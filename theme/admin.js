// 管理后台的界面逻辑。
// 数据全部通过 GitHub Contents API 直接读写仓库，没有中间服务器。

import {
  buildFilename,
  buildMediaPath,
  bytesToBase64,
  createClient,
  extOf,
  formatBytes,
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
  posts: {
    dir: "content/posts",
    url: "posts/",
    label: "文章",
    noun: "篇",
    newLabel: "＋ 写一篇",
    editLabel: "写一篇",
  },
  works: {
    dir: "content/works",
    url: "works/",
    label: "作品",
    noun: "个",
    newLabel: "＋ 加一个作品",
    editLabel: "加一个作品",
  },
  radio: {
    dir: "content/radio",
    url: "radio/",
    label: "电台",
    noun: "期",
    newLabel: "＋ 录一期",
    editLabel: "录一期",
  },
};

const $ = (id) => document.getElementById(id);

const state = {
  token: "",
  account: CFG.owner || "",
  client: null,
  tab: "posts",
  items: [],
  editing: null,
  saving: false,
  profile: { sha: "", data: null, loaded: false },
  uploading: false,
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
  }, kind === "error" ? 6500 : 4000);
}

function setBusy(button, busy, busyText, normalText) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function absoluteAsset(pathname) {
  if (!pathname) return "";
  if (/^https?:/i.test(pathname)) return pathname;
  return `${CFG.base || "/"}${String(pathname).replace(/^\/+/, "")}`;
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
  if (info && info.repo) document.title = `管理 · ${CFG.siteTitle}`;
  loadList();
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.client = null;
  state.items = [];
  state.profile = { sha: "", data: null, loaded: false };
  $("panel-view").hidden = true;
  $("login-view").hidden = false;
  $("login-token").value = "";
  showLoginError("");
  toast("已退出登录。令牌已从这台浏览器清除。");
}

// ---------------- 标签页 ----------------

function switchTab(tab) {
  state.tab = tab;
  state.editing = null;

  $("tabs").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tab);
  });

  const isProfile = tab === "profile";
  $("list-pane").hidden = isProfile;
  $("edit-pane").hidden = true;
  $("profile-pane").hidden = !isProfile;

  if (isProfile) loadProfile();
  else loadList();
}

// ---------------- 列表 ----------------

