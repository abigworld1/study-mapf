#!/usr/bin/env node
/**
 * repositories.yaml を sync-reference-repos.sh が読める TSV へ変換する。
 *
 * 出力: id \t url \t local_path \t default_branch \t pinned_commit
 * 未設定のフィールドは "-" を出力する（シェル側で空文字と区別しやすくするため）。
 *
 * 使い方:
 *   node scripts/lib/repo-targets.mjs [--only id1,id2]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./mini-yaml.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const manifestPath = resolve(repoRoot, "docs/sources/repositories.yaml");

const onlyIndex = process.argv.indexOf("--only");
const only =
  onlyIndex !== -1 && process.argv[onlyIndex + 1]
    ? new Set(
        process.argv[onlyIndex + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;

let entries;
try {
  entries = parseYaml(readFileSync(manifestPath, "utf8"));
} catch (err) {
  process.stderr.write(`repositories.yaml の解析に失敗: ${err.message}\n`);
  process.exit(1);
}

if (!Array.isArray(entries)) {
  process.stderr.write("repositories.yaml のトップレベルがリストではない\n");
  process.exit(1);
}

const dash = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));
let emitted = 0;

for (const entry of entries) {
  if (!entry || typeof entry !== "object") continue;
  if (only && !only.has(entry.id)) continue;
  if (!entry.id || !entry.url) {
    process.stderr.write(
      `id または url が無いエントリをスキップ: ${JSON.stringify(entry).slice(0, 80)}\n`,
    );
    continue;
  }
  const localPath = entry.local_path || `.references/${entry.id}`;
  process.stdout.write(
    [entry.id, entry.url, localPath, dash(entry.default_branch), dash(entry.pinned_commit)].join(
      "\t",
    ) + "\n",
  );
  emitted += 1;
}

if (emitted === 0) {
  process.stderr.write("対象リポジトリが 0 件\n");
  process.exit(2);
}
