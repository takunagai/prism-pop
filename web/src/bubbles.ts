// ============================================================
// bubbles.ts ─ 泡のシミュレーション（描画非依存の純粋な状態）
// レンダラ（render/bubbles2d.ts, render/rich-gl.ts）はこの状態を読むだけで、
// ここには一切描画コードを書かない。正本は docs/architecture.md 3.2 節。
// ============================================================

import {
  BUBBLE_COUNT_MIN,
  BUBBLE_COUNT_POWER,
  BUBBLE_COUNT_REFERENCE_COUNT,
  BUBBLE_COUNT_REFERENCE_SHORT_EDGE,
  BUBBLE_RADIUS_MAX_RATIO,
  BUBBLE_RADIUS_MIN_RATIO,
  BUBBLE_RISE_SPEED_MAX,
  BUBBLE_RISE_SPEED_MIN,
  BUBBLE_SIZE_SKEW,
  BUBBLE_WOBBLE_AMPLITUDE_RATIO,
  BUBBLE_WOBBLE_PERIOD_MAX_S,
  BUBBLE_WOBBLE_PERIOD_MIN_S,
  MAX_BUBBLES,
  POP_ANIM_MS,
  IN_VIEW_SPAWN_DEFICIT_RATIO,
  IN_VIEW_SPAWN_TOP_RATIO,
  SPAWN_GROW_MS,
  SPAWN_INTERVAL_MAX_MS,
  SPAWN_INTERVAL_MIN_MS,
  POP_PUSH_RADIUS_RATIO,
  POP_PUSH_STRENGTH,
  SPLIT_CHILD_SIZE_RATIO,
  SPLIT_MAX_COUNT,
  SPLIT_MIN_COUNT,
  SPLIT_SCATTER_SPEED,
  SPLIT_SIZE_THRESHOLD,
} from "./tuning";

export type BubbleState = "rising" | "popping";

export interface Bubble {
  id: number;
  active: boolean;
  state: BubbleState;
  /** 描画・当たり判定に使う最終位置（baseX/baseY + ウォブルのオフセット） */
  x: number;
  y: number;
  /** ウォブルを除いた物理位置（上昇・押し出しはここを動かす） */
  baseX: number;
  baseY: number;
  radius: number;
  /** 0..1（半径をサイズ範囲で正規化。1 = 最大） */
  sizeNorm: number;
  riseSpeed: number;
  /** 衝撃で押された分の速度（毎フレーム減衰） */
  pushVx: number;
  pushVy: number;
  wobbleSeed: number;
  wobblePeriod: number;
  squashSeed: number;
  /** 虹色の揺らぎ・干渉ノイズのオフセット（レンダラ間で共通の見た目にする） */
  shimmerSeed: number;
  /** 割れアニメーションの進行度 0..1（state="popping" のときだけ意味を持つ） */
  popT: number;
  /** 最終的な半径。湧き出し直後は radius がここへ向かって膨らむ */
  targetRadius: number;
  /** 湧き出しの膨らみの進行度 0..1（1 = 完了） */
  growT: number;
}

export interface BubbleField {
  /** 固定長配列（MAX_BUBBLES）。index === bubble.id で GL の uniform 配列と対応づく */
  bubbles: Bubble[];
  spawnTimerMs: number;
}

