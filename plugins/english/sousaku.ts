import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://sousaku.blog/';

type NovelLink = {
  name: string;
  path: string;
};

type CachedNovel = {
  name: string;
  cover: string;
  summary: string;
  chapters: Plugin.ChapterItem[];
};

class Sousaku implements Plugin.PluginBase {
  id = 'sousaku';
  name = 'Sousaku – 創作 – We Create!';
  icon = 'src/en/sousaku/icon.svg';
  site = SITE;
  version = '1.0.1';

  private novelLinksCache: NovelLink[] | null = null;
  private novelCache = new Map<string, CachedNovel>();
  private chapterContentCache = new Map<string, string>();

  private async getHtml(path = ''): Promise<string> {
    const response = await fetchApi(new URL(path, this.site).href);
    if (!response.ok) {
      throw new Error(`Sousaku returned ${response.status}`);
    }
    return response.text();
  }

  private normalizePath(href: string): string | null {
    try {
      const url = new URL(href, this.site);
      const siteUrl = new URL(this.site);
      if (url.origin !== siteUrl.origin) return null;
      const pathname = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!pathname) return null;
      return pathname + (url.search || '');
    } catch {
      return null;
    }
  }

  private isLikelyNovelPage(path: string): boolean {
    const clean = path.split('?')[0].replace(/^\/+|\/+$/g, '');
    if (!clean) return false;
    if (/^(category|tag|author|page|feed|comments|wp-|search)(\/|$)/i.test(clean)) return false;
    if (/^\d{4}(\/\d{1,2})?(\/\d{1,2})?(\/|$)/.test(clean)) return false;
    if (/^(about-us|contact-us|discord|donate|privacy-policy)(\/|$)/i.test(clean)) return false;
    if (/\.(xml|rss|atom|jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(clean)) return false;
    return true;
  }

  private async getNovelLinks(): Promise<NovelLink[]> {
    if (this.novelLinksCache) return this.novelLinksCache;

    const html = await this.getHtml();
    const $ = load(html);
    const links = new Map<string, NovelLink>();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return;

      const path = this.normalizePath(href);
      if (!path || !this.isLikelyNovelPage(path)) return;

      // Novel index/ToC links on Sousaku are stable internal pages. Exclude
      // ordinary chapter posts, which normally contain a YYYY/MM path.
      if (/\b(chapter|episode)\s*\d+/i.test(text) && /^\d{4}/.test(path)) return;
      if (links.has(path)) return;

      links.set(path, { name: text, path });
    });

    // Prefer links that look like actual novel ToC pages. The site's main
    // navigation exposes these links, so this also avoids scanning old posts.
    const preferred = [...links.values()].filter(link =>
      /table[- ]of[- ]contents|\bhigh-spec-village\b|\bteihen[- ]ryoushu\b|\bmaseki[- ]gurume\b|\bonly-i-know-that-the-world-will-end\b/i.test(link.path + ' ' + link.name),
    );

    this.novelLinksCache = preferred.length ? preferred : [...links.values()];
    return this.novelLinksCache;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];
    const links = await this.getNovelLinks();
    const pageSize = 20;
    const start = (pageNo - 1) * pageSize;
    return links.slice(start, start + pageSize).map(novel => ({
      name: novel.name,
      path: novel.path,
      cover: defaultCover,
    }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const term = searchTerm.trim().toLowerCase();
    const links = (await this.getNovelLinks()).filter(novel => novel.name.toLowerCase().includes(term) || novel.path.toLowerCase().includes(term));
    const pageSize = 20;
    const start = (pageNo - 1) * pageSize;
    return links.slice(start, start + pageSize).map(novel => ({
      name: novel.name,
      path: novel.path,
      cover: defaultCover,
    }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    let cached = this.novelCache.get(novelPath);
    if (!cached) {
      cached = await this.fetchNovel(novelPath);
      this.novelCache.set(novelPath, cached);
    }

    return {
      name: cached.name,
      path: novelPath,
      cover: cached.cover,
      summary: cached.summary,
      chapters: cached.chapters.slice(),
    };
  }

  private async fetchNovel(novelPath: string): Promise<CachedNovel> {
    const html = await this.getHtml(novelPath);
    const $ = load(html);

    const name = $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('title').first().text().replace(/\s+/g, ' ').trim() ||
      novelPath;

    const content = this.getMainContent($);
    const cover = this.findCover($) || defaultCover;
    const summary = this.findSummary($, content);
    const chapters = this.extractChapters($, novelPath);

    return { name, cover, summary, chapters };
  }

  private getMainContent($: ReturnType<typeof load>): ReturnType<typeof load> {
    const selectors = [
      '.entry-content',
      '.post-content',
      '.single-post-content',
      'article .content',
      'article',
      'main',
    ];
    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim()) return load($.html(element));
    }
    return $;
  }

  private findCover($: ReturnType<typeof load>): string | null {
    const selectors = [
      '.entry-content img',
      'article img',
      'main img',
    ];
    for (const selector of selectors) {
      const src = $(selector).first().attr('src') || $(selector).first().attr('data-src');
      if (src) {
        try {
          return new URL(src, this.site).href;
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  private findSummary($: ReturnType<typeof load>, content: ReturnType<typeof load>): string {
    const heading = content('h2, h3').filter((_, el) => /synopsis|summary/i.test(content(el).text())).first();
    if (heading.length) {
      const paragraphs: string[] = [];
      let next = heading.next();
      while (next.length && !/^h[1-3]$/i.test(next[0].tagName)) {
        const text = next.text().replace(/\s+/g, ' ').trim();
        if (text) paragraphs.push(text);
        next = next.next();
      }
      if (paragraphs.length) return paragraphs.join('\n\n');
    }

    const paragraphs = content('p').map((_, el) => content(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
    return paragraphs.slice(0, 4).join('\n\n') || 'Chapters published by Sousaku.';
  }

  private extractChapters($: ReturnType<typeof load>, novelPath: string): Plugin.ChapterItem[] {
    const novelUrl = new URL(novelPath, this.site).href.replace(/\/$/, '');
    const seen = new Set<string>();
    const chapters: Plugin.ChapterItem[] = [];

    const content = this.getMainContent($);
    content('a[href]').each((_, element) => {
      const href = content(element).attr('href');
      const text = content(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return;

      let url: URL;
      try {
        url = new URL(href, this.site);
      } catch {
        return;
      }
      if (url.origin !== new URL(this.site).origin) return;
      if (!url.pathname || url.href.replace(/\/$/, '') === novelUrl) return;

      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!path || /^\d{4}(\/\d{1,2})?(\/\d{1,2})?(\/|$)/.test(path) === false && !path.startsWith(novelPath.replace(/\/$/, '') + '/')) return;
      if (/patreon\.com/i.test(href)) return;
      if (/^(image|volume|manga|raw|twitter|facebook|discord)$/i.test(text)) return;
      if (seen.has(path)) return;

      const numberMatch = text.match(/(?:chapter|episode)\s*([0-9]+(?:\.[0-9]+)?)/i) || text.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*[-:]/);
      const chapterNumber = numberMatch ? Number(numberMatch[1]) : undefined;

      // ToC pages contain the complete chapter list in chronological order.
      // Preserve that order instead of making a request for every date.
      seen.add(path);
      chapters.push({
        name: text,
        path,
        chapterNumber,
      });
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const cached = this.chapterContentCache.get(chapterPath);
    if (cached) return cached;

    const html = await this.getHtml(chapterPath);
    const $ = load(html);
    const selectors = [
      '.entry-content',
      '.post-content',
      '.single-post-content',
      'article .content',
      'article',
      'main',
    ];

    let element = null as ReturnType<typeof $> | null;
    for (const selector of selectors) {
      const candidate = $(selector).first();
      if (candidate.length && candidate.text().trim()) {
        element = candidate;
        break;
      }
    }

    if (!element) return '<p>Chapter content could not be found.</p>';

    element.find('script, style, nav, header, footer, form, .sharedaddy, .jp-relatedposts, .comments-area').remove();
    const result = element.html()?.trim() || '<p>Chapter content could not be found.</p>';
    this.chapterContentCache.set(chapterPath, result);
    return result;
  }

  resolveUrl = (path: string) => new URL(path.replace(/^\//, ''), this.site).href;
}

export default new Sousaku();
