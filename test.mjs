#!/usr/bin/env node
// 自检：node test.mjs
// 覆盖 Markdown 渲染的常见写法 + 内容解析。改动渲染器后跑一遍，防止悄悄坏掉。

import assert from "node:assert/strict";
import { renderMarkdown, toPlainText, escapeHtml } from "./lib/markdown.mjs";
import { parseFrontMatter, estimateReading } from "./lib/content.mjs";
import * as admin from "./theme/admin-core.mjs";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message.split("\n")[0]}`);
  }
}

const md = renderMarkdown;

console.log("\nMarkdown 渲染");

check("标题带锚点 id", () => {
  assert.equal(md("## 旧书的气味"), '<h2 id="旧书的气味">旧书的气味</h2>');
});

check("段落合并为一段", () => {
  assert.equal(md("第一行\n第二行"), "<p>第一行第二行</p>");
});

check("中英文之间的软换行保留空格", () => {
  assert.equal(md("hello\nworld"), "<p>hello world</p>");
});

check("粗体、斜体、删除线", () => {
  assert.equal(md("**粗** *斜* ~~删~~"), "<p><strong>粗</strong> <em>斜</em> <del>删</del></p>");
});

check("行内代码里的星号不被解析", () => {
  assert.equal(md("`a*b*c`"), "<p><code>a*b*c</code></p>");
});

check("链接", () => {
  assert.equal(md("[名](https://a.com)"), '<p><a href="https://a.com">名</a></p>');
});

check("图片", () => {
  assert.equal(md("![图](a.png)"), '<figure><img src="a.png" alt="图" loading="lazy" decoding="async"><figcaption>图</figcaption></figure>');
});

check("整段只有图片时升级为 figure 并带说明", () => {
  const html = md('![图](a.png "说明")');
  assert.match(html, /^<figure>/);
  assert.match(html, /<figcaption>说明<\/figcaption>/);
});

check("裸链接自动成链", () => {
  const html = md("见 https://example.com/x 一游");
  assert.match(html, /<a href="https:\/\/example\.com\/x"/);
});

check("HTML 源码被转义（不执行）", () => {
  assert.equal(md("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

check("无序列表与嵌套", () => {
  const html = md("- 一\n- 二\n  - 二点一");
  assert.match(html, /<ul><li>一<\/li><li>二<ul><li>二点一<\/li><\/ul><\/li><\/ul>/);
});

check("有序列表", () => {
  assert.equal(md("1. 甲\n2. 乙"), "<ol><li>甲</li><li>乙</li></ol>");
});

check("引用块", () => {
  assert.equal(md("> 一句话"), "<blockquote><p>一句话</p></blockquote>");
});

check("代码围栏带语言", () => {
  const html = md("```js\nconst a = 1 < 2;\n```");
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /1 &lt; 2/);
});

check("分隔线", () => {
  assert.equal(md("---"), "<hr>");
});

check("表格", () => {
  const html = md("| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>甲<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

check("纯文本化用于摘要", () => {
  assert.equal(toPlainText("**粗** [链](u)"), "粗 链");
});

check("转义函数", () => {
  assert.equal(escapeHtml('a<b&"c"'), "a&lt;b&amp;&quot;c&quot;");
});

console.log("\n内容解析");

check("front matter", () => {
  const { data, body } = parseFrontMatter("---\ntitle: 标题\ndate: 2026-11-26\ntags: 一, 二\n---\n正文");
  assert.equal(data.title, "标题");
  assert.deepEqual(data.tags, ["一", "二"]);
  assert.equal(body, "正文");
});

check("没有 front matter 时整篇当正文", () => {
  const { data, body } = parseFrontMatter("就是一段话");
  assert.deepEqual(data, {});
  assert.equal(body, "就是一段话");
});

check("阅读时长至少 1 分钟", () => {
  assert.equal(estimateReading("短"), 1);
  assert.ok(estimateReading("字".repeat(2000)) >= 4);
});

console.log("\n管理后台核心逻辑");

check("base64 中文与换行往返", () => {
  const text = "覆雪手记\n第二行 · 标点：「」（）\n\n---\n";
  assert.equal(admin.base64ToUtf8(admin.utf8ToBase64(text)), text);
});

check("serializeDoc 写出的东西，构建侧能原样读出来", () => {
  const meta = { title: "第一场雪", date: "2026-12-01", tags: ["随笔", "冬天"], summary: "一句摘要", draft: true };
  const text = admin.serializeDoc(meta, "正文第一段\n\n第二段");
  const { data, body } = parseFrontMatter(text);
  assert.equal(data.title, "第一场雪");
  assert.equal(data.date, "2026-12-01");
  assert.deepEqual(data.tags, ["随笔", "冬天"]);
  assert.equal(data.summary, "一句摘要");
  assert.equal(String(data.draft), "true");
  assert.equal(body, "正文第一段\n\n第二段");
});

check("标题里带冒号、逗号也不会被切坏", () => {
  const text = admin.serializeDoc({ title: "时间: 现在，以及以后", date: "2026-12-01" }, "正文");
  const { data } = parseFrontMatter(text);
  assert.equal(data.title, "时间: 现在，以及以后");
});

check("标题以引号开头时会加引号保护", () => {
  const text = admin.serializeDoc({ title: "「引号」开头的标题", date: "2026-12-01" }, "正文");
  const { data } = parseFrontMatter(text);
  assert.equal(data.title, "「引号」开头的标题");
});

check("空字段不会被写成垃圾内容", () => {
  const text = admin.serializeDoc({ title: "只有标题", date: "2026-12-01", summary: "", tags: [], draft: false }, "正文");
  assert.ok(!text.includes("summary"));
  assert.ok(!text.includes("tags"));
  assert.ok(!text.includes("draft"));
});

check("没有 front matter 时只输出正文", () => {
  assert.equal(admin.serializeDoc({}, "就一段话"), "就一段话\n");
});

check("slugify 只留字母数字连字符", () => {
  assert.equal(admin.slugify("Hello World! 你好"), "hello-world");
  assert.equal(admin.slugify("纯中文标题"), "");
});

check("文件名带日期前缀，且有兜底", () => {
  assert.equal(admin.buildFilename("2026-12-01", "first-snow"), "2026-12-01-first-snow.md");
  assert.equal(admin.buildFilename("2026-12-01", "纯中文"), "2026-12-01-post-1201.md");
});

check("后台解析与构建解析对普通文章一致", () => {
  const raw = "---\ntitle: 旧书的气味\ndate: 2026-11-02\ntags: 读书, 旧物\nsummary: 纸是会老的。\n---\n\n正文开始。";
  const a = admin.parseDoc(raw);
  const b = parseFrontMatter(raw);
  assert.equal(a.meta.title, b.data.title);
  assert.equal(a.meta.date, b.data.date);
  assert.deepEqual(a.meta.tags, b.data.tags);
  assert.equal(a.body, b.body);
});

check("音频/图片字段能往返", () => {
  const meta = {
    title: "第〇期 · 试音",
    date: "2026-11-27",
    audio: "assets/audio/2026-11-27-ep01.mp3",
    duration: "12:34",
  };
  const text = admin.serializeDoc(meta, "节目简介");
  const { data } = parseFrontMatter(text);
  assert.equal(data.audio, "assets/audio/2026-11-27-ep01.mp3");
  assert.equal(data.duration, "12:34");
});

check("外链音频原样保留", () => {
  const text = admin.serializeDoc({ title: "外链", date: "2026-11-27", audio: "https://example.com/a.mp3" }, "");
  const { data } = parseFrontMatter(text);
  assert.equal(data.audio, "https://example.com/a.mp3");
});

check("二进制转 base64", () => {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
  assert.equal(admin.bytesToBase64(bytes), "SUQzBAA=");
});

check("文件大小格式化", () => {
  assert.equal(admin.formatBytes(512), "512 B");
  assert.equal(admin.formatBytes(2048), "2.0 KB");
  assert.equal(admin.formatBytes(3 * 1024 * 1024), "3.0 MB");
});

check("媒体文件路径按日期和 slug 生成", () => {
  assert.equal(
    admin.buildMediaPath("assets/audio", "2026-11-27", "ep01", "my-recording.MP3"),
    "assets/audio/2026-11-27-ep01.mp3",
  );
});

check("纯中文 slug 会兜底成随机名，不会生成畸形路径", () => {
  const path = admin.buildMediaPath("assets/audio", "2026-11-27", "纯中文名", "x.wav");
  assert.match(path, /^assets\/audio\/2026-11-27-media-[a-z0-9]+\.wav$/);
});

check("从文件名反推 slug（与构建规则一致）", () => {
  assert.equal(admin.slugFromFilename("2026-11-26-kaizhan.md"), "kaizhan");
  assert.equal(admin.slugFromFilename("2026-08-01-diantai.md"), "diantai");
  assert.equal(admin.slugFromFilename("about.md"), "about");
});

console.log("");
if (failed) {
  console.error(`✗ ${failed} 项失败，${passed} 项通过\n`);
  process.exit(1);
}
console.log(`✓ 全部通过（${passed} 项）\n`);
