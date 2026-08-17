import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.5';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 10) return [];
    const page = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=name&order=asc`);
    return page.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(c => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const page = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true`);
    return page.filter(c => c.slug !== 'uncategorized' && c.count > 0).map(c => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const categories = await this.wp<WpCategory[]>(`categories?slug=${encodeURIComponent(novelPath)}`);
    const category = categories[0];
    if (!category) return { name: novelPath, path: novelPath, cover: defaultCover, chapters: [] };

    const chapters: Plugin.ChapterItem[] = [];
    for (let page = 1; page <= 250; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(`posts?categories=${category.id}&per_page=10&page=${page}&orderby=date&order=asc`);
      } catch {
        break;
      }
      if (!posts.length) break;
      for (const post of posts) {
        if (!chapters.some(c => c.path === post.slug)) {
          chapters.push({ name: decodeHtml(post.title.rendered), path: post.slug, releaseTime: post.date, chapterNumber: extractChapterNumber(post.title.rendered) ?? chapters.length + 1 });
        }
      }
      if (posts.length < 10) break;
    }
    chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    return { name: category.name, path: category.slug, cover: defaultCover, summary: category.description ? stripHtml(category.description) : `Chapters published under the ${category.name} category on EatApplePies.`, chapters };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const posts = await this.wp<WpPost[]>(`posts?slug=${encodeURIComponent(chapterPath)}&per_page=1`);
    return posts[0]?.content?.rendered || '<p>Chapter content could not be found.</p>';
  }

  resolveUrl = (path: string) => `${this.site}${path.replace(/^\//, '')}/`;
}

function decodeHtml(value: string): string {
  return value.replace(/&#8217;|&#x2019;/gi, "'").replace(/&#8216;|&#x2018;/gi, "'").replace(/&#8220;|&#x201C;/gi, '"').replace(/&#8221;|&#x201D;/gi, '"').replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8212;|&#x2014;/gi, '—').replace(/&#038;|&amp;/gi, '&');
}
function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractChapterNumber(title: string): number | undefined { const m = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i); return m ? Number(m[1]) : undefined; }
type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content: { rendered: string } };
export default new EatApplePies();
