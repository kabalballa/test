import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.png';
  site = 'https://eatapplepies.com/';
  version = '1.1.0';

  private categoryCache = new Map<string, WpCategory>();
  private novelCache = new Map<string, CachedNovel>();

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async categoryCover(categoryId: number): Promise<string> {
    try {
      const posts = await this.wp<WpPost[]>(`posts?categories=${categoryId}&per_page=1&orderby=date&order=desc&_embed`);
      const post = posts[0];
      const media = post?._embedded?.['wp:featuredmedia']?.[0];
      if (media?.source_url) return media.source_url;
      const html = post?.content?.rendered || '';
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      return match?.[1] || defaultCover;
    } catch {
      return defaultCover;
    }
  }

  popularNovels = async (pageNo: number): Promise<Plugin.NovelItem[]> => {
    if (pageNo < 1 || pageNo > 10) return [];
    const categories = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=name&order=asc&_fields=id,name,slug,description,count`);
    return Promise.all(categories.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(async c => ({ name: c.name, path: c.slug, cover: await this.categoryCover(c.id) })));
  };

  searchNovels = async (searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> => {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const categories = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true&_fields=id,name,slug,description,count`);
    return Promise.all(categories.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(async c => ({ name: c.name, path: c.slug, cover: await this.categoryCover(c.id) })));
  };

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    let category = this.categoryCache.get(novelPath);
    if (!category) {
      const categories = await this.wp<WpCategory[]>(`categories?slug=${encodeURIComponent(novelPath)}&per_page=1&_fields=id,name,slug,description,count`);
      category = categories[0];
      if (!category) return { name: novelPath, path: novelPath, cover: defaultCover, chapters: [] };
      this.categoryCache.set(novelPath, category);
    }

    let cached = this.novelCache.get(novelPath);
    if (!cached) {
      const chapters = await this.fetchAllChapters(category.id);
      const cover = await this.categoryCover(category.id);
      cached = { chapters, cover };
      this.novelCache.set(novelPath, cached);
    } else {
      cached.chapters = await this.fetchNewChapters(category.id, cached.chapters);
    }

    const chapters = cached.chapters.slice();
    if (novelPath === 'tcf') return this.buildNovel(category, chapters.filter(c => c.seriesKey === 'tcf'), cached.cover);
    return this.buildNovel(category, chapters, cached.cover);
  }

  private async fetchAllChapters(categoryId: number): Promise<ChapterRecord[]> {
    const chapters: ChapterRecord[] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(`posts?categories=${categoryId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=slug,date,title`);
      } catch { break; }
      if (!posts.length) break;
      this.appendChapterPosts(chapters, seen, posts);
      if (posts.length < 100) break;
    }
    return chapters;
  }

  private async fetchNewChapters(categoryId: number, cached: ChapterRecord[]): Promise<ChapterRecord[]> {
    const merged = cached.slice();
    const known = new Set(cached.map(chapter => chapter.path));
    const discovered: ChapterRecord[] = [];
    for (let page = 1; ; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(`posts?categories=${categoryId}&per_page=100&page=${page}&orderby=date&order=desc&_fields=slug,date,title`);
      } catch { return cached; }
      if (!posts.length) break;
      let hitKnownChapter = false;
      for (const post of posts) {
        if (known.has(post.slug)) { hitKnownChapter = true; continue; }
        const title = decodeHtml(post.title?.rendered || '');
        const parsed = parseTitle(title);
        discovered.push({ name: title, path: post.slug, releaseTime: post.date, part: parsed.part, chapterNumber: parsed.chapter, seriesKey: parsed.seriesKey, discoveryIndex: 0 });
      }
      if (hitKnownChapter || posts.length < 100) break;
    }
    discovered.reverse();
    for (const chapter of discovered) { chapter.discoveryIndex = merged.length; merged.push(chapter); }
    return merged;
  }

  private appendChapterPosts(chapters: ChapterRecord[], seen: Set<string>, posts: WpPost[]): void {
    for (const post of posts) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      const title = decodeHtml(post.title?.rendered || '');
      const parsed = parseTitle(title);
      chapters.push({ name: title, path: post.slug, releaseTime: post.date, part: parsed.part, chapterNumber: parsed.chapter, seriesKey: parsed.seriesKey, discoveryIndex: chapters.length });
    }
  }

  private buildNovel(category: WpCategory, chapters: ChapterRecord[], cover: string): Plugin.SourceNovel {
    const isTCF = category.slug === 'tcf' || /trash of the count/i.test(category.name);
    chapters.sort((a, b) => {
      if (isTCF) {
        const ap = a.part ?? 1, bp = b.part ?? 1;
        if (ap !== bp) return ap - bp;
        const ac = a.chapterNumber ?? Number.MAX_SAFE_INTEGER, bc = b.chapterNumber ?? Number.MAX_SAFE_INTEGER;
        if (ac !== bc) return ac - bc;
      }
      const ad = a.releaseTime ? Date.parse(a.releaseTime) : Number.MAX_SAFE_INTEGER;
      const bd = b.releaseTime ? Date.parse(b.releaseTime) : Number.MAX_SAFE_INTEGER;
      return ad !== bd ? ad - bd : a.discoveryIndex - b.discoveryIndex;
    });
    return { name: category.name, path: category.slug, cover, summary: category.description ? stripHtml(category.description) : `Chapters published under ${category.name}.`, chapters: chapters.map(({ part, chapterNumber, seriesKey, discoveryIndex, ...chapter }) => chapter) };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const posts = await this.wp<WpPost[]>(`posts?slug=${encodeURIComponent(chapterPath)}&per_page=1&_fields=content`);
    return posts[0]?.content?.rendered || '<p>Chapter content could not be found.</p>';
  }

  resolveUrl = (path: string) => `${this.site}${path.replace(/^\//, '')}/`;
}

function decodeHtml(value: string): string { return value.replace(/&#8217;|&#x2019;/gi, "'").replace(/&#8216;|&#x2018;/gi, "'").replace(/&#8220;|&#x201C;/gi, '"').replace(/&#8221;|&#x201D;/gi, '"').replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8212;|&#x2014;/gi, '—').replace(/&#038;|&amp;/gi, '&'); }
function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseTitle(title: string): { seriesKey: string; part: number; chapter: number | undefined } {
  const normalized = title.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').trim();
  const part2 = /^trash of the count's family\s+part\s*2\s+chapter\s*(\d+(?:\.\d+)?)/i.exec(normalized);
  if (part2) return { seriesKey: 'tcf', part: 2, chapter: Number(part2[1]) };
  const main = /^trash of the count's family\s*(?:-\s*)?chapter\s*(\d+(?:\.\d+)?)/i.exec(normalized);
  if (main) return { seriesKey: 'tcf', part: 1, chapter: Number(main[1]) };
  const spin = /^(.*?)\s*-\s*chapter\s*(\d+(?:\.\d+)?)/i.exec(normalized);
  if (spin && /count's family/i.test(spin[1])) return { seriesKey: slugify(spin[1]), part: 1, chapter: Number(spin[2]) };
  return { seriesKey: 'other', part: 1, chapter: undefined };
}
function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title?: { rendered: string }; content?: { rendered: string }; _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> } };
type ChapterRecord = Plugin.ChapterItem & { seriesKey: string; part: number; chapterNumber?: number; discoveryIndex: number };
type CachedNovel = { chapters: ChapterRecord[]; cover: string };

export default new EatApplePies();