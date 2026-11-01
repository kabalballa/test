import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://www.tseirptranslations.com/';

type CachedNovel = {
  name: string;
  cover: string;
  summary: string;
  chapters: Plugin.ChapterItem[];
};

class TseirpTranslations implements Plugin.PluginBase {
  id = 'tseirptranslations';
  name = 'Tseirp Translations';
  icon = 'src/en/tseirptranslations/icon.svg';
  site = SITE;
  version = '1.0.0';

  private novelCache = new Map<string, CachedNovel>();
  private chapterContentCache = new Map<string, string>();
  private catalogCache: Plugin.NovelItem[] | null = null;

  private readonly knownNovels = [
    ['Water Magician', 'water-magician'],
    ['Monster Eater', 'monster-eater'],
    ['Condemned Saint', 'condemned-saint'],
    ['Invincible Saint ~ Salaryman', 'invincible-saint-salaryman-toc'],
    ['Growth Cheat', 'growth-cheat-toc'],
    ['Resourceful Victoria', 'victoria'],
    ['Slow Life Frontier', 'slow-life-frontier-toc'],
    ['Live Dungeon!', 'live-dungeon'],
  ] as const;

  private async getHtml(path = ''): Promise<string> {
    const url = new URL(path, this.site);
    const response = await fetchApi(url.href);
    if (!response.ok) throw new Error('Tseirp Translations returned ' + response.status);
    return response.text();
  }

  private contentRoot($: ReturnType<typeof load>): ReturnType<typeof load> {
    const entry = $('.entry-content').first();
    if (entry.length) return entry;
    const article = $('article').first();
    if (article.length) return article;
    return $('main').first();
  }

  private normalizeTitle(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s*[–—-]\s*(?:table\s+of\s+contents|toc)\s*$/i, '')
      .trim();
  }

  private extractTitle($: ReturnType<typeof load>): string {
    const heading = $('article .entry-title, article h1, main .entry-title, main h1, .entry-content h1')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (heading) return this.normalizeTitle(heading);

    const openGraphTitle = $('meta[property="og:title"]').attr('content') || '';
    return this.normalizeTitle(openGraphTitle.replace(/\s*[|–—-]\s*Tseirp Translations\s*$/i, ''));
  }

  private extractCover($: ReturnType<typeof load>, content: ReturnType<typeof load>): string {
    const image = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content')
      || content.find('img').first().attr('src');

    if (!image) return defaultCover;
    try {
      return new URL(image, this.site).href;
    } catch {
      return defaultCover;
    }
  }

  private async catalog(): Promise<Plugin.NovelItem[]> {
    if (this.catalogCache) return this.catalogCache;

    const items = await Promise.all(this.knownNovels.map(async ([fallbackName, slug]) => {
      const path = new URL(slug + '/', this.site).href;
      try {
        const $ = load(await this.getHtml(path));
        const content = this.contentRoot($);
        const name = this.extractTitle($) || fallbackName;
        const cover = this.extractCover($, content);
        return { name, path, cover };
      } catch {
        return { name: fallbackName, path, cover: defaultCover };
      }
    }));

    this.catalogCache = items;
    return items;
  }

  async popularNovels(pageNo: number, _options?: unknown): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];
    const items = await this.catalog();
    const start = (pageNo - 1) * 20;
    return items.slice(start, start + 20);
  }

  async searchNovels(searchTerm: string, pageNo = 1): Promise<Plugin.NovelItem[]> {
    const items = await this.catalog();
    const term = searchTerm.trim().toLowerCase();
    const matches = term
      ? items.filter(item => item.name.toLowerCase().includes(term) || item.path.toLowerCase().includes(term))
      : items;
    const start = Math.max(0, pageNo - 1) * 20;
    return matches.slice(start, start + 20);
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
    const $ = load(await this.getHtml(novelPath));
    const content = this.contentRoot($);
    const name = this.extractTitle($) || novelPath;
    const cover = this.extractCover($, content);

    const paragraphs = content.find('p')
      .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    const summary = paragraphs.slice(0, 5).join('\n\n') || 'Chapters published by Tseirp Translations.';
    const chapters = this.extractChapters($, novelPath, content.length > 0);

    return { name, cover, summary, chapters };
  }

  private extractChapters(
    $: ReturnType<typeof load>,
    novelPath: string,
    hasContent: boolean,
  ): Plugin.ChapterItem[] {
    const seen = new Set<string>();
    const chapters: Plugin.ChapterItem[] = [];
    const novelUrl = new URL(novelPath, this.site);
    const siteOrigin = new URL(this.site).origin;

    let links = this.contentRoot($).find('a[href]');
    if (!links.length || !hasContent) links = $('article .entry-content a[href], article a[href]');

    links.each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return;

      let url: URL;
      try {
        url = new URL(href, this.site);
      } catch {
        return;
      }

      if (url.origin !== siteOrigin) return;
      if (url.href.replace(/\/$/, '') === novelUrl.href.replace(/\/$/, '')) return;
      if (url.hash && url.pathname === novelUrl.pathname) return;

      const path = url.pathname.toLowerCase();
      if (!path || /\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(path)) return;
      if (/illustrations?|fan[- ]?art|manga|character[- ]?(?:list|glossary)|glossary|interview|donat|patreon|privacy|contact/i.test(text + ' ' + path)) return;

      const parent = $(element).parent();
      const parentText = parent.clone().children('a').remove().end().text().replace(/\s+/g, ' ').trim();
      const isPartLink = /^(?:part|pt\.?)\s*\d+/i.test(text) && /chapter\s*\d+/i.test(parentText);
      const chapterName = isPartLink ? parentText + ' ' + text : text;

      const textLooksLikeChapter = /^(?:chapter\b|ch\.?\s*\d|prologue\b|epilogue\b|extra\b|side story\b)/i.test(text)
        || /^\(\s*\d{1,4}\s*\)/.test(text);
      const parentHasChapter = isPartLink;
      const pathLooksLikeChapter = /(?:chapter|chap|ch[-_/]?\d|wm-v\d+c\d)/i.test(path);

      if (!textLooksLikeChapter && !parentHasChapter && !pathLooksLikeChapter) return;
      if (seen.has(url.href)) return;

      const numberMatch = chapterName.match(/chapter\s*0*(\d{1,4})(?:[.-](\d+))?/i)
        || chapterName.match(/^\s*\(\s*(\d{1,4})\s*\)/)
        || chapterName.match(/\bv\d+c0*(\d{1,4})/i);

      seen.add(url.href);
      chapters.push({
        name: chapterName,
        path: url.href,
        chapterNumber: numberMatch ? Number(numberMatch[1]) : undefined,
      });
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const cached = this.chapterContentCache.get(chapterPath);
    if (cached) return cached;

    const $ = load(await this.getHtml(chapterPath));
    const content = this.contentRoot($);
    if (!content.length) return '<p>Chapter content could not be found.</p>';

    content.find('script, style, nav, header, footer, form, .sharedaddy, .jp-relatedposts, .comments-area, .post-navigation, .wp-block-buttons').remove();
    const result = content.html()?.trim() || '<p>Chapter content could not be found.</p>';
    this.chapterContentCache.set(chapterPath, result);
    return result;
  }

  resolveUrl = (path: string) => new URL(path, this.site).href;
}

export default new TseirpTranslations();
