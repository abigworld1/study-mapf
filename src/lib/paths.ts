/**
 * base path（/study-mapf/）の解決を 1 箇所に閉じ込める。
 *
 * ★ 本文・コンポーネント・Worker のどこでも "/study-mapf/..." を直接書かないこと。
 *   GitHub Pages のプロジェクトサイトと、ローカルの dev サーバでは base が異なるため、
 *   文字列を散らすと必ずどこかで壊れる。
 *
 * import.meta.env.BASE_URL は Astro が dev / build / preview のいずれでも
 * 正しい値（末尾スラッシュ付き）を注入する。
 */

/** 末尾スラッシュ付きの base。例: "/study-mapf/" */
export const BASE_URL: string = import.meta.env.BASE_URL;

/**
 * サイト内リンクを作る。
 *
 *   withBase("/algorithms/cbs/")  → "/study-mapf/algorithms/cbs/"
 *   withBase("algorithms/cbs/")   → "/study-mapf/algorithms/cbs/"
 *   withBase("/")                 → "/study-mapf/"
 */
export function withBase(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    return path; // 外部 URL はそのまま
  }
  if (path.startsWith("#") || path.startsWith("?")) {
    return path;
  }
  const base = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${rel}`;
}

/**
 * public/ 配下のアセット（favicon、OG 画像、JSON、フォント等）の URL を作る。
 * withBase と同じ動作だが、意図を読み手に伝えるために名前を分けている。
 */
export function assetUrl(path: string): string {
  return withBase(path);
}

/**
 * 絶対 URL を作る。canonical / og:image / sitemap 用。
 * site（オリジン）は Astro.site から渡す。
 */
export function absoluteUrl(path: string, origin: string | URL): string {
  return new URL(withBase(path), origin).href;
}

/**
 * 2 つのパスが同じページを指すかを、base と末尾スラッシュの揺れを吸収して判定する。
 * ナビゲーションの aria-current 判定に使う。
 */
export function isSamePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const withoutQuery = p.split(/[?#]/)[0] ?? p;
    const trimmed = withoutQuery.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  };
  return norm(a) === norm(b);
}

/**
 * 現在パスが指定パス配下かどうか。セクションのハイライトに使う。
 */
export function isUnderPath(current: string, section: string): boolean {
  const norm = (p: string) => {
    const withoutQuery = p.split(/[?#]/)[0] ?? p;
    return withoutQuery.endsWith("/") ? withoutQuery : `${withoutQuery}/`;
  };
  return norm(current).startsWith(norm(section));
}
