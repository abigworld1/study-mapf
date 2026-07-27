/**
 * サイトの公開先。astro.config.mjs と、ビルド外のスクリプト（CI 等）の両方から読む。
 *
 * ★ ここが base path の唯一の定義箇所である。
 *   アプリのコードからは import.meta.env.BASE_URL（= SITE_BASE）を見ればよく、
 *   この値を直接 import する必要はない。src/lib/paths.ts を使うこと。
 */

/** オリジンのみ。base を含めない。 */
export const SITE_ORIGIN = "https://abigworld1.github.io";

/** プロジェクトサイトのサブパス。先頭と末尾にスラッシュを付ける。 */
export const SITE_BASE = "/study-mapf/";

/** 完全な公開 URL。OG 画像や canonical の組み立てに使う。 */
export const SITE_URL = new URL(SITE_BASE, SITE_ORIGIN).href;

export const SITE_TITLE = "study-mapf";
export const SITE_DESCRIPTION =
  "Multi-Agent Path Finding (MAPF)、Lifelong MAPF、Multi-Agent Pickup and Delivery (MAPD) を、原論文に基づいて学ぶ教材サイト。";
