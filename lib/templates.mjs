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

  // 自定义背景图：压在宣纸色下面，靠 tint 的透明度控制露出多少，保证文字始终可读
  const bgImage = String(site.background?.image ?? "").trim();
  let bgStyle = "";
  if (bgImage) {
    const strength = Math.min(1, Math.max(0, Number(site.background?.strength ?? 0.3)));
    // 0 强度 = 完全被纸色遮住；1 强度 = 露出 28%。留足纸色，正文才不会发虚
    const tint = (0.98 - strength * 0.26).toFixed(3);
    bgStyle = `<style>:root{--bg-image:url("${esc(joinUrl(base, bgImage))}");--bg-tint:rgba(248,243,232,${tint})}</style>`;
  }

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
${bgStyle}
</head>
<body${pageClass ? ` class="${esc(pageClass)}"` : ""}>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-head">
  <div class="wrap head-inner">
    <a class="brand" href="${joinUrl(base, "")}">${esc(site.siteTitle)}</a>
    <div class="head-right">
      <nav class="site-nav">${navHtml(site, base, active)}</nav>
      ${site.admin?.enabled ? `<a class="admin-link" href="${joinUrl(base, "admin/")}" rel="nofollow">${esc(site.admin.label || "管理")}</a>` : ""}
    </div>
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
    ? `<img class="avatar" src="${joinUrl(base, site.avatar)}" alt="${esc(site.author ?? "")}" width="84" height="84" decoding="async">`
    : "";
  const links = (site.links ?? [])
    .map((l) => `<a href="${esc(l.url)}" rel="noreferrer noopener"${/^https?:/.test(l.url) ? ' target="_blank"' : ""}>${esc(l.label)}</a>`)
    .join('<span class="dot" aria-hidden="true">·</span>');

  return `<section class="hero">
    ${avatar}
    <div class="hero-body">
      <h1 class="hero-name">${esc(site.author ?? "")}</h1>
      <p class="hero-tagline">${esc(site.tagline ?? "")}</p>
      ${site.bio ? `<p class="hero-bio">${esc(site.bio)}</p>` : ""}
      ${links ? `<p class="hero-links">${links}</p>` : ""}
    </div>
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

// ---------------- 首页三栏 ----------------

function colHead(title, href, moreLabel = "全部") {
  return `<div class="col-head">
      <h2 class="col-title">${esc(title)}</h2>
      <a class="col-more" href="${href}">${esc(moreLabel)} →</a>
    </div>`;
}

function miniPosts(posts, base, limit = 4) {
  if (!posts.length) return `<p class="empty mini-empty">还没有文章。</p>`;
  return `<ul class="mini-list">${posts
    .slice(0, limit)
    .map(
      (p) => `<li class="mini-item">
        <a class="mini-link" href="${joinUrl(base, `posts/${p.slug}/`)}">
          <span class="mini-meta"><time datetime="${fmtISO(p.date)}">${fmtShort(p.date)}</time></span>
          <span class="mini-title">${esc(p.title)}</span>
          <span class="mini-sub">${esc(p.summary)}</span>
        </a>
      </li>`,
    )
    .join("")}</ul>`;
}

function miniWorks(works, base, limit = 3) {
  if (!works.length) return `<p class="empty mini-empty">还没有作品。</p>`;
  return `<ul class="mini-list">${works
    .slice(0, limit)
    .map(
      (w) => `<li class="mini-item">
        <a class="mini-link" href="${joinUrl(base, `works/${w.slug}/`)}">
          ${w.status ? `<span class="mini-badge">${esc(w.status)}</span>` : ""}
          <span class="mini-title">${esc(w.title)}</span>
          <span class="mini-sub">${esc(w.summary)}</span>
        </a>
      </li>`,
    )
    .join("")}</ul>`;
}

function miniRadio(episodes, base, site, limit = 3) {
  if (!episodes.length) return `<p class="empty mini-empty">还没有节目。</p>`;
  return `<ul class="mini-list">${episodes
    .slice(0, limit)
    .map((episode) => {
      const src = audioSrc(site, base, episode.audio);
      const duration = String(episode.duration || "").trim();
      return `<li class="mini-item">
        <a class="mini-link" href="${joinUrl(base, `radio/${episode.slug}/`)}">
          <span class="mini-meta"><time datetime="${fmtISO(episode.date)}">${fmtShort(episode.date)}</time>${
            duration ? `<span class="mini-dur">${esc(duration)}</span>` : ""
          }</span>
          <span class="mini-title">${esc(episode.title)}</span>
          ${episode.summary ? `<span class="mini-sub">${esc(episode.summary)}</span>` : ""}
        </a>
        ${src ? `<audio class="mini-player" controls preload="none" src="${esc(src)}"></audio>` : ""}
      </li>`;
    })
    .join("")}</ul>`;
}

/** 首页：三栏并排，各自露出最新几条，靠纵向错落制造层次 */
export function homeMain(site, base, posts, works, episodes = []) {
  return `${heroHtml(site, base)}
