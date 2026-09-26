// ============================================================
// creatures.ts ─ 浮遊生物（背景を漂う半透明の海の生き物）の動き・驚きの反応・当たり判定と画像の読み込み
// 状態は描画非依存（standard の creatures2d.ts と rich の rich-gl.ts が同じ姿勢を描く）。
// 泡に当たらなかったタップだけが生き物に届く（泡が優先）。正本は docs/architecture.md 7.5 節。
// ============================================================

import type { CreatureSpecies } from "./audio/engine";
import {
  CREATURE_BASE_ASPECT,
  CREATURE_FLEE_RETURN_MAX_S,
  CREATURE_FLEE_RETURN_MIN_S,
  CREATURE_GLIDE_SPEED_MAX,
  CREATURE_GLIDE_SPEED_MIN,
  CREATURE_HIT_ALPHA_RATIO,
  CREATURE_HIT_MASK_SIZE,
  CREATURE_PORTRAIT_SCALE,
  CREATURE_RISE_SPEED_MAX,
  CREATURE_RISE_SPEED_MIN,
  CREATURE_SQUASH_DAMPING,
  CREATURE_SQUASH_HZ,
  CREATURE_STARTLE_COOLDOWN_S,
  CREATURE_TURN_S,
} from "./tuning";

/** rise: 上へ昇る / glide: 頭の向きへ横に進む / drift: 斜めに漂いながら回転する */
type MotionKind = "rise" | "glide" | "drift";

/** 驚いたときの初速の向き。away: 触れた位置から離れる / forward: 今の進行方向 / up: 上 / reverse: 向きを反転して逆方向 */
type StartleBurst = "away" | "forward" | "up" | "reverse";

/** 驚いたときの反応（7.5.1） */
export interface StartleSpec {
  /** stay: 加速のあと元の泳ぎに戻る / flee: 逃走速度を保って画面外へ逃げ去る */
  readonly escape: "stay" | "flee";
  readonly burst: StartleBurst;
  /** 初速（画面短辺比 / 秒）と、その減衰の時定数秒 */
  readonly burstSpeed: number;
  readonly burstTauS: number;
  /** flee のとき保つ逃走速度（画面短辺比 / 秒） */
  readonly fleeSpeed: number;
  /** 最初に縮む割合（0.2 = 2 割縮んでから膨らみ返す） */
  readonly squash: number;
  /** 羽ばたき・拍動の上乗せ（横幅・縦幅の振幅、周波数 Hz、続く秒） */
  readonly flapX: number;
  readonly flapY: number;
  readonly flapHz: number;
  readonly flapS: number;
  /** 震え・揺れ（回転の振幅ラジアン、周波数 Hz、減衰の時定数秒） */
  readonly shakeAmplitude: number;
  readonly shakeHz: number;
  readonly shakeTauS: number;
  /** drift の回転に上乗せする角速度（ラジアン / 秒。時定数 1 秒で減衰） */
  readonly spinBoost: number;
  /** 光の強さ（0..1）と減衰の時定数秒 */
  readonly glow: number;
  readonly glowTauS: number;
}

export interface CreatureSpec {
  readonly name: CreatureSpecies;
  readonly src: string;
  /** 画像 1 辺 = 基準長 × この比率 */
  readonly sizeRatio: number;
  readonly motion: MotionKind;
  /** glide のとき、画像の頭が向いている水平方向（1 = 右, -1 = 左） */
  readonly facing: 1 | -1;
  /** 横幅・縦幅の脈動（拍動・羽ばたき）の振幅と周期 */
  readonly pulseX: number;
  readonly pulseY: number;
  readonly pulsePeriodS: number;
  /** 傾きの揺れ幅（ラジアン） */
  readonly tiltAmplitude: number;
  readonly startle: StartleSpec;
}

