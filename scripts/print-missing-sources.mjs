#!/usr/bin/env node
/**
 * print-missing-sources.mjs — まだ手元に無い資料を一覧化する
 *
 * 「次に何を取りに行けばよいか」だけを出す。判断はしない。
 *
 * 使い方:
 *   node scripts/print-missing-sources.mjs                 # 優先度順の一覧
 *   node scripts/print-missing-sources.mjs --priority P0   # P0 だけ
 *   node scripts/print-missing-sources.mjs --format tsv    # 表計算へ貼る用
 *   node scripts/print-missing-sources.mjs --format urls   # curl などへ流す用
 *   node scripts/print-missing-sources.mjs --repos         # 未 clone の実装のみ
 *   node scripts/print-missing-sources.mjs --marker-meta  # marker_meta.json が無い論文
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./lib/mini-yaml.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
};
const format = argValue("--format") || "text";
const priorityFilter = argValue("--priority");
const reposOnly = argv.includes("--repos");
const markerMetaOnly = argv.includes("--marker-meta");

const load = (rel) => {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    console.error(`${rel} が無い`);
    process.exit(1);
  }
  return parseYaml(readFileSync(abs, "utf8")) || [];
};

const has = (rel) => Boolean(rel) && existsSync(resolve(root, rel));

// ------------------------------------------------------------------ 実装側

if (reposOnly) {
  const repositories = load("docs/sources/repositories.yaml");
  const missing = repositories.filter((r) => !has(r.local_path));
  const unpinned = repositories.filter((r) => has(r.local_path) && !r.pinned_commit);

  console.log(`未取得の参照実装: ${missing.length} / ${repositories.length} 件`);
  for (const r of missing) console.log(`  - ${r.id.padEnd(24)} ${r.url}`);
  if (unpinned.length > 0) {
    console.log(
      `\npinned_commit 未記入: ${unpinned.length} 件（sync 後に git rev-parse HEAD を転記すること）`,
    );
    for (const r of unpinned) console.log(`  - ${r.id}`);
  }
  const noLicense = repositories.filter((r) => !r.license_spdx);
  if (noLicense.length > 0) {
    console.log(`\nライセンス不明: ${noLicense.length} 件（コード転記は禁止）`);
    for (const r of noLicense) console.log(`  - ${r.id.padEnd(24)} ${r.url}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------ marker_meta.json

if (markerMetaOnly) {
  const all = load("docs/sources/papers.yaml");
  const missing = all.filter((p) => p.marker_metadata && !has(p.marker_metadata));
  console.log(`marker_meta.json が無い論文: ${missing.length} / ${all.length} 本\n`);
  for (const p of missing) {
    console.log(`  ${p.id.padEnd(32)} ${p.marker_metadata}`);
  }
  if (missing.length > 0) {
    console.log("\nMarker が marker_meta.json を出力していない場合は取得しようがない。");
    console.log(
      "次回の変換時に出力する設定があれば有効にすること（変換パラメータの追跡に使える）。",
    );
  }
  process.exit(0);
}

// ------------------------------------------------------------------ 論文側

const papers = load("docs/sources/papers.yaml");
const order = { P0: 0, P1: 1, P2: 2, P3: 3, undefined: 9, null: 9 };

const rows = papers
  .filter((p) => !has(p.local_pdf) || !has(p.marker_markdown))
  .filter((p) => !priorityFilter || p.priority === priorityFilter)
  .map((p) => {
    const pdfHere = has(p.local_pdf);
    const mdHere = has(p.marker_markdown);
    const metaHere = has(p.marker_metadata);
    let need;
    if (!pdfHere && !mdHere) need = "PDF+Marker";
    else if (!pdfHere) need = "PDF";
    else if (!mdHere) need = "Marker";
    else need = "-";
    if (pdfHere && mdHere && !metaHere) need = "marker_meta.json";
    return {
      priority: p.priority || "-",
      id: p.id,
      need,
      short: p.short_title || p.title,
      pdf_url: p.pdf_url || "(PDF 直リンクなし)",
      landing: p.landing_url || "",
      dest: p.local_pdf || "",
      redistribution: (p.redistribution && p.redistribution.status) || "unset",
    };
  })
  .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || a.id.localeCompare(b.id));

if (format === "tsv") {
  console.log(
    ["priority", "paper_id", "need", "pdf_url", "landing_url", "dest", "redistribution"].join("\t"),
  );
  for (const r of rows)
    console.log(
      [r.priority, r.id, r.need, r.pdf_url, r.landing, r.dest, r.redistribution].join("\t"),
    );
  process.exit(0);
}

if (format === "urls") {
  for (const r of rows) if (r.pdf_url.startsWith("http")) console.log(r.pdf_url);
  process.exit(0);
}

const byPriority = new Map();
for (const r of rows) {
  if (!byPriority.has(r.priority)) byPriority.set(r.priority, []);
  byPriority.get(r.priority).push(r);
}

console.log(`未取得の資料: ${rows.length} / ${papers.length} 本\n`);
for (const key of ["P0", "P1", "P2", "P3", "-"]) {
  const group = byPriority.get(key);
  if (!group) continue;
  console.log(`## ${key}  (${group.length} 本)`);
  for (const r of group) {
    console.log(`  [${r.need.padEnd(16)}] ${r.id}`);
    console.log(`      ${r.short}`);
    console.log(`      取得元: ${r.pdf_url}`);
    console.log(`      保存先: ${r.dest}`);
    if (r.redistribution !== "allowed") {
      console.log(
        `      再配布: ${r.redistribution}  → サイトへ PDF をコピーしない。外部リンクのみ。`,
      );
    }
  }
  console.log("");
}

const noPdfUrl = papers.filter((p) => !p.pdf_url);
if (noPdfUrl.length > 0) {
  console.log(`## PDF 直リンクが見つかっていない論文 (${noPdfUrl.length} 本)`);
  console.log("   購読が必要か、公開版が存在しない。所属機関経由での入手を検討すること。");
  for (const p of noPdfUrl)
    console.log(`  - ${p.id.padEnd(28)} ${p.landing_url || "(ランディングも不明)"}`);
}
