import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';

class EatApplePies implements Plugin.PluginBase {
  id = 'eatapplepies';
  name = 'EatApplePies';
  icon = 'src/en/eatapplepies/icon.svg';
  site = 'https://eatapplepies.com/';
  version = '1.0.6';

  private async wp<T>(endpoint: string): Promise<T> {
    const response = await fetchApi(`${this.site}wp-json/wp/v2/${endpoint}`);
    if (!response.ok) throw new Error(`EatApplePies API returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  private novels(): Plugin.NovelItem[] {
    return [
      { name: "Trash of the Count's Family", path: 'tcf', cover: defaultCover },
      { name: "Trash of the Count's Family Part 2", path: 'tcf-part2', cover: defaultCover },
    ];
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo === 1) return this.novels();
    return [];
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    const q = searchTerm.toLowerCase();
    return this.novels().filter(n => n.name.toLowerCase().includes(q));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const part2 = novelPath === 'tcf-part2';
    const categories = await this.wp<WpCategory[]>(`categories?slug=tcf`);
    const category = categories[0];
    if (!category) return { name: part2 ? "Trash of the Count's Family Part 2" : "Trash of the Count's Family", path: novelPath, cover: defaultCover, chapters: [] };

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
        const title = decodeHtml(post.title.rendered);
        const isPart2 = /\bpart\s*2\s*chapter\s*\d+/i.test(title);
        if (isPart2 !== part2) continue;
        if (chapters.some(c => c.path === post.slug)) continue;
        chapters.push({
          name: title,
          path: post.slug,
          releaseTime: post.date,
          chapterNumber: extractChapterNumber(title) ?? chapters.length + 1,
        });
      }

      if (posts.length < 10) break;
    }

    chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    return {
      name: part2 ? "Trash of the Count's Family Part 2" : "Trash of the Count's Family",
      path: novelPath,
      cover: defaultCover,
      summary: part2 ? 'Trash of the Count’s Family Part 2 chapters.' : 'Trash of the Count’s Family chapters 1–627.',
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
  return value.replace(/&#8217;|&#x2019;/gi, "'").replace(/&#8216;|&#x2018;/gi, "'").replace(/&#8220;|&#x201C;/gi, '"').replace(/&#8221;|&#x201D;/gi, '"').replace(/&#8211;|&#x2013;/gi, '–').replace(/&#8212;|&#x2014;/gi, '—').replace(/&#038;|&amp;/gi, '&');
}

function extractChapterNumber(title: string): number | undefined {
  const part2 = title.match(/part\s*2\s*chapter\s*(\d+)/i);
  if (part2) return Number(part2[1]);
  const match = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

type WpCategory = { id: number; name: string; slug: string; description: string; count: number };
type WpPost = { slug: string; date: string; title: { rendered: string }; content: { rendered: string } };

export default new EatApplePies();
