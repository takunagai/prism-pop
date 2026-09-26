// ============================================================
// main.ts ─ 入力・ゲーム状態・コンボ・描画ループ（p5 インスタンスモード）・品質切替の配線
// 音には createAudioEngine() が返す AudioEngine 契約越しにしか触らない。
// 正本は docs/architecture.md 3・4・8 節。
// ============================================================

import P5 from "p5";
import "./style.css";

import { createAudioEngine } from "./audio/engine";
import type { PopKind } from "./audio/engine";
import { anchorForSize, colorForDegree, noteForPop } from "./music";
import {
  createBubbleField,
  hitTestPoint,
  hitTestSegment,
  missPush,
  popBubble,
  updateBubbles,
} from "./bubbles";
import type { Bubble } from "./bubbles";
import {
  activeParticleCount,
  createEffectsState,
  drawEffects,
  setParticleCap,
  spawnMissRipple,
  spawnRing,
  spawnRipple,
  spawnSplash,
  updateEffects,
} from "./effects";
import {
  buildCreatureHitMasks,
  createCreatureField,
  hitTestCreatures,
  loadCreatureImages,
  startleCreature,
  updateCreatures,
} from "./creatures";
import type { CreatureHitMask } from "./creatures";
import { backgroundBlobs } from "./field";
import { QualityController } from "./quality";
import type { QualityTier } from "./quality";
import { drawBackground2D } from "./render/background2d";
import { buildBubbleSpriteAtlas, drawBubble2D } from "./render/bubbles2d";
import { drawCreatures2D } from "./render/creatures2d";
import { RichGLRenderer } from "./render/rich-gl";
import {
  COMBO_WINDOW_MS,
  ENERGY_DECAY_PER_S,
  ENERGY_PER_POP,
  GL_MAX_DEVICE_PIXEL_RATIO,
  GL_RENDER_SCALE_BASE,
  HIT_SLOP_PX_MOUSE,
  HIT_SLOP_PX_TOUCH,
  HOVER_HIGHLIGHT_RADIUS_SLOP_PX,
  LOW_RES_DIVISOR,
  MILESTONE_EVERY,
  PRISM_BURST_RADIUS_RATIO,
  PRISM_CHAIN_INTERVAL_MS,
  SHAKE_MILESTONE_AMPLITUDE_PX,
  SHAKE_MILESTONE_DURATION_MS,
  SPLASH_CAP_RICH,
  SPLASH_CAP_STANDARD_STEPS,
  SPLASH_PARTICLES_PER_SIZE,
} from "./tuning";

// p5 v2 の Friendly Error System は偽陽性で fps を殺すので必ず止める（インスタンス生成前）
P5.disableFriendlyErrors = true;

// ---- DOM ----
const stageEl = document.querySelector<HTMLDivElement>("#stage")!;
const bgCanvas = document.querySelector<HTMLCanvasElement>("#bg")!;
const creaturesCanvas = document.querySelector<HTMLCanvasElement>("#creatures")!;
const glCanvas = document.querySelector<HTMLCanvasElement>("#gl")!;
const p5HostEl = document.querySelector<HTMLDivElement>("#p5-host")!;
const glowCanvas = document.querySelector<HTMLCanvasElement>("#glow")!;
const gateEl = document.querySelector<HTMLDivElement>("#gate")!;
const debugOverlayEl = document.querySelector<HTMLPreElement>("#debug-overlay")!;

const searchParams = new URLSearchParams(location.search);
const isDebugMode = searchParams.has("debug");
if (isDebugMode) debugOverlayEl.hidden = false;

// ---- 音響・品質 ----
const audio = createAudioEngine();
const quality = new QualityController();

// ---- 画面サイズ ----
let width = window.innerWidth;
let height = window.innerHeight;
let devicePixelRatioClamped = Math.min(window.devicePixelRatio || 1, GL_MAX_DEVICE_PIXEL_RATIO);