async function loadList() {
  const meta = DIRS[state.tab];
  if (!meta) return;

  $("list-title").textContent = meta.label;
  $("new-post").textContent = meta.newLabel;
  $("list-body").innerHTML = "";
  $("list-empty").hidden = true;
  $("list-count").textContent = "读取中…";
  $("list-hint").textContent = "";

  let entries = [];
  try {
    entries = await state.client.listDir(meta.dir);
  } catch (error) {
    $("list-count").textContent = "";
    // 目录还没建过时 GitHub 返回 404，属于正常情况
    if (error.status === 404) {
      state.items = [];
      renderList();
      return;
    }
    toast(error.message, "error");
    return;
  }

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
    const extra = state.tab === "radio" && !doc.meta.audio ? '<span class="doc-badge">缺音频</span>' : "";

    li.innerHTML = `
      <span class="doc-date">${esc(date || "————")}</span>
      <span class="doc-main">
        <span class="doc-name">${esc(doc.meta.title || doc.name)}${draft ? '<span class="doc-badge is-draft">草稿</span>' : ""}${extra}</span>
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

function audioValue() {
  return $("f-audio").value.trim();
}

function updateAudioPreview() {
  const box = $("audio-preview");
  const value = audioValue();
  if (!value) {
    box.innerHTML = "";
    return;
  }
  if (/^(https?:)?\/\//i.test(value)) {
    box.innerHTML = `<audio class="player" controls preload="none" src="${esc(value)}"></audio>`;
    return;
  }
  box.innerHTML = `<audio class="player" controls preload="none" src="${esc(absoluteAsset(value))}"></audio>
    <p class="upload-hint muted">这是仓库里的文件，本地预览可能听不到，发布后即可播放。</p>`;
}

function openEditor(doc) {
  state.editing = {
    path: doc?.path ?? "",
    sha: doc?.sha ?? "",
    isNew: !doc,
  };

  $("list-pane").hidden = true;
  $("profile-pane").hidden = true;
  $("edit-pane").hidden = false;
  $("delete").hidden = !doc;

  const meta = DIRS[state.tab];
  $("edit-title").textContent = doc ? `编辑${meta.label}` : meta.editLabel;
  $("edit-status").textContent = "";

  const isWork = state.tab === "works";
  const isRadio = state.tab === "radio";
  document.querySelectorAll(".work-only").forEach((node) => { node.hidden = !isWork; });
  document.querySelectorAll(".radio-only").forEach((node) => { node.hidden = !isRadio; });

  const data = doc?.meta ?? {};
  $("f-title").value = data.title || "";
  $("f-date").value = data.date || todayString();
  $("f-slug").value = doc ? doc.name.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}[-_]/, "") : "";
  $("f-slug").disabled = Boolean(doc);
  $("f-tags").value = Array.isArray(data.tags) ? data.tags.join(", ") : data.tags || "";
  $("f-summary").value = data.summary || "";
  $("f-status").value = data.status || "";
  $("f-link").value = data.link || "";
  $("f-cover").value = data.cover || "";
  $("f-audio").value = data.audio || "";
  $("f-duration").value = data.duration || "";
  $("f-draft").checked = data.draft === true;
  $("f-body").value = doc?.body || "";

  $("audio-info").textContent =
    "建议单集 ≤ 15MB（约 15 分钟 128kbps）。更大的音频请用外链，GitHub 仓库不适合放大文件。";

  updateAudioPreview();
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

// ---------------- 音频上传 ----------------

const AUDIO_WARN = 15 * 1024 * 1024;
const AUDIO_MAX = 40 * 1024 * 1024;

async function uploadAudio(file) {
  if (!state.editing || state.uploading) return;

  if (file.size > AUDIO_MAX) {
    toast(`这个音频 ${formatBytes(file.size)}，超过 40MB 上限。GitHub 收不了，请压缩或改用外链。`, "error");
    return;
  }
  if (file.size > AUDIO_WARN) {
    const ok = window.confirm(
      `这个音频 ${formatBytes(file.size)}，偏大。\n\nGitHub 仓库建议单文件 15MB 以内，超过会让构建变慢、也会占用仓库存量。\n\n仍然上传吗？（更推荐用外链）`,
    );
    if (!ok) return;
  }

  const date = $("f-date").value || todayString();
  const slugBase = $("f-slug").value || slugify($("f-title").value) || "episode";
  const path = buildMediaPath("assets/audio", date, slugBase, file.name);

  const button = $("pick-audio");
  state.uploading = true;
  setBusy(button, true, "上传中…", "选择文件");
  $("audio-info").textContent = `正在上传 ${formatBytes(file.size)}…`;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = await state.client.getSha(path);
    await state.client.writeBinaryFile(path, bytes, `上传音频：${$("f-title").value || file.name}`, existing);
    $("f-audio").value = path;
    updateAudioPreview();
    $("audio-info").textContent = `已上传 ${formatBytes(file.size)}：${path}`;
    toast("音频已上传。还要点「保存并发布」，这一期才会真正上线。", "ok");
  } catch (error) {
    $("audio-info").textContent = "上传失败";
    toast(error.message, "error");
  } finally {
    state.uploading = false;
    setBusy(button, false, "上传中…", "选择文件");
    $("audio-file").value = "";
  }
}

// ---------------- 保存 / 删除 ----------------

async function saveDoc(event) {
  event.preventDefault();
  if (state.saving || !state.editing) return;

  const title = $("f-title").value.trim();
  if (!title) {
    toast("标题不能为空。", "error");
    $("f-title").focus();
    return;
  }

  if (state.tab === "radio" && !audioValue()) {
    const ok = window.confirm("这一期还没有音频。仍然保存吗？（页面上会显示「音频还没上传」）");
    if (!ok) return;
  }

  const date = $("f-date").value || todayString();
  const isNew = state.editing.isNew;
  const meta = DIRS[state.tab];

  const fileName = isNew
    ? buildFilename(date, $("f-slug").value || slugify($("f-title").value))
    : state.editing.path.split("/").pop();
  const path = `${meta.dir}/${fileName}`;

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
  if (state.tab === "radio") {
    nextMeta.audio = audioValue();
    nextMeta.duration = $("f-duration").value.trim();
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

// ---------------- 个人资料 ----------------

function refreshBackgroundPreview(data) {
  const box = $("bg-preview");
  const image = data?.background?.image || "";
  if (image) {
    box.style.backgroundImage = `url("${absoluteAsset(image)}")`;
    box.classList.add("has-image");
    box.textContent = "";
  } else {
    box.style.backgroundImage = "";
    box.classList.remove("has-image");
    box.textContent = "当前没有背景图";
  }
  const strength = Math.round((Number(data?.background?.strength ?? 0.3) * 100) / 5) * 5;
  $("bg-strength").value = String(strength);
  $("bg-strength-value").textContent = `${strength}%`;
}

function fillProfile(data) {
  $("p-siteTitle").value = data.siteTitle || "";
  $("p-author").value = data.author || "";
  $("p-tagline").value = data.tagline || "";
  $("p-bio").value = data.bio || "";
  $("p-seal").value = data.seal || "";
  $("p-footerNote").value = data.footerNote || "";
  $("p-links").value = (data.links || []).map((l) => `${l.label}|${l.url}`).join("\n");

  const avatar = data.avatar ? absoluteAsset(data.avatar) : "";
  const img = $("avatar-img");
  if (avatar) {
    img.src = avatar;
    img.style.visibility = "visible";
  } else {
    img.removeAttribute("src");
    img.style.visibility = "hidden";
  }

  refreshBackgroundPreview(data);
}

async function loadProfile() {
  if (state.profile.loaded) {
    fillProfile(state.profile.data);
    return;
  }
  $("profile-status").textContent = "读取中…";
  try {
    const { sha, data } = await state.client.readConfig();
    state.profile = { sha, data, loaded: true };
    fillProfile(data);
    $("profile-status").textContent = "";
  } catch (error) {
    $("profile-status").textContent = "读取失败";
    toast(error.message, "error");
  }
}

/** 图片压缩：头像缩到 512，背景缩到 1920，都转成 jpg，省仓库空间 */
async function shrinkImage(file, maxSide, quality = 0.86) {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    return blob;
  } catch {
    return null;
  }
}

async function uploadImage(file, { folder, maxSide, label, onDone }) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast("请选择图片文件。", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast(`图片 ${formatBytes(file.size)}，太大了，请先自己压缩一下。`, "error");
    return;
  }

  const button = label === "头像" ? $("pick-avatar") : $("pick-bg");
  const original = label === "头像" ? "更换头像" : "更换背景";
  setBusy(button, true, "处理中…", original);
  $("profile-status").textContent = `正在上传${label}…`;

  try {
    const shrunk = await shrinkImage(file, maxSide);
    const blob = shrunk || file;
    const ext = shrunk ? "jpg" : extOf(file.name) || "jpg";
    const path = `${folder}/${{ 头像: "avatar", 背景图: "background" }[label]}.${ext}`;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const existing = await state.client.getSha(path);
    await state.client.writeBinaryFile(path, bytes, `更新${label}`, existing);

    const data = state.profile.data;
    if (label === "头像") data.avatar = path;
    else data.background = { ...(data.background || {}), image: path };

    if (label === "头像") {
      $("avatar-img").src = `${absoluteAsset(path)}?t=${Date.now()}`;
      $("avatar-img").style.visibility = "visible";
    } else {
      refreshBackgroundPreview(data);
    }

    $("profile-status").textContent = `${label}已上传，别忘了点「保存资料」`;
    toast(`${label}已上传（${formatBytes(bytes.length)}）。点「保存资料」后才会生效。`, "ok");
    onDone?.();
  } catch (error) {
    $("profile-status").textContent = "上传失败";
    toast(error.message, "error");
  } finally {
    setBusy(button, false, "处理中…", original);
    $("avatar-file").value = "";
    $("bg-file").value = "";
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (state.uploading) return;
  if (!state.profile.loaded) {
    toast("资料还没读取完成，稍等一下。", "error");
    return;
  }

  const data = JSON.parse(JSON.stringify(state.profile.data));
  data.siteTitle = $("p-siteTitle").value.trim() || data.siteTitle;
  data.author = $("p-author").value.trim();
  data.tagline = $("p-tagline").value.trim();
  data.bio = $("p-bio").value.trim();
  data.seal = $("p-seal").value.trim();
  data.footerNote = $("p-footerNote").value.trim();

  const links = $("p-links").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("|");
      if (at < 0) return { label: line, url: line };
      return { label: line.slice(0, at).trim(), url: line.slice(at + 1).trim() };
    })
    .filter((l) => l.label && l.url);
  data.links = links;

  const strength = Number($("bg-strength").value) / 100;
  if (data.background && data.background.image) {
    data.background.strength = strength;
  }

  const button = $("save-profile");
  setBusy(button, true, "保存中…", "保存资料");
  $("profile-status").textContent = "";

  try {
    const result = await state.client.writeConfig(data, "更新站点资料", state.profile.sha);
    if (result?.content?.sha) state.profile.sha = result.content.sha;
    state.profile.data = data;
    $("profile-status").textContent = "已保存，约 1 分钟后生效";
    const brand = document.querySelector(".admin-brand");
    if (brand && data.siteTitle) brand.textContent = data.siteTitle;
    toast("资料已保存。GitHub 大约 1 分钟后完成构建，刷新首页就能看到。", "ok");
  } catch (error) {
    toast(error.message, "error");
    $("profile-status").textContent = "保存失败";
  } finally {
    setBusy(button, false, "保存中…", "保存资料");
  }
}

function clearBackground() {
  if (!state.profile.loaded) return;
  const data = state.profile.data;
  if (data.background) data.background.image = "";
  refreshBackgroundPreview(data);
  $("profile-status").textContent = "背景图已移除，点「保存资料」生效";
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
  $("profile-form").addEventListener("submit", saveProfile);

  $("f-body").addEventListener("input", () => {
    updatePreview();
    updateBodyStat();
  });
  $("f-title").addEventListener("input", updateUrlPreview);
  $("f-slug").addEventListener("input", updateUrlPreview);
  $("f-date").addEventListener("change", updateUrlPreview);
  $("f-audio").addEventListener("input", updateAudioPreview);

  $("pick-audio").addEventListener("click", () => $("audio-file").click());
  $("audio-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) uploadAudio(file);
  });

  $("pick-avatar").addEventListener("click", () => $("avatar-file").click());
  $("avatar-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) uploadImage(file, { folder: "assets", maxSide: 512, label: "头像" });
  });

  $("pick-bg").addEventListener("click", () => $("bg-file").click());
  $("bg-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) uploadImage(file, { folder: "assets", maxSide: 1920, label: "背景图" });
  });
  $("clear-bg").addEventListener("click", clearBackground);

  $("bg-strength").addEventListener("input", (event) => {
    $("bg-strength-value").textContent = `${event.target.value}%`;
  });

  $("tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (button) switchTab(button.dataset.tab);
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