export interface PopResult {
  x: number;
  y: number;
  radius: number;
  sizeNorm: number;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 画面短辺から目標泡数を冪乗則で算出する（面積そのものだと PC で過剰に増えるため） */
export function targetBubbleCount(width: number, height: number): number {
  const shortEdge = Math.min(width, height);
  const ratio = Math.max(shortEdge / BUBBLE_COUNT_REFERENCE_SHORT_EDGE, 0.4);
  const scaled = BUBBLE_COUNT_REFERENCE_COUNT * Math.pow(ratio, BUBBLE_COUNT_POWER);
  return Math.max(BUBBLE_COUNT_MIN, Math.min(MAX_BUBBLES, Math.round(scaled)));
}

function findFreeSlot(field: BubbleField): number {
  for (let i = 0; i < field.bubbles.length; i++) {
    if (!field.bubbles[i].active) return i;
  }
  return -1;
}

function makeBubble(id: number): Bubble {
  return {
    id,
    active: false,
    state: "rising",
    x: 0,
    y: 0,
    baseX: 0,
    baseY: 0,
    radius: 0,
    sizeNorm: 0,
    riseSpeed: 0,
    pushVx: 0,
    pushVy: 0,
    wobbleSeed: 0,
    wobblePeriod: 1,
    squashSeed: 0,
    shimmerSeed: 0,
    popT: 0,
    targetRadius: 0,
    growT: 1,
  };
}

export function createBubbleField(width: number, height: number): BubbleField {
  const field: BubbleField = { bubbles: [], spawnTimerMs: 0 };
  for (let i = 0; i < MAX_BUBBLES; i++) field.bubbles.push(makeBubble(i));

  // 初期表示はいきなり画面いっぱいに散らす（下からの湧き出しは以降の再スポーンのみ）
  const target = targetBubbleCount(width, height);
  for (let i = 0; i < target; i++) {
    const slot = findFreeSlot(field);
    if (slot === -1) break;
    spawnInto(field.bubbles[slot], width, height, randomRange(0, height));
  }
  return field;
}

function spawnInto(bubble: Bubble, width: number, height: number, y: number): void {
  const shortEdge = Math.min(width, height);
  const sizeNorm = Math.pow(Math.random(), BUBBLE_SIZE_SKEW);
  const radius = shortEdge * (BUBBLE_RADIUS_MIN_RATIO + (BUBBLE_RADIUS_MAX_RATIO - BUBBLE_RADIUS_MIN_RATIO) * sizeNorm);
  bubble.active = true;
  bubble.state = "rising";
  bubble.baseX = randomRange(radius, Math.max(radius, width - radius));
  bubble.baseY = y;
  bubble.x = bubble.baseX;
  bubble.y = bubble.baseY;
  bubble.radius = radius;
  bubble.sizeNorm = sizeNorm;
  // 大きい泡ほどゆっくり昇る
  bubble.riseSpeed = height * randomRange(BUBBLE_RISE_SPEED_MIN, BUBBLE_RISE_SPEED_MAX) * (1.15 - 0.3 * sizeNorm);
  bubble.pushVx = 0;
  bubble.pushVy = 0;
  bubble.wobbleSeed = Math.random() * 1000;
  bubble.wobblePeriod = randomRange(BUBBLE_WOBBLE_PERIOD_MIN_S, BUBBLE_WOBBLE_PERIOD_MAX_S);
  bubble.squashSeed = Math.random() * 1000;
  bubble.shimmerSeed = Math.random();
  bubble.popT = 0;
  bubble.targetRadius = radius;
  bubble.growT = 1;
}

function respawnFromBottom(field: BubbleField, width: number, height: number): void {
  const slot = findFreeSlot(field);
  if (slot === -1) return;
  const bubble = field.bubbles[slot];
  spawnInto(bubble, width, height, height + Math.max(24, height * 0.05));
}

/** 画面の下側に直接湧かせ、小さい状態から膨らませる（大量に割られて画面が空になるのを防ぐ） */
function spawnInView(field: BubbleField, width: number, height: number): void {
  const slot = findFreeSlot(field);
  if (slot === -1) return;
  const bubble = field.bubbles[slot];
  spawnInto(bubble, width, height, randomRange(height * IN_VIEW_SPAWN_TOP_RATIO, height * 0.95));
  bubble.radius = bubble.targetRadius * 0.05;
  bubble.growT = 0;
}

/**
 * 毎フレーム呼ぶ。上昇・揺れ・湧き出し・割れアニメの進行を行う。nowMs は呼び出し側の時刻源（p.millis() 等）を渡す。
 * densityScale はプリズムストーム中の湧く量の倍率（目標数と湧く速さに掛ける。上限は MAX_BUBBLES）
 */
export function updateBubbles(field: BubbleField, dtMs: number, nowMs: number, width: number, height: number, densityScale = 1): void {
  const dtS = dtMs / 1000;
  const target = Math.min(MAX_BUBBLES, Math.round(targetBubbleCount(width, height) * densityScale));
  let activeCount = 0;

  for (const bubble of field.bubbles) {
    if (!bubble.active) continue;
    activeCount++;

    if (bubble.state === "popping") {
      bubble.popT += dtMs / POP_ANIM_MS;
      if (bubble.popT >= 1) bubble.active = false;
      continue;
    }

    // 湧き出しの膨らみ（半径そのものを動かすので、どちらのレンダラも変更不要）
    if (bubble.growT < 1) {
      bubble.growT = Math.min(1, bubble.growT + dtMs / SPAWN_GROW_MS);
      const eased = 1 - Math.pow(1 - bubble.growT, 3);
      bubble.radius = bubble.targetRadius * (0.05 + 0.95 * eased);
    }

    // 上昇 + 押し出し衝撃（減衰）は base 位置を動かす
    bubble.baseY -= bubble.riseSpeed * dtS;
    bubble.baseX += bubble.pushVx * dtS;
    bubble.baseY += bubble.pushVy * dtS;
    bubble.pushVx *= Math.max(0, 1 - dtS * 3.5);
    bubble.pushVy *= Math.max(0, 1 - dtS * 3.5);

    // ウォブル（横揺れ）は時刻の純関数として毎フレーム再計算する（累積させない）
    const wobbleT = (nowMs / 1000 + bubble.wobbleSeed) / bubble.wobblePeriod;
    const wobbleOffset = Math.sin(wobbleT * Math.PI * 2) * bubble.radius * BUBBLE_WOBBLE_AMPLITUDE_RATIO;
    bubble.x = bubble.baseX + wobbleOffset;
    bubble.y = bubble.baseY;

    // 画面上端を抜けたら消滅（再スポーン枠に戻る）
    if (bubble.y < -bubble.radius * 1.5) {
      bubble.active = false;
      continue;
    }
    // 横は緩くクランプ（押し出しで画面外に出過ぎないように）
    if (bubble.baseX < -bubble.radius) bubble.baseX = -bubble.radius;
    if (bubble.baseX > width + bubble.radius) bubble.baseX = width + bubble.radius;
  }

  // 湧き出し: 不足が大きいほど間隔を詰める。不足が大きいときは画面内に直接湧かせる
  field.spawnTimerMs -= dtMs;
  if (activeCount < target && field.spawnTimerMs <= 0) {
    const deficitRatio = (target - activeCount) / target;
    if (deficitRatio > IN_VIEW_SPAWN_DEFICIT_RATIO) {
      spawnInView(field, width, height);
    } else {
      respawnFromBottom(field, width, height);
    }
    const interval = SPAWN_INTERVAL_MAX_MS + (SPAWN_INTERVAL_MIN_MS - SPAWN_INTERVAL_MAX_MS) * Math.min(1, deficitRatio * 2);
    field.spawnTimerMs = (interval / densityScale) * randomRange(0.7, 1.3);
  }
}

function applyPush(field: BubbleField, x: number, y: number, width: number, height: number): void {
  const shortEdge = Math.min(width, height);
  const pushRadius = shortEdge * POP_PUSH_RADIUS_RATIO;
  for (const bubble of field.bubbles) {
    if (!bubble.active || bubble.state !== "rising") continue;
    const dx = bubble.x - x;
    const dy = bubble.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.001 || dist >= pushRadius) continue;
    const falloff = 1 - dist / pushRadius;
    const strength = shortEdge * POP_PUSH_STRENGTH * falloff;
    bubble.pushVx += (dx / dist) * strength;
    bubble.pushVy += (dy / dist) * strength;
  }
}