<section class="home-grid">
  <div class="home-col home-col-posts">
    ${colHead("近笔", joinUrl(base, "posts/"), "全部")}
    ${miniPosts(posts, base)}
  </div>
  <div class="home-col home-col-works">
    ${colHead("小作", joinUrl(base, "works/"), "全部")}
    ${miniWorks(works, base)}
  </div>
  <div class="home-col home-col-radio">
    ${colHead("电台", joinUrl(base, "radio/"), "全部")}
    ${miniRadio(episodes, base, site)}
  </div>
</section>
<section class="block-quiet home-quiet">
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
export function postPageMain(site, base, post, older, newer, comments = []) {
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
${nav.length ? `<nav class="post-nav" aria-label="文章翻页">${nav.join("")}</nav>` : ""}
${guestbookHtml(site, base, "posts", post.slug, comments)}`;
}

// ---------------- 作品留言 ----------------

function dotsDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).replace(/-/g, ".") : text;
}

/** 各类页面下方的留言区。数据来自 content/comments/<栏目>/<slug>.json，只收录审核通过的留言 */
export function guestbookHtml(site, base, section, slug, comments = []) {
  const cfg = site.comments ?? {};
  if (!cfg.enabled) return "";

  const list = Array.isArray(comments) ? comments : [];
  const sealName = String(site.seal || site.author || "").trim();

  const items = list.length
    ? `<ul class="gb-list">${list
        .map(
          (c) => `<li class="gb-item">
      <p class="gb-who"><span class="gb-name">${esc(String(c.name || "").trim() || "匿名")}</span><time class="gb-date">${esc(dotsDate(c.date))}</time></p>
      <p class="gb-text">${esc(String(c.text || "").trim())}</p>
      ${String(c.reply || "").trim() ? `<p class="gb-reply"><span class="gb-reply-tag">${esc(sealName)}回</span>${esc(String(c.reply).trim())}</p>` : ""}
    </li>`,
        )
        .join("")}</ul>`
    : `<p class="gb-empty">还没有人留言。你是第一个吗？</p>`;

  let form = "";
  if (cfg.endpoint) {
    const next = `${absoluteUrl(site, base, `${section}/${slug}/`)}#guestbook`;
    form = `<form class="gb-form" action="${esc(cfg.endpoint)}" method="POST">
    <div class="gb-row">
      <input class="gb-input" type="text" name="name" maxlength="24" required
             placeholder="${esc(cfg.namePlaceholder || "留下你喜欢的名字")}" aria-label="你的名字">
      <button class="gb-submit" type="submit">${esc(cfg.submitLabel || "送出留言")}</button>
    </div>
    <textarea class="gb-textarea" name="message" rows="3" maxlength="500" required
              placeholder="${esc(cfg.placeholder || "说点什么吧")}" aria-label="留言内容"></textarea>
    <input type="hidden" name="_subject" value="${esc(`${site.siteTitle} · 新的作品留言`)}">
    <input type="hidden" name="_next" value="${esc(next)}">
    <input type="text" name="_honey" class="gb-honey" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="gb-note">${esc(cfg.notice || "留言会先经过审核，通过后才显示。")}</p>
  </form>`;
  } else {
    form = `<p class="gb-note">${
      cfg.email
        ? `留言通道还没接上，先写信给我：<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>`
        : "留言通道准备中，很快就好。"
    }</p>`;
  }

  return `<section class="guestbook" id="guestbook">
  <div class="gb-head">
    <h2 class="gb-title">留言</h2>
    ${list.length ? `<span class="gb-count">${list.length} 条</span>` : ""}
  </div>
  ${items}
  ${form}
</section>`;
}

