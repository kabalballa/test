const cheerio = require("cheerio");
const { fetchApi } = require("@libs/fetch");
const { defaultCover } = require("@libs/defaultCover");

class EatApplePies {
  constructor() {
    this.id = "eatapplepies";
    this.name = "EatApplePies";
    this.icon = "src/en/eatapplepies/icon.svg";
    this.site = "https://eatapplepies.com";
    this.version = "1.0.2";
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

      // EAP uses titles such as "Chapter 123", "Chapter 123.5" and
      // "Part 2 Chapter 410". Capture the chapter number wherever it occurs.
      const match = name.match(/chapter\s+(\d+(?:\.\d+)?)/i);
      const chapterNumber = match ? Number(match[1]) : chapters.length + index + 1;

      chapters.push({
        name,
        path: absolute.replace(this.site, "") || "/",
        releaseTime: "",
        chapterNumber,
      });
      seen.add(absolute);
    });

    return links.length;
  }

  async parseNovel(novelPath) {
    const slug = String(novelPath).replace(/^\/+|\/+$/g, "");
    const chapters = [];
    let novelName = slug;
    let page = 1;

    // EatApplePies serves category archives in 10-post pages. The archive
    // pagination isn't consistently marked with a "next" class, so construct
    // /page/N/ URLs directly. This prevents the parser from stopping after the
    // first 10 chapters.
    while (page <= 300) {
      const pageUrl = page === 1
        ? `${this.site}/category/${encodeURIComponent(slug)}/`
        : `${this.site}/category/${encodeURIComponent(slug)}/page/${page}/`;

      const $ = await this.fetchPage(pageUrl);
      const heading = $("h1").first().text().replace(/^Category Archives:\s*/i, "").trim();
      if (heading) novelName = heading;

      const before = chapters.length;
      const count = this.parseArchive($, chapters);
      if (!count || chapters.length === before) break;

      page += 1;
    }

    chapters.sort((a, b) => {
      if (a.chapterNumber !== b.chapterNumber) return a.chapterNumber - b.chapterNumber;
      return a.name.localeCompare(b.name);
    });

    return {
      name: novelName,
      path: novelPath,
      cover: defaultCover,
      summary: `Chapters published under the ${novelName} category on EatApplePies.`,
      chapters,
    };
  }

  async parseChapter(chapterPath) {
    const url = chapterPath.startsWith("http")
      ? chapterPath
      : `${this.site}${chapterPath.startsWith("/") ? "" : "/"}${chapterPath}`;
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
