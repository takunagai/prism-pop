// ============================================================
// render/creatures2d.ts ─ standard の浮遊生物（#creatures canvas、CSS px 等倍）
// 姿勢は creatures.ts が決める。ここでは回転・反転・脈動の変形で drawImage するだけ。
// 驚いたときの光は、不透明度の上乗せ + 同じ画像の加算合成で出す（rich-gl.ts と同じ式）。
// 正本は docs/architecture.md 7.5 節。
// ============================================================

import type { CreaturePose } from "../creatures";
import { CREATURE_GLOW_ADD, CREATURE_GLOW_OPACITY_BOOST, CREATURE_OPACITY } from "../tuning";

export function drawCreatures2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  poses: readonly CreaturePose[],
  images: readonly HTMLImageElement[],
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.imageSmoothingQuality = "medium";
  for (const pose of poses) {
    if (pose.visibility <= 0) continue;
    const image = images[pose.index];
    ctx.setTransform(1, 0, 0, 1, pose.centerX, pose.centerY);
    ctx.rotate(pose.rotation);
    // halfWidth が負のときは左右反転になる
    ctx.scale(pose.halfWidth, pose.halfHeight);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = Math.min(1, CREATURE_OPACITY * (1 + pose.glow * CREATURE_GLOW_OPACITY_BOOST));
    ctx.drawImage(image, -1, -1, 2, 2);
    if (pose.glow > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, pose.glow * CREATURE_GLOW_ADD);
      ctx.drawImage(image, -1, -1, 2, 2);
    }
  }
  ctx.restore();
}
