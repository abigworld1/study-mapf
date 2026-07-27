#!/usr/bin/env node
/**
 * check-marker-fidelity.mjs — marker.md が paper.pdf をどれだけ正しく写せているかの機械照合
 *
 * ★ これは人手の目視照合の代替ではない ★
 *
 * Marker は数式・擬似コード・表を壊す（SOURCE_POLICY.md 第 5 条）。
 * このスクリプトが検出できるのは「丸ごと落ちた」類の欠落であって、
 * 数式が微妙に間違っている、添字が入れ替わっている、といった誤りは検出できない。
 * したがって本スクリプトの結果だけで status を verified にしてはならない。
 *
 * やること:
 *   1. paper.pdf をページ単位でテキスト化し、Algorithm / Theorem / Lemma / Definition /
 *      Proposition / Corollary / Figure / Table の番号付き要素とページ番号を索引化する
 *   2. 同じ要素が marker.md にあるかを照合し、欠落を列挙する
 *   3. 語数比（marker.md / PDF）を出し、大きく目減りしていないかを見る
 *   4. 数式記号の残存を見る（PDF 側に多い記号が marker.md でどれだけ残っているか）
 *
 * 使い方:
 *   node scripts/check-marker-fidelity.mjs                # 全件、結果を表示するだけ
 *   node scripts/check-marker-fidelity.mjs cbs-aaai-2012  # 指定 ID のみ
 *   node scripts/check-marker-fidelity.mjs --write        # metadata.yaml の machine_index を更新
 *
 * 依存: pdftotext (poppler-utils)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseYaml } from "./lib/mini-yaml.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const only = argv.filter((a) => !a.startsWith("--"));

const KINDS = [
  "Algorithm",
  "Theorem",
  "Lemma",
  "Definition",
  "Proposition",
  "Corollary",
  "Figure",
  "Table",
];

// 注意点が 2 つある。
//   1. 空白に \s を使うと改行を跨ぐ。擬似コードの行番号を拾って
//      「Algorithm\n0: Input: ...」を "Algorithm 0" と誤検出する（ml-lns-aaai-2022 で実際に発生）。
//      そのため [ \t]+ に限定する。
//   2. 古い論文は見出しが大文字（THEOREM 4.）のことがある。i フラグで拾い、
//      比較用のキーは先頭大文字へ正規化する（hungarian-method-1955 で実際に発生）。
const LABEL_RE = new RegExp(`\\b(${KINDS.join("|")})[ \\t]+(\\d+)\\b`, "gi");
const normLabel = (kind, num) => `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} ${num}`;

/** PDF をページ配列へ。pdftotext は改ページを \f で出す。 */
function pdfPages(pdfPath) {
  const raw = execFileSync("pdftotext", ["-q", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
  });
  const pages = raw.split("\f");
  if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
}

const words = (s) => (s.match(/[A-Za-z][A-Za-z-]+/g) || []).length;

/** 「Algorithm 1」→ 出現ページ番号の集合 */
function labelIndex(pages) {
  const idx = new Map();
  pages.forEach((text, i) => {
    for (const m of text.matchAll(LABEL_RE)) {
      const key = normLabel(m[1], m[2]);
      if (!idx.has(key)) idx.set(key, new Set());
      idx.get(key).add(i + 1);
    }
  });
  return idx;
}

/**
 * 数式表現の量を測る。
 *
 * ★ Marker は数式を LaTeX へ変換する。PDF 側の Unicode 記号（≤, ∈, α …）は
 *   marker.md では $...$ や \leq になるため、Unicode 記号だけ数えると必ず「減った」ように見える。
 *   実際 icts-ijcai-2011 は marker.md の Unicode 記号 0 に対し $...$ が 198 ブロックある。
 *   したがって marker.md 側は Unicode + TeX ブロック + LaTeX コマンドの合計で数える。
 */
function mathSignals(s) {
  const greek = (s.match(/[Ͱ-Ͽ]/g) || []).length;
  const mathOps = (s.match(/[≤≥≠≈∈∉⊆∪∩∀∃∑∏√±×·→←↔¬∧∨∞]/g) || []).length;
  const subSup = (s.match(/[⁰-₟]/g) || []).length;
  const tex = (s.match(/\$[^$\n]{1,200}\$/g) || []).length;
  const texCmd = (s.match(/\\[a-zA-Z]{2,}/g) || []).length;
  return { greek, mathOps, subSup, tex, texCmd, unicode: greek + mathOps + subSup };
}

const papers = parseYaml(readFileSync(resolve(root, "docs/sources/papers.yaml"), "utf8"));
const targets = papers.filter(
  (p) =>
    (only.length === 0 || only.includes(p.id)) &&
    p.local_pdf &&
    existsSync(resolve(root, p.local_pdf)) &&
    p.marker_markdown &&
    existsSync(resolve(root, p.marker_markdown)),
);

if (targets.length === 0) {
  console.error("対象がない（PDF と marker.md が揃っている論文が無い、または ID 指定が不正）");
  process.exit(1);
}

const results = [];