/** 泡を割る。大きい泡は 2〜3 個の小泡に分裂し、周囲の泡は衝撃で押し出される */
export function popBubble(field: BubbleField, id: number, width: number, height: number): PopResult | null {
  const bubble = field.bubbles[id];
  if (!bubble || !bubble.active || bubble.state !== "rising") return null;

  const result: PopResult = { x: bubble.x, y: bubble.y, radius: bubble.radius, sizeNorm: bubble.sizeNorm };

  if (bubble.sizeNorm > SPLIT_SIZE_THRESHOLD) {
    const childCount = Math.round(randomRange(SPLIT_MIN_COUNT, SPLIT_MAX_COUNT + 1) - 0.5);
    for (let i = 0; i < childCount; i++) {
      const slot = findFreeSlot(field);
      if (slot === -1) break;
      const child = field.bubbles[slot];
      spawnInto(child, width, height, bubble.y);
      child.sizeNorm = bubble.sizeNorm * SPLIT_CHILD_SIZE_RATIO;
      const shortEdge = Math.min(width, height);
      child.radius =
        shortEdge * (BUBBLE_RADIUS_MIN_RATIO + (BUBBLE_RADIUS_MAX_RATIO - BUBBLE_RADIUS_MIN_RATIO) * child.sizeNorm);
      const angle = (Math.PI * 2 * i) / childCount + Math.random() * 0.6;
      const speed = shortEdge * SPLIT_SCATTER_SPEED;
      child.baseX = bubble.x + Math.cos(angle) * bubble.radius * 0.3;
      child.baseY = bubble.y + Math.sin(angle) * bubble.radius * 0.3;
      child.x = child.baseX;
      child.y = child.baseY;
      child.targetRadius = child.radius;
      child.growT = 1;
      child.pushVx = Math.cos(angle) * speed;
      child.pushVy = Math.sin(angle) * speed;
    }
  }

  bubble.state = "popping";
  bubble.popT = 0;
  applyPush(field, bubble.x, bubble.y, width, height);
  return result;
}

