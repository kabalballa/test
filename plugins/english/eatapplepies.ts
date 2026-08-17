import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.0';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    return response.json() as Promise<T>;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 2) return [];
    const page = await this.wp<WpCategory[]>(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=count&order=desc`);
    return page
      .filter(category => category.slug !== 'uncategorized')
      .filter(category => category.count > 0)
      .map(category => ({
        name: category.name,
        path: category.slug,
        cover: defaultCover,
      }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const page = await this.wp<WpCategory[]>(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true`);
    return page
      .filter(category => category.slug !== 'uncategorized')
      .map(category => ({
        name: category.name,
        path: category.slug,
        cover: defaultCover,
      }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const categories = await this.wp<WpCategory[]>(`categories?slug=${encodeURIComponent(novelPath)}`);
    const category = categories[0];
    if (!category) {
      return { name: novelPath, path: novelPath, cover: defaultCover, chapters: [] };
    }

    const chapters: Plugin.ChapterItem[] = [];
    for (let page = 1; page <= 50; page++) {
      const posts = await this.wp<WpPost[]>(`posts?categories=${category.id}&per_page=100&page=${page}&orderby=date&order=asc&_embed`);
      if (!posts.length) break;
      chapters.push(...posts.map((post, index) => ({
        name: post.title.rendered.replace(/&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"'),
        path: post.slug,
        releaseTime: post.date,
        chapterNumber: extractChapterNumber(post.title.rendered) ?? chapters.length + index + 1,
      })));
      if (posts.length < 100) break;
    }

    return {
      name: category.name,
      path: category.slug,
      cover: defaultCover,
      summary: category.description ? stripHtml(category.description) : `Chapters published under the ${category.name} category on EatApplePies.`,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const posts = await this.wp<WpPost[]>(`posts?slug=${encodeURIComponent(chapterPath)}&per_page=10`);
    const post = posts[0];
    return post?.content?.rendered || '<p>Chapter content could not be found.</p>';
  }

  resolveUrl = (path: string) => `${this.site}${path.replace(/^\//, '')}/`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractChapterNumber(title: string): number | undefined {
  const match = title.match(/(?:chapter|ch\.?|part\s*2\s*chapter)\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content: { rendered: string } };

export default new EatApplePies();
