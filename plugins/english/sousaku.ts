import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class Sousaku implements Plugin.PluginBase {
  id = 'sousaku';
  name = 'Sousaku – 創作 – We Create!';
  icon = 'src/en/sousaku/icon.svg';
  site = 'https://sousaku.blog/';
  version = '1.0.0';

  private categoryCache = new Map<string, WpCategory>();
  private novelCache = new Map<string, CachedNovel>();

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`Sousaku API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async categoryCover(categoryId: number): Promise<string> {
    try {
      const posts = await this.wp<WpPost[]>(`posts?categories=${categoryId}&per_page=1&orderby=date&order=desc&_embed&_fields=featured_media,content,_embedded`);
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

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 10) return [];
    const categories = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=name&order=asc&_fields=id,name,slug,description,count`);
    const novels = categories.filter(c => c.slug !== 'uncategorized' && c.count > 0);
    return Promise.all(novels.map(async c => ({ name: c.name, path: c.slug, cover: await this.categoryCover(c.id) })));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const categories = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true&_fields=id,name,slug,description,count`);
    const novels = categories.filter(c => c.slug !== 'uncategorized' && c.count > 0);
    return Promise.all(novels.map(async c => ({ name: c.name, path: c.slug, cover: await this.categoryCover(c.id) })));
  }

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

    return this.buildNovel(category, cached.chapters.slice(), cached.cover);
  }

  private async fetchAllChapters(categoryId: number): Promise<ChapterRecord[]> {
    const chapters: ChapterRecord[] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(`posts?categories=${categoryId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=slug,date,title`);
      } catch {
        break;
      }
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
      } catch {
        return cached;
      }
      if (!posts.length) break;

      let hitKnownChapter = false;
      for (const post of posts) {
        if (known.has(post.slug)) {
          hitKnownChapter = true;
          continue;
        }
        const title = decodeHtml(post.title?.rendered || '');
        discovered.push({ name: title, path: post.slug, releaseTime: post.date, discoveryIndex: 0 });
      }

      if (hitKnownChapter || posts.length < 100) break;
    }

    discovered.reverse();
    for (const chapter of discovered) {
      chapter.discoveryIndex = merged.length;
      merged.push(chapter);
    }
    return merged;
  }

  private appendChapterPosts(chapters: ChapterRecord[], seen: Set<string>, posts: WpPost[]): void {
    for (const post of posts) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      const title = decodeHtml(post.title?.rendered || '');
      chapters.push({ name: title, path: post.slug, releaseTime: post.date, discoveryIndex: chapters.length });
    }
  }

  private buildNovel(category: WpCategory, chapters: ChapterRecord[], cover: string): Plugin.SourceNovel {
    chapters.sort((a, b) => {
      const ad = a.releaseTime ? Date.parse(a.releaseTime) : Number.MAX_SAFE_INTEGER;
      const bd = b.releaseTime ? Date.parse(b.releaseTime) : Number.MAX_SAFE_INTEGER;
      return ad !== bd ? ad - bd : a.discoveryIndex - b.discoveryIndex;
    });
    return {
      name: category.name,
      path: category.slug,
      cover,
      summary: category.description ? stripHtml(category.description) : `Chapters published under ${category.name}.`,
      chapters: chapters.map(({ discoveryIndex, ...chapter }) => chapter),
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const posts = await this.wp<WpPost[]>(`posts?slug=${encodeURIComponent(chapterPath)}&per_page=1&_fields=content`);
    return posts[0]?.content?.rendered || '<p>Chapter content could not be found.</p>';
  }

  resolveUrl = (path: string) => `${this.site}${path.replace(/^\//, '')}/`;
}

function decodeHtml(value: string): string {
  return value.replace(/&#8217;|&#x2019;/gi, "'").replace(/&#8216;|&#x2018;/gi, "'").replace(/&#8220;|&#x201C;/gi, '"').replace(/&#8221;|&#x201D;/gi, '"').replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8212;|&#x2014;/gi, '—').replace(/&#038;|&amp;/gi, '&');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title?: { rendered: string }; content?: { rendered: string }; _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> } };
type ChapterRecord = Plugin.ChapterItem & { discoveryIndex: number };
type CachedNovel = { chapters: ChapterRecord[]; cover: string };

export default new Sousaku();