import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.3';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 2) return [];
    const page = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=count&order=desc`);
    return page.filter(category => category.slug !== 'uncategorized' && category.count > 0)
      .map(category => ({ name: category.name, path: category.slug, cover: defaultCover }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const page = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true`);
    return page.filter(category => category.slug !== 'uncategorized' && category.count > 0)
      .map(category => ({ name: category.name, path: category.slug, cover: defaultCover }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const categories = await this.wp<WpCategory[]>(`categories?slug=${encodeURIComponent(novelPath)}`);
    const category = categories[0];
    if (!category) return { name: novelPath, path: novelPath, cover: defaultCover, chapters: [] };

    const chapters: Plugin.ChapterItem[] = [];

    // EAP's WordPress installation can cap API responses at 10 posts even
    // when per_page=100 is requested. Therefore a 10-item response is NOT
    // the end; continue until WordPress returns an actually empty page.
    for (let page = 1; page <= 250; page++) {
      let posts: WpPost[];
      try {
        posts = await this.wp<WpPost[]>(`posts?categories=${category.id}&per_page=100&page=${page}&orderby=date&order=asc`);
      } catch {
        break;
      }
      if (!posts.length) break;

      posts.forEach(post => {
        chapters.push({
          name: decodeHtml(post.title.rendered),
          path: post.slug,
          releaseTime: post.date,
          chapterNumber: extractChapterNumber(post.title.rendered) ?? chapters.length + 1,
        });
      });
    }

    chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));

    return {
      name: category.name,
      path: category.slug,
      cover: defaultCover,
      summary: category.description ? stripHtml(category.description) : `Chapters published under the ${category.name} category on EatApplePies.`,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const posts = await this.wp<WpPost[]>(`posts?slug=${encodeURIComponent(chapterPath)}&per_page=1`);
    return posts[0]?.content?.rendered || '<p>Chapter content could not be found.</p>';
  }

  resolveUrl = (path: string) => `${this.site}${path.replace(/^\//, '')}/`;
}

function decodeHtml(value: string): string {
  return value.replace(/&#8217;|&#x2019;/gi, "'").replace(/&#8216;|&#x2018;/gi, "'")
    .replace(/&#8220;|&#x201C;/gi, '"').replace(/&#8221;|&#x201D;/gi, '"')
    .replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8212;|&#x2014;/gi, '—')
    .replace(/&#038;|&amp;/gi, '&');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractChapterNumber(title: string): number | undefined {
  const part2 = title.match(/part\s*2\s*chapter\s*(\d+)/i);
  if (part2) return 100000 + Number(part2[1]);
  const match = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content: { rendered: string } };

export default new EatApplePies();
