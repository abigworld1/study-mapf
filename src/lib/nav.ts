import { SITE_CATEGORIES } from "./manifest.js";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * サイト全体のナビゲーション。
 * href はすべて base を含まない形で書く。表示時に withBase() を通す。
 */
export const MAIN_NAV: readonly NavItem[] = [
  { href: "/getting-started/", label: "はじめに", description: "このサイトの読み方" },
  { href: "/mapf/", label: "MAPFとは", description: "問題設定と衝突の種類" },
  { href: "/mapd/", label: "MAPDとは", description: "運搬タスクへの拡張" },
  { href: "/roadmap/", label: "学習ロードマップ", description: "推奨する読む順番" },
  { href: "/algorithms/", label: "アルゴリズム一覧", description: "分類別の索引" },
  { href: "/compare/", label: "手法比較", description: "保証と対象問題の一覧" },
  { href: "/simulator/", label: "シミュレータ", description: "ブラウザ内で動かす" },
  { href: "/benchmarks/", label: "ベンチマーク", description: "標準問題と読み込み" },
  { href: "/glossary/", label: "用語集", description: "日本語と原語の対応" },
  { href: "/sources/", label: "論文・実装一覧", description: "出典と参照実装" },
  { href: "/about/", label: "このサイトについて", description: "方針と制作" },
];

/**
 * アルゴリズム分類のサブナビ。
 *
 * ★ /algorithms/category/<id>/ に置く。
 *   分類 id とアルゴリズム id が衝突するため（どちらにも "cbs" がある）、
 *   /algorithms/<id>/ の名前空間を分ける必要がある。
 */
export const CATEGORY_NAV: readonly NavItem[] = SITE_CATEGORIES.map((c) => ({
  href: `/algorithms/category/${c.id}/`,
  label: c.label,
  description: c.original,
}));