export const CREATURE_SPECS: readonly CreatureSpec[] = [
  {
    name: "ray", src: "creatures/ray.webp", sizeRatio: 0.4, motion: "glide", facing: 1, pulseX: 0.03, pulseY: 0.05, pulsePeriodS: 5.5, tiltAmplitude: 0.12,
    // 翼を大きく羽ばたかせて進行方向へダッシュし、そのまま逃げ去る
    startle: { escape: "flee", burst: "forward", burstSpeed: 0.45, burstTauS: 0.5, fleeSpeed: 0.26, squash: 0.1, flapX: 0.04, flapY: 0.22, flapHz: 2.2, flapS: 1.6, shakeAmplitude: 0.12, shakeHz: 2.2, shakeTauS: 0.8, spinBoost: 0, glow: 0.6, glowTauS: 0.4 },
  },
  {
    name: "clione", src: "creatures/clione.webp", sizeRatio: 0.2, motion: "rise", facing: 1, pulseX: 0.07, pulseY: 0.015, pulsePeriodS: 1.3, tiltAmplitude: 0.08,
    // 翼を高速でパタパタさせ、くるっと揺れながら上へ跳ぶ
    startle: { escape: "stay", burst: "up", burstSpeed: 0.28, burstTauS: 0.6, fleeSpeed: 0, squash: 0.12, flapX: 0.3, flapY: 0.03, flapHz: 7, flapS: 1.2, shakeAmplitude: 0.45, shakeHz: 2.5, shakeTauS: 0.5, spinBoost: 0, glow: 0.8, glowTauS: 0.45 },
  },
  {
    name: "ctenophore", src: "creatures/ctenophore.webp", sizeRatio: 0.35, motion: "rise", facing: 1, pulseX: 0.02, pulseY: 0.02, pulsePeriodS: 4.2, tiltAmplitude: 0.1,
    // 大きく縮みながら強く光り、触れた位置から離れる
    startle: { escape: "stay", burst: "away", burstSpeed: 0.14, burstTauS: 0.9, fleeSpeed: 0, squash: 0.24, flapX: 0.03, flapY: 0.03, flapHz: 6, flapS: 0.6, shakeAmplitude: 0.05, shakeHz: 11, shakeTauS: 0.3, spinBoost: 0, glow: 1, glowTauS: 0.7 },
  },
  {
    name: "octopus", src: "creatures/octopus.webp", sizeRatio: 0.4, motion: "drift", facing: 1, pulseX: 0.035, pulseY: 0.035, pulsePeriodS: 6.5, tiltAmplitude: 0,
    // ギュッと縮み、触れた位置と逆方向へ噴射して回転を速めながら逃げ去る
    startle: { escape: "flee", burst: "away", burstSpeed: 0.6, burstTauS: 0.35, fleeSpeed: 0.26, squash: 0.3, flapX: 0.08, flapY: 0.08, flapHz: 3, flapS: 0.8, shakeAmplitude: 0, shakeHz: 1, shakeTauS: 1, spinBoost: 3, glow: 0.5, glowTauS: 0.4 },
  },
  {
    name: "seadragon", src: "creatures/seadragon.webp", sizeRatio: 0.35, motion: "glide", facing: -1, pulseX: 0.015, pulseY: 0.02, pulsePeriodS: 4.8, tiltAmplitude: 0.07,
    // 小刻みに震え、くるりと向きを反転して逆方向へ泳ぐ
    startle: { escape: "stay", burst: "reverse", burstSpeed: 0.16, burstTauS: 0.9, fleeSpeed: 0, squash: 0.06, flapX: 0.02, flapY: 0.03, flapHz: 5, flapS: 0.5, shakeAmplitude: 0.09, shakeHz: 15, shakeTauS: 0.35, spinBoost: 0, glow: 0.5, glowTauS: 0.4 },
  },
  {
    name: "jellyfish", src: "creatures/jellyfish.webp", sizeRatio: 0.35, motion: "rise", facing: 1, pulseX: 0.05, pulseY: -0.04, pulsePeriodS: 3.2, tiltAmplitude: 0.06,
    // 傘を 3 回ほど強く拍動させて上へ跳ねる
    startle: { escape: "stay", burst: "up", burstSpeed: 0.22, burstTauS: 1, fleeSpeed: 0, squash: 0.14, flapX: 0.16, flapY: -0.14, flapHz: 2.3, flapS: 1.3, shakeAmplitude: 0.06, shakeHz: 2.3, shakeTauS: 0.8, spinBoost: 0, glow: 0.7, glowTauS: 0.5 },
  },
];

