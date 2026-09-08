import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://sousaku.blog/';

type NovelLink = { name: string; path: string };
type CachedNovel = { name: string; cover: string; summary: string; chapters: Plugin.ChapterItem[] };

class Sousaku implements Plugin.PluginBase {
  id = 'sousaku';
  name = 'Sousaku – 創作 – We Create!';
  icon = 'src/en/sousaku/icon.svg';
  site = SITE;
  version = '1.0.4';

  private novelLinksCache: NovelLink[] | null = null;
  private novelCache = new Map<string, CachedNovel>();
  private chapterContentCache = new Map<string, string>();

  // These are the stable ToC pages exposed by Sousaku's main navigation.
  // Keep them as a fallback because WordPress.com can occasionally return a
  // different/blocked homepage response to the Android app's HTTP client.
  private readonly knownNovels: NovelLink[] = [
    { name: 'Moto Sekai Ichi Table of Contents', path: 'motto-sekai-ichi-i-no-sub-chara-ikusei-nikki' },
    { name: 'Labyrinth Renovation – Table of contents', path: 'labyrinth-renovation-table-of-contents' },
    { name: 'Only I know that the world will end – Table of Contents', path: 'only-i-know-that-the-world-will-end' },
    { name: 'High Spec Village', path: 'high-spec-village' },
    { name: 'Teihen Ryoushu ToC', path: 'teihen-ryoushi-toc' },
    { name: 'Tensei arasaa joshi – Table of contents', path: 'tensei-arasaa-joshi-table-of-contents' },
    { name: 'The Lady of the Underworld – ToC', path: 'the-lady-of-the-underworld' },
    { name: 'Beyond the hero’s death – Table of contents', path: 'beyond-the-heros-death-table-of-contents' },
    { name: 'The abused merchant’s daughter – Table of contents', path: 'the-abused-merchants-daughter-table-of-contents' },
    { name: 'Maseki Gurume – ToC', path: 'maseki-gurume-toc' },
    { name: 'Maseki Gurume LN – ToC', path: 'maseki-gurume-ln-toc' },
    { name: 'Mistaken for the Demon King', path: 'mistaken-for-the-demon-king' },
    { name: 'Isekai wo Seigyo Mahou de Kirihirake!', path: 'isekai-wo-seigyo-mahou-de-kirihirake' },
  ];

  private async getHtml(path = ''): Promise<string> {
    const response = await fetchApi(new URL(path, this.site).href);
    if (!response.ok) throw new Error(`Sousaku returned ${response.status}`);
    return response.text();
  }

  private normalizePath(href: string): string | null {
    try {
      const url = new URL(href, this.site);
      if (url.origin !== new URL(this.site).origin) return null;
      const pathname = url.pathname.replace(/^\/+|\/+$/g, '');
      return pathname || null;
    } catch {
      return null;
    }
  }

  private isUtilityPage(path: string): boolean {
    return /^(category|tag|author|page|feed|comments|wp-|search|about|about-us|contact|contact-us|discord|donate|privacy-policy|patreon)(\/|$)/i.test(path)
      || /^\d{4}(\/|$)/.test(path)
      || /\.(xml|rss|atom|jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(path);
  }

  private async getNovelLinks(): Promise<NovelLink[]> {
    if (this.novelLinksCache) return this.novelLinksCache;

    // Start with the known ToC catalog so results are available even when the
    // homepage cannot be fetched by the LNReader runtime.
    const links = new Map<string, NovelLink>(this.knownNovels.map(novel => [novel.path, novel]));

    try {
      const $ = load(await this.getHtml());
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        if (!href || !text) return;

        const path = this.normalizePath(href);
        if (!path || path.includes('/') || this.isUtilityPage(path)) return;

        // Only merge root-level links that are already known as novel ToCs.
        // This avoids turning ordinary homepage links into fake novels.
        if (links.has(path)) links.get(path)!.name = text;
      });
    } catch {
      // Keep the static catalog if the homepage request fails.
    }

