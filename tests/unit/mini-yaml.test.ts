import { describe, expect, it } from "vitest";
// 型は src/env.d.ts の declare module "*/mini-yaml.mjs" で与えている。
import { parseYaml } from "../../scripts/lib/mini-yaml.mjs";

/**
 * マニフェストのパーサはサイトのビルドにも使うため、退行を検出できるようにしておく。
 */
describe("mini-yaml", () => {
  it("基本的なブロックマッピングとシーケンス", () => {
    const parsed = parseYaml(`
- id: a
  title: "テスト"
  count: 3
  flag: true
  nothing: null
  nested:
    key: value
`);
    expect(parsed).toEqual([
      {
        id: "a",
        title: "テスト",
        count: 3,
        flag: true,
        nothing: null,
        nested: { key: "value" },
      },
    ]);
  });

  it("1 行のフローシーケンス", () => {
    expect(parseYaml(`- items: [a, b, "c d"]`)).toEqual([{ items: ["a", "b", "c d"] }]);
    expect(parseYaml(`- items: []`)).toEqual([{ items: [] }]);
  });

  it("★ 複数行に折り返されたフローシーケンス（Prettier が生成する形）", () => {
    // 値がキーと同じ行に無く、次行から [ で始まるパターン
    const parsed = parseYaml(`
- id: x
  authors:
    [
      "Roni Stern",
      "Nathan R. Sturtevant",
      "Ariel Felner"
    ]
  year: 2019
`);
    expect(parsed).toEqual([
      {
        id: "x",
        authors: ["Roni Stern", "Nathan R. Sturtevant", "Ariel Felner"],
        year: 2019,
      },
    ]);
  });

  it("キーと同じ行で始まり途中で折り返されるフローシーケンス", () => {
    const parsed = parseYaml(`
- id: y
  tags: [
      "one",
      "two"
    ]
`);
    expect(parsed).toEqual([{ id: "y", tags: ["one", "two"] }]);
  });

  it("コメントを無視する", () => {
    const parsed = parseYaml(`
# 先頭コメント
- id: a  # 行末コメント
  note: "# は文字列の中では残る"
`);
    expect(parsed).toEqual([{ id: "a", note: "# は文字列の中では残る" }]);
  });

  it("閉じられていない [ はエラーにする", () => {
    expect(() => parseYaml(`- items: [a, b`)).toThrow();
  });

  it("タブインデントはエラーにする", () => {
    expect(() => parseYaml("- id: a\n\tkey: v")).toThrow();
  });

  it("未対応の構文は黙って通さない", () => {
    expect(() => parseYaml(`- key: |`)).toThrow();
    expect(() => parseYaml(`- key: &anchor`)).toThrow();
    expect(() => parseYaml(`- key: { a: 1 }`)).toThrow();
  });
});
