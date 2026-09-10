import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://sousaku.blog/';
const CHAPTER_MARKER = '__sousaku_chapter';
const CHAPTER_WRAPPER = '/__sousaku_chapter__/';

type CachedNovel = {
  name: string;
  cover: string;
  summary: string;
  status?: Plugin.NovelStatus;
  chapters: Plugin.ChapterItem[];
};

class Sousaku implements Plugin.PluginBase {
  id = 'sousaku';
  name = 'Sousaku – 創作 – We Create!';
  icon = 'src/en/sousaku/icon.svg';
  site = SITE;
  version = '1.2.0';

  private novelCache = new Map<string, CachedNovel>();
  private chapterContentCache = new Map<string, string>();
  private chapterPageCache = new Map<string, string>();
  private catalogCache: Plugin.NovelItem[] | null = null;

  private readonly knownNovels = [
    ['Moto Sekai Ichi', 'motto-sekai-ichi-i-no-sub-chara-ikusei-nikki'],
    ['Labyrinth Renovation', 'labyrinth-renovation-table-of-contents'],
    ['Only I know that the world will end', 'only-i-know-that-the-world-will-end'],
    ['High Spec Village', 'high-spec-village'],
    ['Teihen Ryoushu', 'teihen-ryoushi-toc'],
    ['Tensei arasaa joshi', 'tensei-arasaa-joshi-table-of-contents'],
    ['The villainous noble daughter is perfectly fine alone!', 'the-villainous-noble-daughter-is-perfectly-fine-alone'],
    ['The Lady of the Underworld', 'the-lady-of-the-underworld'],
    ['Beyond the hero’s death', 'beyond-the-heros-death-table-of-contents'],
    ['The abused merchant’s daughter', 'the-abused-merchants-daughter-table-of-contents'],
    ['My Wish was…', 'my-wish-was'],
    ['Maseki Gurume', 'maseki-gurume-toc'],
    ['Maseki Gurume LN', 'maseki-gurume-ln-toc'],
    ['Mistaken for the Demon King', 'mistaken-for-the-demon-king'],
    ['Tou no Madoushi', 'tou-no-madoushi'],
    ['In search of a scenery I’ve yet to see.', 'in-search-of-a-scenery-i-have-yet-to-see'],
    ['Isekai wo Seigyo Mahou de Kirihirake!', 'isekai-wo-seigyo-mahou-de-kirihirake'],
  ] as const;

  private async catalog(): Promise<Plugin.NovelItem[]> {
    if (this.catalogCache) return this.catalogCache;
    const items = await Promise.all(this.knownNovels.map(async ([fallbackName, slug]) => {
      const path = new URL(`${slug}/`, this.site).href;
      try {
        const $ = load(await this.getHtml(path));
        const contentRoot = $('.entry-content').first().length
          ? $('.entry-content').first()
          : $('article').first().length
            ? $('article').first()
            : $('main').first();
        const name = this.extractEntryTitle($) || fallbackName;
        const cover = this.extractCover($, contentRoot);
        return { name, path, cover };
      } catch {
        return { name: fallbackName, path, cover: defaultCover };
      }
    }));
    this.catalogCache = items;
    return items;
  }

  private async getHtml(path = ''): Promise<string> {
    const requestUrl = new URL(path, this.site);
    if (requestUrl.pathname === CHAPTER_WRAPPER && requestUrl.searchParams.has('url')) {
      const encodedTarget = requestUrl.searchParams.get('url');
      if (!encodedTarget) throw new Error('Missing Sousaku chapter URL');
      let target: URL;
      try { target = new URL(encodedTarget); } catch { throw new Error('Invalid Sousaku chapter URL'); }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        throw new Error(`Unsupported Sousaku chapter protocol: ${target.protocol}`);
      }
      target.searchParams.delete(CHAPTER_MARKER);
      const response = await fetchApi(target.href);
      if (!response.ok) throw new Error(`Sousaku returned ${response.status}`);
      return response.text();
    }

