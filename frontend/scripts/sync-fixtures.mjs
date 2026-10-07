// Copy the repo fixtures the UI needs into frontend/mock/from-fixtures/.
//
// READ-ONLY on the sources: fixtures/ and eval/ are owned by the backend agent
// (AGENTS.md section 6). This script only reads them, writes local copies plus a
// manifest with sha256 hashes, and turns eval/transcripts.jsonl into a JSON array
// the mock layer can import.
//
// Run: npm run sync:fixtures

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const outDir = path.join(frontendRoot, "mock", "from-fixtures");

const SOURCES = [
  { from: "fixtures/golden_engine.json", to: "golden_engine.json" },
  { from: "eval/transcripts.jsonl", to: "transcripts.jsonl" },
];

async function sha256(file) {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const manifest = {
    generated_by: "frontend/scripts/sync-fixtures.mjs",
    note: "Local read-only copies of repo fixtures so the frontend mock layer can import them. Never edit here; edit the source in fixtures/ or eval/ and re-run npm run sync:fixtures.",
    sources: [],
  };

  for (const source of SOURCES) {
    const srcPath = path.join(repoRoot, source.from);
    const destPath = path.join(outDir, source.to);
    const content = await readFile(srcPath, "utf8");
    await writeFile(destPath, content, "utf8");
    manifest.sources.push({
      source: source.from,
      copy: `frontend/mock/from-fixtures/${source.to}`,
      sha256: await sha256(srcPath),
      bytes: Buffer.byteLength(content, "utf8"),
    });
  }

  // JSONL -> JSON array so the app can import the synthetic transcripts + gold.
  const rows = (await readFile(path.join(repoRoot, "eval/transcripts.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  await writeFile(
    path.join(outDir, "transcripts.generated.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify({ ...manifest, rows: rows.length }, null, 2)}\n`,
    "utf8",
  );

  for (const source of manifest.sources) {
    console.log(`${source.sha256.slice(0, 16)}…  ${source.source} -> ${source.copy}`);
  }
  console.log(`${rows.length} transcripts -> frontend/mock/from-fixtures/transcripts.generated.json`);
}

await main();
