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

  test("Batch 4 の実装状態がページと一致する", async ({ page }) => {
    await page.goto("./algorithms/icts/");
    await expect(page.getByText("シミュレータで実行可")).toBeVisible();
    await expect(page.getByRole("heading", { name: "サイト上の実装との差異" })).toBeVisible();

    await page.goto("./algorithms/push-and-rotate/");
    await expect(page.getByText("シミュレータで実行可")).toBeVisible();
    await expect(page.locator(".sim-link")).toContainText("biconnected subproblem merge");
  });

  test("Batch 5 のページは実装状態と目的関数の注意を表示する", async ({ page }) => {
    await page.goto("./algorithms/lacam/");
    await expect(page.getByText("シミュレータで実行可")).toBeVisible();
    await expect(page.getByRole("heading", { name: "サイト上の実装との差異" })).toBeVisible();

    await page.goto("./algorithms/lacam-star/");
    await expect(page.getByText("シミュレータで実行可")).toBeVisible();
    await expect(page.getByText(/サイト表示 SOC は内部 sum-of-loss/)).toBeVisible();
  });

  test("Batch 6 のページは実装状態と差異を表示する", async ({ page }) => {
    for (const [path, name] of [
      ["mapf-lns", "MAPF-LNS"],
      ["mapf-lns2", "MAPF-LNS2"],
      ["rhcr", "RHCR"],
    ] as const) {
      await page.goto(`./algorithms/${path}/`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
      await expect(page.getByText("シミュレータで実行可")).toBeVisible();
      await expect(page.getByRole("heading", { name: "サイト上の実装との差異" })).toBeVisible();
    }
    await page.goto("./algorithms/mapf-lns2/");
    await expect(page.getByText(/理論保証はありません/)).toBeVisible();
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
    await expect(solverSelect).toContainText("PBS");
    await expect(solverSelect).toContainText("PIBT");
    await expect(solverSelect).toContainText("winPIBT");
    await expect(solverSelect).toContainText("ICTS");
    await expect(solverSelect).toContainText("M*");
    await expect(solverSelect).toContainText("Push and Swap");
    await expect(solverSelect).toContainText("Push and Rotate");
    await expect(solverSelect).toContainText("LaCAM");
    await expect(solverSelect).toContainText("LaCAM*");
    await expect(solverSelect).toContainText("MAPF-LNS");
    await expect(solverSelect).toContainText("MAPF-LNS2");
    // RHCR も registry に登録された実装済み solver として選択肢に出る。
    await expect(solverSelect).toContainText("RHCR");
  });

  test("RHCR は既定 one-shot プリセットを固定 goal queue として実行できる", async ({ page }) => {
    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    const solverSelect = algorithmSection.getByRole("combobox");
    await solverSelect.selectOption("rhcr");
    await expect(page.getByLabel("planning window w")).toBeVisible();
    await expect(page.getByLabel("replanning period h")).toBeVisible();
    // 運転時間は w とは別のつまみ。空欄なら Solver 側がマップから決める。
    await expect(page.getByLabel("シミュレーション horizon")).toHaveValue("");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.getByText(/sum of costs/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".solver-warnings")).toContainText("one-shot Scenario");
  });

  /*
    RHCR は完全ではない。解ける問題で失敗したとき、
    「解が求まりませんでした」だけを見せると解の非存在と読まれる。
    swap-conflict は CBS が sum of costs 11 で解くが RHCR は失敗する。
  */
  test("RHCR が解けなかったとき、非存在の証明ではないと画面に出る", async ({ page }) => {
    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    await algorithmSection.getByRole("combobox").selectOption("rhcr");
    await page.getByLabel("プリセット").selectOption("swap-conflict");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.locator(".solver-warnings")).toContainText("解の非存在の証明ではありません", {
      timeout: 30_000,
    });
  });

  /*
    ★ Solver が返す但し書きは画面に出ること。
      不完全な手法が「解が見つかりませんでした」だけを表示すると
      「解が存在しない」と読まれる。この区別は warnings にしか書かれていない。
      実際、この描画は 3 バッチ分のあいだ抜け落ちていた。
  */
  test("解けなかったとき、非存在の証明ではないと画面に出る", async ({ page }) => {
    const solverSelect = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) })
      .getByRole("combobox");
    const labels = await solverSelect.locator("option").allInnerTexts();
    const pibt = labels.find((label) => label.startsWith("PIBT"));
    expect(pibt, "PIBT が選択肢に無い").toBeTruthy();
    await solverSelect.selectOption({ label: pibt });

    const presetSelect = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "シナリオ", exact: true }) })
      .getByRole("combobox")
      .first();
    await presetSelect.selectOption({ label: "Narrow Corridor" });

    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.getByText("解が見つかりませんでした").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".solver-warnings")).toContainText("解不存在の証明ではありません");
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
