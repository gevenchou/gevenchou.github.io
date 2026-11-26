// 零依赖 Markdown 渲染器。
// 只实现个人博客真正会用到的语法，行为可预测；不追求完整 CommonMark 兼容。
// 设计取舍：所有原始 HTML 一律转义（不信任内容里的 <div> 之类），避免手滑写出坏页面。

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

const esc = escapeHtml;
const escAttr = escapeHtml;

// 中日韩表意文字与全角标点，用于「软换行」拼接时判断是否该插入空格。
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

function softJoin(text) {
  return text.split("\n").reduce((acc, line) => {
    if (!acc) return line;
    const left = acc.slice(-1);
    const right = line.charAt(0);
    const glue = CJK.test(left) && CJK.test(right) ? "" : " ";
    return acc + glue + line;
  }, "");
}

/**
 * 渲染行内语法：`code`、![img](src)、[link](href)、**粗**、*斜*、~~删除~~、裸链接。
 * 逐层「先摘出、后转义、再还原」，避免生成的标签被二次转义。
 */
export function renderInline(source) {
  const store = [];
  const stash = (html) => {
    store.push(html);
    return `\u0000${store.length - 1}\u0001`;
  };

  let s = softJoin(String(source ?? ""));

  // 1. 行内代码先摘走，里面的 * _ 不参与后续强调解析
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => stash(`<code>${esc(code)}</code>`));

  // 2. 图片（必须在链接之前，否则 ![]() 会被当成链接）
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt, src, title) =>
      stash(
        `<img src="${escAttr(src)}" alt="${escAttr(alt)}"` +
          (title ? ` title="${escAttr(title)}"` : "") +
          ` loading="lazy" decoding="async">`,
      ),
  );

  // 3. 链接（链接文字允许再嵌套行内语法）
  s = s.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, label, href, title) =>
      stash(
        `<a href="${escAttr(href)}"` +
          (title ? ` title="${escAttr(title)}"` : "") +
          `>${renderInline(label)}</a>`,
      ),
  );

  // 4. 剩下的纯文本做 HTML 转义
  s = esc(s);

  // 5. 裸链接自动成链（此时 < > & 已转义，不会劫持已有标签）
  s = s.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>"）)]+)/g, (_m, lead, url) => {
    return `${lead}<a href="${url}" rel="noreferrer noopener" target="_blank">${url}</a>`;
  });

  // 6. 强调
  s = s
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([\s\S]+?)__/g, "<strong>$1</strong>")
    .replace(/~~([\s\S]+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, "$1<em>$2</em>");

  // 7. 还原被摘出的片段
  return s.replace(/\u0000(\d+)\u0001/g, (_m, index) => store[Number(index)] ?? "");
}

let headingSlugCounts = new Map();

function headingId(text) {
  const base =
    text
      .replace(/<[^>]*>/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
  const seen = headingSlugCounts.get(base) ?? 0;
  headingSlugCounts.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const BLOCK_START = /^(\s{0,3})(#{1,6}\s|>|\s*([-*+]|\d+[.)])\s+|```|~~~|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/;

function renderList(lines, start) {
  const items = [];
  let i = start;
  const first = lines[i].match(LIST_ITEM);
  const ordered = /\d/.test(first[2]);
  const indent = first[1].length;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // 空行后如果还是同一层的列表项，列表继续
      const next = lines[i + 1] ?? "";
      const nextItem = next.match(LIST_ITEM);
      if (nextItem && nextItem[1].length === indent && /\d/.test(nextItem[2]) === ordered) {
        i += 1;
        continue;
      }
      break;
    }
    const m = line.match(LIST_ITEM);
    if (!m) break;
    if (m[1].length !== indent) break;
    if (/\d/.test(m[2]) !== ordered) break;

    const head = m[3];
    i += 1;

    // 收集该项目的续行与子列表
    const rest = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        const next = lines[i + 1] ?? "";
        const isSub = /^\s{2,}\S/.test(next);
        if (isSub) {
          rest.push("");
          i += 1;
          continue;
        }
        break;
      }
      const nm = l.match(LIST_ITEM);
      if (nm && nm[1].length <= indent) break;
      if (nm) {
        rest.push(l);
        i += 1;
        continue;
      }
      if (/^\s{2,}/.test(l)) {
        rest.push(l);
        i += 1;
        continue;
      }
      break;
    }

    items.push({ head, rest });
  }

  // 去掉子块统一的缩进后再递归渲染，从而支持嵌套列表与项目内多段
  let body = "";
  for (const item of items) {
    body += "<li>" + renderInline(item.head);
    if (item.rest.length) {
      const dedented = item.rest.map((l) => (l.startsWith(" ".repeat(indent + 2)) ? l.slice(indent + 2) : l.replace(/^\s{1,2}/, "")));
      while (dedented.length && !dedented[dedented.length - 1].trim()) dedented.pop();
      if (dedented.length) body += renderBlocks(dedented);
    }
    body += "</li>";
  }

  return { html: ordered ? `<ol>${body}</ol>` : `<ul>${body}</ul>`, next: i };
}

function renderTable(lines, start) {
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const head = cells(lines[start]);
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
    rows.push(cells(lines[i]));
    i += 1;
  }

  const thead = "<tr>" + head.map((c) => `<th>${renderInline(c)}</th>`).join("") + "</tr>";
  const tbody = rows
    .map((row) => "<tr>" + row.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>")
    .join("");
  return { html: `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`, next: i };
}

function isTableStart(lines, i) {
  if (!lines[i] || !lines[i].includes("|")) return false;
  const sep = lines[i + 1];
  if (!sep) return false;
  return /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(sep) && sep.includes("-") && sep.includes("|");
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 围栏代码块
    const fence = line.match(/^(```+|~~~+)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      i += 1;
      const buf = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const cls = lang ? ` class="language-${escAttr(lang)}"` : "";
      out.push(`<pre><code${cls}>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = renderInline(heading[2]);
      const id = headingId(heading[2]);
      out.push(`<h${level} id="${escAttr(id)}">${text}</h${level}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    // 引用
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(buf)}</blockquote>`);
      continue;
    }

    // 表格
    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }

    // 列表
    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // 段落（含「整段只有一张图」时升级为 figure）
    const buf = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    if (!buf.length) {
      buf.push(line);
      i += 1;
    }
    const raw = buf.join("\n").trim();
    const solo = raw.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (solo) {
      const caption = solo[3] || solo[1];
      out.push(
        `<figure><img src="${escAttr(solo[2])}" alt="${escAttr(solo[1])}" loading="lazy" decoding="async">` +
          (caption ? `<figcaption>${renderInline(caption)}</figcaption>` : "") +
          `</figure>`,
      );
    } else {
      out.push(`<p>${renderInline(raw)}</p>`);
    }
  }

  return out.join("\n");
}

/** 把 Markdown 正文渲染成 HTML 片段（不含 <article> 外壳）。 */
export function renderMarkdown(source) {
  headingSlugCounts = new Map();
  const lines = String(source ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  return renderBlocks(lines);
}

/** 纯文本化，用于摘要、RSS、meta description。 */
export function toPlainText(source) {
  return String(source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
