#!/usr/bin/env node
// 把音频上传到 Cloudflare R2。零依赖：签名用 Node 自带的 crypto 手写 AWS SigV4。
//
// 用法：
//   node tools/r2-upload.mjs 我的节目.mp3
//   node tools/r2-upload.mjs 第一集.mp3 第二集.m4a
//   node tools/r2-upload.mjs --check          检查配置和凭据是否可用
//   node tools/r2-upload.mjs --selftest       只跑签名自检（不需要凭据）
//   node tools/r2-upload.mjs --key eps/ep01.mp3 我的节目.mp3   自定义对象路径
//
// 凭据从 tools/r2.config.json 读（已在 .gitignore 里），也可以用环境变量覆盖：
//   R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_PUBLIC_BASE

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "r2.config.json");

// ---------------- 签名（AWS SigV4） ----------------

const encodeRfc3986 = (str) =>
  encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const encodePath = (pathname) =>
  String(pathname || "/")
    .split("/")
    .map(encodeRfc3986)
    .join("/");

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();

export function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * 给请求签名。返回需要附加的 header。
 * region 对 R2 固定是 "auto"；service 固定 "s3"。
 */
export function signV4({
  method,
  url,
  headers = {},
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region = "auto",
  service = "s3",
  now = new Date(),
  query = "",
}) {
  const parsed = new URL(url);
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);

  const signed = { ...headers };
  signed.host = parsed.host;
  signed["x-amz-date"] = stamp;
  signed["x-amz-content-sha256"] = payloadHash;

  const lower = {};
  for (const [key, value] of Object.entries(signed)) {
    lower[key.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  const headerNames = Object.keys(lower).sort();
  const canonicalHeaders = headerNames.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = headerNames.join(";");

  const canonicalRequest = [
    method,
    encodePath(parsed.pathname),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const out = { ...headers };
  out.host = parsed.host;
  out["x-amz-date"] = stamp;
  out["x-amz-content-sha256"] = payloadHash;
  out.Authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: out, signature, canonicalRequest, stringToSign };
}

// ---------------- 自检：AWS 官方文档里的示例 ----------------

function selfTest() {
  // AWS 文档 "Example: GET Object" 的测试向量
  const result = signV4({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    now: new Date("2013-05-24T00:00:00Z"),
  });

  const expected = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";
  const ok = result.signature === expected;

  console.log("SigV4 自检（AWS 官方测试向量）");
  console.log("  期望签名:", expected);
  console.log("  实际签名:", result.signature);
  console.log(ok ? "  ✓ 通过：签名算法实现正确" : "  ✗ 失败：签名不一致");
  return ok;
}

// ---------------- 配置 ----------------

const MIME = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  }
  const config = {
    accountId: process.env.R2_ACCOUNT_ID || fileConfig.accountId || "",
    bucket: process.env.R2_BUCKET || fileConfig.bucket || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || fileConfig.accessKeyId || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || fileConfig.secretAccessKey || "",
    publicBase: (process.env.R2_PUBLIC_BASE || fileConfig.publicBase || "").replace(/\/+$/, ""),
    prefix: String(fileConfig.prefix || "radio").replace(/^\/+|\/+$/g, ""),
  };
  return config;
}

function requireConfig(config) {
  const missing = ["accountId", "bucket", "accessKeyId", "secretAccessKey"].filter((k) => !config[k]);
  if (missing.length) {
    console.error("缺少配置：" + missing.join("、"));
    console.error(`请填写 ${path.relative(process.cwd(), CONFIG_PATH)}（可参照 r2.config.example.json）`);
    console.error("或用环境变量 R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }
}

const endpointFor = (config, key = "") =>
  `https://${config.accountId}.r2.cloudflarestorage.com/${encodeRfc3986(config.bucket)}` +
  (key ? `/${key.split("/").map(encodeRfc3986).join("/")}` : "");

function ymd(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function slugFromName(name) {
  return String(name)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ---------------- 操作 ----------------

async function check(config) {
  requireConfig(config);
  const url = endpointFor(config) + "/";
  const payloadHash = sha256hex("");
  const { headers } = signV4({
    method: "HEAD",
    url,
    headers: {},
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  console.log(`检查：bucket「${config.bucket}」`);
  const res = await fetch(url, { method: "HEAD", headers });
  if (res.ok) {
    console.log("  ✓ 凭据有效，bucket 可访问");
    if (!config.publicBase) {
      console.log("  ! 还没配 publicBase，上传后无法给出公开链接");
    } else {
      console.log(`  公开地址前缀：${config.publicBase}`);
    }
    return true;
  }
  console.log(`  ✗ HTTP ${res.status}`);
  if (res.status === 403) console.log("    → Access Key / Secret 不对，或令牌没有这个 bucket 的权限");
  if (res.status === 404) console.log("    → bucket 名字不对，或 accountId 不对");
  return false;
}

async function uploadOne(config, filePath, keyOverride) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${filePath}`);

  const buf = fs.readFileSync(abs);
  const name = path.basename(abs);
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  const key = keyOverride
    ? keyOverride.replace(/^\/+/, "")
    : `${config.prefix}/${ymd()}-${slugFromName(name) || "audio"}.${ext || "bin"}`;

  const url = endpointFor(config, key);
  const payloadHash = sha256hex(buf);
  const contentType = MIME[ext] || "application/octet-stream";

  const { headers } = signV4({
    method: "PUT",
    url,
    headers: { "content-type": contentType },
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const sizeMb = (buf.length / 1024 / 1024).toFixed(1);
  process.stdout.write(`上传 ${name}（${sizeMb} MB）… `);

  const res = await fetch(url, { method: "PUT", headers, body: buf });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log("失败");
    throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  console.log("完成");

  const publicUrl = config.publicBase ? `${config.publicBase}/${key.split("/").map(encodeRfc3986).join("/")}` : "";
  return { key, size: buf.length, publicUrl };
}

// ---------------- 入口 ----------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--selftest")) {
    process.exit(selfTest() ? 0 : 1);
  }

  const config = loadConfig();

  if (args.includes("--check")) {
    process.exit((await check(config)) ? 0 : 1);
  }

  const keyIndex = args.indexOf("--key");
  const keyOverride = keyIndex >= 0 ? args[keyIndex + 1] : "";
  const files = args.filter((a, i) => !a.startsWith("--") && i !== keyIndex + 1);

  if (!files.length) {
    console.log("用法：node tools/r2-upload.mjs <音频文件> [更多文件…]");
    console.log("      node tools/r2-upload.mjs --check      检查配置");
    console.log("      node tools/r2-upload.mjs --selftest   签名自检");
    process.exit(1);
  }

  requireConfig(config);

  const results = [];
  for (const file of files) {
    results.push(await uploadOne(config, file, files.length === 1 ? keyOverride : ""));
  }

  console.log("");
  if (!config.publicBase) {
    console.log("上传成功，但配置里没有 publicBase，所以没有公开链接。");
    console.log("去 R2 桶的 Settings 里开 Public Development URL，或绑自定义域名，再把前缀填进配置。");
  } else {
    console.log("公开地址（复制到后台「音频」那一栏，或播客订阅源会自动用它）：");
    for (const r of results) console.log("  " + r.publicUrl);
  }
}

main().catch((error) => {
  console.error("\n出错了：" + error.message);
  process.exit(1);
});