for (const p of targets) {
  const pdfPath = resolve(root, p.local_pdf);
  const mdPath = resolve(root, p.marker_markdown);

  let pages;
  try {
    pages = pdfPages(pdfPath);
  } catch (e) {
    console.error(`[${p.id}] pdftotext に失敗: ${e.message}`);
    continue;
  }
  const pdfText = pages.join("\n");
  const md = readFileSync(mdPath, "utf8");

  const idx = labelIndex(pages);
  const inMd = new Set([...md.matchAll(LABEL_RE)].map((m) => normLabel(m[1], m[2])));

  const entries = [...idx.entries()]
    .map(([label, pset]) => ({
      label,
      pdf_pages: [...pset].sort((a, b) => a - b),
      in_marker: inMd.has(label),
    }))
    .sort((a, b) => {
      const [ka, na] = a.label.split(" ");
      const [kb, nb] = b.label.split(" ");
      return KINDS.indexOf(ka) - KINDS.indexOf(kb) || Number(na) - Number(nb);
    });

  const missing = entries.filter((e) => !e.in_marker).map((e) => e.label);

  const wPdf = words(pdfText);
  const wMd = words(md);
  const coverage = wPdf > 0 ? wMd / wPdf : 0;

  const mPdf = mathSignals(pdfText);
  const mMd = mathSignals(md);
  // PDF 側は Unicode 記号のみ。marker.md 側は Unicode + TeX で数える（上の注記参照）。
  const mathTotalPdf = mPdf.unicode;
  const mathTotalMd = mMd.unicode + mMd.tex + mMd.texCmd;
  const mathRetention = mathTotalPdf > 0 ? mathTotalMd / mathTotalPdf : null;

  results.push({
    id: p.id,
    pages: pages.length,
    entries,
    missing,
    wPdf,
    wMd,
    coverage,
    mathTotalPdf,
    mathTotalMd,
    mathRetention,
    texCount: mMd.tex,
    texCmdCount: mMd.texCmd,
    uniCount: mMd.unicode,
  });
}

// ---------------------------------------------------------------- 表示

const pct = (v) => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(4)}%`);
const flagOf = (r) => {
  const bad = [];
  if (r.missing.length > 0) bad.push(`欠落${r.missing.length}`);
  if (r.coverage < 0.85) bad.push("語数減");
  if (r.coverage > 1.6) bad.push("語数増");
  // 数式が丸ごと落ちた場合だけ拾う。LaTeX 化は減少と見なさない。
  if (r.mathRetention !== null && r.mathTotalPdf >= 20 && r.mathRetention < 0.2)
    bad.push("数式表現ほぼ無し");
  return bad;
};

console.log(
  "id                              頁  PDF語数  md語数  語数比  数式表現(md/PDF)  欠落した番号付き要素",
);
console.log("-".repeat(112));
for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
  const bad = flagOf(r);
  const mark = bad.length ? "!" : " ";
  console.log(
    `${mark} ${r.id.padEnd(30)}${String(r.pages).padStart(3)} ${String(r.wPdf).padStart(7)} ${String(r.wMd).padStart(7)} ` +
      `${pct(r.coverage)} ${String(r.mathTotalMd).padStart(4)}/${String(r.mathTotalPdf).padEnd(5)} ` +
      `${r.missing.slice(0, 6).join(", ")}${r.missing.length > 6 ? ` ほか${r.missing.length - 6}` : ""}`,
  );
}

const flagged = results.filter((r) => flagOf(r).length > 0);
console.log("-".repeat(112));
console.log(`対象 ${results.length} 本 / 要確認 ${flagged.length} 本`);
if (flagged.length > 0) {
  console.log("\n要確認の内訳:");
  for (const r of flagged) console.log(`  ${r.id.padEnd(32)} ${flagOf(r).join(" / ")}`);
}
console.log("\n★ このスクリプトは丸ごとの欠落しか検出できない。");
console.log(
  "  数式の中身が正しいかは判定していないので、status: verified には人手の目視照合が要る。",
);

// ---------------------------------------------------------------- metadata.yaml へ書き込み

if (!WRITE) {
  console.log("\n（--write を付けると各 metadata.yaml の machine_index を更新する）");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
let written = 0;

for (const r of results) {
  const mp = resolve(root, `docs/papers/${r.id}/metadata.yaml`);
  if (!existsSync(mp)) continue;
  let t = readFileSync(mp, "utf8");

  const lines = [];
  lines.push(
    "# --- 機械照合の結果（scripts/check-marker-fidelity.mjs が自動生成。手で編集しない）---",
  );
  lines.push("# これは人手の目視照合ではない。丸ごとの欠落しか検出していない。");
  lines.push("# 数式の中身の正しさは判定していないため、これだけで verified にしてはならない。");
  lines.push("machine_index:");
  lines.push(`  generated_at: "${today}"`);
  lines.push(`  pdf_pages: ${r.pages}`);
  lines.push(`  word_count_pdf: ${r.wPdf}`);
  lines.push(`  word_count_marker: ${r.wMd}`);
  lines.push(`  word_ratio: ${r.coverage.toFixed(3)}`);
  lines.push(`  math_symbols_pdf: ${r.mathTotalPdf}`);
  lines.push(`  math_symbols_marker: ${r.mathTotalMd}`);
  lines.push(`  inline_tex_blocks: ${r.texCount}`);
  lines.push("  # PDF から検出した番号付き要素と、その出現ページ（1 始まり）");
  lines.push("  labels:");
  if (r.entries.length === 0) lines.push("    []");
  for (const e of r.entries) {
    lines.push(
      `    - { label: "${e.label}", pdf_pages: [${e.pdf_pages.join(", ")}], in_marker: ${e.in_marker} }`,
    );
  }
  lines.push("  # PDF にあるが marker.md に見当たらない要素");
  lines.push(`  missing_in_marker: [${r.missing.map((m) => `"${m}"`).join(", ")}]`);

  const block = lines.join("\n") + "\n";
  t = t.replace(/\n# --- 機械照合の結果[\s\S]*?(?=\n# ---|\n[a-z_]+:\n|$)/, "\n");
  t = t.trimEnd() + "\n\n" + block;
  writeFileSync(mp, t);
  written += 1;
}
console.log(`\nmetadata.yaml を ${written} 件更新した`);