/** 外れたときに軽く周囲の泡を押す */
export function missPush(field: BubbleField, x: number, y: number, width: number, height: number): void {
  applyPush(field, x, y, width, height);
}

/** タップ位置の泡を探す（当たり判定は見た目より甘くする） */
export function hitTestPoint(field: BubbleField, x: number, y: number, slopPx: number): Bubble | null {
  let closest: Bubble | null = null;
  let closestDist = Infinity;
  for (const bubble of field.bubbles) {
    if (!bubble.active || bubble.state !== "rising") continue;
    const dist = Math.hypot(bubble.x - x, bubble.y - y);
    if (dist <= bubble.radius + slopPx && dist < closestDist) {
      closest = bubble;
      closestDist = dist;
    }
  }
  return closest;
}

/** なぞり用: 前フレーム位置→現在位置の線分が通過した泡を、通過順に返す */
export function hitTestSegment(field: BubbleField, x0: number, y0: number, x1: number, y1: number, slopPx: number): Bubble[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  const hits: Array<{ bubble: Bubble; t: number }> = [];

  for (const bubble of field.bubbles) {
    if (!bubble.active || bubble.state !== "rising") continue;
    const slop = bubble.radius + slopPx;
    let t = lengthSq <= 0.0001 ? 0 : ((bubble.x - x0) * dx + (bubble.y - y0) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = x0 + dx * t;
    const closestY = y0 + dy * t;
    const dist = Math.hypot(bubble.x - closestX, bubble.y - closestY);
    if (dist <= slop) hits.push({ bubble, t });
  }

  hits.sort((a, b) => a.t - b.t);
  return hits.map((h) => h.bubble);
}
