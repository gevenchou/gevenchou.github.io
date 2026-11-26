// 后台的纯逻辑层：base64 编解码、front matter 读写、GitHub API 封装。
// 刻意不碰 DOM，所以既能在浏览器里用，也能直接在 Node 里跑测试。

const LIST_KEYS = new Set(["tags", "category", "categories", "keywords"]);

/** 字符串 → base64（正确处理中文，不能直接用 btoa） */
export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → 字符串 */
export function base64ToUtf8(base64) {
  const binary = atob(String(base64).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 解析一篇 Markdown：拆出 front matter 与正文。与 lib/content.mjs 的行为保持一致。 */
export function parseDoc(raw) {
  const text = String(raw)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text.trim() };

  const meta = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();

    if (/^\[.*\]$/.test(value)) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    } else if (LIST_KEYS.has(key) && /[,，、]/.test(value)) {
      value = value
        .split(/[,，、]/)
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      value = value === "true";
    }
    meta[key] = value;
  }
  return { meta, body: (match[2] ?? "").trim() };
}

const FIELD_ORDER = ["title", "date", "tags", "summary", "status", "cover", "link", "draft"];

function needsQuote(value) {
  return (
    /^["']/.test(value) ||
    /\n/.test(value) ||
    /^[\s]|[\s]$/.test(value) ||
    value === "true" ||
    value === "false"
  );
}

/** 把字段写回成 front matter + 正文。未识别的旧字段会原样保留，不会丢数据。 */
export function serializeDoc(meta, body) {
  const ordered = [
    ...FIELD_ORDER.filter((k) => k in meta),
    ...Object.keys(meta).filter((k) => !FIELD_ORDER.includes(k)),
  ];

  const lines = [];
  for (const key of ordered) {
    const value = meta[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}: ${value.join(", ")}`);
    } else if (typeof value === "boolean") {
      if (!value) continue;
      lines.push(`${key}: true`);
    } else {
      const s = String(value);
      lines.push(`${key}: ${needsQuote(s) ? JSON.stringify(s) : s}`);
    }
  }

  const head = lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
  return `${head}${String(body ?? "").trim()}\n`;
}

/** 英文/数字型 slug；中文标题会得到空串，由调用方兜底 */
export function slugify(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function todayString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildFilename(date, slug) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayString();
  const safeSlug = slugify(slug) || `post-${safeDate.slice(5).replace("-", "")}`;
  return `${safeDate}-${safeSlug}.md`;
}

function explainStatus(status, data) {
  const message = data && typeof data === "object" ? data.message : "";
  switch (status) {
    case 401:
      return "令牌无效或已过期，请重新生成并填入。";
    case 403:
      return message.includes("rate limit")
        ? "触发了 GitHub 频率限制，过一会儿再试。"
        : "令牌权限不足。需要给这个仓库 Contents 的 Read and write 权限。";
    case 404:
      return "找不到仓库或文件。常见原因是令牌没有勾选这个仓库的权限。";
    case 409:
      return "文件冲突：刚刚有别的修改。刷新页面后重试。";
    case 422:
      return "内容或文件名不被接受，检查一下文件名是否重复。";
    default:
      return `GitHub 返回 ${status}${message ? "：" + message : ""}`;
  }
}

/** GitHub Contents API 的最小封装。CORS 由 GitHub 本身支持，不需要任何后端。 */
export function createClient({ owner, repo, branch = "main", token }) {
  const root = `https://api.github.com/repos/${owner}/${repo}`;
  const ref = encodeURIComponent(branch);

  async function request(url, init = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    };
    const res = await fetch(url, { ...init, headers });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const error = new Error(explainStatus(res.status, data));
      error.status = res.status;
      throw error;
    }
    return data;
  }

  const contentPath = (path) =>
    `${root}/contents/${String(path).split("/").map(encodeURIComponent).join("/")}`;

  return {
    /** 校验令牌：能读到仓库就说明至少能访问 */
    async verify() {
      const info = await request(root);
      return {
        repo: info.full_name,
        private: info.private,
        canPush: Boolean(info.permissions?.push),
        defaultBranch: info.default_branch,
      };
    },
    listDir: (dir) => request(`${contentPath(dir)}?ref=${ref}`),
    async readFile(path) {
      const file = await request(`${contentPath(path)}?ref=${ref}`);
      const text = base64ToUtf8(file.content ?? "");
      const { meta, body } = parseDoc(text);
      return { path, sha: file.sha, meta, body, raw: text };
    },
    async writeFile(path, text, message, sha) {
      const payload = {
        message,
        content: utf8ToBase64(text),
        branch,
        ...(sha ? { sha } : {}),
      };
      return request(contentPath(path), { method: "PUT", body: JSON.stringify(payload) });
    },
    async deleteFile(path, sha, message) {
      return request(contentPath(path), {
        method: "DELETE",
        body: JSON.stringify({ message, sha, branch }),
      });
    },
  };
}
