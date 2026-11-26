// 页面模板：全部是纯字符串拼接，没有模板引擎，改一眼就能看懂。

import { escapeHtml as esc } from "./markdown.mjs";

const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function cnNumber(n) {
  if (n === 0) return "〇";
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return n === 10 ? "十" : "十" + CN_DIGITS[n % 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return CN_DIGITS[tens] + "十" + (ones ? CN_DIGITS[ones] : "");
}

function cnYear(year) {
  return String(year)
    .split("")
    .map((d) => CN_DIGITS[Number(d)] ?? d)
    .join("");
}

function parseDate(value) {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 列表里的短日期：11·26 */
export function fmtShort(value) {
  const d = parseDate(value);
  if (!d) return esc(value);
  return `${String(d.month).padStart(2, "0")}·${String(d.day).padStart(2, "0")}`;
}

/** 文章页的长日期：二〇二六年十一月二十六日 */
export function fmtChinese(value) {
  const d = parseDate(value);
  if (!d) return esc(value);
  return `${cnYear(d.year)}年${cnNumber(d.month)}月${cnNumber(d.day)}日`;
}

/** ISO 8601，用于 RSS 和 <time datetime> */
export function fmtISO(value) {
  const d = parseDate(value);
  if (!d) return "";
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}T09:00:00+08:00`;
}

export function fmtYear(value) {
  const d = parseDate(value);
  return d ? cnYear(d.year) : "";
}

export function joinUrl(base, pathname) {
  const b = base.endsWith("/") ? base : base + "/";
  const p = String(pathname).replace(/^\/+/, "");
  return b + p;
}

export function absoluteUrl(site, base, pathname) {
  const origin = String(site.url || "").replace(/\/+$/, "");
  if (!origin) return joinUrl(base, pathname);
  return origin + joinUrl(base, pathname);
}

function navHtml(site, base, active) {
  return (site.nav ?? [])
    .map((item) => {
      const on = item.key && item.key === active;
      return `<a href="${joinUrl(base, item.href)}"${on ? ' class="is-active" aria-current="page"' : ""}>${esc(item.label)}</a>`;
    })
    .join("");
}

export function layout(site, base, options) {
  const { title, description, active, main, pageClass = "", canonical = "", noindex = false } = options;
  const fullTitle = title ? `${title} · ${site.siteTitle}` : `${site.siteTitle} · ${site.tagline ?? ""}`;
  const desc = description || site.bio || "";
  const cssHref = joinUrl(base, "assets/style.css");
  const iconHref = joinUrl(base, "assets/favicon.svg");
  const rssHref = joinUrl(base, "rss.xml");

  const ogImage = site.avatar ? absoluteUrl(site, base, site.avatar) : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="author" content="${esc(site.author ?? "")}">
<meta name="color-scheme" content="light">
${noindex ? '<meta name="robots" content="noindex">' : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:type" content="${options.ogType ?? "website"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(site.siteTitle)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<link rel="stylesheet" href="${cssHref}">
<link rel="icon" href="${iconHref}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.siteTitle)}" href="${rssHref}">
</head>
<body${pageClass ? ` class="${esc(pageClass)}"` : ""}>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-head">
  <div class="wrap head-inner">
    <a class="brand" href="${joinUrl(base, "")}">${esc(site.siteTitle)}</a>
    <nav class="site-nav">${navHtml(site, base, active)}</nav>
  </div>
</header>
<main id="main" class="wrap">
${main}
</main>
<footer class="site-foot">
  <div class="wrap foot-inner">
    ${site.seal ? `<span class="seal" aria-hidden="true">${esc(site.seal)}</span>` : ""}
    <p class="foot-note">${esc(site.footerNote ?? "")}</p>
    <p class="foot-meta"><a href="${rssHref}">RSS 订阅</a><span aria-hidden="true">·</span><span>© ${new Date().getFullYear()} ${esc(site.author ?? "")}</span></p>
  </div>
</footer>
</body>
</html>
`;
}

function heroHtml(site, base) {
  const avatar = site.avatar
    ? `<img class="avatar" src="${joinUrl(base, site.avatar)}" alt="${esc(site.author ?? "")}" width="96" height="96" decoding="async">`
    : "";
  const links = (site.links ?? [])
    .map((l) => `<a href="${esc(l.url)}" rel="noreferrer noopener"${/^https?:/.test(l.url) ? ' target="_blank"' : ""}>${esc(l.label)}</a>`)
    .join('<span class="dot" aria-hidden="true">·</span>');

  return `<section class="hero">
    ${avatar}
    <h1 class="hero-name">${esc(site.author ?? "")}</h1>
    <p class="hero-tagline">${esc(site.tagline ?? "")}</p>
    ${site.bio ? `<p class="hero-bio">${esc(site.bio)}</p>` : ""}
    ${links ? `<p class="hero-links">${links}</p>` : ""}
  </section>`;
}

function postRow(item, base) {
  const tags = item.tags.length
    ? `<span class="row-tags">${item.tags.map((t) => esc(t)).join(" / ")}</span>`
    : "";
  return `<li class="row">
    <a class="row-link" href="${joinUrl(base, `posts/${item.slug}/`)}">
      <time class="row-date" datetime="${fmtISO(item.date)}">${fmtShort(item.date)}</time>
      <span class="row-main">
        <span class="row-title">${esc(item.title)}</span>
        <span class="row-summary">${esc(item.summary)}</span>
        ${tags}
      </span>
    </a>
  </li>`;
}

/** 按年份分组的文章列表 */
export function postListHtml(items, base, { showAll = false } = {}) {
  if (!items.length) {
    return `<p class="empty">还没有文章。写第一篇吧。</p>`;
  }
  const list = showAll ? items : items.slice(0, 6);
  let html = "";
  let currentYear = null;

  for (const item of list) {
    const year = fmtYear(item.date) || "未署日期";
    if (year !== currentYear) {
      if (currentYear !== null) html += "</ul>";
      html += `<h3 class="year-head">${esc(year)}</h3><ul class="rows">`;
      currentYear = year;
    }
    html += postRow(item, base);
  }
  if (currentYear !== null) html += "</ul>";
  return html;
}

export function workCardHtml(item, base) {
  const cover = item.cover
    ? `<span class="card-cover"><img src="${joinUrl(base, item.cover)}" alt="" loading="lazy" decoding="async"></span>`
    : "";
  const status = item.status ? `<span class="card-status">${esc(item.status)}</span>` : "";
  return `<li class="work-card">
    <a class="card-link" href="${joinUrl(base, `works/${item.slug}/`)}">
      ${cover}
      <span class="card-body">
        ${status}
        <span class="card-title">${esc(item.title)}</span>
        <span class="card-desc">${esc(item.summary)}</span>
        <span class="card-meta">${fmtShort(item.date)}${item.tags.length ? " · " + item.tags.map((t) => esc(t)).join(" / ") : ""}</span>
      </span>
    </a>
  </li>`;
}

export function homeMain(site, base, posts, works) {
  const recentWorks = works.slice(0, 3);
  return `${heroHtml(site, base)}
<section class="block">
  <div class="block-head">
    <h2 class="block-title">近笔</h2>
    <a class="more" href="${joinUrl(base, "posts/")}">全部文章</a>
  </div>
  ${postListHtml(posts, base)}
</section>
${
  recentWorks.length
    ? `<section class="block">
  <div class="block-head">
    <h2 class="block-title">小作</h2>
    <a class="more" href="${joinUrl(base, "works/")}">全部作品</a>
  </div>
  <ul class="work-grid">${recentWorks.map((w) => workCardHtml(w, base)).join("")}</ul>
</section>`
    : ""
}
<section class="block block-quiet">
  <p class="quote-line">愿你在漫长的时间里，留得下一点自己的声音。</p>
</section>`;
}

export function pageHead(title, subtitle) {
  return `<header class="page-head">
    <h1 class="page-title">${esc(title)}</h1>
    ${subtitle ? `<p class="page-sub">${esc(subtitle)}</p>` : ""}
  </header>`;
}

/** older = 更早一篇，newer = 更新一篇 */
export function postPageMain(site, base, post, older, newer) {
  const tags = post.tags.length
    ? `<p class="post-tags">${post.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>`
    : "";
  const nav = [];
  if (newer) {
    nav.push(
      `<a class="post-nav-item" href="${joinUrl(base, `posts/${newer.slug}/`)}"><span class="nav-label">← 上一篇</span><span class="nav-title">${esc(newer.title)}</span></a>`,
    );
  }
  if (older) {
    nav.push(
      `<a class="post-nav-item is-right" href="${joinUrl(base, `posts/${older.slug}/`)}"><span class="nav-label">下一篇 →</span><span class="nav-title">${esc(older.title)}</span></a>`,
    );
  }

  return `<article class="article">
  <header class="article-head">
    <p class="article-date"><time datetime="${fmtISO(post.date)}">${fmtChinese(post.date)}</time></p>
    <h1 class="article-title">${esc(post.title)}</h1>
    <p class="article-meta"><span>约 ${post.minutes} 分钟</span>${post.tags.length ? `<span aria-hidden="true">·</span><span>${post.tags.map((t) => esc(t)).join(" / ")}</span>` : ""}</p>
  </header>
  <div class="prose">
${post.html}
  </div>
  ${tags}
  <div class="article-foot">
    <a class="back" href="${joinUrl(base, "posts/")}">← 回到文章列表</a>
  </div>
</article>
${nav.length ? `<nav class="post-nav" aria-label="文章翻页">${nav.join("")}</nav>` : ""}`;
}

export function workPageMain(site, base, work) {
  const cover = work.cover
    ? `<figure class="work-cover"><img src="${joinUrl(base, work.cover)}" alt="${esc(work.title)}" loading="lazy" decoding="async"></figure>`
    : "";
  const link = work.link
    ? `<p class="work-link"><a href="${esc(work.link)}" target="_blank" rel="noreferrer noopener">前往看看 →</a></p>`
    : "";
  return `<article class="article">
  <header class="article-head">
    <p class="article-date"><time datetime="${fmtISO(work.date)}">${fmtChinese(work.date)}</time></p>
    <h1 class="article-title">${esc(work.title)}</h1>
    <p class="article-meta">${work.status ? `<span>${esc(work.status)}</span>` : ""}${work.tags.length ? `<span aria-hidden="true">·</span><span>${work.tags.map((t) => esc(t)).join(" / ")}</span>` : ""}</p>
  </header>
  ${cover}
  <div class="prose">
${work.html}
  </div>
  ${link}
  <div class="article-foot">
    <a class="back" href="${joinUrl(base, "works/")}">← 回到作品列表</a>
  </div>
</article>`;
}

export function rssXml(site, base, posts) {
  const items = posts
    .slice(0, 20)
    .map((p) => {
      const url = absoluteUrl(site, base, `posts/${p.slug}/`);
      const pub = p.date ? new Date(fmtISO(p.date) || p.date) : new Date();
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${pub.toUTCString()}</pubDate>
      <description>${esc(p.summary)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.siteTitle)}</title>
    <link>${esc(absoluteUrl(site, base, ""))}</link>
    <description>${esc(site.bio ?? site.tagline ?? "")}</description>
    <language>zh-CN</language>
    <atom:link href="${esc(absoluteUrl(site, base, "rss.xml"))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function notFoundMain(site, base) {
  return `<section class="notfound">
    <p class="nf-code">四〇四</p>
    <h1 class="nf-title">这一页被风带走了</h1>
    <p class="nf-text">你要找的东西不在这里。也许它还没写，也许它换了名字。</p>
    <p class="nf-back"><a href="${joinUrl(base, "")}">回到首页</a></p>
  </section>`;
}