/** 驚きの表現（縮み・羽ばたき・震え・光）を計算する最長の秒。これを過ぎたら計算しない */
const STARTLE_ACTIVE_S = 3;
/** 上乗せした回転の減衰の時定数秒 */
const SPIN_BOOST_TAU_S = 1;
/** 反転の途中で横幅が 0 にならないようにする下限（描画と当たり判定の 0 除算を避ける） */
const MIN_FLIP_SCALE = 0.03;
/** 集まる輪: 持ち場へ寄る速さ（1/秒）・最高速度（画面短辺比 / 秒）・速度の追従の速さ（1/秒）・輪の回る速さ（ラジアン / 秒） */
const GATHER_RATE = 1.2;
const GATHER_MAX_SPEED = 0.35;
const GATHER_FOLLOW = 2.5;
const GATHER_ORBIT_SPEED = 0.12;

export interface Creature {
  readonly spec: CreatureSpec;
  readonly index: number;
  /** 中心位置（画面比 0..1） */
  x: number;
  y: number;
  /** 速度（画面比 / 秒） */
  vx: number;
  vy: number;
  /** 画像を左右反転して描くか */
  isFlipped: boolean;
  phase: number;
  /** drift の回転角（ラジアン） */
  spin: number;
  spinSpeed: number;
  /** 驚いた時刻（秒）。驚いていなければ -Infinity */
  startleAtS: number;
  /** 驚いたときの上乗せ速度（画面比 / 秒）。burstTauS で減衰する */
  boostVx: number;
  boostVy: number;
  /** drift の回転に上乗せする角速度 */
  spinBoost: number;
  /** 向きを反転し始めた時刻（秒） */
  turnAtS: number;
  /** 逃げ去っている途中か（画面外に出たら姿を消す） */
  isFleeing: boolean;
  /** 逃げ去って姿を消しているか。hiddenUntilS を過ぎたら再登場する */
  isHidden: boolean;
  hiddenUntilS: number;
}

/** 描画側が使う 1 体分の姿勢（CSS px） */
export interface CreaturePose {
  index: number;
  centerX: number;
  centerY: number;
  /** 画像の半辺（脈動込み）。isFlipped のとき halfWidth は負 */
  halfWidth: number;
  halfHeight: number;
  rotation: number;
  /** 驚いたときの光（0..1） */
  glow: number;
  /** 0 = 姿を消している（描かない・当たらない）/ 1 = 表示 */
  visibility: number;
}

/** プリズムストーム中に生き物が集まる輪（CSS px） */
export interface CreatureGather {
  centerX: number;
  centerY: number;
  radiusPx: number;
}

