// ============================================================
// field.ts ─ 背景の色ブロブの時間関数
// 2D レンダラ（render/background2d.ts）と GL シェーダ（render/rich-gl.ts）が
// 同じ式を評価することで、standard / rich で背景の見え方を揃える。
// 正本は docs/architecture.md 7.1・7.2・8 節。
// ============================================================

import { BG_BLOB_COLORS, MUDDY_HUE_MAX, MUDDY_HUE_MIN } from "./tuning";

export interface BackgroundBlob {
  /** 0..1（画面幅・高さで正規化、正方形換算ではなく画面比そのまま） */
  x: number;
  y: number;
  /** 0..1（画面短辺に対する半径比） */
  radius: number;
  /** 0..1 の RGB */
  r: number;
  g: number;
  b: number;
}

const BLOB_COUNT = 4;

/** ブロブごとの漂う軌道パラメータ（周期・位相をずらして単調にならないようにする） */
const DRIFT = [
  { cx: 0.28, cy: 0.32, ax: 0.14, ay: 0.1, periodX: 47, periodY: 61, phase: 0 },
  { cx: 0.74, cy: 0.26, ax: 0.12, ay: 0.13, periodX: 53, periodY: 39, phase: 1.7 },
  { cx: 0.3, cy: 0.72, ax: 0.16, ay: 0.11, periodX: 66, periodY: 48, phase: 3.1 },
  { cx: 0.72, cy: 0.7, ax: 0.11, ay: 0.15, periodX: 41, periodY: 57, phase: 4.6 },
] as const;

const BASE_RADIUS = [0.62, 0.58, 0.66, 0.6] as const;

/**
 * 色相 15〜125°（橙〜黄緑）を避ける。暗い背景・低 alpha で泥色化するため
 * （docs/architecture.md 7.2）。帯の中に入っていたら近い方の境界の外へ逃がす。
 */
export function avoidMuddyHue(hueDeg: number): number {
  const wrapped = ((hueDeg % 360) + 360) % 360;
  if (wrapped < MUDDY_HUE_MIN || wrapped > MUDDY_HUE_MAX) return wrapped;
  const distanceToLow = wrapped - MUDDY_HUE_MIN;
  const distanceToHigh = MUDDY_HUE_MAX - wrapped;
  return distanceToLow < distanceToHigh ? MUDDY_HUE_MIN - 1 : MUDDY_HUE_MAX + 1;
}

function hexToRgb01(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hNorm = h / 360;
  return [hueToRgb(hNorm + 1 / 3), hueToRgb(hNorm), hueToRgb(hNorm - 1 / 3)];
}

const BASE_HSL = BG_BLOB_COLORS.map((hex) => rgbToHsl(...hexToRgb01(hex)));

/** プリズムストームの虹色が 1 往復する秒 */
const PRISM_HUE_CYCLE_S = 7;

/** 色相を泥色帯の上端から始まる連続区間 [MUDDY_HUE_MAX, MUDDY_HUE_MAX + 360) で表す（帯をまたがずに補間するため） */
function toAllowedArc(hueDeg: number): number {
  const wrapped = ((hueDeg % 360) + 360) % 360;
  return wrapped < MUDDY_HUE_MAX ? wrapped + 360 : wrapped;
}

/**
 * energy に応じてブロブを明るく・バイオレット/ライム寄りに色ずらしする。
 * prism（0..1、プリズムストームとその予告）では、泥色帯を除いた色相の範囲を往復する虹色へ寄せる
 * （帯をまたいで色が跳ばないよう、範囲の端で折り返す）。最終色相は avoidMuddyHue で泥色帯の外に保つ。
 */
function blobColor(index: number, energy: number, prism: number, timeSec: number): [number, number, number] {
  const [baseHue, baseSat, baseLight] = BASE_HSL[index];
  const hueShift = index % 2 === 0 ? 18 : -14; // 偶数はバイオレット寄り、奇数はライム寄りへ少し逃がす
  let hue = avoidMuddyHue(baseHue + hueShift * energy);
  if (prism > 0) {
    const arcStart = MUDDY_HUE_MAX;
    const arcLength = 360 - (MUDDY_HUE_MAX - MUDDY_HUE_MIN);
    const phase = timeSec / PRISM_HUE_CYCLE_S + index * 0.25;
    const rainbowHue = arcStart + arcLength * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    const from = toAllowedArc(hue);
    hue = avoidMuddyHue(from + (rainbowHue - from) * prism);
  }
  const sat = Math.min(1, baseSat + 0.22 * energy + 0.2 * prism);
  const light = Math.min(0.66, baseLight + 0.16 * energy + 0.08 * prism);
  return hslToRgb(hue, sat, light);
}

/** 現在時刻・energy・prism（プリズムストームの虹色 0..1）から 4 個の背景ブロブを計算する（2D・GL 共通） */
export function backgroundBlobs(timeSec: number, energy: number, prism = 0): BackgroundBlob[] {
  const blobs: BackgroundBlob[] = [];
  for (let i = 0; i < BLOB_COUNT; i++) {
    const d = DRIFT[i];
    const x = d.cx + d.ax * Math.sin((timeSec / d.periodX) * Math.PI * 2 + d.phase);
    const y = d.cy + d.ay * Math.cos((timeSec / d.periodY) * Math.PI * 2 + d.phase * 1.3);
    const [r, g, b] = blobColor(i, energy, prism, timeSec);
    blobs.push({ x, y, radius: BASE_RADIUS[i] + 0.04 * energy, r, g, b });
  }
  return blobs;
}
