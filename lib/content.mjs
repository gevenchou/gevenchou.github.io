// 读取 content/ 下的 Markdown，解析极简 front matter。
// front matter 格式（刻意只支持这一种，够用且不会出错）：
//   ---
//   title: 标题
//   date: 2026-11-26
//   tags: 随笔, 夜
//   summary: 一句摘要
//   ---

import fs from "node:fs";
import path from "node:path";
import { renderMarkdown, toPlainText } from "./markdown.mjs";

const LIST_KEYS = new Set(["tags", "category", "categories", "keywords"]);

export function parseFrontMatter(raw) {
  const text = String(raw)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text.trim() };

  const data = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();

    if (/^\[.*\]$/.test(value)) {
      // tags: [甲, 乙]
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^(["']).*\1$/.test(value)) {
      // 引号包裹的一律当纯文本，哪怕里面有逗号
      value = value.slice(1, -1);
    } else if (LIST_KEYS.has(key) && /[,，、]/.test(value)) {
      // 只有列表型字段才按逗号拆分，避免 summary 之类的句子被切碎
      value = value
        .split(/[,，、]/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    data[key] = value;
  }

  return { data, body: (match[2] ?? "").trim() };
}

function normalizeTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(/[,，、]/);
  return list.map((t) => String(t).trim()).filter(Boolean);
}

function stripDatePrefix(name) {
  return name.replace(/^\d{4}-\d{2}-\d{2}[-_]/, "");
}

export function estimateReading(body) {
  const plain = toPlainText(body);
  const cjk = (plain.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (plain.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9'’]+/g) ?? []).length;
  return Math.max(1, Math.round((cjk + words * 1.6) / 400));
}

/** 读取一个目录下的全部 .md；draft: true 的条目在正式构建时被跳过。 */
export function loadCollection(dir, { includeDrafts = false } = {}) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort();

  const items = [];
  for (const name of entries) {
    const file = path.join(dir, name);
    const raw = fs.readFileSync(file, "utf8");
    const { data, body } = parseFrontMatter(raw);

    const isDraft = String(data.draft ?? "").toLowerCase() === "true";
    if (isDraft && !includeDrafts) continue;

    const slug = String(data.slug || stripDatePrefix(name.replace(/\.md$/i, ""))).trim();
    const title = String(data.title || slug);
    const plain = toPlainText(body);

    items.push({
      slug,
      title,
      date: String(data.date || "").trim(),
      tags: normalizeTags(data.tags),
      summary: String(data.summary || "").trim() || plain.slice(0, 84) + (plain.length > 84 ? "…" : ""),
      cover: String(data.cover || "").trim(),
      link: String(data.link || "").trim(),
      status: String(data.status || "").trim(),
      draft: isDraft,
      file,
      filename: name,
      body,
      html: renderMarkdown(body),
      plain,
      minutes: estimateReading(body),
      kind: String(data.kind || "").trim(),
    });
  }

  return items;
}

export function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    if (a.date === b.date) return a.title.localeCompare(b.title, "zh-Hans-CN");
    return a.date < b.date ? 1 : -1;
  });
}

export { normalizeTags };