    this.novelLinksCache = [...links.values()];
    return this.novelLinksCache;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];
    const links = await this.getNovelLinks();
    const start = (pageNo - 1) * 20;
    return links.slice(start, start + 20).map(novel => ({ name: novel.name, path: novel.path, cover: defaultCover }));
  }

  async searchNovels(searchTerm: string, pageNo?: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.trim().toLowerCase();
    const links = (await this.getNovelLinks()).filter(n => n.name.toLowerCase().includes(term) || n.path.toLowerCase().includes(term));
    const page = pageNo && pageNo > 0 ? pageNo : 1;
    const start = (page - 1) * 20;
    return links.slice(start, start + 20).map(novel => ({ name: novel.name, path: novel.path, cover: defaultCover }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    let cached = this.novelCache.get(novelPath);
    if (!cached) {
      cached = await this.fetchNovel(novelPath);
      this.novelCache.set(novelPath, cached);
    }
    return { name: cached.name, path: novelPath, cover: cached.cover, summary: cached.summary, chapters: cached.chapters.slice() };
  }

  private async fetchNovel(novelPath: string): Promise<CachedNovel> {
    const $ = load(await this.getHtml(novelPath));
    const content = $('.entry-content').first();
    const name = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').first().text().trim() || novelPath;
    const coverSrc = $('meta[property="og:image"]').attr('content') || content.find('img').first().attr('src');
    let cover = defaultCover;
    if (coverSrc) {
      try { cover = new URL(coverSrc, this.site).href; } catch { /* keep default */ }
    }

    const paragraphs = content('p').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
    const summary = paragraphs.slice(0, 4).join('\n\n') || 'Chapters published by Sousaku.';
    const chapters = this.extractChapters($, novelPath);
    return { name, cover, summary, chapters };
  }

  private extractChapters($: ReturnType<typeof load>, novelPath: string): Plugin.ChapterItem[] {
    const content = $('.entry-content').first();
    const seen = new Set<string>();
    const chapters: Plugin.ChapterItem[] = [];
    const novelUrl = new URL(novelPath, this.site).href.replace(/\/$/, '');

    content('a[href]').each((_, element) => {
      const href = content(element).attr('href');
      const text = content(element).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return;
      let url: URL;
      try { url = new URL(href, this.site); } catch { return; }
      if (url.origin !== new URL(this.site).origin || url.href.replace(/\/$/, '') === novelUrl) return;

      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!path || seen.has(path) || /\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(path)) return;
      if (/^(category|tag|author|about|contact|discord|donate|patreon)(\/|$)/i.test(path)) return;

      const chapterLike = /(?:chapter|episode|prologue|epilogue|idle talk)/i.test(text)
        || /^\s*\d{3,4}\s*[-:]/.test(text)
        || /\/(?:chapter|episode)[-\d]/i.test(path)
        || /^\d{4}\//.test(path);
      if (!chapterLike) return;

      const numberMatch = text.match(/(?:chapter|episode)\s*([0-9]+(?:\.[0-9]+)?)/i) || text.match(/^\s*(\d{1,4})\s*[-:]/);
      seen.add(path);
      chapters.push({ name: text, path, chapterNumber: numberMatch ? Number(numberMatch[1]) : undefined });
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const cached = this.chapterContentCache.get(chapterPath);
    if (cached) return cached;
    const $ = load(await this.getHtml(chapterPath));
    const element = $('.entry-content').first();
    if (!element.length) return '<p>Chapter content could not be found.</p>';
    element.find('script, style, nav, header, footer, form, .sharedaddy, .jp-relatedposts, .comments-area').remove();
    const result = element.html()?.trim() || '<p>Chapter content could not be found.</p>';
    this.chapterContentCache.set(chapterPath, result);
    return result;
  }

  resolveUrl = (path: string) => new URL(path.replace(/^\//, ''), this.site).href;
}

export default new Sousaku();
