/**
 * 로컬 실행용 서버 — 정적 파일 + /api/market
 *
 * Cloudflare Pages 에 배포하지 않고도 PC에서 대시보드를 그대로 띄우기 위한 스크립트입니다.
 * functions/api/market.js 의 onRequest 를 그대로 재사용하므로, 배포본과 동일한 데이터를
 * 보게 됩니다. 외부 의존성이 없어 npm install 이 필요 없습니다.
 *
 * KIS 시세를 로컬에서도 쓰려면 실행 전에 환경변수를 지정하세요.
 * 미지정 시 배포본과 동일하게 Yahoo Finance 로 자동 대체됩니다.
 *   set KIS_APP_KEY=...
 *   set KIS_APP_SECRET=...
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8899;
const HOST = "127.0.0.1"; // 외부 노출 방지 — 이 PC에서만 접속 가능

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
};

// 배포본과 같은 함수를 재사용한다
const marketFn = path.join(ROOT, "functions", "api", "market.js");
const { onRequest } = await import(pathToFileURL(marketFn).href);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/api/market") {
    try {
      const result = await onRequest({
        request: { method: req.method, url: url.href },
        env: {
          KIS_APP_KEY:    process.env.KIS_APP_KEY,
          KIS_APP_SECRET: process.env.KIS_APP_SECRET,
        },
      });
      const body = await result.text();
      res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(body);
    } catch (err) {
      console.error("[/api/market]", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "시장 데이터 수집 실패" }));
    }
  }

  // 정적 파일 — ROOT 밖으로 나가는 경로는 차단
  const rel  = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404 Not Found");
  }

  res.writeHead(200, {
    "Content-Type":  CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(fs.readFileSync(file));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`PORT_IN_USE ${PORT}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  // 실행 스크립트가 이 줄을 기다립니다 — 형식을 바꾸지 마세요
  console.log(`READY http://localhost:${PORT}`);
});