export interface CreatureField {
  creatures: Creature[];
  poses: CreaturePose[];
  /** 集まる輪。null なら通常の泳ぎ */
  gather: CreatureGather | null;
  /** 光の下限 0..1（プリズムストーム中に全員を光らせる） */
  glowFloor: number;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function creatureBaseLength(width: number, height: number): number {
  const baseLength = Math.min(width, height * CREATURE_BASE_ASPECT);
  return width < height ? baseLength * CREATURE_PORTRAIT_SCALE : baseLength;
}

/** 画面外の余白（画面比）。画像の半辺ぶん外に出てから再登場させる */
function marginFor(spec: CreatureSpec, width: number, height: number): { mx: number; my: number } {
  const half = (creatureBaseLength(width, height) * spec.sizeRatio) / 2;
  return { mx: half / width, my: half / height };
}

function assignVelocity(creature: Creature): void {
  const spec = creature.spec;
  if (spec.motion === "rise") {
    creature.vx = randomRange(-0.004, 0.004);
    creature.vy = -randomRange(CREATURE_RISE_SPEED_MIN, CREATURE_RISE_SPEED_MAX);
    creature.isFlipped = Math.random() < 0.5;
  } else if (spec.motion === "glide") {
    const direction = Math.random() < 0.5 ? 1 : -1;
    creature.vx = direction * randomRange(CREATURE_GLIDE_SPEED_MIN, CREATURE_GLIDE_SPEED_MAX);
    creature.vy = randomRange(-0.004, 0.004);
    creature.isFlipped = direction !== spec.facing;
  } else {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(CREATURE_RISE_SPEED_MIN, CREATURE_RISE_SPEED_MAX) * 0.7;
    creature.vx = Math.cos(angle) * speed;
    creature.vy = Math.sin(angle) * speed;
    creature.isFlipped = Math.random() < 0.5;
    creature.spinSpeed = randomRange(0.04, 0.08) * (Math.random() < 0.5 ? 1 : -1);
  }
}

function clearStartle(creature: Creature): void {
  creature.startleAtS = -Infinity;
  creature.boostVx = 0;
  creature.boostVy = 0;
  creature.spinBoost = 0;
  creature.turnAtS = -Infinity;
  creature.isFleeing = false;
}

/** 進行方向の反対側の画面外へ置き直す */
function respawn(creature: Creature, width: number, height: number): void {
  clearStartle(creature);
  assignVelocity(creature);
  const { mx, my } = marginFor(creature.spec, width, height);
  const isHorizontal = Math.abs(creature.vx) > Math.abs(creature.vy);
  if (isHorizontal) {
    creature.x = creature.vx > 0 ? -mx : 1 + mx;
    creature.y = randomRange(0.1, 0.9);
  } else {
    creature.x = randomRange(0.1, 0.9);
    creature.y = creature.vy > 0 ? -my : 1 + my;
  }
}

export function createCreatureField(): CreatureField {
  const count = CREATURE_SPECS.length;
  // 初期配置は横方向に散らし、全員が画面内にいる状態から始める（起動直後に空の画面を見せない）
  const slots = CREATURE_SPECS.map((_, i) => (i + 0.5) / count).sort(() => Math.random() - 0.5);
  const creatures = CREATURE_SPECS.map((spec, index): Creature => {
    const creature: Creature = {
      spec,
      index,
      x: slots[index],
      y: randomRange(0.15, 0.85),
      vx: 0,
      vy: 0,
      isFlipped: false,
      phase: Math.random() * Math.PI * 2,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: 0,
      startleAtS: -Infinity,
      boostVx: 0,
      boostVy: 0,
      spinBoost: 0,
      turnAtS: -Infinity,
      isFleeing: false,
      isHidden: false,
      hiddenUntilS: 0,
    };
    assignVelocity(creature);
    return creature;
  });
  return {
    creatures,
    poses: creatures.map((c) => ({ index: c.index, centerX: 0, centerY: 0, halfWidth: 0, halfHeight: 0, rotation: 0, glow: 0, visibility: 1 })),
    gather: null,
    glowFloor: 0,
  };
}

/** 逃げ去って姿を消している生き物を画面外から呼び戻し、逃走も解く（プリズムストームの開始時） */
export function summonCreatures(field: CreatureField, width: number, height: number): void {
  for (const creature of field.creatures) {
    if (creature.isHidden) {
      creature.isHidden = false;
      respawn(creature, width, height);
    }
    creature.isFleeing = false;
  }
}

export function updateCreatures(field: CreatureField, dtMs: number, timeSec: number, width: number, height: number): void {
  const dt = dtMs / 1000;
  const baseLength = creatureBaseLength(width, height);

  for (const creature of field.creatures) {
    const spec = creature.spec;
    const pose = field.poses[creature.index];

    if (creature.isHidden) {
      if (timeSec < creature.hiddenUntilS) {
        pose.visibility = 0;
        continue;
      }
      creature.isHidden = false;
      respawn(creature, width, height);
    }

    creature.x += (creature.vx + creature.boostVx) * dt;
    creature.y += (creature.vy + creature.boostVy) * dt;
    const boostDecay = Math.exp(-dt / spec.startle.burstTauS);
    creature.boostVx *= boostDecay;
    creature.boostVy *= boostDecay;
    creature.spinBoost *= Math.exp(-dt / SPIN_BOOST_TAU_S);
    creature.spin += (creature.spinSpeed + creature.spinBoost) * dt;

    // 集まる輪: 輪の上の持ち場（ゆっくり回る）へ向かう速度になるよう、上乗せ速度をなめらかに寄せる
    const gather = field.gather;
    if (gather) {
      const angle = (creature.index / field.creatures.length) * Math.PI * 2 + timeSec * GATHER_ORBIT_SPEED;
      const toX = (gather.centerX + Math.cos(angle) * gather.radiusPx) / width - creature.x;
      const toY = (gather.centerY + Math.sin(angle) * gather.radiusPx) / height - creature.y;
      let desiredVx = toX * GATHER_RATE;
      let desiredVy = toY * GATHER_RATE;
      // 画面外から戻るときに速すぎないよう、px/秒で頭打ちにする
      const maxSpeedPx = Math.min(width, height) * GATHER_MAX_SPEED;
      const speedPx = Math.hypot(desiredVx * width, desiredVy * height);
      if (speedPx > maxSpeedPx) {
        desiredVx *= maxSpeedPx / speedPx;
        desiredVy *= maxSpeedPx / speedPx;
      }
      const follow = 1 - Math.exp(-dt * GATHER_FOLLOW);
      creature.boostVx += (desiredVx - creature.vx - creature.boostVx) * follow;
      creature.boostVy += (desiredVy - creature.vy - creature.boostVy) * follow;
    }

    const { mx, my } = marginFor(spec, width, height);
    const isOutside = creature.x < -mx - 0.01 || creature.x > 1 + mx + 0.01 || creature.y < -my - 0.01 || creature.y > 1 + my + 0.01;
    if (isOutside) {
      if (creature.isFleeing) {
        // 逃げ去った: しばらく姿を消してから通常どおり再登場する
        clearStartle(creature);
        creature.isHidden = true;
        creature.hiddenUntilS = timeSec + randomRange(CREATURE_FLEE_RETURN_MIN_S, CREATURE_FLEE_RETURN_MAX_S);
        pose.visibility = 0;
        continue;
      }
      respawn(creature, width, height);
    }

    const t = timeSec + creature.phase * 10;
    const pulse = Math.sin((t / spec.pulsePeriodS) * Math.PI * 2);
    // ゆらぎ: 昇る種類は左右、横に進む種類は上下に、ゆっくり波打つ
    const swayX = spec.motion === "rise" ? Math.sin(t * 0.35) * 0.018 * width : 0;
    const swayY = spec.motion === "glide" ? Math.sin(t * 0.3) * 0.025 * height : 0;

    let rotation: number;
    if (spec.motion === "drift") {
      rotation = creature.spin;
    } else if (spec.motion === "glide") {
      // 波打つ上下動に合わせて進行方向へ傾ける
      rotation = Math.cos(t * 0.3) * spec.tiltAmplitude * Math.sign(creature.vx);
    } else {
      rotation = Math.sin(t * 0.35 + 0.8) * spec.tiltAmplitude;
    }

    // 驚きの表現: 縮んで膨らみ返す減衰振動・羽ばたきの上乗せ・震え・光
    let squashScale = 1;
    let flapWidth = 0;
    let flapHeight = 0;
    let glow = 0;
    const sinceStartle = timeSec - creature.startleAtS;
    if (sinceStartle < STARTLE_ACTIVE_S) {
      const startle = spec.startle;
      squashScale =
        1 - startle.squash * Math.exp(-CREATURE_SQUASH_DAMPING * sinceStartle) * Math.cos(2 * Math.PI * CREATURE_SQUASH_HZ * sinceStartle);
      const flap = Math.sin(2 * Math.PI * startle.flapHz * sinceStartle) * Math.max(0, 1 - sinceStartle / startle.flapS);
      flapWidth = startle.flapX * flap;
      flapHeight = startle.flapY * flap;
      rotation += startle.shakeAmplitude * Math.sin(2 * Math.PI * startle.shakeHz * sinceStartle) * Math.exp(-sinceStartle / startle.shakeTauS);
      glow = startle.glow * Math.exp(-sinceStartle / startle.glowTauS);
    }

    // 向きの反転: 横幅を元の向き → 0 → 新しい向きへ回す（isFlipped は反転の開始時に切り替え済み）
    const flipSign = creature.isFlipped ? -1 : 1;
    const turnProgress = (timeSec - creature.turnAtS) / CREATURE_TURN_S;
    let flipScale = turnProgress < 1 ? -flipSign * Math.cos(Math.PI * Math.max(0, turnProgress)) : flipSign;
    if (Math.abs(flipScale) < MIN_FLIP_SCALE) flipScale = MIN_FLIP_SCALE * (Math.sign(flipScale) || flipSign);

    const half = (baseLength * spec.sizeRatio) / 2;
    pose.centerX = creature.x * width + swayX;
    pose.centerY = creature.y * height + swayY;
    pose.halfWidth = half * squashScale * (1 + spec.pulseX * pulse + flapWidth) * flipScale;
    pose.halfHeight = half * squashScale * (1 + spec.pulseY * pulse + flapHeight);
    pose.rotation = rotation;
    pose.glow = Math.max(glow, field.glowFloor);
    pose.visibility = 1;
  }
}

/**
 * 触れた生き物を驚かせる。クールダウン中は何もしない。
 * @returns 新たに驚いたら true（音を鳴らすかの判断に使う）
 */
export function startleCreature(
  field: CreatureField,
  creature: Creature,
  tapX: number,
  tapY: number,
  width: number,
  height: number,
  timeSec: number,
): boolean {
  if (creature.isHidden || timeSec - creature.startleAtS < CREATURE_STARTLE_COOLDOWN_S) return false;
  const startle = creature.spec.startle;
  const pose = field.poses[creature.index];
  creature.startleAtS = timeSec;

  let dirX: number;
  let dirY: number;
  if (startle.burst === "away") {
    const dx = pose.centerX - tapX;
    const dy = pose.centerY - tapY;
    const distance = Math.hypot(dx, dy);
    const angle = Math.random() * Math.PI * 2;
    dirX = distance > 1 ? dx / distance : Math.cos(angle);
    dirY = distance > 1 ? dy / distance : Math.sin(angle);
  } else if (startle.burst === "forward") {
    dirX = Math.sign(creature.vx) || 1;
    dirY = 0;
  } else if (startle.burst === "up") {
    // 触れた側と反対へ少しそれながら上へ
    const sideX = Math.sign(pose.centerX - tapX) * 0.3;
    const length = Math.hypot(sideX, 1);
    dirX = sideX / length;
    dirY = -1 / length;
  } else {
    creature.vx = -creature.vx;
    creature.vy = -creature.vy;
    creature.isFlipped = !creature.isFlipped;
    creature.turnAtS = timeSec;
    dirX = Math.sign(creature.vx) || 1;
    dirY = 0;
  }

  // 速さは画面短辺比で持ち、縦横それぞれの画面比へ直す（縦長・横長で逃げる速さが変わらないように）
  const shortSide = Math.min(width, height);
  creature.boostVx = (dirX * startle.burstSpeed * shortSide) / width;
  creature.boostVy = (dirY * startle.burstSpeed * shortSide) / height;
  creature.spinBoost = startle.spinBoost * (Math.sign(creature.spinSpeed) || 1);

  if (startle.escape === "flee") {
    creature.isFleeing = true;
    creature.vx = (dirX * startle.fleeSpeed * shortSide) / width;
    creature.vy = (dirY * startle.fleeSpeed * shortSide) / height;
    if (creature.spec.motion === "glide" && dirX !== 0) creature.isFlipped = Math.sign(dirX) !== creature.spec.facing;
  }
  return true;
}

/** 当たり判定のマスク（CREATURE_HIT_MASK_SIZE 四方、1 = 体）。画像ごとに 1 枚 */
export type CreatureHitMask = Uint8Array;

/** 画像の α からマスクを作る。最大 α の一定割合以上を体とし、1 マス膨らませて細い部分と指の太さを吸収する */
export function buildCreatureHitMasks(images: readonly HTMLImageElement[]): CreatureHitMask[] | null {
  const size = CREATURE_HIT_MASK_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  return images.map((image) => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let maxAlpha = 0;
    for (let i = 3; i < data.length; i += 4) maxAlpha = Math.max(maxAlpha, data[i]);
    const threshold = Math.max(1, maxAlpha * CREATURE_HIT_ALPHA_RATIO);

    const body = new Uint8Array(size * size);
    for (let i = 0; i < body.length; i++) body[i] = data[i * 4 + 3] >= threshold ? 1 : 0;

    const mask = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        let isBody = 0;
        for (let dy = -1; dy <= 1 && !isBody; dy++) {
          for (let dx = -1; dx <= 1 && !isBody; dx++) {
            const r = row + dy;
            const c = col + dx;
            if (r >= 0 && r < size && c >= 0 && c < size) isBody = body[r * size + c];
          }
        }
        mask[row * size + col] = isBody;
      }
    }
    return mask;
  });
}

