/**
 * docs/sources/*.yaml をビルド時に読み込む。
 *
 * ★ 同じ情報を複数箇所へ手書きしないための単一入口。
 *   ナビゲーション、アルゴリズム一覧、比較表、出典表示はすべてここから生成する。
 *
 * パーサは前工程で作った依存ゼロの scripts/lib/mini-yaml.mjs を再利用する。
 * サイト側で YAML ライブラリを増やさないのは、マニフェストの書式が
 * バリデータ（scripts/validate-sources.mjs）と食い違わないようにするため。
 */
// 型は src/env.d.ts の declare module "*/mini-yaml.mjs" で与えている。
import { parseYaml } from "../../scripts/lib/mini-yaml.mjs";

/**
 * ★ ?raw でビルド時に YAML の中身を文字列として埋め込む。
 *
 *   fs.readFileSync + import.meta.url は使えない。
 *   Astro の prerender ではこのモジュールが dist/.prerender/ 配下へバンドルされるため、
 *   import.meta.url が出力先を指してしまい docs/ を見つけられない
 *   （実際にビルドが ENOENT で落ちた）。
 *   ?raw なら内容がバンドルに入るので、実行位置に依存しない。
 */
import papersYaml from "../../docs/sources/papers.yaml?raw";
import repositoriesYaml from "../../docs/sources/repositories.yaml?raw";
import algorithmsYaml from "../../docs/sources/algorithms.yaml?raw";

