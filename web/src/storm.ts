// ============================================================
// storm.ts ─ プリズムストーム（累計 pop 数・予告・進行）の純粋な状態
// 演出（波・生き物・背景・音）の配線は main.ts。正本は docs/architecture.md 3.4.1 節。
// ============================================================

import {
  STORM_ANTICIPATION_POPS,
  STORM_BASE_DURATION_MS,
  STORM_CREATURE_GLOW,
  STORM_CREATURE_GLOW_PER_LEVEL,
  STORM_DURATION_PER_LEVEL_MS,
  STORM_EVERY,
  STORM_MAX_SCALING_LEVEL,
  STORM_RAMP_IN_MS,
  STORM_RAMP_OUT_MS,
  STORM_SPAWN_BOOST,
  STORM_SPAWN_BOOST_PER_LEVEL,
  STORM_WAVE_INTERVAL_MIN_MS,
  STORM_WAVE_INTERVAL_MS,
  STORM_WAVE_INTERVAL_PER_LEVEL_MS,
} from "./tuning";

export interface StormState {
  /** 累計 pop 数（tap・swipe・chain すべて。タブを閉じるまで保持） */
  totalPops: number;
  /** 起きたストームの回数（= 直近のストームの level） */
  level: number;
  /** 発動中か */
  isActive: boolean;
  startMs: number;
  durationMs: number;
  /** 次の波を起こす時刻 */
  nextWaveMs: number;
  /** 生き物を中央から散らしたか（1 回のストームで 1 回だけ） */
  hasScattered: boolean;
  /** 締めを鳴らしたか。締めは収まり（STORM_RAMP_OUT_MS）の入り口で鳴らし、以降は波を起こさない */
  hasFinale: boolean;
}

export function createStormState(initialPops = 0): StormState {
  return {
    totalPops: Math.max(0, Math.floor(initialPops)),
    // 初期値が閾値を越えていても、過去の分は起きたことにする（?pops=990 などの検証で 0 回目扱いにする）
    level: Math.floor(Math.max(0, initialPops) / STORM_EVERY),
    isActive: false,
    startMs: 0,
    durationMs: 0,
    nextWaveMs: 0,
    hasScattered: false,
    hasFinale: false,
  };
}

/** 回を追うごとの強化は STORM_MAX_SCALING_LEVEL で頭打ちにする */
function scalingStep(level: number): number {
  return Math.min(level, STORM_MAX_SCALING_LEVEL) - 1;
}

export function stormDurationMs(level: number): number {
  return STORM_BASE_DURATION_MS + STORM_DURATION_PER_LEVEL_MS * scalingStep(level);
}

export function stormWaveIntervalMs(level: number): number {
  return Math.max(STORM_WAVE_INTERVAL_MIN_MS, STORM_WAVE_INTERVAL_MS - STORM_WAVE_INTERVAL_PER_LEVEL_MS * scalingStep(level));
}

export function stormSpawnBoost(level: number): number {
  return STORM_SPAWN_BOOST + STORM_SPAWN_BOOST_PER_LEVEL * scalingStep(level);
}

export function stormCreatureGlow(level: number): number {
  return Math.min(1, STORM_CREATURE_GLOW + STORM_CREATURE_GLOW_PER_LEVEL * scalingStep(level));
}

/** pop を 1 つ数える */
export function countPop(state: StormState): void {
  state.totalPops++;
}

/** 発動待ちの閾値に達していて、発動中でなければ true（ストーム中に達した分は終了後に拾う） */
export function isStormDue(state: StormState): boolean {
  return !state.isActive && Math.floor(state.totalPops / STORM_EVERY) > state.level;
}

export function startStorm(state: StormState, nowMs: number): void {
  state.level++;
  state.isActive = true;
  state.startMs = nowMs;
  state.durationMs = stormDurationMs(state.level);
  // 最初の波は立ち上がりの後
  state.nextWaveMs = nowMs + STORM_RAMP_IN_MS;
  state.hasScattered = false;
  state.hasFinale = false;
}

/** 締めの時刻に達したか（収まりの入り口） */
export function isFinaleDue(state: StormState, nowMs: number): boolean {
  return state.isActive && !state.hasFinale && nowMs - state.startMs >= state.durationMs - STORM_RAMP_OUT_MS;
}

export function endStorm(state: StormState): void {
  state.isActive = false;
}

/** 進行度 0..1（発動中でなければ 0） */
export function stormProgress(state: StormState, nowMs: number): number {
  if (!state.isActive) return 0;
  return Math.min(1, Math.max(0, (nowMs - state.startMs) / state.durationMs));
}

/** 強さ 0..1。立ち上がり・収まりをなめらかにする（smoothstep） */
export function stormIntensity(state: StormState, nowMs: number): number {
  if (!state.isActive) return 0;
  const elapsed = nowMs - state.startMs;
  const remaining = state.durationMs - elapsed;
  const t = Math.min(1, Math.max(0, Math.min(elapsed / STORM_RAMP_IN_MS, remaining / STORM_RAMP_OUT_MS)));
  return t * t * (3 - 2 * t);
}

/** 予告の強さ 0..1。次の閾値の STORM_ANTICIPATION_POPS 個手前から閾値に向けて増える（発動中は 0） */
export function stormAnticipation(state: StormState): number {
  if (state.isActive) return 0;
  const untilNext = STORM_EVERY - (state.totalPops % STORM_EVERY);
  // 閾値ちょうど（発動待ち）は最大
  if (isStormDue(state)) return 1;
  if (untilNext > STORM_ANTICIPATION_POPS) return 0;
  return 1 - untilNext / STORM_ANTICIPATION_POPS;
}
