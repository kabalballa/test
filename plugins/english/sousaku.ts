import { load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

const SITE = 'https://sousaku.blog/';

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
  version = '1.0.7';

  private novelCache = new Map<string, CachedNovel>();
  private chapterContentCache = new Map<string, string>();

  // Keep source listing completely local. This prevents the LNReader source
  // screen from depending on a homepage request that may fail in the app's
  // networking environment.
  private readonly knownNovels = [
    ['Moto Sekai Ichi Table of Contents', 'motto-sekai-ichi-i-no-sub-chara-ikusei-nikki'],
    ['Labyrinth Renovation – Table of contents', 'labyrinth-renovation-table-of-contents'],
    ['Only I know that the world will end – Table of Contents', 'only-i-know-that-the-world-will-end'],
    ['High Spec Village', 'high-spec-village'],
    ['Teihen Ryoushu ToC', 'teihen-ryoushi-toc'],
    ['Tensei arasaa joshi – Table of contents', 'tensei-arasaa-joshi-table-of-contents'],
    ['The villainous noble daughter is perfectly fine alone!', 'the-villainous-noble-daughter-is-perfectly-fine-alone'],
    ['The Lady of the Underworld – ToC', 'the-lady-of-the-underworld'],
    ['Beyond the hero’s death – Table of contents', 'beyond-the-heros-death-table-of-contents'],
    ['The abused merchant’s daughter – Table of contents', 'the-abused-merchants-daughter-table-of-contents'],
    ['My Wish was…', 'my-wish-was'],
    ['Maseki Gurume – ToC', 'maseki-gurume-toc'],
    ['Maseki Gurume LN – ToC', 'maseki-gurume-ln-toc'],
    ['Mistaken for the Demon King', 'mistaken-for-the-demon-king'],
    ['Tou no Madoushi', 'tou-no-madoushi'],
    ['In search of a scenery I’ve yet to see.', 'in-search-of-a-scenery-i-have-yet-to-see'],
    ['Isekai wo Seigyo Mahou de Kirihirake!', 'isekai-wo-seigyo-mahou-de-kirihirake'],
  ] as const;

  private catalog(): Plugin.NovelItem[] {
    return this.knownNovels.map(([name, slug]) => ({
      name,
      path: new URL(`${slug}/`, this.site).href,
      cover: defaultCover,
    }));
  }

  private async getHtml(path = ''): Promise<string> {
    const response = await fetchApi(new URL(path, this.site).href);
    if (!response.ok) throw new Error(`Sousaku returned ${response.status}`);
    return response.text();
  }

  async popularNovels(pageNo: number, _options?: unknown): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];
    const items = this.catalog();
    const start = (pageNo - 1) * 20;
    return items.slice(start, start + 20);
  }

  async searchNovels(searchTerm: string, pageNo = 1): Promise<Plugin.NovelItem[]> {
    const items = this.catalog();
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
      chapters.push({ name: text, path: url.href, chapterNumber: numberMatch ? Number(numberMatch[1]) : undefined });
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

  resolveUrl = (path: string) => new URL(path, this.site).href;
}

export default new Sousaku();
