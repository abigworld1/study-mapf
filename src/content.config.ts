import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Astro 7 の content layer。src/content/algorithms/*.mdx を読む。
 *
 * ★ frontmatter で出典を必須にしている。
 *   primarySources が空でも書けてしまうと、根拠のない解説が混ざる。
 *   資料が足りないページは status: "draft" のまま、本文を書かずに
 *   「解説準備中」を出す運用にする（CONTENT_GUIDE.md 参照）。
 */
const algorithms = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/algorithms" }),
  schema: z.object({
    title: z.string(),
    /** docs/sources/algorithms.yaml の algorithm-id と一致させること。 */
    algorithmId: z.string(),
    /** 原語表記。UI で併記する。 */
    originalName: z.string(),
    /** 一覧での並び順。小さいほど先。 */
    order: z.number().default(100),
    /** 一覧に出す 1 行説明。事実だけ書く。 */
    summary: z.string().default(""),
    status: z.enum(["draft", "reviewed", "verified"]).default("draft"),
    primarySources: z
      .array(
        z.object({
          paperId: z.string(),
          /** 確認できた節。推測で書かない。 */
          sections: z.array(z.string()).optional(),
          /** 確認できたページ。推測で書かない。 */
          pages: z.array(z.union([z.number(), z.string()])).optional(),
        }),
      )
      .default([]),
    implementationReferences: z.array(z.object({ repositoryId: z.string() })).default([]),
    /** 最後に原論文と照合した日。 */
    lastReviewed: z.string().optional(),
    /** シミュレータで動かせる場合の solver id。registry と一致すること。 */
    simulatorSolverId: z.string().optional(),
  }),
});

export const collections = { algorithms };