function loadYaml<T>(source: string): T[] {
  const parsed = parseYaml(source) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

// ---------------------------------------------------------------- 型

export type RedistributionStatus = "allowed" | "link-only" | "unknown";
export type PaperStatus = "missing" | "pdf-ready" | "marker-ready" | "verified";
export type SourceType = "primary" | "survey" | "tutorial" | "thesis";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface PaperEntry {
  id: string;
  title: string;
  short_title: string;
  algorithms: string[];
  authors: string[];
  year: number;
  venue: string;
  doi: string | null;
  landing_url: string | null;
  pdf_url: string | null;
  source_type: SourceType;
  local_pdf: string | null;
  marker_markdown: string | null;
  marker_metadata: string | null;
  open_access: boolean | null;
  redistribution: { status: RedistributionStatus; evidence_url: string | null };
  status: PaperStatus;
  priority?: Priority;
  alternate_urls?: string[];
  notes: string | null;
}

export type RepoRelation = "official" | "author-maintained" | "research-reference" | "third-party";

export interface RepositoryEntry {
  id: string;
  name: string;
  url: string;
  algorithms: string[];
  paper_ids: string[];
  relation: RepoRelation;
  local_path: string | null;
  default_branch: string | null;
  pinned_commit: string | null;
  license_spdx: string | null;
  license_file: string | null;
  copy_allowed: boolean | null;
  clone_status?: string;
  notes: string | null;
}

export type GuaranteeValue = true | false | "unknown" | "conditional";

export type AlgorithmCategory =
  | "foundations"
  | "single-agent-search"
  | "space-time-search"
  | "prioritized-planning"
  | "conflict-based-search"
  | "joint-state-and-subdimensional-search"
  | "rule-based-and-configuration-search"
  | "large-neighborhood-search"
  | "lifelong-mapf"
  | "mapd"
  | "tapf-and-task-assignment"
  | "learning-based"
  | "matching-and-assignment"
  | "benchmarks-and-tools";

export interface AlgorithmEntry {
  id: string;
  display_name: string;
  aliases: string[];
  category: AlgorithmCategory;
  problem_types: string[];
  primary_paper_ids: string[];
  implementation_repository_ids: string[];
  implementation_status: "planned" | "partial" | "runnable" | "explanation-only";
  guarantees: {
    complete: GuaranteeValue;
    optimal: GuaranteeValue;
    bounded_suboptimal: GuaranteeValue;
  };
  guarantee_evidence?: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------- 読み込み

export const papers: PaperEntry[] = loadYaml<PaperEntry>(papersYaml);
export const repositories: RepositoryEntry[] = loadYaml<RepositoryEntry>(repositoriesYaml);
export const algorithms: AlgorithmEntry[] = loadYaml<AlgorithmEntry>(algorithmsYaml);

const paperMap = new Map(papers.map((p) => [p.id, p]));
const repoMap = new Map(repositories.map((r) => [r.id, r]));
const algoMap = new Map(algorithms.map((a) => [a.id, a]));

export function getPaper(id: string): PaperEntry | undefined {
  return paperMap.get(id);
}
export function getRepository(id: string): RepositoryEntry | undefined {
  return repoMap.get(id);
}
export function getAlgorithm(id: string): AlgorithmEntry | undefined {
  return algoMap.get(id);
}

// ---------------------------------------------------------------- サイト上の分類

/**
 * サイトの表示分類。algorithms.yaml の category（14 種、資料整理の都合で細かい）を、
 * 学習順に沿った 12 種へまとめ直したもの。
 * 対応は 1 箇所だけに置き、ページ側では触らない。
 */
export const SITE_CATEGORIES = [
  { id: "basic-search", label: "基礎探索", original: "Basic search" },
  { id: "space-time", label: "時間拡張探索", original: "Space-time search" },
  { id: "prioritized", label: "優先順位付き計画", original: "Prioritized planning" },
  { id: "cbs", label: "CBS系", original: "Conflict-Based Search family" },
  { id: "icts-joint", label: "ICTS・結合状態・M*系", original: "ICTS / joint-state / M*" },
  { id: "pibt-lacam", label: "PIBT・LaCAM系", original: "PIBT / LaCAM family" },
  { id: "push", label: "Push系", original: "Push-based rule algorithms" },
  { id: "lns", label: "LNS系", original: "Large Neighborhood Search" },
  { id: "lifelong", label: "Lifelong MAPF", original: "Lifelong MAPF" },
  { id: "mapd", label: "MAPD", original: "Multi-Agent Pickup and Delivery" },
  { id: "tapf", label: "TAPF・タスク割当", original: "TAPF / task assignment" },
  { id: "learning", label: "学習ベース", original: "Learning-based" },
] as const;

export type SiteCategoryId = (typeof SITE_CATEGORIES)[number]["id"];

/** manifest の category → サイト表示分類。 */
const CATEGORY_MAP: Record<AlgorithmCategory, SiteCategoryId | null> = {
  foundations: null,
  "single-agent-search": "basic-search",
  "space-time-search": "space-time",
  "prioritized-planning": "prioritized",
  "conflict-based-search": "cbs",
  "joint-state-and-subdimensional-search": "icts-joint",
  "rule-based-and-configuration-search": "pibt-lacam",
  "large-neighborhood-search": "lns",
  "lifelong-mapf": "lifelong",
  mapd: "mapd",
  "tapf-and-task-assignment": "tapf",
  "learning-based": "learning",
  "matching-and-assignment": "tapf",
  "benchmarks-and-tools": null,
};

/**
 * Push 系は manifest 上 rule-based-and-configuration-search に同居しているため、
 * ID で明示的に分ける。
 */
const PUSH_IDS = new Set(["push-and-swap", "push-and-rotate"]);

export function siteCategoryOf(algo: AlgorithmEntry): SiteCategoryId | null {
  if (PUSH_IDS.has(algo.id)) return "push";
  return CATEGORY_MAP[algo.category] ?? null;
}

export function algorithmsInSiteCategory(categoryId: SiteCategoryId): AlgorithmEntry[] {
  return algorithms.filter((a) => siteCategoryOf(a) === categoryId);
}

export function siteCategoryLabel(id: SiteCategoryId): string {
  return SITE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

// ---------------------------------------------------------------- 派生情報

/**
 * その論文の PDF をサイト内で配布してよいか。
 * SOURCE_POLICY.md 第 12 条。allowed かつ根拠 URL があるときだけ true。
 */
export function mayBundlePdf(paper: PaperEntry): boolean {
  return paper.redistribution.status === "allowed" && Boolean(paper.redistribution.evidence_url);
}

/** 表示に使う最良のリンク。PDF 直リンク > ランディング > DOI。 */
export function bestPaperLink(paper: PaperEntry): string | null {
  if (paper.pdf_url) return paper.pdf_url;
  if (paper.landing_url) return paper.landing_url;
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  return null;
}

export function formatAuthors(paper: PaperEntry, max = 3): string {
  const authors = paper.authors ?? [];
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} ほか`;
}

export function citationOf(paper: PaperEntry): string {
  return `${formatAuthors(paper)} (${paper.year}) ${paper.title}. ${paper.venue}`;
}

/** 転記してよい参照実装だけを返す。 */
export function copyableRepositories(): RepositoryEntry[] {
  return repositories.filter((r) => r.copy_allowed === true);
}
