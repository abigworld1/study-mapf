import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSpec,
  Cell,
  Scenario,
  SolverEvent,
  SolverResult,
  SolverWarning,
  TimedPath,
} from "@/lib/model/types";
import { withBlocked, isWalkable, resizeMap } from "@/lib/model/grid";
import {
  PRESETS,
  buildPreset,
  scenarioToJson,
  scenarioFromJson,
  validateScenario,
} from "@/lib/model/scenario";
import { positionAt } from "@/lib/model/conflicts";
import { checkWellFormed } from "@/lib/model/mapd";
import { runSolver } from "@/solvers/client";
import { listSolverMetadata, listSolverMetadataFor } from "@/solvers/registry";
import {
  cellFromPoint,
  computeViewport,
  describeState,
  readTheme,
  render,
  type LayerName,
  type RenderState,
} from "@/lib/render/renderer";
import { createRandom, randomInt } from "@/lib/model/random";
import {
  canPaintWall,
  describeDragTarget,
  findDragTarget,
  moveDragTarget,
  type DragTarget,
} from "./drag";

type EditMode = "wall" | "agent" | "start" | "goal" | "pickup" | "delivery";

const OBJECTIVE_LABEL: Record<
  "makespan" | "sum-of-costs" | "sum-of-loss" | "average-service-time" | "total-travel-delay",
  string
> = {
  makespan: "makespan（他の指標は最適値ではありません）",
  "sum-of-costs": "sum of costs（他の指標は最適値ではありません）",
  "sum-of-loss": "sum of loss（画面の sum of costs とは別の量です）",
  "average-service-time": "average service time（保証された最適値ではありません）",
  "total-travel-delay": "total travel delay（service time とは別の量です）",
};

const PROBLEM_KIND_LABEL: Record<Scenario["kind"], string> = {
  "one-shot-mapf": "一括 MAPF",
  "lifelong-mapf": "lifelong MAPF",
  mapd: "MAPD",
  tapf: "TAPF（目標割当つき）",
};

const DEFAULT_LAYERS: Record<LayerName, boolean> = {
  grid: true,
  obstacles: true,
  tasks: true,
  "planned-paths": true,
  reservations: false,
  constraints: false,
  conflicts: true,
  agents: true,
  labels: true,
  selection: true,
};

interface Props {
  /** URL の ?solver= で初期選択。 */
  initialSolverId?: string;
}