export function workPageMain(site, base, work, comments = []) {
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
</article>
${guestbookHtml(site, base, "works", work.slug, comments)}`;
}

// ---------------- 电台 ----------------

/** 音频地址：外链保持原样，仓库内文件补上站点前缀 */
export function audioSrc(site, base, audio) {
  const value = String(audio || "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value)) return value;
  return joinUrl(base, value.replace(/^\/+/, ""));
}

function durationText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

export function radioRowHtml(episode, base, site) {
  const src = audioSrc(site, base, episode.meta?.audio ?? episode.audio);
  const duration = durationText(episode.duration || episode.meta?.duration);
  const player = src
    ? `<audio class="player" controls preload="none" src="${esc(src)}"></audio>`
    : `<p class="player-missing">音频还没上传。</p>`;

  return `<li class="episode">
  <div class="episode-head">
    <time class="episode-date" datetime="${fmtISO(episode.date)}">${fmtShort(episode.date)}</time>
    ${duration ? `<span class="episode-dur">${esc(duration)}</span>` : ""}
  </div>
  <a class="episode-title" href="${joinUrl(base, `radio/${episode.slug}/`)}">${esc(episode.title)}</a>
  ${episode.summary ? `<p class="episode-sum">${esc(episode.summary)}</p>` : ""}
  ${player}
</li>`;
}

export function radioListHtml(episodes, base, site) {
  if (!episodes.length) {
    return `<p class="empty">还没有节目。第一期最难录，也最值得录。</p>`;
  }
  return `<ul class="episode-list">${episodes.map((e) => radioRowHtml(e, base, site)).join("")}</ul>`;
}

export function radioPageMain(site, base, episode, comments = []) {
  const src = audioSrc(site, base, episode.audio);
  const duration = durationText(episode.duration);
  const player = src
    ? `<audio class="player player-large" controls preload="metadata" src="${esc(src)}"></audio>`
    : `<p class="player-missing">这一期的音频还没上传。</p>`;
  const tags = episode.tags.length
    ? `<p class="post-tags">${episode.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>`
    : "";

  return `<article class="article article-radio">
  <header class="article-head">
    <p class="article-date"><time datetime="${fmtISO(episode.date)}">${fmtChinese(episode.date)}</time></p>
    <h1 class="article-title">${esc(episode.title)}</h1>
    <p class="article-meta">${duration ? `<span>时长 ${esc(duration)}</span>` : ""}${
      duration && episode.tags.length ? `<span aria-hidden="true">·</span>` : ""
    }${episode.tags.length ? `<span>${episode.tags.map((t) => esc(t)).join(" / ")}</span>` : ""}</p>
  </header>
  ${player}
  <div class="prose">
${episode.html}
  </div>
  ${tags}
  <div class="article-foot">
    <a class="back" href="${joinUrl(base, "radio/")}">← 回到电台</a>
  </div>
</article>
${guestbookHtml(site, base, "radio", episode.slug, comments)}`;
}

/** 播客订阅源：带 enclosure，可以直接丢进小宇宙/Apple Podcasts 之类 */
export function podcastFeedXml(site, base, episodes) {
  const podcast = site.podcast ?? {};
  const title = podcast.title || `${site.siteTitle} 电台`;
  const description = podcast.description || site.bio || "";
  const cover = podcast.cover ? absoluteUrl(site, base, podcast.cover) : "";

  const items = episodes
    .filter((e) => audioSrc(site, base, e.audio))
    .map((e) => {
      const pageUrl = absoluteUrl(site, base, `radio/${e.slug}/`);
      const fileUrl = audioSrc(site, base, e.audio);
      const absolute = /^https?:/i.test(fileUrl) ? fileUrl : absoluteUrl(site, base, e.audio);
      const pub = new Date(fmtISO(e.date));
      const ext = (absolute.split("?")[0].match(/\.(mp3|m4a|aac|ogg|wav|flac)$/i) || [, "mp3"])[1].toLowerCase();
      const type = ext === "m4a" || ext === "aac" ? "audio/mp4" : ext === "ogg" ? "audio/ogg" : ext === "wav" ? "audio/wav" : "audio/mpeg";
      return `    <item>
      <title>${esc(e.title)}</title>
      <link>${esc(pageUrl)}</link>
      <guid isPermaLink="false">${esc(`${site.url || ""}radio/${e.slug}`)}</guid>
      <pubDate>${Number.isNaN(pub.getTime()) ? new Date().toUTCString() : pub.toUTCString()}</pubDate>
      <description>${esc(e.summary)}</description>
      <enclosure url="${esc(absolute)}" length="${Number(e.audioSize) || 0}" type="${type}"/>
      ${e.duration ? `<itunes:duration>${esc(e.duration)}</itunes:duration>` : ""}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(absoluteUrl(site, base, "radio/"))}</link>
    <description>${esc(description)}</description>
    <language>zh-CN</language>
    <itunes:author>${esc(podcast.author || site.author || "")}</itunes:author>
    <itunes:summary>${esc(description)}</itunes:summary>
    ${cover ? `<itunes:image href="${esc(cover)}"/>` : ""}
    <itunes:explicit>false</itunes:explicit>
    <atom:link href="${esc(absoluteUrl(site, base, "radio/feed.xml"))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
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
