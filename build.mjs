#!/usr/bin/env node
// 构建入口：node build.mjs
// 读取 site.config.json + content/**/*.md → 输出完整静态站到 dist/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCollection, parseFrontMatter, sortByDateDesc } from "./lib/content.mjs";
import { renderMarkdown } from "./lib/markdown.mjs";
import * as T from "./lib/templates.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const CONTENT = path.join(ROOT, "content");

const warnings = [];
const warn = (msg) => warnings.push(msg);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeBase(raw) {
  let base = String(raw ?? "/").trim() || "/";
  if (!base.startsWith("/")) base = "/" + base;
  if (!base.endsWith("/")) base += "/";
  return base;
}

function writeFile(relPath, content) {
  const target = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function copyDir(from, to, filter = null) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (filter && !filter(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else fs.copyFileSync(src, dst);
  }
}

/** 让文中写 assets/xxx.jpg 的图片/链接在任意目录层级都能正确解析 */
function resolveAssetUrls(html, base) {
  if (base === "/") return html;
  return html.replace(/(src|href)="assets\//g, `$1="${base}assets/`);
}

function prosePage(site, base, { title, description, active, markdownHtml, subtitle }) {  const main = `${T.pageHead(title, subtitle)}<div class="prose prose-page">\n${markdownHtml}\n</div>`;
  return T.layout(site, base, {
    title,
    description,
    active,
    main,
    canonical: T.absoluteUrl(site, base, `${active}/`),
  });
}

/** 生成管理后台页面：把 theme/admin.html 里的占位符换成真实配置 */
function writeAdminPage(site, base) {
  const tplPath = path.join(ROOT, "theme", "admin.html");
  if (!fs.existsSync(tplPath)) {
    warn("theme/admin.html 不存在，跳过管理页");
    return;
  }
  const tpl = fs.readFileSync(tplPath, "utf8");
  const adminConfig = {
    owner: site.admin.owner,
    repo: site.admin.repo,
    branch: site.admin.branch || "main",
    siteTitle: site.siteTitle,
    base,
  };
  const html = tpl
    .replaceAll("{{base}}", base)
    .replaceAll("{{siteTitle}}", site.siteTitle)
    .replaceAll("{{adminConfig}}", JSON.stringify(adminConfig));
  writeFile("admin/index.html", html);
}

/** 读取某个作品的留言（只收录审核通过的，文件不存在就当没有） */
function loadComments(slug) {
  const file = path.join(CONTENT, "comments", `${slug}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = readJson(file);
    const list = Array.isArray(data) ? data : data.comments;
    return Array.isArray(list) ? list.filter((c) => c && String(c.text || "").trim()) : [];
  } catch (error) {
    warn(`content/comments/${slug}.json 解析失败：${error.message}`);
    return [];
  }
}

async function main() {
  const configFile = path.join(ROOT, "site.config.json");
  if (!fs.existsSync(configFile)) {
    console.error("找不到 site.config.json");
    process.exit(1);
  }

  const site = readJson(configFile);
  // SITE_BASE / SITE_URL 由 GitHub Actions 注入；本地构建时回落到配置
  const base = normalizeBase(process.env.SITE_BASE || site.basePath);
  if (process.env.SITE_URL) site.url = process.env.SITE_URL;
  site.url = String(site.url ?? "").replace(/\/+$/, "");

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // ---- 内容 ----
  const posts = sortByDateDesc(loadCollection(path.join(CONTENT, "posts")));
  const works = sortByDateDesc(loadCollection(path.join(CONTENT, "works")));
  const radio = sortByDateDesc(loadCollection(path.join(CONTENT, "radio")));

  // 仓库内的音频要算出真实字节数，播客订阅源的 enclosure 需要它
  for (const episode of radio) {
    episode.audioSize = 0;
    const file = String(episode.audio || "").trim();
    if (!file) continue;
    if (/^(https?:)?\/\//i.test(file)) continue; // 外链稍后异步取
    const abs = path.join(ROOT, file.replace(/^\/+/, ""));
    if (fs.existsSync(abs)) episode.audioSize = fs.statSync(abs).size;
    else warn(`radio/${episode.filename}：找不到音频文件 ${file}`);
  }

  // 外链音频（R2、喜马拉雅等）用 HEAD 取真实字节数；拿不到就留 0，不阻塞构建
  const external = radio.filter((e) => /^https?:\/\//i.test(String(e.audio || "").trim()));
  if (external.length) {
    await Promise.all(
      external.map(async (episode) => {
        const url = String(episode.audio).trim();
        try {
          const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) });
          const size = Number(res.headers.get("content-length") || 0);
          if (res.ok && size > 0) episode.audioSize = size;
        } catch {
          warn(`radio/${episode.filename}：取不到外链音频大小，播客源里 length 会写成 0`);
        }
      }),
    );
  }

  for (const [kind, items] of [
    ["posts", posts],
    ["works", works],
    ["radio", radio],
  ]) {
    const seen = new Map();
    for (const item of items) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) warn(`${kind}/${item.filename}：date 缺失或格式不是 YYYY-MM-DD`);
      if (seen.has(item.slug)) warn(`${kind}/${item.filename}：slug「${item.slug}」与 ${seen.get(item.slug)} 重复`);
      seen.set(item.slug, item.filename);
      if (!item.html.trim()) warn(`${kind}/${item.filename}：正文为空`);
    }
  }

  // ---- 留言设置（可选）：合并到 site.comments ----
  const commentCfg = path.join(CONTENT, "comments", "settings.json");
  if (fs.existsSync(commentCfg)) {
    try {
      site.comments = { ...(site.comments || {}), ...readJson(commentCfg) };
    } catch (error) {
      warn(`content/comments/settings.json 解析失败：${error.message}`);
    }
  }

  // ---- 首页 ----
  writeFile(
    "index.html",
    T.layout(site, base, {
      title: "",
      description: site.bio,
      active: "home",
      main: T.homeMain(site, base, posts, works, radio),
      pageClass: "page-home",
      canonical: T.absoluteUrl(site, base, ""),
    }),
  );

  // ---- 文章列表 ----
  writeFile(
    "posts/index.html",
    T.layout(site, base, {
      title: "文章",
      description: `${site.siteTitle} 的全部文章`,
      active: "posts",
      main: `${T.pageHead("文章", "按时间，从近到远。")}${T.postListHtml(posts, base, { showAll: true })}`,
      canonical: T.absoluteUrl(site, base, "posts/"),
    }),
  );

  // ---- 文章详情 ----
  posts.forEach((post, index) => {
    const newer = posts[index - 1] ?? null;
    const older = posts[index + 1] ?? null;
    const main = T.postPageMain(site, base, { ...post, html: resolveAssetUrls(post.html, base) }, older, newer);
    writeFile(
      `posts/${post.slug}/index.html`,
      T.layout(site, base, {
        title: post.title,
        description: post.summary,
        active: "posts",
        main,
        pageClass: "page-article",
        ogType: "article",
        canonical: T.absoluteUrl(site, base, `posts/${post.slug}/`),
      }),
    );
  });

  // ---- 作品列表 ----
  writeFile(
    "works/index.html",
    T.layout(site, base, {
      title: "作品",
      description: `${site.siteTitle} 的作品与项目`,
      active: "works",
      main: `${T.pageHead("作品", "做过的东西，都放在这里。")}${
        works.length
          ? `<ul class="work-grid work-grid-all">${works.map((w) => T.workCardHtml(w, base)).join("")}</ul>`
          : `<p class="empty">还没有作品。慢慢来。</p>`
      }`,
      canonical: T.absoluteUrl(site, base, "works/"),
    }),
  );

  // ---- 作品详情 ----
  works.forEach((work) => {
    writeFile(
      `works/${work.slug}/index.html`,
      T.layout(site, base, {
        title: work.title,
        description: work.summary,
        active: "works",
        main: T.workPageMain(site, base, work, loadComments(work.slug)),
        pageClass: "page-article",
        ogType: "article",
        canonical: T.absoluteUrl(site, base, `works/${work.slug}/`),
      }),
    );
  });

  // ---- 电台 ----
  writeFile(
    "radio/index.html",
    T.layout(site, base, {
      title: "电台",
      description: site.podcast?.description || `${site.siteTitle} 的电台`,
      active: "radio",
      main: `${T.pageHead(site.podcast?.title || "电台", "点开就能听。没有配乐，不剪。")}${T.radioListHtml(
        radio,
        base,
        site,
      )}${
        radio.length
          ? `<p class="feed-hint">想订阅？把这个地址加进播客 App：<a href="${T.joinUrl(base, "radio/feed.xml")}">radio/feed.xml</a></p>`
          : ""
      }`,
      canonical: T.absoluteUrl(site, base, "radio/"),
    }),
  );

  radio.forEach((episode) => {
    writeFile(
      `radio/${episode.slug}/index.html`,
      T.layout(site, base, {
        title: episode.title,
        description: episode.summary,
        active: "radio",
        main: T.radioPageMain(site, base, { ...episode, html: resolveAssetUrls(episode.html, base) }),
        pageClass: "page-article",
        ogType: "article",
        canonical: T.absoluteUrl(site, base, `radio/${episode.slug}/`),
      }),
    );
  });

  writeFile("radio/feed.xml", T.podcastFeedXml(site, base, radio));

  // ---- 关于 ----
  const aboutFile = path.join(CONTENT, "about.md");
  if (fs.existsSync(aboutFile)) {
    const { data, body } = parseFrontMatter(fs.readFileSync(aboutFile, "utf8"));
    writeFile(
      "about/index.html",
      prosePage(site, base, {
        title: String(data.title || "关于"),
        subtitle: String(data.subtitle || ""),
        description: String(data.summary || site.bio || ""),
        active: "about",
        markdownHtml: resolveAssetUrls(renderMarkdown(body), base),
      }),
    );
  } else {
    warn("content/about.md 不存在，跳过「关于」页");
  }

  // ---- 管理后台 ----
  if (site.admin?.enabled) writeAdminPage(site, base);

  // ---- 404 ----
  writeFile(
    "404.html",
    T.layout(site, base, {
      title: "页面不存在",
      description: "404",
      active: "",
      main: T.notFoundMain(site, base),
      noindex: true,
    }),
  );

  // ---- RSS / 静态文件 ----
  writeFile("rss.xml", T.rssXml(site, base, posts));
  writeFile(
    "robots.txt",
    `User-agent: *\nDisallow: /admin/\nAllow: /\n${site.url ? `Sitemap: ${site.url}/rss.xml\n` : ""}`,
  );
  writeFile(".nojekyll", "");

  // ---- 资源 ----
  const assetOut = path.join(DIST, "assets");
  copyDir(path.join(ROOT, "assets"), assetOut);
  // theme 里的 .html 是模板，不该出现在产物里
  copyDir(path.join(ROOT, "theme"), assetOut, (name) => !name.toLowerCase().endsWith(".html"));
  // 把构建期的 Markdown 渲染器复制一份给浏览器，让后台的实时预览和线上效果完全一致
  fs.copyFileSync(path.join(ROOT, "lib", "markdown.mjs"), path.join(assetOut, "markdown.mjs"));
  if (fs.existsSync(path.join(ROOT, "public"))) copyDir(path.join(ROOT, "public"), DIST);
  if (fs.existsSync(path.join(ROOT, "CNAME"))) fs.copyFileSync(path.join(ROOT, "CNAME"), path.join(DIST, "CNAME"));

  // ---- 报告 ----
  const pages = posts.length + works.length + radio.length + 6;
  console.log("");
  console.log(`  站点      ${site.siteTitle} / ${site.author}`);
  console.log(`  地址前缀  ${base}`);
  console.log(`  文章      ${posts.length} 篇`);
  console.log(`  作品      ${works.length} 个`);
  console.log(`  电台      ${radio.length} 期`);
  console.log(`  生成页面  ${pages} 个 → dist/`);
  if (warnings.length) {
    console.log("");
    console.log("  提示：");
    for (const w of warnings) console.log(`   · ${w}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error("\n构建失败：" + (error && error.message ? error.message : error));
  process.exit(1);
});