export default function Simulator({ initialSolverId }: Props) {
  const allSolvers = useMemo(() => listSolverMetadata(), []);
  const [solverId, setSolverId] = useState(() => initialSolverId ?? allSolvers[0]?.id ?? "astar");

  // アルゴリズムページからの導線（?solver=...）を受ける。
  // 実装が無い id が来ても選択は変えない（存在しない手法を選ばせないため）。
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("solver");
    if (requested && allSolvers.some((s) => s.id === requested)) setSolverId(requested);
  }, [allSolvers]);
  const [presetId, setPresetId] = useState("open-grid");
  const [seed, setSeed] = useState(1);
  const [rhcrPlanningWindow, setRhcrPlanningWindow] = useState(8);
  const [rhcrReplanningPeriod, setRhcrReplanningPeriod] = useState(2);
  // 空欄 = 自動。w から導くと、無関係なつまみで運転時間が決まってしまう。
  const [rhcrHorizon, setRhcrHorizon] = useState("");
  /*
    LNS-wPBS の時間窓。既定 10 は論文の実験設定（mg-mapd-iros-2022 p.6
    「We set the time window of LNS-wPBS to w = 10 timesteps.」）に合わせる。

    ★ ここを動かせるようにしておく意味は大きい。LNS-PBS と LNS-wPBS は
      w が十分大きいと同じ結果になり、画面上は区別が付かない。
      w を小さくすると LNS-wPBS だけが shortsighted になって詰まる。
      それが論文 p.5 の言う非完全性の理由そのものなので、
      動かして確かめられないと 2 手法の違いを説明できない。
  */
  const [wpbsWindow, setWpbsWindow] = useState(10);
  const [scenario, setScenario] = useState<Scenario>(() => buildPreset("open-grid", 1));

  /*
    ★ 手法の一覧は Scenario.kind で絞る。

      metadata.supports は前から宣言されていて registry に solversFor() も
      あったのに、UI が使っていなかった。そのため RHCR（lifelong 専用）が
      one-shot のプリセットでも選べてしまい、選んで実行すると必ず
      「対応していません」エラーになる状態が一度できている。
      TAPF や MAPD を足すと同じことがまた起きるので、ここで塞ぐ。
  */
  const solvers = useMemo(() => listSolverMetadataFor(scenario), [scenario]);

  // 絞り込みの結果いま選んでいる手法が消えたら、先頭へ移す。
  useEffect(() => {
    if (solvers.length > 0 && !solvers.some((s) => s.id === solverId)) {
      setSolverId(solvers[0]!.id);
    }
  }, [solvers, solverId]);
  const [mode, setMode] = useState<EditMode>("wall");
  /** いま掴んでいるもの。null なら掴んでいない。 */
  const [drag, setDrag] = useState<DragTarget | null>(null);
  /** 壁塗りの向き。true なら塗る、false なら消す、null なら塗っていない。 */
  const paintRef = useRef<boolean | null>(null);
  /** キーボードで掴んだときの元の位置。Escape で戻すのに使う。 */
  const dragOriginRef = useRef<Cell | null>(null);
  /** 最後に触れたエージェント。「開始」「目標」モードの対象になる。 */
  const activeAgentRef = useRef<string | null>(null);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<Cell | null>(null);

  const [result, setResult] = useState<SolverResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [message, setMessage] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const horizon = result ? result.metrics.makespan : 0;
  const paths: readonly TimedPath[] = result?.paths ?? [];

  // ------------------------------------------------------------ 描画

  const positions = useMemo(() => {
    const out: Record<string, Cell> = {};
    if (paths.length === 0) {
      for (const a of scenario.agents) out[a.id] = a.start;
      return out;
    }
    for (const p of paths) {
      const cell = positionAt(p, time, scenario.rules);
      if (cell) out[p.agentId] = cell;
    }
    return out;
  }, [paths, time, scenario]);

  // MAPD のときだけ Definition 1 を検査する。他の kind では意味がない。
  const wellFormed = useMemo(
    () => (scenario.kind === "mapd" ? checkWellFormed(scenario) : null),
    [scenario],
  );

  const conflictsNow = useMemo(
    () => (result?.conflicts ?? []).filter((c) => c.time === time),
    [result, time],
  );

  const renderState: RenderState = useMemo(
    () => ({
      map: scenario.map,
      agents: scenario.agents,
      tasks: scenario.tasks,
      nonTaskEndpoints: wellFormed?.endpoints.nonTask,
      teams: scenario.teams,
      assignment: scenario.assignment,
      targetAssignments: result?.targetAssignments,
      positions,
      paths: layers["planned-paths"] ? paths : undefined,
      conflicts: conflictsNow,
      time,
      selected,
      layers,
    }),
    [scenario, positions, paths, conflictsNow, time, selected, layers, result?.targetAssignments],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    render(canvas, renderState, readTheme());
  }, [renderState]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [draw]);

  // ------------------------------------------------------------ 再生

  useEffect(() => {
    if (!playing || horizon === 0) return;
    const id = setInterval(
      () => {
        setTime((t) => {
          if (t >= horizon) {
            setPlaying(false);
            return t;
          }
          return t + 1;
        });
      },
      reduceMotion ? Math.max(speed, 500) : speed,
    );
    return () => clearInterval(id);
  }, [playing, horizon, speed, reduceMotion]);

  // ------------------------------------------------------------ 編集

  const applyEdit = useCallback(
    (cell: Cell) => {
      setSelected(cell);
      setScenario((prev) => {
        if (mode === "wall") {
          const occupied = prev.agents.some(
            (a) =>
              (a.start.x === cell.x && a.start.y === cell.y) ||
              (a.goal && a.goal.x === cell.x && a.goal.y === cell.y),
          );
          if (occupied) {
            setMessage("エージェントの開始・目標がある場所には壁を置けません。");
            return prev;
          }
          const nowBlocked = !isWalkable(prev.map, cell);
          return { ...prev, map: withBlocked(prev.map, cell, !nowBlocked) };
        }

        if (mode === "agent") {
          const existing = prev.agents.findIndex(
            (a) => a.start.x === cell.x && a.start.y === cell.y,
          );
          if (existing >= 0) {
            return { ...prev, agents: prev.agents.filter((_, i) => i !== existing) };
          }
          if (!isWalkable(prev.map, cell)) {
            setMessage("壁の上にはエージェントを置けません。");
            return prev;
          }
          const id = `a${prev.agents.length + 1}`;
          const agent: AgentSpec = {
            id,
            start: cell,
            goal: cell,
            colorIndex: prev.agents.length,
          };
          return { ...prev, agents: [...prev.agents, agent] };
        }

        if ((mode === "start" || mode === "goal") && prev.agents.length > 0) {
          if (!isWalkable(prev.map, cell)) {
            setMessage("壁の上には設定できません。");
            return prev;
          }
          /*
            ★ 対象は「最後に追加したエージェント」ではなく、選んでいるエージェント。

              以前は末尾固定だったので、途中のエージェントの開始・目標を
              触る手段が無かった。いまは盤上のものを掴んで動かせるので
              このモードは補助だが、直前に選んだエージェントへ効くほうが
              素直なので揃えておく。選んでいなければ末尾に戻す。
          */
          const activeIndex = activeAgentRef.current
            ? prev.agents.findIndex((a) => a.id === activeAgentRef.current)
            : -1;
          const idx = activeIndex >= 0 ? activeIndex : prev.agents.length - 1;
          const agents = prev.agents.map((a, i) =>
            i === idx ? { ...a, [mode]: cell } : a,
          ) as AgentSpec[];
          return { ...prev, agents };
        }

        if (mode === "pickup" || mode === "delivery") {
          if (!isWalkable(prev.map, cell)) return prev;
          const tasks = [...(prev.tasks ?? [])];
          const last = tasks[tasks.length - 1];
          if (mode === "pickup" || !last) {
            tasks.push({
              id: `t${tasks.length + 1}`,
              pickup: cell,
              delivery: cell,
              releaseTime: 0,
            });
          } else {
            tasks[tasks.length - 1] = { ...last, delivery: cell };
          }
          return { ...prev, tasks, kind: "mapd" };
        }

        return prev;
      });
      setResult(null);
      setTime(0);
    },
    [mode],
  );

  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const vp = computeViewport(canvas, scenario.map);
      return cellFromPoint(vp, scenario.map, clientX - rect.left, clientY - rect.top);
    },
    [scenario.map],
  );

  /** 掴んでいるものを cell へ動かす。置けないセルは黙って無視する。 */
  const dropAt = useCallback((target: DragTarget, cell: Cell) => {
    setScenario((prev) => moveDragTarget(prev, target, cell) ?? prev);
    setSelected(cell);
    setResult(null);
    setTime(0);
  }, []);

  /*
    ★ 盤上のものは掴んで動かせる。モードを切り替える必要は無い。

      以前は「開始」「目標」モードで**最後に追加したエージェント**にしか
      設定できず、途中のエージェントを動かす手段が無かった。
      掴んで動かす方式ならどれでも直接触れる。
      モードは「新しく置く」ときだけの意味に変えた。

    ★ 壁は押したまま引きずって塗れる。最初に押したセルの状態で
      塗るか消すかを決め、以後は同じ操作を続ける。1 セルずつ
      クリックし直すのは、細い通路を作るときに現実的でない。
  */
  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const cell = cellAt(event.clientX, event.clientY);
      if (!cell) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelected(cell);

      const target = findDragTarget(scenario, cell);
      if (target) {
        if (target.kind === "agent-start" || target.kind === "agent-goal") {
          activeAgentRef.current = target.agentId;
        }
        dragOriginRef.current = cell;
        setDrag(target);
        setMessage(`${describeDragTarget(target)} を掴みました。動かして離すと確定します。`);
        return;
      }
      if (mode === "wall" && canPaintWall(scenario, cell)) {
        paintRef.current = isWalkable(scenario.map, cell);
        setScenario((prev) => ({ ...prev, map: withBlocked(prev.map, cell, paintRef.current!) }));
        setResult(null);
        setTime(0);
        return;
      }
      applyEdit(cell);
    },
    [applyEdit, cellAt, mode, scenario],
  );

  const onCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag && paintRef.current === null) return;
      const cell = cellAt(event.clientX, event.clientY);
      if (!cell) return;
      if (drag) {
        dropAt(drag, cell);
        return;
      }
      // 壁塗り。乗り物がある場所は飛ばす。
      setScenario((prev) =>
        canPaintWall(prev, cell)
          ? { ...prev, map: withBlocked(prev.map, cell, paintRef.current!) }
          : prev,
      );
      setSelected(cell);
    },
    [cellAt, drag, dropAt],
  );

  /*
    ★ フォーカスした時点で選択セルを出す。
      以前は選択が空のままだったので、キーボード利用者は最初の 1 打が
      「どこを選んでいるか分からないまま (0,0) から 1 つずれる」動きになり、
      (0,0) 自体を選べなかった。入り口を見えるようにする。
  */
  const onCanvasFocus = useCallback(() => {
    setSelected((prev) => prev ?? { x: 0, y: 0 });
  }, []);

  const onCanvasPointerUp = useCallback(() => {
    if (drag) setMessage("");
    setDrag(null);
    paintRef.current = null;
  }, [drag]);

  /*
    ★ キーボードでも掴んで動かせるようにする。
      ドラッグをポインタ専用にすると、支援技術の利用者だけが
      「最後に追加したエージェントにしか設定できない」古い操作に
      取り残される。矢印で選び、Enter で掴み、矢印で運び、Enter で置く。
      Escape で元へ戻す。
  */
  const onCanvasKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const step = (dx: number, dy: number) => {
        event.preventDefault();
        const base = selected ?? { x: 0, y: 0 };
        const next = {
          x: Math.max(0, Math.min(scenario.map.width - 1, base.x + dx)),
          y: Math.max(0, Math.min(scenario.map.height - 1, base.y + dy)),
        };
        // 掴んでいるなら本体ごと運ぶ。置けないセルなら選択だけ動かす。
        if (drag) dropAt(drag, next);
        else setSelected(next);
      };
      if (event.key === "ArrowLeft") step(-1, 0);
      else if (event.key === "ArrowRight") step(1, 0);
      else if (event.key === "ArrowUp") step(0, -1);
      else if (event.key === "ArrowDown") step(0, 1);
      else if (event.key === "Escape" && drag) {
        event.preventDefault();
        if (dragOriginRef.current) dropAt(drag, dragOriginRef.current);
        setDrag(null);
        setMessage("");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!selected) return;
        if (drag) {
          setDrag(null);
          setMessage("");
          return;
        }
        const target = findDragTarget(scenario, selected);
        if (target) {
          dragOriginRef.current = selected;
          setDrag(target);
          setMessage(
            `${describeDragTarget(target)} を掴みました。矢印キーで動かし、Enter で置きます。Escape で戻します。`,
          );
          return;
        }
        applyEdit(selected);
      }
    },
    [applyEdit, drag, dropAt, selected, scenario],
  );

  // ------------------------------------------------------------ 実行

  const onRun = useCallback(async () => {
    const problems = validateScenario(scenario);
    if (problems.length > 0) {
      setMessage(problems.join(" / "));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setMessage("");
    setResult(null);
    setTime(0);
    setProgress("計画中…");

    const onEvent = (event: SolverEvent) => {
      if (event.type === "progress")
        setProgress(event.label ?? `${Math.round(event.ratio * 100)}%`);
    };

    try {
      // horizon が空欄のときは渡さない。Solver 側がマップと goal 距離から決める。
      const options =
        solverId === "rhcr"
          ? {
              ...(rhcrHorizon.trim() === "" ? {} : { horizon: Number(rhcrHorizon) }),
              extra: {
                planningWindow: rhcrPlanningWindow,
                replanningPeriod: rhcrReplanningPeriod,
              },
            }
          : solverId === "lns-wpbs"
            ? { extra: { windowSize: wpbsWindow } }
            : undefined;
      const res = await runSolver({
        solverId,
        scenario,
        options,
        seed,
        onEvent,
        signal: controller.signal,
      });
      setResult(res);
      if (res.outcome !== "solved") {
        setMessage(outcomeMessage(res));
      } else if (res.conflicts.length > 0) {
        setMessage(
          `経路は求まりましたが衝突が ${res.conflicts.length} 件残っています。この手法は衝突を解消しません。`,
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "実行に失敗しました");
    } finally {
      setRunning(false);
      setProgress("");
    }
  }, [rhcrHorizon, rhcrPlanningWindow, rhcrReplanningPeriod, scenario, seed, solverId, wpbsWindow]);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  // ------------------------------------------------------------ プリセット / JSON

  const loadPreset = useCallback((id: string, s: number) => {
    setPresetId(id);
    setScenario(buildPreset(id, s));
    setResult(null);
    setTime(0);
    setMessage("");
  }, []);

  const onExport = useCallback(() => {
    const json = JSON.stringify(scenarioToJson(scenario), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [scenario]);

  const onImport = useCallback((file: File) => {
    void file.text().then((text) => {
      try {
        setScenario(scenarioFromJson(JSON.parse(text)));
        setResult(null);
        setTime(0);
        setMessage(`${file.name} を読み込みました。`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "読み込みに失敗しました");
      }
    });
  }, []);

  const generateTasks = useCallback((count: number, arrivalRate: number) => {
    setScenario((prev) => {
      const random = createRandom(prev.seed);
      const free: Cell[] = [];
      for (let y = 0; y < prev.map.height; y += 1) {
        for (let x = 0; x < prev.map.width; x += 1) {
          if (isWalkable(prev.map, { x, y })) free.push({ x, y });
        }
      }
      if (free.length < 2) return prev;
      /*
        ★ エージェントの初期位置は作業地点にしない。
          mapd-tp-tpts-central-2017 p.2 §3.2 の V_ep は
          「エージェント初期位置 ∪ 作業地点 ∪ 追加 parking」で、
          そこから作業地点を除いたものが non-task endpoint になる。
          初期位置を pickup / delivery にしてしまうと task endpoint 側へ
          移ってしまい、Definition 1 の条件 (b)（退避先 >= エージェント数）
          を自動的に壊す。生成タスクがいつも well-formed でなくなるので避ける。
      */
      const starts = new Set(prev.agents.map((a) => `${a.start.x},${a.start.y}`));
      const workCells = free.filter((c) => !starts.has(`${c.x},${c.y}`));
      if (workCells.length < 2) return prev;
      const tasks = Array.from({ length: count }, (_, i) => ({
        id: `t${i + 1}`,
        pickup: workCells[randomInt(random, workCells.length)]!,
        delivery: workCells[randomInt(random, workCells.length)]!,
        releaseTime: Math.floor(i / Math.max(0.01, arrivalRate)),
      }));
      return {
        ...prev,
        tasks,
        kind: "mapd" as const,
        // 初期位置を退避地点として明示する。条件 (b) の最低限を満たすため。
        parkingEndpoints: prev.agents.map((a) => ({ ...a.start })),
      };
    });
    setMessage(
      "タスクを生成しました。MAPD の手法を選んで実行できます。well-formed かどうかは下の判定を見てください。",
    );
  }, []);

  const description = useMemo(() => describeState(renderState), [renderState]);
  const currentSolver = solvers.find((s) => s.id === solverId);

  return (
    <div className="sim">
      <div className="sim-canvas-wrap">
        {/*
          canvas 自体を操作面にしている。role は付けない。
          jsx-a11y は「対話ハンドラを持つ要素に非対話ロール（application）を付けるな」と警告するが、
          ここでは role を外し、代わりに次の 3 つで支援技術に対応している。
            1. tabIndex でフォーカス可能にし、矢印キー + Enter で全操作できる
            2. aria-label で操作方法を伝える
            3. 直下の .sim-desc（aria-live）に盤面の状態を文章で出す
        */}
        <canvas
          ref={canvasRef}
          className={drag ? "sim-canvas dragging" : "sim-canvas"}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onKeyDown={onCanvasKeyDown}
          onFocus={onCanvasFocus}
          tabIndex={0}
          aria-label="MAPF シミュレータのグリッド。エージェント・目標・タスク地点はドラッグで動かせます。キーボードでは矢印キーでセルを選び、Enter で掴んで動かし、もう一度 Enter で置きます。Escape で元に戻します。盤面の状態はこの下に文章で表示しています。"
        />
        <p className="sim-desc" aria-live="polite">
          {description}
        </p>
      </div>

      <div className="sim-controls">
        <section>
          <h3>アルゴリズム</h3>
          <label>
            手法
            <select value={solverId} onChange={(e) => setSolverId(e.target.value)}>
              {solvers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}（{s.originalName}）
                </option>
              ))}
            </select>
          </label>
          {currentSolver?.implementationNote && (
            <p className="note">{currentSolver.implementationNote}</p>
          )}
          <p className="hint">
            ここに出るのは、実装済みでかつ「{PROBLEM_KIND_LABEL[scenario.kind]}
            」に対応した手法だけです。解説だけの手法や、別の問題設定の手法は選べません。
          </p>

          {solverId === "rhcr" && (
            <div>
              <div className="row">
                <label>
                  planning window w
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={rhcrPlanningWindow}
                    onChange={(event) => setRhcrPlanningWindow(Number(event.target.value) || 1)}
                  />
                </label>
                <label>
                  replanning period h
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={rhcrReplanningPeriod}
                    onChange={(event) => setRhcrReplanningPeriod(Number(event.target.value) || 1)}
                  />
                </label>
                <label>
                  シミュレーション horizon
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    placeholder="自動"
                    value={rhcrHorizon}
                    onChange={(event) => setRhcrHorizon(event.target.value)}
                  />
                </label>
              </div>
              <p className="hint">
                RHCR は w ≥ h を要求します。w は衝突解消の先読み、h は実行周期、horizon は何 step
                運転するかです。horizon を空欄にするとマップと goal の距離から自動で決めます。
              </p>
            </div>
          )}

          {solverId === "lns-wpbs" && (
            <div>
              <div className="row">
                <label>
                  時間窓 w
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={wpbsWindow}
                    onChange={(event) => setWpbsWindow(Number(event.target.value) || 1)}
                  />
                </label>
              </div>
              <p className="hint">
                LNS-wPBS は最初の w step 分だけ衝突を解消し、w step 進んだら計画し直します。w
                を小さくすると先が見えなくなって詰まることがあります。これが LNS-PBS
                との違いで、完全性の保証が無い理由でもあります（mg-mapd-iros-2022 p.5）。w
                を十分大きくすると LNS-PBS と同じ結果になります。既定の 10 は論文の実験設定です（同
                p.6）。
              </p>
            </div>
          )}

          <div className="row">
            <button type="button" className="primary" onClick={onRun} disabled={running}>
              {running ? "実行中…" : "実行"}
            </button>
            <button type="button" onClick={onStop} disabled={!running}>
              停止
            </button>
          </div>
          {progress && (
            <p className="hint" aria-live="polite">
              {progress}
            </p>
          )}
          {/*
            ★ 実行の結末はボタンのすぐ下に出す。
              指標表は下のほうにあるので、押した人の目線から遠い。
              「解けたのか、詰まったのか、衝突が残ったのか」は
              押した直後にいちばん知りたいこと。
              詳しい数値は下の指標表に出す。ここは結末だけ。
          */}
          {result && (
            <p className={`run-outcome ${outcomeTone(result)}`} role="status">
              <strong>{outcomeLabel(result.outcome)}</strong>
              {result.conflicts.length > 0 && `／残存衝突 ${result.conflicts.length} 件`}
              {result.metrics.pendingTasks !== undefined &&
                result.metrics.pendingTasks > 0 &&
                `／未処理タスク ${result.metrics.pendingTasks} 件`}
              {result.warnings && result.warnings.length > 0 && (
                <span className="run-outcome-note">
                  但し書きが {result.warnings.length} 件あります（下の「指標」を参照）
                </span>
              )}
            </p>
          )}
        </section>

        <section>
          <h3>再生</h3>
          <div className="row">
            <button type="button" onClick={() => setPlaying((p) => !p)} disabled={horizon === 0}>
              {playing ? "一時停止" : "再生"}
            </button>
            <button
              type="button"
              onClick={() => setTime((t) => Math.max(0, t - 1))}
              disabled={horizon === 0}
            >
              1 ステップ戻る
            </button>
            <button
              type="button"
              onClick={() => setTime((t) => Math.min(horizon, t + 1))}
              disabled={horizon === 0}
            >
              1 ステップ進む
            </button>
            <button
              type="button"
              onClick={() => {
                setTime(0);
                setPlaying(false);
              }}
            >
              リセット
            </button>
          </div>
          <label>
            時刻 {time} / {horizon}
            <input
              type="range"
              min={0}
              max={Math.max(0, horizon)}
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
              disabled={horizon === 0}
            />
          </label>
          <label>
            再生速度（1 ステップ {speed}ms）
            <input
              type="range"
              min={60}
              max={1200}
              step={20}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
          {reduceMotion && (
            <p className="hint">動きを減らす設定が有効なため、再生速度の下限を制限しています。</p>
          )}
        </section>

        <section>
          <h3>シナリオ</h3>
          <label>
            プリセット
            <select value={presetId} onChange={(e) => loadPreset(e.target.value, seed)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{PRESETS.find((p) => p.id === presetId)?.description}</p>

          <div className="row">
            <label>
              幅
              <input
                type="number"
                min={2}
                max={60}
                value={scenario.map.width}
                onChange={(e) =>
                  setScenario((prev) => ({
                    ...prev,
                    map: resizeMap(
                      prev.map,
                      Number(e.target.value) || prev.map.width,
                      prev.map.height,
                    ),
                  }))
                }
              />
            </label>
            <label>
              高さ
              <input
                type="number"
                min={2}
                max={60}
                value={scenario.map.height}
                onChange={(e) =>
                  setScenario((prev) => ({
                    ...prev,
                    map: resizeMap(
                      prev.map,
                      prev.map.width,
                      Number(e.target.value) || prev.map.height,
                    ),
                  }))
                }
              />
            </label>
            <label>
              seed
              <input
                type="number"
                value={seed}
                onChange={(e) => {
                  const s = Number(e.target.value) || 1;
                  setSeed(s);
                  setScenario((prev) => ({ ...prev, seed: s }));
                }}
              />
            </label>
          </div>
          <p className="hint">同じ seed と同じ入力なら、実行結果は毎回同じになります。</p>
        </section>

        <section>
          <h3>編集</h3>
          <div className="modes" role="radiogroup" aria-label="編集モード">
            {(
              [
                ["wall", "壁"],
                ["agent", "エージェント追加/削除"],
                ["start", "開始"],
                ["goal", "目標"],
                ["pickup", "pickup"],
                ["delivery", "delivery"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? "chip active" : "chip"}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">
            エージェント・目標・タスク地点は<strong>ドラッグで動かせます</strong>。壁は押したまま
            なぞると続けて塗れます。上のモードは「何も無いセルを押したとき何を置くか」の指定です。
            キーボードでは矢印キーでセルを選び、Enter で掴んで矢印キーで動かし、もう一度 Enter
            で置きます（Escape で元に戻ります）。
          </p>
        </section>

        <section>
          <h3>表示</h3>
          <div className="toggles">
            {(
              [
                ["planned-paths", "経路"],
                ["reservations", "予約表"],
                ["conflicts", "衝突"],
                ["tasks", "タスク"],
                ["labels", "番号"],
                ["grid", "グリッド線"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="toggle">
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={(e) => setLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>MAPD タスク</h3>
          <TaskGenerator onGenerate={generateTasks} />
          {/*
            ★ well-formed かどうかは必ず出す。
              TP / TPTS の理論保証（mapd-tp-tpts-central-2017 p.4 Theorem 3）は
              well-formed な入力についての主張なので、いま触っている入力が
              その対象かどうかが見えないと保証の話が読めない。
              ただし well-formed は十分条件であって必要条件ではない（同 p.2）ので、
              「満たさない ＝ 解けない」とは書かない。
          */}
          {scenario.kind === "mapd" && wellFormed && (
            <div className={wellFormed.wellFormed ? "wf ok" : "wf warn"}>
              <p>
                <strong>
                  {!wellFormed.checked
                    ? "well-formed か未判定"
                    : wellFormed.wellFormed
                      ? "well-formed です"
                      : "well-formed ではありません"}
                </strong>
                （endpoint {wellFormed.endpoints.all.length} 個 = 作業地点{" "}
                {wellFormed.endpoints.task.length} + 退避地点 {wellFormed.endpoints.nonTask.length}
                、エージェント {scenario.agents.length} 体）
              </p>
              {wellFormed.violations.length > 0 && (
                <ul>
                  {wellFormed.violations.slice(0, 3).map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              )}
              <p className="hint">
                well-formed は解けるための十分条件です（mapd-tp-tpts-central-2017 p.2 Definition
                1）。満たさなくても解ける場合はありますが、TP / TPTS
                の理論保証は満たす入力についての主張です。
              </p>
            </div>
          )}
        </section>

        <section>
          <h3>指標</h3>
          {result ? (
            <dl className="metrics">
              <div>
                <dt>結果</dt>
                <dd>{outcomeLabel(result.outcome)}</dd>
              </div>
              <div>
                <dt>sum of costs</dt>
                <dd>{result.metrics.sumOfCosts}</dd>
              </div>
              <div>
                <dt>makespan</dt>
                <dd>{result.metrics.makespan}</dd>
              </div>
              <div>
                <dt>展開ノード</dt>
                <dd>{result.metrics.expandedNodes ?? "—"}</dd>
              </div>
              <div>
                <dt>計画時間</dt>
                <dd>{result.metrics.runtimeMs.toFixed(1)} ms</dd>
              </div>
              <div>
                <dt>残存衝突</dt>
                <dd className={result.conflicts.length > 0 ? "bad" : ""}>
                  {result.conflicts.length}
                </dd>
              </div>
              {/*
                ★ どの量を最小化したのかは必ず添える。
                  TAPF は手法ごとに目的関数が違う。CBM は makespan
                  （cbm-tapf-aamas-2016 p.2）、CBS-TA は sum of costs
                  （cbs-ta-aamas-2018 p.2）で、CBS-TA 論文 p.1 自身が
                  両者を区別している。画面は両方の数値を出すので、
                  黙っていると「どれも最適値」と読まれる。
              */}
              {result.objective && (
                <div>
                  <dt>最小化した量</dt>
                  <dd>{OBJECTIVE_LABEL[result.objective]}</dd>
                </div>
              )}
              {/*
                ★ MAPD は sum of costs や makespan では測らない。
                  mapd-tp-tpts-central-2017 p.2 §3.1 は service time
                  （タスクが task set に入ってから完了までの歩数）で評価し、
                  「service time が有界なら解けた」と定義している。
                  one-shot の指標と混同させないため、別行で出す。
              */}
              {result.metrics.averageServiceTime !== undefined && (
                <div>
                  <dt>平均 service time</dt>
                  <dd>{result.metrics.averageServiceTime.toFixed(1)}</dd>
                </div>
              )}
              {result.metrics.throughput !== undefined && (
                <div>
                  <dt>throughput</dt>
                  <dd>{result.metrics.throughput.toFixed(3)} 件/ステップ</dd>
                </div>
              )}
              {result.metrics.pendingTasks !== undefined && (
                <div>
                  <dt>未処理タスク</dt>
                  <dd className={result.metrics.pendingTasks > 0 ? "bad" : ""}>
                    {result.metrics.pendingTasks}
                  </dd>
                </div>
              )}
              {result.metrics.totalTravelDelay !== undefined && (
                <div>
                  <dt>total travel delay</dt>
                  <dd>{result.metrics.totalTravelDelay.toFixed(1)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="hint">まだ実行していません。</p>
          )}
          {result && result.targetAssignments && result.targetAssignments.length > 0 && (
            <div className="assignments">
              <h4>目標割当</h4>
              <ul>
                {result.targetAssignments.map((assignment) => (
                  <li key={assignment.agentId}>
                    {assignment.teamId && <span className="team">{assignment.teamId}</span>}{" "}
                    {assignment.agentId} →（
                    {assignment.goal.x}, {assignment.goal.y}）
                    {assignment.targetId && <span className="hint"> [{assignment.targetId}]</span>}
                  </li>
                ))}
              </ul>
              <p className="hint">
                TAPF では、どのエージェントがどの target へ行くかも解の一部です。 盤面の破線の四角が
                target で、割り当てられたものには実線とエージェント名が付きます。
              </p>
            </div>
          )}
          {/*
            ★ warnings は必ず出す。
              手法の多くは不完全（PIBT / winPIBT / PBS / 優先順位付き計画）なので、
              「解が見つかりませんでした」だけを見せると「解が存在しない」と読まれる。
              その区別を書いているのが warnings なので、隠すと過大主張になる
              （SOURCE_POLICY.md 第 8 条）。
          */}
          {result && result.warnings && result.warnings.length > 0 && (
            <ul className="solver-warnings">
              {result.warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>
                  <span className="warning-code">{warningLabel(warning.code)}</span>
                  {warning.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>入出力</h3>
          <div className="row">
            <button type="button" onClick={onExport}>
              JSON を書き出す
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              JSON を読み込む
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = "";
              }}
            />
          </div>
        </section>

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function TaskGenerator({
  onGenerate,
}: {
  onGenerate: (count: number, arrivalRate: number) => void;
}) {
  const [count, setCount] = useState(10);
  const [rate, setRate] = useState(0.5);
  return (
    <>
      <div className="row">
        <label>
          タスク数
          <input
            type="number"
            min={0}
            max={200}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 0)}
          />
        </label>
        <label>
          到着率（/ステップ）
          <input
            type="number"
            min={0.05}
            max={5}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value) || 0.05)}
          />
        </label>
      </div>
      <button type="button" onClick={() => onGenerate(count, rate)}>
        タスクを生成
      </button>
    </>
  );
}

/**
 * 実行結果の見た目の強さ。
 *
 * ★ solved でも衝突や未処理が残っていれば「うまくいった」扱いにしない。
 *   衝突を解消しない手法（BFS / A*）は solved を返しつつ重なりを残すので、
 *   緑一色にすると誤読させる。
 */
function outcomeTone(result: SolverResult): "ok" | "warn" | "bad" {
  if (result.outcome === "error") return "bad";
  if (result.outcome !== "solved") return "warn";
  if (result.conflicts.length > 0) return "warn";
  if ((result.metrics.pendingTasks ?? 0) > 0) return "warn";
  return "ok";
}

function outcomeLabel(outcome: SolverResult["outcome"]): string {
  switch (outcome) {
    case "solved":
      return "解が求まりました";
    case "no-solution":
      return "解が見つかりませんでした";
    case "timeout":
      return "時間切れ";
    case "node-limit":
      return "展開ノード数の上限に達しました";
    case "aborted":
      return "中断しました";
    default:
      return "エラー";
  }
}

function warningLabel(code: SolverWarning["code"]): string {
  switch (code) {
    case "input-too-large":
      return "入力が大きすぎます";
    case "trace-truncated":
      return "トレース打切り";
    case "option-ignored":
      return "無視した設定";
    case "simplified-behavior":
      return "簡略化";
    case "nondeterminism-risk":
      return "非決定性の恐れ";
    default:
      return "注意";
  }
}

function outcomeMessage(result: SolverResult): string {
  if (result.error?.message) return result.error.message;
  return outcomeLabel(result.outcome);
}
