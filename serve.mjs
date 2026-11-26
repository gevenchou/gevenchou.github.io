#!/usr/bin/env node
// 本地预览：node serve.mjs [端口]
// 直接跑在 dist/ 上，不监听外部网卡，只本机可见。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv[2] || process.env.PORT || 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const safe = path.normalize(clean).replace(/^(\.\.[/\\])+/, "");
  let target = path.join(DIST, safe);

  if (!target.startsWith(DIST)) return null;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!fs.existsSync(target)) return null;
  return target;
}

if (!fs.existsSync(DIST)) {
  console.error("还没有构建产物，先运行：node build.mjs");
  process.exit(1);
}

http
  .createServer((req, res) => {
    const file = resolveFile(req.url || "/");
    if (!file) {
      const notFound = path.join(DIST, "404.html");
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : "404");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`预览：http://127.0.0.1:${PORT}/`);
    console.log("改完内容后另开一个终端跑 node build.mjs，刷新页面即可。Ctrl+C 结束。");
  });
