// ============================================================
// render/background2d.ts ─ standard の背景（低解像度 2D canvas を CSS で拡大表示）
// field.ts の共通のブロブ関数を評価するだけ。rich-gl.ts と同じ式を使うことで
// standard / rich で背景の見え方を揃える。正本は docs/architecture.md 7.1・7.2 節。
// ============================================================

import { backgroundBlobs } from "../field";
import { PALETTE_BASE } from "../tuning";

/** width/height は低解像度 canvas 自身の px（呼び出し側が 1/4 スケールで確保している前提） */
export function drawBackground2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  energy: number,
  prism = 0,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = PALETTE_BASE;
  ctx.fillRect(0, 0, width, height);

  const shortEdge = Math.min(width, height);
  const blobs = backgroundBlobs(timeSec, energy, prism);

  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.8;
  for (const blob of blobs) {
    const cx = blob.x * width;
    const cy = blob.y * height;
    const radius = blob.radius * shortEdge;
    const r = Math.round(blob.r * 255);
    const g = Math.round(blob.g * 255);
    const b = Math.round(blob.b * 255);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
