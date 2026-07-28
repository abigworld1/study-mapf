import { useEffect, useMemo, useRef, useState } from "react";
import type { Cell, SolverResult, TimedPath } from "@/lib/model/types";
import { buildPreset } from "@/lib/model/scenario";
import { positionAt } from "@/lib/model/conflicts";
import { runInline } from "@/solvers/client";
import { readTheme, render, type LayerName } from "@/lib/render/renderer";

const LAYERS: Record<LayerName, boolean> = {
  grid: true,
  obstacles: true,
  tasks: false,
  "planned-paths": true,
  reservations: false,
  constraints: false,
  conflicts: true,
  agents: true,
  labels: true,
  selection: false,
};

/**
 * トップページの短いデモ。
 * 優先順位付き計画で 1 度だけ解き、その結果をループ再生するだけ。
 * 探索そのものは見せない（それはシミュレータの役割）。
 */
/*
  ★ プリセットは「優先順位付き計画で解ける」ものを選ぶこと。
    以前は cross を使っていたが、cross は 121 マス中 100 マスが壁（83%）で、
    しかも固定優先順位では解けない（no-solution）。makespan が 0 になるため
    下の setInterval が起動せず、トップページは真っ黒な静止画になっていた。
    bottleneck は壁 7%、1 マスの隘路を 4 体が順に抜けるので、
    「優先順位で通す」という MAPF の核が一目で伝わる。
    tests/unit/hero-demo.test.ts がこの前提を固定している。
*/
export const HERO_PRESET_ID = "bottleneck";
export const HERO_SEED = 7;

export default function HeroDemo() {
  const scenario = useMemo(() => buildPreset(HERO_PRESET_ID, HERO_SEED), []);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [time, setTime] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let cancelled = false;
    void runInline({ solverId: "prioritized-planning", scenario }).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const horizon = result?.metrics.makespan ?? 0;

  useEffect(() => {
    if (horizon === 0 || reduceMotion) return;
    const id = setInterval(() => setTime((t) => (t >= horizon ? 0 : t + 1)), 420);
    return () => clearInterval(id);
  }, [horizon, reduceMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paths: readonly TimedPath[] = result?.paths ?? [];
    const positions: Record<string, Cell> = {};
    if (paths.length === 0) {
      for (const a of scenario.agents) positions[a.id] = a.start;
    } else {
      for (const p of paths) {
        const cell = positionAt(p, time, scenario.rules);
        if (cell) positions[p.agentId] = cell;
      }
    }
    render(
      canvas,
      {
        map: scenario.map,
        agents: scenario.agents,
        positions,
        paths,
        conflicts: (result?.conflicts ?? []).filter((c) => c.time === time),
        time,
        layers: LAYERS,
      },
      readTheme(),
    );
  }, [result, time, scenario]);

  return (
    <figure className="hero-demo">
      <canvas ref={canvasRef} aria-hidden="true" />
      <figcaption>
        1 マスの隘路を 4 体が通り抜ける例。優先順位付き計画で解いた経路を繰り返し再生しています。
        {reduceMotion && "（動きを減らす設定のため静止表示）"}
        {result && result.conflicts.length === 0
          ? " 衝突は 0 件です。"
          : result
            ? ` 衝突が ${result.conflicts.length} 件残っています。`
            : " 計算中…"}
      </figcaption>
    </figure>
  );
}
