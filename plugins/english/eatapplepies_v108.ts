import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.8';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    return [{ name: "Trash of the Count's Family", path: 'tcf', cover: defaultCover }];
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    const q = searchTerm.toLowerCase();
    const name = "Trash of the Count's Family";
    return name.toLowerCase().includes(q) ? [{ name, path: 'tcf', cover: defaultCover }] : [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const categories = await this.wp<WpCategory[]>(`categories?slug=tcf`);
    const category = categories[0];
    if (!category) return { name: "Trash of the Count's Family", path: novelPath, cover: defaultCover, chapters: [] };

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
        if (chapters.some(c => c.path === post.slug)) continue;
        const title = decodeHtml(post.title.rendered);
        chapters.push({ name: title, path: post.slug, releaseTime: post.date, chapterNumber: extractChapterNumber(title) });
      }
      if (posts.length < 10) break;
    }

    chapters.sort((a, b) => {
      const ad = a.releaseTime ? Date.parse(a.releaseTime) : Number.MAX_SAFE_INTEGER;
      const bd = b.releaseTime ? Date.parse(b.releaseTime) : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER);
    });

    return { name: "Trash of the Count's Family", path: novelPath, cover: defaultCover, summary: 'Trash of the Count’s Family chapters in EatApplePies upload order.', chapters };
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

function extractChapterNumber(title: string): number | undefined {
  const match = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content: { rendered: string } };

export default new EatApplePies();
