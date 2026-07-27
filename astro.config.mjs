// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import { SITE_ORIGIN, SITE_BASE } from "./src/config/site.mjs";

/**
 * Astro 7.1.x 用の設定。
 *
 * ★ GitHub Pages の「プロジェクトサイト」である点が全ての前提になる。
 *   公開先は https://abigworld1.github.io/study-mapf/ なので
 *   site  = オリジンのみ（https://abigworld1.github.io）
 *   base  = /study-mapf/
 *   の 2 つに分ける。site に base を含めてはならない（sitemap や canonical が二重になる）。
 *
 *   base を各所で文字列結合しないこと。参照は必ず src/lib/paths.ts の
 *   withBase() / assetUrl() を通す。これらは import.meta.env.BASE_URL を読むので、
 *   dev / preview / 本番のどれでも同じコードで正しく解決される。
 */
export default defineConfig({
  site: SITE_ORIGIN,
  base: SITE_BASE,

  // GitHub Pages は静的ホスティング。SSR は使わない。
  output: "static",

  // Pages は /foo/ を /foo/index.html として配信する。
  // "ignore" だと dev と本番でリンクの解決が食い違うことがあるため明示する。
  trailingSlash: "always",

  integrations: [
    react(),
    // MDX は Markdown 用の設定を継承する（extendMarkdownConfig の既定は true）。
    mdx(),
  ],

  markdown: {
    /**
     * Astro 7 では markdown.remarkPlugins / rehypePlugins は非推奨。
     * @astrojs/markdown-remark の unified() でプロセッサを組み立てて processor に渡す。
     *
     * 数式は KaTeX。CSS は BaseLayout が node_modules から import するため、
     * CDN に依存せずオフラインでもビルドできる。
     */
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [[rehypeKatex, { strict: false, throwOnError: false }]],
    }),
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },

  build: {
    // 生成物のハッシュ付きアセットの置き場。base 配下に出る。
    assets: "_assets",
    // 既定の "directory" のまま。/study-mapf/algorithms/cbs/index.html になる。
    format: "directory",
  },

  vite: {
    worker: {
      // Web Worker も本番でモジュール形式のまま扱う。
      format: "es",
    },
    build: {
      target: "es2022",
    },
  },
});