/** 画面座標（CSS px）の点にいる生き物を返す。手前（描画順が後）を優先。姿を消している生き物は当たらない */
export function hitTestCreatures(field: CreatureField, masks: readonly CreatureHitMask[], x: number, y: number): Creature | null {
  const size = CREATURE_HIT_MASK_SIZE;
  for (let i = field.creatures.length - 1; i >= 0; i--) {
    const creature = field.creatures[i];
    const pose = field.poses[creature.index];
    if (creature.isHidden || pose.visibility <= 0) continue;
    if (Math.abs(pose.halfWidth) < 1 || Math.abs(pose.halfHeight) < 1) continue;
    // 描画の変形（平行移動 → 回転 → 拡大・反転）の逆変換で画像座標 -1..1 へ戻す
    const dx = x - pose.centerX;
    const dy = y - pose.centerY;
    const cos = Math.cos(pose.rotation);
    const sin = Math.sin(pose.rotation);
    const localX = (cos * dx + sin * dy) / pose.halfWidth;
    const localY = (-sin * dx + cos * dy) / pose.halfHeight;
    if (Math.abs(localX) >= 1 || Math.abs(localY) >= 1) continue;
    const col = Math.floor((localX * 0.5 + 0.5) * size);
    const row = Math.floor((localY * 0.5 + 0.5) * size);
    if (masks[creature.index][row * size + col]) return creature;
  }
  return null;
}

/** 全画像を読み込む。1 枚でも失敗したら null（生き物を描かないだけで本体は動く） */
export async function loadCreatureImages(): Promise<HTMLImageElement[] | null> {
  const base = import.meta.env.BASE_URL;
  try {
    return await Promise.all(
      CREATURE_SPECS.map(async (spec) => {
        const image = new Image();
        image.decoding = "async";
        image.src = base + spec.src;
        await image.decode();
        return image;
      }),
    );
  } catch {
    return null;
  }
}
