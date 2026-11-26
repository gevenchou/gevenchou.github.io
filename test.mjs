#!/usr/bin/env node
// 自检：node test.mjs
// 覆盖 Markdown 渲染的常见写法 + 内容解析。改动渲染器后跑一遍，防止悄悄坏掉。

import assert from "node:assert/strict";
import { renderMarkdown, toPlainText, escapeHtml } from "./lib/markdown.mjs";
import { parseFrontMatter, estimateReading } from "./lib/content.mjs";

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

console.log("");
if (failed) {
  console.error(`✗ ${failed} 项失败，${passed} 项通过\n`);
  process.exit(1);
}
console.log(`✓ 全部通过（${passed} 项）\n`);
