const cheerio = require("cheerio");
const { fetchApi } = require("@libs/fetch");
const { defaultCover } = require("@libs/defaultCover");

class EatApplePies {
  constructor() {
    this.id = "eatapplepies";
    this.name = "EatApplePies";
    this.icon = "src/en/eatapplepies/icon.svg";
    this.site = "https://eatapplepies.com";
    this.version = "1.0.1";
  }

  async fetchPage(url) {
    const response = await fetchApi(url);
    if (!response.ok) throw new Error(`EatApplePies returned ${response.status}`);
    return cheerio.load(await response.text());
  }

  async wp(path) {
    const response = await fetchApi(`${this.site}/wp-json/wp/v2/${path}`);
    if (!response.ok) throw new Error(`WordPress API returned ${response.status}`);
    return response.json();
  }

  async popularNovels(pageNo) {
    if (pageNo < 1 || pageNo > 2) return [];
    const categories = await this.wp(`categories?per_page=100&page=${pageNo}&hide_empty=true&orderby=count&order=desc`);
    return categories.filter((c) => c.slug !== "uncategorized" && c.count > 0).map((c) => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  async searchNovels(searchTerm, pageNo) {
    if (!searchTerm.trim() || pageNo < 1) return [];
    const categories = await this.wp(`categories?search=${encodeURIComponent(searchTerm)}&per_page=100&page=${pageNo}&hide_empty=true`);
    return categories.filter((c) => c.slug !== "uncategorized").map((c) => ({ name: c.name, path: c.slug, cover: defaultCover }));
  }

  parseArchive($, chapters) {
    const seen = new Set(chapters.map((c) => c.path));
    const selectors = ["article .entry-title a", "article h2.entry-title a", "article h3.entry-title a", ".post .entry-title a", ".post-title a"];
    let links = [];
    for (const selector of selectors) {
      links = $(selector).toArray();
      if (links.length) break;
    }
    links.forEach((element, index) => {
      const href = $(element).attr("href");
      const name = $(element).text().replace(/\s+/g, " ").trim();
      if (!href || !name) return;
      const absolute = href.startsWith("http") ? href : `${this.site}${href.startsWith("/") ? "" : "/"}${href}`;
      if (!absolute.startsWith(this.site) || seen.has(absolute)) return;
      const match = name.match(/(?:chapter|ch\.?|part\s*\d+\s*chapter)\s*(\d+(?:\.\d+)?)/i);
      chapters.push({ name, path: absolute.replace(this.site, "") || "/", releaseTime: "", chapterNumber: match ? Number(match[1]) : chapters.length + index + 1 });
      seen.add(absolute);
    });
    return links.length;
  }

  async parseNovel(novelPath) {
    const slug = String(novelPath).replace(/^\/+|\/+$/g, "");
    const chapters = [];
    let pageUrl = `${this.site}/category/${encodeURIComponent(slug)}/?posts_per_page=100`;
    let pages = 0;
    let novelName = slug;

    while (pageUrl && pages < 250) {
      const $ = await this.fetchPage(pageUrl);
      const heading = $("h1").first().text().replace(/^Category Archives:\s*/i, "").trim();
      if (heading) novelName = heading;
      const count = this.parseArchive($, chapters);
      if (!count) break;
      const next = $(".nav-links a.next, .pagination a.next, a.next.page-numbers, a.next-posts-link").first().attr("href");
      pageUrl = next ? (next.startsWith("http") ? next : `${this.site}${next.startsWith("/") ? "" : "/"}${next}`) : null;
      pages++;
    }

    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
    return { name: novelName, path: novelPath, cover: defaultCover, summary: `Chapters published under the ${novelName} category on EatApplePies.`, chapters };
  }

  async parseChapter(chapterPath) {
    const url = chapterPath.startsWith("http") ? chapterPath : `${this.site}${chapterPath.startsWith("/") ? "" : "/"}${chapterPath}`;
    const $ = await this.fetchPage(url);
    const content = $("article .entry-content, article .post-content, .entry-content, .post-content, .single-post-content").first().clone();
    content.find("script, style, noscript, iframe, form, .sharedaddy, .jp-relatedposts, .comments-area").remove();
    return content.html() || "<p>Chapter content could not be found.</p>";
  }

  resolveUrl(path) {
    return path.startsWith("http") ? path : `${this.site}${path.startsWith("/") ? "" : "/"}${path}`;
  }
}

module.exports.default = new EatApplePies();