// ---- シミュレーション状態 ----
const bubbleField = createBubbleField(width, height);
const effectsState = createEffectsState(SPLASH_CAP_RICH);
let spriteAtlas = buildBubbleSpriteAtlas(Math.min(width, height));
let spriteRebuildTimer = 0;
const SPRITE_REBUILD_DEBOUNCE_MS = 150;
const creatureField = createCreatureField();
/** 浮遊生物の画像。読み込み完了までは null（その間は描かない） */
let creatureImages: HTMLImageElement[] | null = null;
/** 浮遊生物の当たり判定マスク。読み込み完了までは null（その間は生き物に当たらない） */
let creatureHitMasks: CreatureHitMask[] | null = null;
void loadCreatureImages().then((images) => {
  creatureImages = images;
  if (images) creatureHitMasks = buildCreatureHitMasks(images);
});
let creaturesCtx: CanvasRenderingContext2D | null = null;
let richRenderer: RichGLRenderer | null = null;
let glowCtx: CanvasRenderingContext2D | null = null;

let currentTierForCap: QualityTier = quality.getTier();
let standardCapStepIndex = 0;
let capCheckAccumMs = 0;

function applyCapForTierChange(tier: QualityTier): void {
  if (tier === "rich") setParticleCap(effectsState, SPLASH_CAP_RICH);
  else setParticleCap(effectsState, SPLASH_CAP_STANDARD_STEPS[standardCapStepIndex]);
}
applyCapForTierChange(currentTierForCap);

// ---- ゲート・コンボ・energy ----
let hasStarted = false;
let comboCount = 0;
let comboAnchorIndex = 0;
let lastPopTimeMs = -Infinity;
let energy = 0;
let shakeStartMs = -Infinity;
let lastPopX = width / 2;
let lastPopY = height / 2;
let lastError = "";
/** 直近フレームの getAmp()。検証・診断用に保持する（再取得しない） */
let lastAmp = 0;
/** 種類別の累計 pop 数（検証・診断用） */
const popTotals: Record<PopKind, number> = { tap: 0, swipe: 0, chain: 0 };
/** 生き物を驚かせた累計回数（検証・診断用） */
let creatureStartleCount = 0;

let hoverX: number | null = null;
let hoverY: number | null = null;

interface PointerState {
  x: number;
  y: number;
  isDown: boolean;
}
const pointers = new Map<number, PointerState>();

interface ChainEntry {
  bubbleId: number;
  fireAtMs: number;
}
let chainQueue: ChainEntry[] = [];

// ---- デバッグ計測 ----
const HISTORY_LENGTH = 90;
const frameIntervalHistory: number[] = [];
const drawTimeHistory: number[] = [];
let debugFrameCounter = 0;

