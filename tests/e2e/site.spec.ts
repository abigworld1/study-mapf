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

  test("操作パネルはアルゴリズムの次に再生が来る", async ({ page }) => {
    const headings = await page.locator(".sim-controls h3").allTextContents();
    expect(headings.slice(0, 2)).toEqual(["アルゴリズム", "再生"]);
  });

  /*
    実行の結末は押したボタンのすぐ下に出す。指標表は下のほうにあり、
    押した人の目線から遠い。solved でも衝突が残っていれば「うまくいった」
    扱いにしないこと。BFS は衝突を解消しないので solved のまま重なりを残す。
  */
  test("実行の結末が実行ボタンのすぐ下に出る", async ({ page }) => {
    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    const solverSelect = algorithmSection.getByRole("combobox");
    const outcome = page.locator(".run-outcome");

    await solverSelect.selectOption("cbs");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(outcome).toContainText("解が求まりました", { timeout: 30_000 });
    await expect(outcome).toHaveClass(/\bok\b/);
    // 結末は「アルゴリズム」節の中にある＝実行ボタンと同じ場所。
    await expect(algorithmSection.locator(".run-outcome")).toHaveCount(1);

    // BFS は衝突を解消しないので、solved でも警告扱いにする。
    await solverSelect.selectOption("bfs");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(outcome).toContainText("残存衝突", { timeout: 30_000 });
    await expect(outcome).toHaveClass(/\bwarn\b/);
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

  /*
    ドラッグでエージェントを動かせること。
    以前は「開始」「目標」モードが最後に追加したエージェントにしか効かず、
    途中のエージェントを動かす手段が無かった。
  */
  test("エージェントをドラッグで動かせる", async ({ page }) => {
    const canvas = page.locator("canvas.sim-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const desc = page.locator(".sim-desc");

    /*
      ★ 盤面は canvas いっぱいには描かれない。renderer.computeViewport が
        セルを正方形に保ったまま中央へ寄せるので、余白を計算に入れないと
        別のセルを掴んでしまう。ここは同じ式をなぞる。
    */
    const size = 12;
    const cell = Math.max(4, Math.floor(Math.min(box!.width / size, box!.height / size)));
    const offsetX = Math.floor((box!.width - cell * size) / 2);
    const offsetY = Math.floor((box!.height - cell * size) / 2);
    const at = (cx: number, cy: number) => ({
      x: box!.x + offsetX + (cx + 0.5) * cell,
      y: box!.y + offsetY + (cy + 0.5) * cell,
    });

    await expect(desc).toContainText("(0, 0)");
    const from = at(0, 0);
    const to = at(3, 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    // 動かした先が説明文に出る。元の位置には居ない。
    await expect(desc).toContainText("(3, 2)");
  });

  test("キーボードでも掴んで動かせる", async ({ page }) => {
    const canvas = page.locator("canvas.sim-canvas");
    await canvas.focus();
    const desc = page.locator(".sim-desc");
    await expect(desc).toContainText("(0, 0)");

    // (0,0) には a1 が居る。Enter で掴み、右へ 2 つ動かして Enter で置く。
    await page.keyboard.press("Enter");
    await expect(page.locator(".sim-controls .message")).toContainText("掴みました");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(desc).toContainText("(2, 0)");
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
    TAPF の入り口。目標割当が解の一部であることが画面で見えること、
    そして「どの量を最小化したのか」が必ず添えられることを固定する。
    CBM は makespan、CBS-TA は sum of costs を最小化するので
    （cbs-ta-aamas-2018 p.1 が両者を区別している）、
    目的関数を言わずに数値だけ出すと「どれも最適」と読まれる。
  */
  test("TAPF プリセットを解くと目標割当と目的関数が出る", async ({ page }) => {
    await page.getByLabel("プリセット").selectOption("tapf-crossing");

    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    const solverSelect = algorithmSection.getByRole("combobox");
    // kind で絞るので、one-shot 専用の手法は選択肢から消えている。
    await expect(solverSelect).toContainText("全探索割当");
    await expect(solverSelect).not.toContainText("CBS（Conflict-Based Search）");
    await expect(solverSelect).not.toContainText("RHCR");

    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.getByText("目標割当")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".assignments")).toContainText("team1");
    await expect(page.getByText(/最小化した量/)).toBeVisible();
    await expect(page.locator(".metrics")).toContainText(
      "makespan（他の指標は最適値ではありません）",
    );
    await expect(page.locator(".solver-warnings")).toContainText(
      "sum of costs は最適値ではありません",
    );
  });

  /*
    MAPD。TP / TPTS の保証（mapd-tp-tpts-central-2017 p.4 Theorem 3）は
    well-formed な入力についての主張なので、いま触っている入力がその対象か
    どうかが画面で分かること、そして「満たさない = 解けない」と読ませないことを固定する。
  */
  test("MAPD プリセットは well-formed 判定と service time を表示する", async ({ page }) => {
    await page.getByLabel("プリセット").selectOption("mapd-well-formed");
    await expect(page.locator(".wf")).toContainText("well-formed です");
    await expect(page.locator(".wf")).toContainText("十分条件");

    await page.getByRole("button", { name: "実行" }).click();
    const metrics = page.locator(".metrics");
    await expect(metrics.getByText("平均 service time")).toBeVisible({ timeout: 30_000 });
    await expect(metrics.getByText("throughput")).toBeVisible();
    await expect(metrics.getByText("未処理タスク")).toBeVisible();
    await expect(metrics).toContainText("解が求まりました");
  });

  /*
    LNS-wPBS は w が十分大きいと LNS-PBS と同じ結果になり、画面上は区別が付かない。
    w を小さくすると LNS-wPBS だけが shortsighted になって詰まる。
    それが mg-mapd-iros-2022 p.5 の言う非完全性の理由なので、
    画面から w を動かせること自体が説明の一部になる。
  */
  test("LNS-wPBS の時間窓を狭めると LNS-PBS と違う結果になる", async ({ page }) => {
    await page.getByLabel("プリセット").selectOption("mapd-well-formed");
    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    const solverSelect = algorithmSection.getByRole("combobox");
    const metrics = page.locator(".metrics");

    // LNS-PBS には窓が無い。
    await solverSelect.selectOption("lns-pbs");
    await expect(page.getByLabel("時間窓 w")).toHaveCount(0);
    await page.getByRole("button", { name: "実行" }).click();
    await expect(metrics.getByText("平均 service time")).toBeVisible({ timeout: 30_000 });
    await expect(metrics).toContainText("解が求まりました");

    // LNS-wPBS は既定 w=10（論文 p.6 の実験設定）。
    await solverSelect.selectOption("lns-wpbs");
    await expect(page.getByLabel("時間窓 w")).toHaveValue("10");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(metrics.getByText("平均 service time")).toBeVisible({ timeout: 30_000 });
    await expect(metrics).toContainText("解が求まりました");

    // w=2 まで狭めると先が見えなくなって処理しきれない。
    await page.getByLabel("時間窓 w").fill("2");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(metrics.getByText("未処理タスク")).toBeVisible({ timeout: 30_000 });
    await expect(metrics).not.toContainText("解が求まりました");
  });

  /*
    Space-Time A* は単一エージェント専用（原論文どおりの低レベル探索）。
    canSolve が無かったころは全プリセットが 2 体以上だったので、
    画面から選ぶと必ずエラーになっていた。候補の出し分けと、
    single-agent プリセットで実際に解けることを画面から固定する。
  */
  test("時空間 A* は 1 体の盤面でだけ選べて、そこでは解ける", async ({ page }) => {
    const algorithmSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) });
    const solverSelect = algorithmSection.getByRole("combobox");

    await page.getByLabel("プリセット").selectOption("open-grid");
    await expect(solverSelect.locator('option[value="space-time-astar"]')).toHaveCount(0);

    await page.getByLabel("プリセット").selectOption("single-agent");
    await expect(solverSelect.locator('option[value="space-time-astar"]')).toHaveCount(1);
    await solverSelect.selectOption("space-time-astar");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.locator(".run-outcome")).toContainText("解が求まりました", {
      timeout: 30_000,
    });
  });

  test("well-formed でない MAPD 入力は、保証の対象外だと画面に出る", async ({ page }) => {
    await page.getByLabel("プリセット").selectOption("mapd-not-well-formed");
    await expect(page.locator(".wf")).toContainText("well-formed ではありません");
    await page.getByRole("button", { name: "実行" }).click();
    await expect(page.locator(".solver-warnings")).toContainText("必要条件ではない", {
      timeout: 30_000,
    });
    await expect(page.locator(".solver-warnings")).toContainText("Theorem 3");
  });

  test("プリセットを TAPF から一括 MAPF に戻すと手法の一覧も戻る", async ({ page }) => {
    const solverSelect = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "アルゴリズム", exact: true }) })
      .getByRole("combobox");
    await page.getByLabel("プリセット").selectOption("tapf-crossing");
    await expect(solverSelect).not.toContainText("LaCAM");
    await page.getByLabel("プリセット").selectOption("open-grid");
    await expect(solverSelect).toContainText("LaCAM");
    await expect(solverSelect).not.toContainText("全探索割当");
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
