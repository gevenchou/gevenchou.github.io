// 管理后台的界面逻辑。
// 数据全部通过 GitHub Contents API 直接读写仓库，没有中间服务器。

import {
  buildFilename,
  createClient,
  parseDoc,
  serializeDoc,
  slugify,
  todayString,
} from "./admin-core.mjs";
import { renderMarkdown } from "./markdown.mjs";

const CFG = window.ADMIN_CONFIG || {};
const TOKEN_KEY = "fuxue-admin-token";
const ACCOUNT_KEY = "fuxue-admin-account";

const DIRS = {
  posts: { dir: "content/posts", url: "posts/", label: "文章", noun: "篇文章" },
  works: { dir: "content/works", url: "works/", label: "作品", noun: "个作品" },
};

const $ = (id) => document.getElementById(id);

const state = {
  token: "",
  account: CFG.owner || "",
  client: null,
  tab: "posts",
  items: [],
  editing: null, // { path, sha, isNew, slugLocked }
  saving: false,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

let toastTimer = null;
function toast(message, kind = "") {
  const node = $("toast");
  node.textContent = message;
  node.className = `toast is-show${kind ? " is-" + kind : ""}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = "toast";
    node.hidden = true;
  }, kind === "error" ? 6000 : 3800);
}

function setBusy(button, busy, busyText, normalText) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

// ---------------- 登录 ----------------

function showLoginError(message) {
  const box = $("login-error");
  box.textContent = message;
  box.hidden = !message;
}

async function doLogin(token) {
  const client = createClient({
    owner: CFG.owner,
    repo: CFG.repo,
    branch: CFG.branch || "main",
    token,
  });
  const info = await client.verify();
  if (!info.canPush) {
    toast("这个令牌只能读取，不能写入。保存会失败，请把 Contents 权限改成 Read and write。", "error");
  }
  state.token = token;
  state.client = client;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, state.account);
  enterPanel(info);
}

function enterPanel(info) {
  $("login-view").hidden = true;
  $("panel-view").hidden = false;
  $("who").textContent = `${CFG.owner} · ${CFG.repo}`;
  if (info && info.repo) {
    document.title = `管理 · ${CFG.siteTitle}`;
  }
  loadList();
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.client = null;
  state.items = [];
  $("panel-view").hidden = true;
  $("login-view").hidden = false;
  $("login-token").value = "";
  showLoginError("");
  toast("已退出登录。令牌已从这台浏览器清除。");
}

// ---------------- 列表 ----------------

async function loadList() {
  const meta = DIRS[state.tab];
  $("list-title").textContent = meta.label;
  $("new-post").textContent = state.tab === "posts" ? "＋ 写一篇" : "＋ 加一个作品";
  $("list-body").innerHTML = "";
  $("list-empty").hidden = true;
  $("list-count").textContent = "读取中…";
  $("list-hint").textContent = "";

  let entries = [];
  try {
    entries = await state.client.listDir(meta.dir);
  } catch (error) {
    $("list-count").textContent = "";
    toast(error.message, "error");
    return;
  }

  // 逐个取内容以读到标题；数量少，够用
  const docs = [];
  for (const entry of entries) {
    if (entry.type !== "file" || !entry.name.endsWith(".md")) continue;
    try {
      const file = await state.client.readFile(entry.path);
      docs.push({
        path: entry.path,
        name: entry.name,
        sha: entry.sha,
        meta: file.meta,
        body: file.body,
        raw: file.raw,
      });
    } catch {
      docs.push({ path: entry.path, name: entry.name, sha: entry.sha, meta: {}, body: "", raw: "" });
    }
  }

  docs.sort((a, b) => String(b.meta.date || "").localeCompare(String(a.meta.date || "")));
  state.items = docs;
  renderList();
}

function renderList() {
  const meta = DIRS[state.tab];
  const list = $("list-body");
  list.innerHTML = "";
  $("list-count").textContent = `${state.items.length} ${meta.noun}`;
  $("list-empty").hidden = state.items.length > 0;
  $("list-hint").textContent = state.items.length
    ? "点标题编辑，鼠标移到右侧可删除。保存后约 1 分钟自动上线。"
    : "";

  for (const doc of state.items) {
    const li = document.createElement("li");
    li.className = "doc-item";

    const date = String(doc.meta.date || "").replace(/-/g, ".");
    const draft = doc.meta.draft === true;
    const summary = String(doc.meta.summary || "").slice(0, 60);

    li.innerHTML = `
      <span class="doc-date">${esc(date || "————")}</span>
      <span class="doc-main">
        <span class="doc-name">${esc(doc.meta.title || doc.name)}${draft ? '<span class="doc-badge is-draft">草稿</span>' : ""}</span>
        <span class="doc-meta">${esc(doc.name)}${summary ? " · " + esc(summary) : ""}</span>
      </span>
      <span class="doc-actions">
        <button type="button" class="btn btn-ghost" data-act="edit">编辑</button>
        <button type="button" class="btn btn-danger" data-act="del">删除</button>
      </span>`;

    li.querySelector('[data-act="edit"]').addEventListener("click", () => openEditor(doc));
    li.querySelector(".doc-name").addEventListener("click", () => openEditor(doc));
    li.querySelector('[data-act="del"]').addEventListener("click", () => removeDoc(doc));
    list.appendChild(li);
  }
}

// ---------------- 编辑器 ----------------

function currentUrlFor(fileName) {
  const meta = DIRS[state.tab];
  const slug = fileName.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}[-_]/, "");
  return `${location.origin}${CFG.base || "/"}${meta.url}${slug}/`;
}

function updateUrlPreview() {
  const node = $("url-preview");
  if (!state.editing) {
    node.textContent = "";
    return;
  }
  if (state.editing.isNew) {
    const fileName = buildFilename($("f-date").value, $("f-slug").value);
    node.innerHTML = `网址会是：<code>${esc(currentUrlFor(fileName))}</code>`;
  } else {
    node.innerHTML = `网址：<code>${esc(currentUrlFor(state.editing.path.split("/").pop()))}</code>（文件名固定，改名要重新创建）`;
  }
}

function openEditor(doc) {
  state.editing = {
    path: doc?.path ?? "",
    sha: doc?.sha ?? "",
    isNew: !doc,
    slugLocked: Boolean(doc),
  };

  $("list-pane").hidden = true;
  $("edit-pane").hidden = false;
  $("delete").hidden = !doc;
  $("edit-title").textContent = doc ? "编辑" : state.tab === "posts" ? "写一篇" : "加一个作品";
  $("edit-status").textContent = "";

  const isWork = state.tab === "works";
  document.querySelectorAll(".work-only").forEach((node) => {
    node.hidden = !isWork;
  });

  const meta = doc?.meta ?? {};
  $("f-title").value = meta.title || "";
  $("f-date").value = meta.date || todayString();
  $("f-slug").value = doc ? doc.name.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}[-_]/, "") : "";
  $("f-slug").disabled = Boolean(doc);
  $("f-tags").value = Array.isArray(meta.tags) ? meta.tags.join(", ") : meta.tags || "";
  $("f-summary").value = meta.summary || "";
  $("f-status").value = meta.status || "";
  $("f-link").value = meta.link || "";
  $("f-cover").value = meta.cover || "";
  $("f-draft").checked = meta.draft === true;
  $("f-body").value = doc?.body || "";

  updateUrlPreview();
  updatePreview();
  updateBodyStat();
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("f-title").focus();
}

function closeEditor() {
  state.editing = null;
  $("edit-pane").hidden = true;
  $("list-pane").hidden = false;
  loadList();
}

let previewTimer = null;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const text = $("f-body").value.trim();
    if (!text) {
      $("preview").innerHTML = '<p class="muted">这里会显示排版效果。</p>';
      return;
    }
    try {
      $("preview").innerHTML = renderMarkdown(text);
    } catch (error) {
      $("preview").innerHTML = `<p class="muted">预览出错：${esc(error.message)}</p>`;
    }
  }, 150);
}

function updateBodyStat() {
  const text = $("f-body").value;
  const chars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9'’]+/g) || []).length;
  const minutes = Math.max(1, Math.round((chars + words * 1.6) / 400));
  $("body-stat").textContent = `${chars + words} 字 · 约 ${minutes} 分钟`;
}

async function saveDoc(event) {
  event.preventDefault();
  if (state.saving || !state.editing) return;

  const title = $("f-title").value.trim();
  if (!title) {
    toast("标题不能为空。", "error");
    $("f-title").focus();
    return;
  }

  const date = $("f-date").value || todayString();
  const isNew = state.editing.isNew;
  const meta = DIRS[state.tab];

  const fileName = isNew
    ? buildFilename(date, $("f-slug").value || slugify($("f-title").value))
    : state.editing.path.split("/").pop();
  const path = `${meta.dir}/${fileName}`;

  // 保留原有未识别的字段，避免覆盖时丢数据
  const nextMeta = { ...(state.items.find((d) => d.path === state.editing.path)?.meta ?? {}) };
  nextMeta.title = title;
  nextMeta.date = date;
  const tags = $("f-tags").value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
  if (tags.length) nextMeta.tags = tags;
  else delete nextMeta.tags;
  nextMeta.summary = $("f-summary").value.trim();
  if (state.tab === "works") {
    nextMeta.status = $("f-status").value.trim();
    nextMeta.link = $("f-link").value.trim();
    nextMeta.cover = $("f-cover").value.trim();
  }
  if ($("f-draft").checked) nextMeta.draft = true;
  else delete nextMeta.draft;

  for (const key of Object.keys(nextMeta)) {
    if (nextMeta[key] === "" || nextMeta[key] === undefined) delete nextMeta[key];
  }

  const text = serializeDoc(nextMeta, $("f-body").value);
  const verb = isNew ? "新建" : "更新";
  const message = `${verb}${meta.label}：${title}`;

  state.saving = true;
  setBusy($("save"), true, "提交中…", "保存并发布");
  $("edit-status").textContent = "";

  try {
    const result = await state.client.writeFile(path, text, message, isNew ? null : state.editing.sha);
    if (result?.content?.sha) {
      state.editing.sha = result.content.sha;
      state.editing.path = result.content.path || path;
      state.editing.isNew = false;
      state.editing.slugLocked = true;
      $("f-slug").disabled = true;
      $("delete").hidden = false;
    }
    $("edit-status").textContent = "已提交，等待自动构建";
    toast(`已提交「${title}」。GitHub 大约 1 分钟后完成构建并上线。`, "ok");
    await loadList();
    updateUrlPreview();
  } catch (error) {
    toast(error.message, "error");
    $("edit-status").textContent = "保存失败";
  } finally {
    state.saving = false;
    setBusy($("save"), false, "提交中…", "保存并发布");
  }
}

async function removeDoc(doc) {
  const title = doc.meta.title || doc.name;
  if (!window.confirm(`确定删除「${title}」吗？\n\n这会直接提交到仓库，历史可在 GitHub 上找回。`)) return;

  try {
    await state.client.deleteFile(doc.path, doc.sha, `删除${DIRS[state.tab].label}：${title}`);
    toast(`已删除「${title}」。`, "ok");
    if (state.editing && state.editing.path === doc.path) closeEditor();
    else await loadList();
  } catch (error) {
    toast(error.message, "error");
  }
}

// ---------------- 启动 ----------------

function bindEvents() {
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = $("login-token").value.trim();
    state.account = $("login-account").value.trim() || CFG.owner;
    if (!token) {
      showLoginError("请先把访问令牌粘贴进来。");
      return;
    }
    showLoginError("");
    const button = $("login-submit");
    setBusy(button, true, "验证中…", "登 录");
    try {
      await doLogin(token);
    } catch (error) {
      showLoginError(error.message);
    } finally {
      setBusy(button, false, "验证中…", "登 录");
    }
  });

  $("logout").addEventListener("click", logout);
  $("cancel").addEventListener("click", closeEditor);
  $("edit-form").addEventListener("submit", saveDoc);
  $("f-body").addEventListener("input", () => {
    updatePreview();
    updateBodyStat();
  });
  $("f-title").addEventListener("input", updateUrlPreview);
  $("f-slug").addEventListener("input", updateUrlPreview);
  $("f-date").addEventListener("change", updateUrlPreview);

  $("tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    state.tab = button.dataset.tab;
    $("tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === button));
    $("edit-pane").hidden = true;
    $("list-pane").hidden = false;
    state.editing = null;
    loadList();
  });

  $("new-post").addEventListener("click", () => openEditor(null));
}

async function boot() {
  const repo = $("help-repo");
  if (repo) repo.textContent = `${CFG.owner}/${CFG.repo}`;

  $("login-account").value = CFG.owner || "";
  bindEvents();

  if (!CFG.owner || !CFG.repo) {
    showLoginError("配置缺失：site.config.json 里的 admin.owner / admin.repo 没有填。");
    return;
  }

  const saved = localStorage.getItem(TOKEN_KEY);
  if (!saved) return;

  $("login-token").value = saved;
  const button = $("login-submit");
  setBusy(button, true, "验证中…", "登 录");
  try {
    await doLogin(saved);
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY);
    $("login-token").value = "";
    showLoginError("上次的令牌已失效，请重新填入。" + error.message);
  } finally {
    setBusy(button, false, "验证中…", "登 录");
  }
}

boot();
