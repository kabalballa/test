import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { defaultCover } from '@libs/defaultCover';
import { Plugin } from '@/types/plugin';

class AzureChronicles implements Plugin.PluginBase {
  id = 'azurechronicles';
  name = 'Azure Chronicles';
  icon = 'src/en/azurechronicles/icon.svg';
  site = 'https://azurechronicles.com/';
  version = '1.0.0';

  private novelCache = new Map<string, Plugin.SourceNovel>();

  private async get(path: string): Promise<string> {
    const response = await fetchApi(`${this.site}${path.replace(/^\//, '')}`);
    if (!response.ok) throw new Error(`Azure Chronicles returned ${response.status}`);
    return response.text();
  }

  private normalizePath(href: string): string | null {
    try {
      const url = new URL(href, this.site);
      if (url.origin !== new URL(this.site).origin) return null;
      const match = url.pathname.match(/^\/novel\/([^/]+)\/?$/i);
      return match ? `/novel/${match[1]}/` : null;
    } catch {
      return null;
    }
  }

  private parseNovelLinks(html: string): Plugin.NovelItem[] {
    const $ = parseHTML(html);
    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      const path = this.normalizePath(href);
      if (!path || seen.has(path)) return;

      const name = $(element).text().replace(/\s+/g, ' ').trim();
      if (!name || /^(read novel|novel)$/i.test(name)) return;

      seen.add(path);
      const image = $(element).find('img').attr('src');
      novels.push({ name, path, cover: image || defaultCover });
    });

    return novels;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1 || pageNo > 7) return [];
    const path = pageNo === 1 ? 'series/' : `series/page/${pageNo}/`;
    try {
      return this.parseNovelLinks(await this.get(path));
    } catch {
      return [];
    }
  }

  async searchNovels(searchTerm: string, pageNo = 1): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim();
    if (!query || pageNo < 1) return [];

    const path = pageNo === 1
      ? `series/?s=${encodeURIComponent(query)}`
      : `series/page/${pageNo}/?s=${encodeURIComponent(query)}`;

    try {
      const novels = this.parseNovelLinks(await this.get(path));
      const normalized = normalize(query);
      return novels.filter(novel => normalize(novel.name).includes(normalized));
    } catch {
      return [];
    }
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const cached = this.novelCache.get(novelPath);
    if (cached) return cached;

    const html = await this.get(novelPath);
    const $ = parseHTML(html);
    const path = novelPath.endsWith('/') ? novelPath : `${novelPath}/`;
    const slug = path.match(/^\/novel\/([^/]+)\//i)?.[1];

    const title = $('h1').first().text().replace(/\s+/g, ' ').trim()
      || $('title').first().text().replace(/\s+/g, ' ').trim()
      || slug?.replace(/-/g, ' ')
      || novelPath;

    const cover = $('main img, article img, .novel img, img').first().attr('src') || defaultCover;
    const summary = cleanText(
      $('meta[name="description"]').attr('content')
        || $('main .description, article .description, .novel-description, .summary').first().text()
        || '',
    );

    const chapters = this.parseChapters($, path);
    const novel: Plugin.SourceNovel = {
      name: title,
      path: novelPath,
      cover,
      summary: summary || undefined,
      chapters,
    };

    this.novelCache.set(novelPath, novel);
    return novel;
  }

  private parseChapters($: ReturnType<typeof parseHTML>, novelPath: string): Plugin.ChapterItem[] {
    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<string>();
    const prefix = novelPath.replace(/\/$/, '');
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const chapterPattern = new RegExp(`^${escapedPrefix}/chapter-[^/]+/?$`, 'i');

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, this.site);
      } catch {
        return;
      }
      if (url.origin !== new URL(this.site).origin) return;

      const chapterPath = url.pathname;
      if (!chapterPattern.test(chapterPath) || seen.has(chapterPath)) return;

      const name = cleanText($(element).text());
      if (!name || !/chapter\s*\d+/i.test(name)) return;

      const chapterMatch = name.match(/chapter\s*(\d+(?:\.\d+)?)/i)
        || chapterPath.match(/chapter-(\d+(?:\.\d+)?)/i);

      seen.add(chapterPath);
      chapters.push({
        name,
        path: chapterPath,
        chapterNumber: chapterMatch ? Number(chapterMatch[1]) : undefined,
      });
    });

    chapters.sort((a, b) => {
      const an = a.chapterNumber ?? Number.MAX_SAFE_INTEGER;
      const bn = b.chapterNumber ?? Number.MAX_SAFE_INTEGER;
      return an - bn || a.name.localeCompare(b.name);
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await this.get(chapterPath);
    const $ = parseHTML(html);
    const title = cleanText($('h1').first().text());

    const content = $('article .entry-content, article .chapter-content, article [class*="chapter-content"], .chapter-content, .reading-content, .entry-content, main').first();
    content.find('script, style, nav, header, footer, .sharedaddy, .comments, .comment-respond').remove();

    return `${title ? `<h1>${escapeHtml(title)}</h1>` : ''}${content.html() || '<p>Chapter content could not be found.</p>'}`;
  }

  resolveUrl = (path: string) => new URL(path.replace(/^\//, ''), this.site).toString();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default new AzureChronicles();