function pushHistory(history: number[], value: number): void {
  history.push(value);
  if (history.length > HISTORY_LENGTH) history.shift();
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

interface DebugSnapshot {
  fps: number;
  drawMsAvg: number;
  tier: QualityTier;
  particleCount: number;
  bubbleCount: number;
  isSecureContext: boolean;
  lastError: string;
  amp: number;
  [key: string]: string | number | boolean;
}

function collectDebugInfo(): DebugSnapshot {
  const avgInterval = average(frameIntervalHistory);
  const fps = avgInterval > 0 ? 1000 / avgInterval : 0;
  let bubbleCount = 0;
  for (const bubble of bubbleField.bubbles) if (bubble.active) bubbleCount++;

  return {
    fps: Math.round(fps * 10) / 10,
    drawMsAvg: Math.round(average(drawTimeHistory) * 100) / 100,
    tier: quality.getTier(),
    particleCount: activeParticleCount(effectsState),
    bubbleCount,
    isSecureContext: window.isSecureContext,
    lastError,
    amp: Math.round(lastAmp * 1000) / 1000,
    popsTap: popTotals.tap,
    popsSwipe: popTotals.swipe,
    popsChain: popTotals.chain,
    creatureStartles: creatureStartleCount,
    combo: comboCount,
    ...audio.getDiagnostics(),
  };
}

function renderDebugOverlay(): void {
  const snapshot = collectDebugInfo();
  const lines = Object.entries(snapshot).map(([key, value]) => `${key}: ${value}`);
  debugOverlayEl.textContent = lines.join("\n");
}

declare global {
  interface Window {
    __prismDebug?: () => DebugSnapshot;
  }
}
window.__prismDebug = () => collectDebugInfo();

// 開発ビルドのみ: E2E 検証で泡の位置を狙って本物のポインタ・タッチを送るためのハンドル
if (import.meta.env.DEV) {
  (window as unknown as { __prismBubbles: () => Array<{ x: number; y: number; radius: number }> }).__prismBubbles =
    () =>
      bubbleField.bubbles
        .filter((bubble) => bubble.active && bubble.state === "rising")
        .map((bubble) => ({ x: bubble.x, y: bubble.y, radius: bubble.radius }));
  // 生き物の体の上で、泡に重なっていない画面内の点（無ければ null）。姿勢の状態も返す
  (window as unknown as { __prismCreatureTarget: (name: string) => unknown }).__prismCreatureTarget = (name) => {
    const creature = creatureField.creatures.find((candidate) => candidate.spec.name === name);
    if (!creature || !creatureHitMasks) return null;
    const pose = creatureField.poses[creature.index];
    const state = { isHidden: creature.isHidden, isFleeing: creature.isFleeing, glow: pose.glow, halfWidth: pose.halfWidth };
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = pose.centerX + (Math.random() * 2 - 1) * Math.abs(pose.halfWidth);
      const y = pose.centerY + (Math.random() * 2 - 1) * Math.abs(pose.halfHeight);
      if (x < 8 || y < 8 || x > width - 8 || y > height - 8) continue;
      if (hitTestPoint(bubbleField, x, y, HIT_SLOP_PX_TOUCH * 2)) continue;
      // 取得からクリックまでの間に動いても外れないよう、上下左右 12px も同じ生き物に当たる内側の点を選ぶ
      const isInside = [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(
        ([offsetX, offsetY]) => hitTestCreatures(creatureField, creatureHitMasks!, x + offsetX, y + offsetY) === creature,
      );
      if (isInside) return { x, y, ...state };
    }
    return { x: null, y: null, ...state };
  };
}

// ---- 2D レイヤーのサイズ（#bg / #glow は低解像度、#creatures は CSS px 等倍） ----
function resizeLayerCanvases(): void {
  const lowWidth = Math.max(1, Math.ceil(width / LOW_RES_DIVISOR));
  const lowHeight = Math.max(1, Math.ceil(height / LOW_RES_DIVISOR));
  bgCanvas.width = lowWidth;
  bgCanvas.height = lowHeight;
  glowCanvas.width = lowWidth;
  glowCanvas.height = lowHeight;
  creaturesCanvas.width = width;
  creaturesCanvas.height = height;
}
resizeLayerCanvases();

function handleResize(p: P5): void {
  width = window.innerWidth;
  height = window.innerHeight;
  devicePixelRatioClamped = Math.min(window.devicePixelRatio || 1, GL_MAX_DEVICE_PIXEL_RATIO);
  p.resizeCanvas(width, height);
  p.pixelDensity(1);
  resizeLayerCanvases();
  // スプライトの焼き直しは画素単位で数十 ms かかるので、リサイズが落ち着いてから 1 回だけ行う
  window.clearTimeout(spriteRebuildTimer);
  spriteRebuildTimer = window.setTimeout(() => {
    spriteAtlas = buildBubbleSpriteAtlas(Math.min(width, height));
  }, SPRITE_REBUILD_DEBOUNCE_MS);
  if (richRenderer) richRenderer.resize(width, height, GL_RENDER_SCALE_BASE * devicePixelRatioClamped);
}

// ---- 入力 ----
function hitSlopFor(pointerType: string): number {
  return pointerType === "mouse" ? HIT_SLOP_PX_MOUSE : HIT_SLOP_PX_TOUCH;
}

function tryPopAt(x: number, y: number, kind: PopKind, slopPx: number): void {
  const bubble = hitTestPoint(bubbleField, x, y, slopPx);
  if (bubble) {
    doPop(bubble, kind);
    return;
  }
  // 泡が無い場所で生き物の体に触れたら驚かせる（クールダウン中の再タップも空振りにしない）
  const creature = creatureHitMasks ? hitTestCreatures(creatureField, creatureHitMasks, x, y) : null;
  if (creature) {
    if (startleCreature(creatureField, creature, x, y, width, height, performance.now() / 1000)) {
      creatureStartleCount++;
      spawnMissRipple(effectsState, x, y, Math.min(width, height) * 0.08);
      audio.creature({ species: creature.spec.name, x: x / width, y: y / height });
    }
    return;
  }
  missPush(bubbleField, x, y, width, height);
  spawnMissRipple(effectsState, x, y, Math.min(width, height) * 0.12);
  audio.miss(x / width, y / height);
}

function doPop(bubble: Bubble, kind: PopKind): void {
  const nowMs = performance.now();
  const result = popBubble(bubbleField, bubble.id, width, height);
  if (!result) return;
  popTotals[kind]++;

  const isNewCombo = comboCount === 0 || nowMs - lastPopTimeMs > COMBO_WINDOW_MS;
  if (isNewCombo) {
    comboCount = 1;
    comboAnchorIndex = anchorForSize(result.sizeNorm);
  } else {
    comboCount += 1;
  }
  lastPopTimeMs = nowMs;
  lastPopX = result.x;
  lastPopY = result.y;

  const note = noteForPop(result.sizeNorm, comboCount, comboAnchorIndex);
  const color = colorForDegree(note.degree);

  energy = Math.min(1, energy + ENERGY_PER_POP);

  audio.pop({
    x: result.x / width,
    y: result.y / height,
    midi: note.midi,
    size: result.sizeNorm,
    combo: comboCount,
    kind,
  });

  const particleCount = Math.round(SPLASH_PARTICLES_PER_SIZE * (0.4 + 0.6 * result.sizeNorm));
  const speedScale = kind === "swipe" ? 0.8 : 1;
  spawnSplash(effectsState, result.x, result.y, color, particleCount, speedScale);
  spawnRing(effectsState, result.x, result.y, color, result.radius * 3.2, kind === "chain");
  spawnRipple(effectsState, result.x, result.y, color, result.radius * 2, 0.45);

  if (comboCount % MILESTONE_EVERY === 0) {
    triggerPrismBurst(result.x, result.y, comboCount / MILESTONE_EVERY, nowMs);
  }
}

function triggerPrismBurst(originX: number, originY: number, level: number, nowMs: number): void {
  audio.comboMilestone(level, originX / width, originY / height);
  shakeStartMs = nowMs;

  const diagonal = Math.hypot(width, height);
  const maxRadius = diagonal * PRISM_BURST_RADIUS_RATIO;
  spawnRing(effectsState, originX, originY, "#ffffff", maxRadius, true, PRISM_BURST_RADIUS_RATIO * 1200);
  spawnRipple(effectsState, originX, originY, "#ffffff", maxRadius * 0.45, 0.5);

  const candidates: Array<{ id: number; dist: number }> = [];
  for (const candidate of bubbleField.bubbles) {
    if (!candidate.active || candidate.state !== "rising") continue;
    const dist = Math.hypot(candidate.x - originX, candidate.y - originY);
    if (dist <= maxRadius) candidates.push({ id: candidate.id, dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  candidates.forEach((candidate, index) => {
    chainQueue.push({ bubbleId: candidate.id, fireAtMs: nowMs + (index + 1) * PRISM_CHAIN_INTERVAL_MS });
  });
}

function processChainQueue(nowMs: number): void {
  if (chainQueue.length === 0) return;
  const remaining: ChainEntry[] = [];
  for (const entry of chainQueue) {
    if (nowMs >= entry.fireAtMs) {
      const bubble = bubbleField.bubbles[entry.bubbleId];
      if (bubble.active && bubble.state === "rising") doPop(bubble, "chain");
    } else {
      remaining.push(entry);
    }
  }
  chainQueue = remaining;
}

function computeShake(nowMs: number): { x: number; y: number } | null {
  const elapsed = nowMs - shakeStartMs;
  if (elapsed < 0 || elapsed > SHAKE_MILESTONE_DURATION_MS) return null;
  const decay = 1 - elapsed / SHAKE_MILESTONE_DURATION_MS;
  const angle = nowMs * 0.05;
  return {
    x: Math.sin(angle * 2.3) * SHAKE_MILESTONE_AMPLITUDE_PX * decay,
    y: Math.cos(angle * 1.7) * SHAKE_MILESTONE_AMPLITUDE_PX * decay,
  };
}

function drawGlow(amp: number): void {
  if (!glowCtx) glowCtx = glowCanvas.getContext("2d");
  const ctx = glowCtx;
  if (!ctx) return;
  const w = glowCanvas.width;
  const h = glowCanvas.height;
  const scaleX = w / width;
  const scaleY = h / height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";

  const pulseRadius = Math.min(w, h) * (0.35 + 0.4 * amp);
  const px = lastPopX * scaleX;
  const py = lastPopY * scaleY;
  const pulse = ctx.createRadialGradient(px, py, 0, px, py, pulseRadius);
  pulse.addColorStop(0, `rgba(198, 255, 0, ${(0.08 + 0.22 * amp).toFixed(3)})`);
  pulse.addColorStop(1, "rgba(198, 255, 0, 0)");
  ctx.fillStyle = pulse;
  ctx.fillRect(0, 0, w, h);

  for (const ring of effectsState.rings) {
    const t = ring.ageMs / ring.lifeMs;
    const alpha = (1 - t) * 0.5;
    if (alpha <= 0.01) continue;
    const radius = Math.max(3, ring.maxRadius * 0.16 * scaleX);
    const rx = ring.x * scaleX;
    const ry = ring.y * scaleY;
    const gradient = ctx.createRadialGradient(rx, ry, 0, rx, ry, radius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ---- p5 インスタンス ----
new P5((p: P5) => {
  p.setup = () => {
    const canvas = p.createCanvas(width, height);
    canvas.parent(p5HostEl);
    // p5 v2 の既知の制約: pixelDensity は createCanvas の後に呼ぶ
    p.pixelDensity(1);
    if (canvas.elt.width !== width) {
      // eslint-disable-next-line no-console
      console.warn("[prism-pop] pixelDensity(1) 後も canvas.width が CSS px と一致していません", canvas.elt.width, width);
    }

    window.addEventListener("resize", () => handleResize(p), { passive: true });
    window.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener(
      "pointerdown",
      (e: PointerEvent) => {
        if (!hasStarted) {
          hasStarted = true;
          gateEl.classList.add("is-hidden");
          // resume() の解決を待たない。音の成否に関わらず描画は続ける
          audio.start().catch((error: unknown) => {
            lastError = error instanceof Error ? error.message : String(error);
          });
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, isDown: true });
        if (e.pointerType === "mouse") {
          hoverX = e.clientX;
          hoverY = e.clientY;
        }
        tryPopAt(e.clientX, e.clientY, "tap", hitSlopFor(e.pointerType));
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (e: PointerEvent) => {
        if (e.pointerType === "mouse") {
          hoverX = e.clientX;
          hoverY = e.clientY;
        }
        const state = pointers.get(e.pointerId);
        if (!state) return;
        if (state.isDown) {
          const slop = hitSlopFor(e.pointerType);
          const hits = hitTestSegment(bubbleField, state.x, state.y, e.clientX, e.clientY, slop);
          for (const bubble of hits) doPop(bubble, "swipe");
        }
        state.x = e.clientX;
        state.y = e.clientY;
      },
      { passive: true },
    );

    const releasePointer = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
    };
    window.addEventListener("pointerup", releasePointer, { passive: true });
    window.addEventListener("pointercancel", releasePointer, { passive: true });
  };

  p.draw = () => {
    const drawStartMs = performance.now();
    const dtMs = Math.min(p.deltaTime || 16.7, 100);
    const nowMs = performance.now();
    pushHistory(frameIntervalHistory, dtMs);

    quality.recordFrame(dtMs);
    let tier = quality.getTier();

    if (tier === "rich" && !richRenderer) {
      richRenderer = new RichGLRenderer(glCanvas);
      if (!richRenderer.isAvailable) {
        quality.forceStandardFallback();
        tier = quality.getTier();
      } else {
        richRenderer.resize(width, height, GL_RENDER_SCALE_BASE * devicePixelRatioClamped);
      }
    }
    if (tier === "rich" && richRenderer && richRenderer.hasContextLoss) {
      quality.forceStandardFallback();
      tier = quality.getTier();
    }

    if (currentTierForCap !== tier) {
      currentTierForCap = tier;
      applyCapForTierChange(tier);
    }
    if (tier === "standard") {
      capCheckAccumMs += dtMs;
      if (capCheckAccumMs >= 2000) {
        capCheckAccumMs = 0;
        const avgDt = average(frameIntervalHistory);
        if (avgDt > 20 && standardCapStepIndex < SPLASH_CAP_STANDARD_STEPS.length - 1) {
          standardCapStepIndex++;
          setParticleCap(effectsState, SPLASH_CAP_STANDARD_STEPS[standardCapStepIndex]);
        }
      }
    }

    const richActive = tier === "rich" && richRenderer !== null && richRenderer.isAvailable && !richRenderer.hasContextLoss;
    glCanvas.style.display = richActive ? "block" : "none";
    creaturesCanvas.style.display = richActive ? "none" : "block";
    if (richActive && richRenderer && creatureImages && !richRenderer.hasCreatures) richRenderer.setCreatureImages(creatureImages);

    energy = Math.max(0, energy - ENERGY_DECAY_PER_S * (dtMs / 1000));
    audio.setEnergy(energy);

    updateBubbles(bubbleField, dtMs, nowMs, width, height);
    processChainQueue(nowMs);

    if (comboCount > 0 && nowMs - lastPopTimeMs > COMBO_WINDOW_MS) {
      audio.comboEnd(comboCount);
      comboCount = 0;
    }

    updateEffects(effectsState, dtMs);
    const amp = audio.getAmp(); // 1 フレーム 1 回だけ呼ぶ
    lastAmp = amp;

    const shake = computeShake(nowMs);
    stageEl.style.transform = shake ? `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px)` : "";

    const timeSec = nowMs / 1000;
    const blobs = backgroundBlobs(timeSec, energy);
    updateCreatures(creatureField, dtMs, timeSec, width, height);

    if (richActive && richRenderer) {
      richRenderer.render({
        bubbles: bubbleField.bubbles,
        creaturePoses: creatureField.poses,
        blobs,
        timeSec,
        amp,
        cssWidth: width,
        cssHeight: height,
        renderScale: GL_RENDER_SCALE_BASE * devicePixelRatioClamped,
      });
    } else {
      const bgCtx = bgCanvas.getContext("2d");
      if (bgCtx) drawBackground2D(bgCtx, bgCanvas.width, bgCanvas.height, timeSec, energy);
      if (!creaturesCtx) creaturesCtx = creaturesCanvas.getContext("2d");
      if (creaturesCtx && creatureImages) drawCreatures2D(creaturesCtx, width, height, creatureField.poses, creatureImages);
    }

    const ctx = p.drawingContext;
    ctx.clearRect(0, 0, p.width, p.height);

    if (!richActive) {
      const hoverBubble = hoverX !== null && hoverY !== null ? hitTestPoint(bubbleField, hoverX, hoverY, HOVER_HIGHLIGHT_RADIUS_SLOP_PX) : null;
      for (const bubble of bubbleField.bubbles) {
        if (!bubble.active) continue;
        drawBubble2D(ctx, bubble, spriteAtlas, timeSec, hoverBubble !== null && hoverBubble.id === bubble.id, amp);
      }
    }

    drawEffects(ctx, effectsState);
    drawGlow(amp);

    const drawMs = performance.now() - drawStartMs;
    pushHistory(drawTimeHistory, drawMs);

    if (isDebugMode) {
      debugFrameCounter++;
      if (debugFrameCounter % 6 === 0) renderDebugOverlay();
    }
  };
});
