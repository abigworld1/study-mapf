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
import { runSolver } from "@/solvers/client";
import { listSolverMetadata } from "@/solvers/registry";
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

type EditMode = "wall" | "agent" | "start" | "goal" | "pickup" | "delivery";

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
  const solvers = useMemo(() => listSolverMetadata(), []);
  const [solverId, setSolverId] = useState(() => initialSolverId ?? solvers[0]?.id ?? "astar");

  // アルゴリズムページからの導線（?solver=...）を受ける。
  // 実装が無い id が来ても選択は変えない（存在しない手法を選ばせないため）。
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("solver");
    if (requested && solvers.some((s) => s.id === requested)) setSolverId(requested);
  }, [solvers]);
  const [presetId, setPresetId] = useState("open-grid");
  const [seed, setSeed] = useState(1);
  const [rhcrPlanningWindow, setRhcrPlanningWindow] = useState(8);
  const [rhcrReplanningPeriod, setRhcrReplanningPeriod] = useState(2);
  // 空欄 = 自動。w から導くと、無関係なつまみで運転時間が決まってしまう。
  const [rhcrHorizon, setRhcrHorizon] = useState("");
  const [scenario, setScenario] = useState<Scenario>(() => buildPreset("open-grid", 1));
  const [mode, setMode] = useState<EditMode>("wall");
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

  const conflictsNow = useMemo(
    () => (result?.conflicts ?? []).filter((c) => c.time === time),
    [result, time],
  );

  const renderState: RenderState = useMemo(
    () => ({
      map: scenario.map,
      agents: scenario.agents,
      tasks: scenario.tasks,
      positions,
      paths: layers["planned-paths"] ? paths : undefined,
      conflicts: conflictsNow,
      time,
      selected,
      layers,
    }),
    [scenario, positions, paths, conflictsNow, time, selected, layers],
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
          const idx = prev.agents.length - 1;
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

  const onCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const vp = computeViewport(canvas, scenario.map);
      const cell = cellFromPoint(
        vp,
        scenario.map,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      if (cell) applyEdit(cell);
    },
    [applyEdit, scenario.map],
  );

  const onCanvasKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const step = (dx: number, dy: number) => {
        event.preventDefault();
        setSelected((prev) => {
          const base = prev ?? { x: 0, y: 0 };
          return {
            x: Math.max(0, Math.min(scenario.map.width - 1, base.x + dx)),
            y: Math.max(0, Math.min(scenario.map.height - 1, base.y + dy)),
          };
        });
      };
      if (event.key === "ArrowLeft") step(-1, 0);
      else if (event.key === "ArrowRight") step(1, 0);
      else if (event.key === "ArrowUp") step(0, -1);
      else if (event.key === "ArrowDown") step(0, 1);
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (selected) applyEdit(selected);
      }
    },
    [applyEdit, selected, scenario.map],
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
  }, [rhcrHorizon, rhcrPlanningWindow, rhcrReplanningPeriod, scenario, seed, solverId]);

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
      const tasks = Array.from({ length: count }, (_, i) => ({
        id: `t${i + 1}`,
        pickup: free[randomInt(random, free.length)]!,
        delivery: free[randomInt(random, free.length)]!,
        releaseTime: Math.floor(i / Math.max(0.01, arrivalRate)),
      }));
      return { ...prev, tasks, kind: "mapd" as const };
    });
    setMessage(
      "タスクを生成しました。現時点では MAPD に対応した Solver が未実装のため、実行はできません（JSON へは書き出せます）。",
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
          className="sim-canvas"
          onClick={onCanvasClick}
          onKeyDown={onCanvasKeyDown}
          tabIndex={0}
          aria-label="MAPF シミュレータのグリッド。矢印キーでセルを選択し、Enter で編集します。盤面の状態はこの下に文章で表示しています。"
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
          <p className="hint">ここに出るのは実装済みの手法だけです。解説だけの手法は選べません。</p>

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
            グリッドをクリックすると編集できます。「開始」「目標」は最後に追加したエージェントに適用します。
          </p>
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
          <p className="hint">
            現時点では MAPD に対応した Solver が未実装のため、生成したタスクは JSON
            への書き出しと表示にのみ使えます。
          </p>
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
            </dl>
          ) : (
            <p className="hint">まだ実行していません。</p>
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
