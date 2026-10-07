// Zero-dependency static server for the exported build (`out/`), so the UI can be
// checked in a browser without adding a runtime dependency. Localhost only.
//
// Run: npm run build && npm run serve:out   (http://localhost:3000)

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "out");
const port = Number(process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function resolveFile(urlPath) {
  const candidates = [];
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  candidates.push(clean === "/" ? "/index.html" : clean);
  candidates.push(clean.endsWith("/") ? `${clean}index.html` : `${clean}/index.html`);
  for (const candidate of candidates) {
    const filePath = path.join(root, candidate);
    if (!filePath.startsWith(root)) continue;
    try {
      const info = await stat(filePath);
      if (info.isFile()) return filePath;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? "/");
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`);
});
