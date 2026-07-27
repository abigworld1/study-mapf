#!/usr/bin/env node
/**
 * validate-sources.mjs — docs/sources/*.yaml の整合性検査
 *
 * 検査内容:
 *   1.  YAML が docs/sources/schema/*.schema.json に適合するか
 *   2.  paper-id / repository-id / algorithm-id の重複
 *   3.  相互参照の整合（papers.algorithms、repositories.paper_ids など）
 *   4.  local_pdf / marker_markdown / marker_metadata の実在
 *   5.  空ファイル
 *   6.  PDF の拡張子とマジックバイト
 *   7.  guarantees の不明値（unknown が残っているものを一覧化）
 *   8.  URL 形式
 *   9.  status: verified なのにローカル資料が無い状態
 *   10. redistribution.status が未設定・根拠なしの状態
 *
 * 依存: Node.js 標準機能のみ（YAML と JSON Schema は scripts/lib/ の自作サブセット実装）
 *
 * 使い方:
 *   node scripts/validate-sources.mjs            # error があれば exit 1
 *   node scripts/validate-sources.mjs --strict   # warning も exit 1 にする
 *   node scripts/validate-sources.mjs --quiet    # 集計だけ表示
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./lib/mini-yaml.mjs";
import { validate } from "./lib/mini-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const STRICT = process.argv.includes("--strict");
const QUIET = process.argv.includes("--quiet");

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`[ERROR] ${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`[WARN ] ${where}: ${msg}`);

function loadYamlFile(rel) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    err(rel, "ファイルが存在しない");
    return null;
  }
  try {
    const parsed = parseYaml(readFileSync(abs, "utf8"));
    if (!Array.isArray(parsed)) {
      err(rel, "トップレベルがリストではない");
      return null;
    }
    return parsed;
  } catch (e) {
    err(rel, `YAML 解析に失敗: ${e.message}`);
    return null;
  }
}

function loadSchema(rel) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    err(rel, "スキーマが存在しない");
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    err(rel, `JSON 解析に失敗: ${e.message}`);
    return null;
  }
}

const papers = loadYamlFile("docs/sources/papers.yaml") || [];
const repositories = loadYamlFile("docs/sources/repositories.yaml") || [];
const algorithms = loadYamlFile("docs/sources/algorithms.yaml") || [];

const paperSchema = loadSchema("docs/sources/schema/paper.schema.json");
const repoSchema = loadSchema("docs/sources/schema/repository.schema.json");
const algoSchema = loadSchema("docs/sources/schema/algorithm.schema.json");

// ---------------------------------------------------------------- 1. スキーマ

function checkSchema(entries, schema, label) {
  if (!schema) return;
  entries.forEach((entry, i) => {
    const where = `${label}[${i}] (${entry && entry.id ? entry.id : "id 不明"})`;
    for (const message of validate(entry, schema, "$")) err(where, message);
  });
}
checkSchema(papers, paperSchema, "papers.yaml");
checkSchema(repositories, repoSchema, "repositories.yaml");
checkSchema(algorithms, algoSchema, "algorithms.yaml");

// ---------------------------------------------------------------- 2. ID 重複

function collectIds(entries, label) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    if (seen.has(entry.id)) err(label, `id が重複: "${entry.id}"`);
    else seen.set(entry.id, entry);
  }
  return seen;
}
const paperById = collectIds(papers, "papers.yaml");
const repoById = collectIds(repositories, "repositories.yaml");
const algoById = collectIds(algorithms, "algorithms.yaml");

// ---------------------------------------------------------------- 3. 相互参照

function checkRefs(entries, field, table, tableName, label) {
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry[field])) continue;
    const seenHere = new Set();
    for (const ref of entry[field]) {
      if (seenHere.has(ref)) warn(`${label}/${entry.id}`, `${field} 内で "${ref}" が重複`);
      seenHere.add(ref);
      if (!table.has(ref))
        err(`${label}/${entry.id}`, `${field} が未定義の ${tableName} を参照: "${ref}"`);
    }
  }
}
checkRefs(papers, "algorithms", algoById, "algorithm-id", "papers.yaml");
checkRefs(repositories, "algorithms", algoById, "algorithm-id", "repositories.yaml");
checkRefs(repositories, "paper_ids", paperById, "paper-id", "repositories.yaml");
checkRefs(algorithms, "primary_paper_ids", paperById, "paper-id", "algorithms.yaml");
checkRefs(
  algorithms,
  "implementation_repository_ids",
  repoById,
  "repository-id",
  "algorithms.yaml",
);

// 逆方向: どの論文からも、どの実装からも参照されないアルゴリズムを警告する。
const referencedAlgos = new Set();
for (const p of papers) (p.algorithms || []).forEach((a) => referencedAlgos.add(a));
for (const r of repositories) (r.algorithms || []).forEach((a) => referencedAlgos.add(a));
for (const id of algoById.keys()) {
  if (!referencedAlgos.has(id)) {
    warn("algorithms.yaml", `"${id}" はどの論文・実装からも参照されていない`);
  }
}

// 論文 id と docs/papers/<id>/ の対応
for (const p of papers) {
  if (!p.id) continue;
  for (const [field, expected] of [
    ["local_pdf", `docs/papers/${p.id}/paper.pdf`],
    ["marker_markdown", `docs/papers/${p.id}/marker.md`],
    ["marker_metadata", `docs/papers/${p.id}/marker_meta.json`],
  ]) {
    if (p[field] && p[field] !== expected) {
      err(
        `papers.yaml/${p.id}`,
        `${field} が規約のパスと違う（期待: ${expected} / 実際: ${p[field]}）`,
      );
    }
  }
}

// ---------------------------------------------------------------- 4-6. ファイル実在・空・拡張子

function fileState(rel) {
  if (!rel) return { declared: false };
  const abs = resolve(root, rel);
  if (!existsSync(abs)) return { declared: true, exists: false, abs };
  const st = statSync(abs);
  return { declared: true, exists: true, abs, size: st.size, isFile: st.isFile() };
}

function looksLikePdf(abs) {
  try {
    const fd = openSync(abs, "r");
    const buf = Buffer.alloc(5);
    const n = readSync(fd, buf, 0, 5, 0);
    closeSync(fd);
    return n === 5 && buf.toString("latin1") === "%PDF-";
  } catch {
    return false;
  }
}

const counts = { missing: 0, pdfReady: 0, markerReady: 0, verified: 0 };

// marker_meta.json の欠落は、Marker の設定次第で構造的に発生しうる。
// 1 本ずつ warning を出すと他の警告が埋もれるため、集約して 1 件だけ報告する。
const missingMarkerMeta = [];

for (const p of papers) {
  if (!p || !p.id) continue;
  const where = `papers.yaml/${p.id}`;
  const pdf = fileState(p.local_pdf);
  const md = fileState(p.marker_markdown);
  const meta = fileState(p.marker_metadata);

  if (p.local_pdf && extname(p.local_pdf).toLowerCase() !== ".pdf") {
    err(where, `local_pdf の拡張子が .pdf ではない: ${p.local_pdf}`);
  }
  if (p.marker_markdown && extname(p.marker_markdown).toLowerCase() !== ".md") {
    err(where, `marker_markdown の拡張子が .md ではない: ${p.marker_markdown}`);
  }

  if (pdf.exists) {
    if (!pdf.isFile) err(where, `local_pdf がファイルではない: ${p.local_pdf}`);
    else if (pdf.size === 0) err(where, `local_pdf が空ファイル: ${p.local_pdf}`);
    else if (!looksLikePdf(pdf.abs))
      err(where, `local_pdf が PDF ではない（先頭が %PDF- でない）: ${p.local_pdf}`);
  }
  if (md.exists) {
    if (md.size === 0) err(where, `marker_markdown が空ファイル: ${p.marker_markdown}`);
  }
  if (meta.exists) {
    if (meta.size === 0) err(where, `marker_metadata が空ファイル: ${p.marker_metadata}`);
    else {
      try {
        JSON.parse(readFileSync(meta.abs, "utf8"));
      } catch (e) {
        err(where, `marker_metadata が JSON として不正: ${e.message}`);
      }
    }
  }

  // ---- 9. status と実ファイルの整合
  switch (p.status) {
    case "missing":
      counts.missing += 1;
      if (pdf.exists)
        warn(where, "status が missing だが local_pdf が存在する。pdf-ready へ更新すること");
      break;
    case "pdf-ready":
      counts.pdfReady += 1;
      if (!pdf.exists) err(where, `status が pdf-ready だが ${p.local_pdf} が無い`);
      break;
    case "marker-ready":
      counts.markerReady += 1;
      if (!pdf.exists) err(where, `status が marker-ready だが ${p.local_pdf} が無い`);
      if (!md.exists) err(where, `status が marker-ready だが ${p.marker_markdown} が無い`);
      // Marker が marker_meta.json を出さない場合もあるため error ではなく warning（集約）。
      if (!meta.exists) missingMarkerMeta.push(p.id);
      break;
    case "verified":
      counts.verified += 1;
      if (!pdf.exists) err(where, `status が verified だがローカル PDF が無い: ${p.local_pdf}`);
      if (!md.exists)
        err(where, `status が verified だが Marker Markdown が無い: ${p.marker_markdown}`);
      if (!meta.exists) missingMarkerMeta.push(p.id);
      break;
    default:
      break; // enum 違反はスキーマ検査側で報告済み
  }

  // ---- 10. 再配布可否
  const redist = p.redistribution;
  if (!redist || typeof redist !== "object") {
    err(where, "redistribution が無い。status と evidence_url を必ず書くこと");
  } else {
    if (!redist.status) {
      err(
        where,
        "redistribution.status が未設定。allowed / link-only / unknown のいずれかを書くこと",
      );
    }
    if (redist.status === "allowed" && !redist.evidence_url) {
      err(
        where,
        "redistribution.status が allowed なのに evidence_url が無い。根拠が無い PDF はサイトへコピーしてはならない",
      );
    }
    if (redist.status === "unknown" && pdf.exists) {
      warn(
        where,
        "再配布可否が unknown のまま PDF がリポジトリに置かれている。外部リンクのみに留めるか、根拠を確認すること",
      );
    }
  }

  // ---- 8. URL 形式（null は許容）
  for (const field of ["landing_url", "pdf_url"]) {
    const v = p[field];
    if (v && !/^https?:\/\/\S+$/.test(v)) err(where, `${field} が http(s) URL ではない: ${v}`);
  }
  for (const v of p.alternate_urls || []) {
    if (!/^https?:\/\/\S+$/.test(v)) err(where, `alternate_urls に不正な URL: ${v}`);
  }
  if (!p.pdf_url && !p.landing_url) {
    warn(where, "pdf_url も landing_url も無い。少なくとも参照先を 1 つ記録すること");
  }
}

// marker_meta.json の欠落をまとめて 1 件の warning にする。
// 「存在しない場合も明確に警告する」という要件は満たしつつ、他の警告を埋もれさせない。
if (missingMarkerMeta.length > 0) {
  const head = missingMarkerMeta.slice(0, 5).join(", ");
  const tail = missingMarkerMeta.length > 5 ? ` ほか ${missingMarkerMeta.length - 5} 件` : "";
  warn(
    "papers.yaml",
    `marker_meta.json が無い論文が ${missingMarkerMeta.length} 件ある（${head}${tail}）。` +
      "Marker が出力した場合は docs/papers/<paper-id>/marker_meta.json へ必ず配置すること。" +
      "全件の一覧は node scripts/print-missing-sources.mjs --marker-meta で出る",
  );
}

// ---------------------------------------------------------------- リポジトリ側

for (const r of repositories) {
  if (!r || !r.id) continue;
  const where = `repositories.yaml/${r.id}`;
  if (r.url && !/^https?:\/\/\S+$/.test(r.url)) err(where, `url が http(s) URL ではない: ${r.url}`);
  if (r.local_path && r.local_path !== `.references/${r.id}`) {
    err(where, `local_path が規約と違う（期待: .references/${r.id} / 実際: ${r.local_path}）`);
  }
  if (r.pinned_commit && !/^[0-9a-f]{40}$/.test(r.pinned_commit)) {
    err(where, `pinned_commit が 40 桁の SHA ではない: ${r.pinned_commit}`);
  }
  if (r.copy_allowed === true && !r.license_spdx) {
    err(where, "copy_allowed が true なのに license_spdx が無い");
  }
  if (r.license_spdx && !r.license_file) {
    warn(where, "license_spdx があるのに license_file が無い。判定根拠のファイル名を記録すること");
  }
  if (r.license_spdx === null && r.copy_allowed !== false) {
    err(where, "ライセンス不明なのに copy_allowed が false になっていない");
  }
  if (r.relation === "official" && (!r.notes || r.notes.length < 10)) {
    warn(where, "relation が official だが根拠が notes に書かれていない");
  }
  if (r.local_path && r.clone_status === "cloned" && !existsSync(resolve(root, r.local_path))) {
    warn(
      where,
      `clone_status が cloned だが ${r.local_path} が存在しない。sync-reference-repos.sh を実行すること`,
    );
  }
}

// ---------------------------------------------------------------- 7. 不明な保証値

const unknownGuarantees = [];
for (const a of algorithms) {
  if (!a || !a.id) continue;
  const where = `algorithms.yaml/${a.id}`;
  const g = a.guarantees || {};
  const unknownFields = ["complete", "optimal", "bounded_suboptimal"].filter(
    (k) => g[k] === "unknown",
  );
  if (unknownFields.length > 0) unknownGuarantees.push(`${a.id}: ${unknownFields.join(", ")}`);

  const asserted = ["complete", "optimal", "bounded_suboptimal"].filter(
    (k) => g[k] === true || g[k] === "conditional",
  );
  if (asserted.length > 0 && !a.guarantee_evidence) {
    err(
      where,
      `保証 [${asserted.join(", ")}] を主張しているのに guarantee_evidence が無い。原論文の根拠なしに保証を書いてはならない`,
    );
  }
  if (g.optimal === true && g.bounded_suboptimal === true) {
    err(where, "optimal と bounded_suboptimal を同時に true にはできない。用語を区別すること");
  }
  if (
    a.implementation_status === "runnable" &&
    (a.implementation_repository_ids || []).length === 0
  ) {
    warn(where, "implementation_status が runnable だが参照実装が登録されていない");
  }
}

// ---------------------------------------------------------------- 出力

if (!QUIET) {
  for (const line of errors) console.error(line);
  for (const line of warnings) console.error(line);
  if (errors.length || warnings.length) console.error("");
}

console.log("=== validate-sources.mjs 集計 ===");
console.log(
  `papers        : ${papers.length} 件  (missing=${counts.missing}, pdf-ready=${counts.pdfReady}, marker-ready=${counts.markerReady}, verified=${counts.verified})`,
);
console.log(`repositories  : ${repositories.length} 件`);
console.log(`algorithms    : ${algorithms.length} 件`);
console.log(`保証が unknown : ${unknownGuarantees.length} 件のアルゴリズム`);
if (!QUIET && unknownGuarantees.length > 0) {
  console.log("  ↓ PDF 取得後に原論文で確定させること");
  for (const line of unknownGuarantees) console.log(`  - ${line}`);
}
console.log(`errors=${errors.length} warnings=${warnings.length}`);

if (errors.length > 0) process.exit(1);
if (STRICT && warnings.length > 0) process.exit(1);
