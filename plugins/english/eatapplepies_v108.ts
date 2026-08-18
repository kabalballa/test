import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.12';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 10) return [];
    const categories = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=name&order=asc&_fields=id,name,slug,description,count`);
    return categories.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(c => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const categories = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true&_fields=id,name,slug,description,count`);
    return categories.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(c => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const categories = await this.wp<WpCategory[]>(`categories?slug=${encodeURIComponent(novelPath)}&per_page=1&_fields=id,name,slug,description,count`);
    const category = categories[0];
    if (!category) return { name: novelPath, path: novelPath, cover: defaultCover, chapters: [] };

    const chapters: ChapterWithIndex[] = [];
    const seen = new Set<string>();
    const totalPages = Math.ceil(category.count / 100);

    // Only request the number of pages that this category actually contains.
    // This avoids the old 250-page upper bound and keeps large categories fast.
    for (let page = 1; page <= totalPages; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(
          `posts?categories=${category.id}&per_page=100&page=${page}&orderby=date&order=asc&_fields=slug,date,title`
        );
      } catch {
        break;
      }

      if (!posts.length) break;

      for (const post of posts) {
        if (seen.has(post.slug)) continue;
        seen.add(post.slug);
        chapters.push({
          name: decodeHtml(post.title.rendered),
          path: post.slug,
          releaseTime: post.date,
          discoveryIndex: chapters.length,
        });
      }

      if (posts.length < 100) break;
    }

    // EAP's WordPress publication timestamp is the sole ordering key.
    // For identical timestamps, preserve the API's stable order.
    // No chapter number is exposed because LNReader may independently sort
    // chapterNumber and would incorrectly mix TCF and TCF Part 2.
    chapters.sort((a, b) => {
      const ad = a.releaseTime ? Date.parse(a.releaseTime) : Number.MAX_SAFE_INTEGER;
      const bd = b.releaseTime ? Date.parse(b.releaseTime) : Number.MAX_SAFE_INTEGER;
      return ad !== bd ? ad - bd : a.discoveryIndex - b.discoveryIndex;
    });

    return {
      name: category.name,
      path: category.slug,
      cover: defaultCover,
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

function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content?: { rendered: string } };
type ChapterWithIndex = Plugin.ChapterItem & { discoveryIndex: number };

export default new EatApplePies();
