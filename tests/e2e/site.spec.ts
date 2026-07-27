import { expect, test } from "@playwright/test";

/**
 * E2E は build 済みの dist/ を astro preview で配信して確認する。
 * baseURL に /study-mapf/ を含めているので、本番と同じ base path で検証できる。
 */

test.describe("サイト全体", () => {
  test("トップページが表示され、主要な導線がある", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("複数のロボット");
    await expect(page.getByRole("link", { name: /学習ロードマップから始める/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /シミュレータを触る/ })).toBeVisible();
  });

  test("アセットが /study-mapf/ 配下で壊れていない", async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
    });
    await page.goto("./");
    await page.waitForLoadState("networkidle");
    expect(failed, failed.join("\n")).toEqual([]);

    // favicon と CSS が base 付きで解決されている
    const iconHref = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(iconHref).toContain("/study-mapf/");
  });

  test("ナビゲーションから各ページへ遷移できる", async ({ page }) => {
    await page.goto("./");
    for (const [label, heading] of [
      ["MAPFとは", "MAPFとは"],
      ["MAPDとは", "MAPDとは"],
      ["学習ロードマップ", "学習ロードマップ"],
      ["アルゴリズム一覧", "アルゴリズム一覧"],
      ["手法比較", "手法比較"],
      ["用語集", "用語集"],
    ] as const) {
      await page
        .getByRole("navigation", { name: "メインナビゲーション" })
        .getByRole("link", { name: label, exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
      expect(page.url()).toContain("/study-mapf/");
    }
  });

  test("アルゴリズムページに実装状態と出典が出る", async ({ page }) => {
    await page.goto("./algorithms/cbs/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("CBS");
    // Batch 2 で CBS を実装したため、registry とページ表示が一致すること
    await expect(page.getByText("シミュレータで実行可")).toBeVisible();
    await expect(page.getByRole("heading", { name: "原論文" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /完全性・最適性/ })).toBeVisible();
  });

  test("解説準備中のページは推測で埋めていない", async ({ page }) => {
    await page.goto("./algorithms/lacam/");
    await expect(page.getByRole("heading", { name: "解説準備中" })).toBeVisible();
  });

  test("比較表を絞り込める", async ({ page }) => {
    await page.goto("./compare/");
    const rows = page.locator("#compare-table tbody tr");
    const total = await rows.count();
    await page.locator("#filter-runnable").check();
    const shown = await rows.evaluateAll(
      (els) => els.filter((e) => !(e as HTMLElement).hidden).length,
    );
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
  });
});

test.describe("シミュレータ", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./simulator/");
    await expect(page.locator("canvas.sim-canvas")).toBeVisible();
  });

  test("起動して実行・一時停止・リセットができる", async ({ page }) => {
    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.getByText(/sum of costs/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "再生", exact: true }).click();
    await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();
    await page.getByRole("button", { name: "一時停止" }).click();

    await page.getByRole("button", { name: "1 ステップ進む" }).click();
    await page.getByRole("button", { name: "1 ステップ戻る" }).click();
    await page.getByRole("button", { name: "リセット" }).click();
    await expect(page.getByText(/時刻 0 \//)).toBeVisible();
  });

  test("マップを編集してエージェントを追加できる", async ({ page }) => {
    const canvas = page.locator("canvas.sim-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // 壁を置く
    await canvas.click({ position: { x: box!.width * 0.3, y: box!.height * 0.3 } });
    // エージェントを追加する
    await page.getByRole("radio", { name: "エージェント追加/削除" }).click();
    await canvas.click({ position: { x: box!.width * 0.6, y: box!.height * 0.6 } });

    // Canvas の内容が文章でも説明されている（支援技術向け）
    await expect(page.locator(".sim-desc")).toContainText("グリッド");
  });

  test("アルゴリズムを切り替えられる。未実装の手法は選択肢に出ない", async ({ page }) => {
    const solverSelect = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) })
      .getByRole("combobox");
    await expect(solverSelect).toContainText("CBS");
    await expect(solverSelect).not.toContainText("LaCAM");
  });

  test("JSON を書き出せる", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON を書き出す" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });
});

test.describe("アクセシビリティの基本", () => {
  test("スキップリンクとランドマークがある", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByRole("link", { name: "本文へスキップ" })).toBeAttached();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "メインナビゲーション" })).toBeVisible();
  });

  test("テーマを切り替えられる", async ({ page }) => {
    await page.goto("./");
    const toggle = page.locator("[data-theme-toggle]");
    await toggle.click();
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(["light", "dark"]).toContain(theme);
  });

  test("キーボードだけでシミュレータのセルを選べる", async ({ page }) => {
    await page.goto("./simulator/");
    const canvas = page.locator("canvas.sim-canvas");
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".sim-desc")).toBeVisible();
  });
});