    requestUrl.searchParams.delete(CHAPTER_MARKER);
    const response = await fetchApi(requestUrl.href);
    if (!response.ok) throw new Error(`Sousaku returned ${response.status}`);
    return response.text();
  }

  private toChapterPath(url: URL, chapterName: string): string {
    const target = new URL(url.href);
    target.searchParams.delete(CHAPTER_MARKER);
    return new URL(
      `${CHAPTER_WRAPPER}?url=${encodeURIComponent(target.href)}&${CHAPTER_MARKER}=${encodeURIComponent(chapterName)}`,
      this.site,
    ).href;
  }

  private normalizeNovelTitle(text: string): string {
    return text.replace(/\s+/g, ' ').replace(/\s*[–—-]\s*(?:table\s+of\s+contents|toc)\s*$/i, '').trim();
  }

  private normalizeChapterLabel(text: string): string {
    return text
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^chapter\s+/, '')
      .replace(/^episode\s+/, '');
  }

  private extractEntryTitle($: ReturnType<typeof load>): string {
    const entryTitle = $('.entry-content h1.entry-title, .entry-content h1, .entry-content .entry-title').first().text().replace(/\s+/g, ' ').trim();
    const articleTitle = $('article .entry-title, article h1, main .entry-title, main h1').first().text().replace(/\s+/g, ' ').trim();
    const firstTitle = entryTitle || articleTitle;
    if (firstTitle) {
      const title = this.normalizeNovelTitle(firstTitle);
      if (title && !/^(sousaku|kari translates japanese novels)$/i.test(title)) return title;
    }
    const explicitEnglishTitle = $('article, main, .entry-content').first().find('*')
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
      .find(text => /^english\s+title\s*:/i.test(text));
    if (explicitEnglishTitle) return this.normalizeNovelTitle(explicitEnglishTitle.replace(/^english\s+title\s*:\s*/i, '').trim());
    return '';
  }

  private extractCover($: ReturnType<typeof load>, contentRoot: ReturnType<typeof load>): string {
    const coverSrc = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || contentRoot.find('img').first().attr('src');
    if (!coverSrc) return defaultCover;
    try { return new URL(coverSrc, this.site).href; } catch { return defaultCover; }
  }

  private extractNovelStatus($: ReturnType<typeof load>, slug: string): Plugin.NovelStatus {
    const text = $('article, main, .entry-content').first().text().replace(/\s+/g, ' ').trim();
    if (/\b(?:series|novel)\s*(?:status|state)\s*[:\-]\s*completed\b/i.test(text)) return NovelStatus.Completed;
    if (/\b(?:series|novel)\s*(?:status|state)\s*[:\-]\s*(?:on\s+)?hiatus\b/i.test(text)) return NovelStatus.OnHiatus;
    if (/\b(?:series|novel)\s*(?:status|state)\s*[:\-]\s*(?:cancelled|canceled)\b/i.test(text)) return NovelStatus.Cancelled;
    if (/\b(?:series|novel)\s*(?:status|state)\s*[:\-]\s*(?:ongoing|active|in progress)\b/i.test(text)) return NovelStatus.Ongoing;
    const completedSlugs = new Set(['beyond-the-heros-death-table-of-contents', 'the-abused-merchants-daughter-table-of-contents']);
    if (completedSlugs.has(slug)) return NovelStatus.Completed;
    return NovelStatus.Unknown;
  }

  private extractChapterReleaseTime($: ReturnType<typeof load>, url: URL, element: ReturnType<ReturnType<typeof load>>): string | undefined {
    const dateMatch = url.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
    if (dateMatch) return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const rawDate = element.attr('datetime') || element.attr('data-date') || element.closest('[datetime], [data-date]').first().attr('datetime') || element.closest('[datetime], [data-date]').first().attr('data-date');
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return undefined;
  }

  private extractChapters($: ReturnType<typeof load>, novelPath: string, _hasContentRoot: boolean): Plugin.ChapterItem[] {
    const seen = new Set<string>();
    const chapters: Plugin.ChapterItem[] = [];
    const novelUrl = new URL(novelPath, this.site);
    const contentRoot = $('.entry-content').first().length ? $('.entry-content').first() : $('article').first().length ? $('article').first() : $('main').first();
    const root = contentRoot.length ? contentRoot : $('body');
    const excludedPattern = /^(?:illustrations?|manga)\s*:?\s*$/i;
    let inExcludedSection = false;

    root.find('h1, h2, h3, h4, h5, h6, a[href]').each((_, node) => {
      const tag = String(node.name || '').toLowerCase();
      const element = $(node);
      const text = element.text().replace(/\s+/g, ' ').trim();

      if (/^h[1-6]$/.test(tag)) {
        inExcludedSection = excludedPattern.test(text);
        return;
      }
      if (tag !== 'a' || inExcludedSection) return;

      const href = element.attr('href');
      if (!href || !text) return;

      let url: URL;
      try { url = new URL(href, this.site); } catch { return; }

      const cleanTarget = new URL(url.href);
      cleanTarget.searchParams.delete(CHAPTER_MARKER);
      const originalFragment = cleanTarget.hash;
      const cleanBase = new URL(cleanTarget.href);
      cleanBase.hash = '';

      if (cleanBase.href.replace(/\/$/, '') === novelUrl.href.replace(/\/$/, '')) return;

      const path = cleanBase.pathname.replace(/^\/+|\/+$/g, '');
      const lowerPath = path.toLowerCase();
      if (!path || /\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(path)) return;
      if (/(?:^|[\s_-])illustrations?(?:[\s_-]|$)/i.test(`${text} ${path}`) || /(?:^|[\s_-])manga(?:[\s_-]|$)/i.test(`${text} ${path}`)) return;

      const textLooksLikeChapter = /(?:chapter|episode|prologue|epilogue|interlude|idle\s*talk)/i.test(text) || /^\s*\d{1,4}(?:\.\d+)?\s*[-:–—]/.test(text);
      const pathLooksLikeChapter = /(?:chapter|episode|prologue|epilogue|interlude|idle-talk)/i.test(lowerPath) || /(?:^|-)\d{1,4}(?:-|\/|$)/.test(lowerPath);
      if (!textLooksLikeChapter && !pathLooksLikeChapter) return;
      if (/^(category|tag|author|about|contact|discord|donate|patreon|wp-|feed|page)(\/|$)/i.test(path)) return;

      const identity = `${cleanBase.href.replace(/\/$/, '')}::${this.normalizeChapterLabel(text)}::${originalFragment}`;
      if (seen.has(identity)) return;
      seen.add(identity);

      const numberMatch = text.match(/(?:chapter|episode)\s*([0-9]+(?:\.[0-9]+)?)/i) || text.match(/^\s*(\d{1,4}(?:\.\d+)?)\s*[-:–—]/);
      chapters.push({
        name: text,
        path: this.toChapterPath(cleanTarget, text),
        chapterNumber: numberMatch ? Number(numberMatch[1]) : undefined,
        releaseTime: this.extractChapterReleaseTime($, cleanBase, element),
      });

      const chapter = chapters[chapters.length - 1];
      if (chapter && originalFragment) {
        const wrapper = new URL(chapter.path, this.site);
        const encodedTarget = wrapper.searchParams.get('url');
        if (encodedTarget) {
          const target = new URL(encodedTarget);
          target.hash = originalFragment;
          wrapper.searchParams.set('url', target.href);
          chapter.path = wrapper.href;
        }
      }
    });

    return chapters;
  }

  private isChapterMarkerText(text: string): boolean {
    const normalized = text.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    return /^(?:chapter\s+|episode\s+|prologue\b|epilogue\b|interlude\b|idle\s*talk\b)/i.test(normalized);
  }

  private findChapterMarker($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>, requestedLabel: string, fragment = ''): ReturnType<typeof load> {
    if (fragment) {
      const id = decodeURIComponent(fragment.replace(/^#/, ''));
      const escaped = id.replace(/([\\.#:[\],>+~*])/g, '\\$1');
      const target = root.find(`#${escaped}`).first();
      if (target.length) {
        const targetText = target.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
        const targetTag = String(target[0]?.name || '').toLowerCase();
        if (/^h[1-6]$/.test(targetTag) || this.isChapterMarkerText(targetText)) return target;

        const parent = target.parent();
        if (parent.length) {
          const parentText = parent.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
          const parentTag = String(parent[0]?.name || '').toLowerCase();
          if (/^h[1-6]$/.test(parentTag) || this.isChapterMarkerText(parentText)) return parent;
        }

        let current = target.next();
        while (current.length) {
          const currentTag = String(current[0]?.name || '').toLowerCase();
          const currentText = current.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
          if (/^h[1-6]$/.test(currentTag) || this.isChapterMarkerText(currentText)) return current;
          current = current.next();
        }
      }

      const named = root.find(`[name="${id.replace(/"/g, '\\"')}"]`).first();
      if (named.length) {
        const namedText = named.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
        const namedTag = String(named[0]?.name || '').toLowerCase();
        if (/^h[1-6]$/.test(namedTag) || this.isChapterMarkerText(namedText)) return named;
        let current = named.next();
        while (current.length) {
          const currentTag = String(current[0]?.name || '').toLowerCase();
          const currentText = current.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
          if (/^h[1-6]$/.test(currentTag) || this.isChapterMarkerText(currentText)) return current;
          current = current.next();
        }
      }
    }

    const normalized = this.normalizeChapterLabel(requestedLabel);
    if (!normalized) return root.find('__no_such_chapter_marker__').first();

    return root.find('h1, h2, h3, h4, h5, h6, p, div, li, strong, b, span').filter((_, element) => {
      const text = $(element).text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
      const value = this.normalizeChapterLabel(text);
      if (!text || !this.isChapterMarkerText(text)) return false;
      return value === normalized
        || value.startsWith(`${normalized}:`)
        || value.startsWith(`${normalized} -`)
        || value.startsWith(`${normalized} –`)
        || value.startsWith(`${normalized} —`);
    }).first();
  }

  private getChapterBlock(marker: ReturnType<ReturnType<typeof load>>): ReturnType<ReturnType<typeof load>> {
    const tag = String(marker[0]?.name || '').toLowerCase();
    if (/^(strong|b|span|a)$/.test(tag)) {
      const parent = marker.parent();
      if (parent.length) return parent;
    }
    return marker;
  }

  private extractRequestedChapter($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>, requestedLabel: string, fragment = ''): string {
    const marker = this.findChapterMarker($, root, requestedLabel, fragment);
    if (!marker.length) return '';

    const block = this.getChapterBlock(marker);
    const blockTag = String(block[0]?.name || '').toLowerCase();
    const result: string[] = [];

    if (/^h[1-6]$/.test(blockTag)) {
      const level = Number(blockTag.slice(1));
      let current = block.next();
      while (current.length) {
        const currentTag = String(current[0]?.name || '').toLowerCase();
        const currentText = current.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
        if (/^h[1-6]$/.test(currentTag) && Number(currentTag.slice(1)) <= level) break;
        if (currentText && this.isChapterMarkerText(currentText)) break;
        result.push($.html(current) || '');
        current = current.next();
      }
      return result.filter(Boolean).join('').trim();
    }

    const parent = block.parent();
    if (!parent.length) return '';
    let current = block.next();
    while (current.length) {
      const currentTag = String(current[0]?.name || '').toLowerCase();
      const currentText = current.text().replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
      if (/^h[1-6]$/.test(currentTag) || (currentText && this.isChapterMarkerText(currentText))) break;
      result.push($.html(current) || '');
      current = current.next();
    }
    return result.filter(Boolean).join('').trim();
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
    const matches = term ? items.filter(item => item.name.toLowerCase().includes(term) || item.path.toLowerCase().includes(term)) : items;
    const start = Math.max(0, pageNo - 1) * 20;
    return matches.slice(start, start + 20);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    let cached = this.novelCache.get(novelPath);
    if (!cached) {
      cached = await this.fetchNovel(novelPath);
      this.novelCache.set(novelPath, cached);
    }
    return { name: cached.name, path: novelPath, cover: cached.cover, summary: cached.summary, status: cached.status, chapters: cached.chapters.slice() };
  }

  private async fetchNovel(novelPath: string): Promise<CachedNovel> {
    const $ = load(await this.getHtml(novelPath));
    const content = $('.entry-content').first();
    const contentRoot = content.length ? content : $('article').first().length ? $('article').first() : $('main').first();
    const name = this.extractEntryTitle($) || novelPath;
    const cover = this.extractCover($, contentRoot);
    const slug = new URL(novelPath, this.site).pathname.replace(/^\/+|\/+$/g, '');
    const status = this.extractNovelStatus($, slug);
    const paragraphs = contentRoot.find('p').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
    const summary = paragraphs.slice(0, 4).join('\n\n') || 'Chapters published by Sousaku.';
    const chapters = this.extractChapters($, novelPath, contentRoot.length > 0);
    return { name, cover, summary, status, chapters };
  }

  private async fetchChapterPage(cleanUrl: string): Promise<string> {
    const cached = this.chapterPageCache.get(cleanUrl);
    if (cached) return cached;
    const html = await this.getHtml(cleanUrl);
    this.chapterPageCache.set(cleanUrl, html);
    return html;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const cached = this.chapterContentCache.get(chapterPath);
    if (cached) return cached;

    const requestUrl = new URL(chapterPath, this.site);
    const requestedLabel = requestUrl.searchParams.get(CHAPTER_MARKER) || '';
    let cleanUrl = '';
    let fragment = '';

    if (requestUrl.pathname === CHAPTER_WRAPPER && requestUrl.searchParams.has('url')) {
      const encodedTarget = requestUrl.searchParams.get('url');
      if (!encodedTarget) return '<p>Chapter content could not be found.</p>';
      try {
        const target = new URL(encodedTarget);
        fragment = target.hash;
        target.hash = '';
        target.searchParams.delete(CHAPTER_MARKER);
        cleanUrl = target.href;
      } catch {
        return '<p>Chapter content could not be found.</p>';
      }
    } else {
      fragment = requestUrl.hash;
      requestUrl.hash = '';
      requestUrl.searchParams.delete(CHAPTER_MARKER);
      cleanUrl = requestUrl.href;
    }

    const $ = load(await this.fetchChapterPage(cleanUrl));
    const element = $('.entry-content').first();
    if (!element.length) return '<p>Chapter content could not be found.</p>';
    element.find('script, style, nav, header, footer, form, .sharedaddy, .jp-relatedposts, .comments-area').remove();

    let result = '';
    if (fragment || requestedLabel) {
      result = this.extractRequestedChapter($, element, requestedLabel, fragment);
    }

    if ((fragment || requestedLabel) && !result) {
      result = '<p>Requested chapter could not be isolated.</p>';
    }
    if (!result) result = element.html()?.trim() || '<p>Chapter content could not be found.</p>';

    this.chapterContentCache.set(chapterPath, result);
    return result;
  }

  resolveUrl = (path: string) => new URL(path, this.site).href;
}

export default new Sousaku();
