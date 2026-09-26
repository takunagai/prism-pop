// ============================================================
// engine.ts ─ AudioEngine 契約 + Noop 実装 + ファクトリ
// 正本は docs/architecture.md 5 節。契約を変えるときは先に architecture.md を更新する
//
// main.ts は createAudioEngine() 経由でのみ音響に触る。
// audio/ 配下はこの契約以外の公開 API を増やさない。
// ============================================================

export type PopKind = "tap" | "swipe" | "chain";

export interface PopEvent {
  /** 0..1（画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
  /** music.ts の noteForPop() が決める */
  midi: number;
  /** 0..1（泡の半径をサイズ範囲で正規化。1 = 最大） */
  size: number;
  /** この pop を含む現在のコンボ数（1 始まり） */
  combo: number;
  kind: PopKind;
}

/** 浮遊生物の種類（creatures.ts の CREATURE_SPECS[].name と一致させる） */
export type CreatureSpecies = "ray" | "clione" | "ctenophore" | "octopus" | "seadragon" | "jellyfish";

export interface CreatureEvent {
  species: CreatureSpecies;
  /** 0..1（触れた位置。画面幅で正規化） */
  x: number;
  /** 0..1（画面高さで正規化） */
  y: number;
}

export interface AudioEngine {
  /** ユーザー操作のハンドラ内で呼ぶ。resume() の解決を待たずに配線まで済ませ、常駐の解錠リスナーを置く */
  start(): Promise<void>;
  /** 配線と素材の準備が済んでいるか。false の間、他メソッドは何もしない */
  readonly isReady: boolean;
  pop(event: PopEvent): void;
  miss(x: number, y: number): void;
  /** 浮遊生物に触れて驚かせたとき（種類ごとの効果音） */
  creature(event: CreatureEvent): void;
  /** プリズムストーム開始（上昇グリッサンド + パッドを持続時間いっぱい膨らませる） */
  stormStart(level: number, durationSeconds: number): void;
  /** プリズムストームの締め（主和音をかき鳴らす） */
  stormFinale(level: number): void;
  /** タイトルへ戻るとき。鳴っている音をフェードして止める（AudioContext は止めない） */
  stopAll(): void;
  comboMilestone(level: number, x: number, y: number): void;
  comboEnd(combo: number): void;
  /** 毎フレーム呼ばれてよい（内部で平滑化） */
  setEnergy(energy: number): void;
  /** マスター振幅 0..1。1 フレーム 1 回だけ呼ぶ */
  getAmp(): number;
  /** ?debug 表示用 */
  getDiagnostics(): Record<string, string | number | boolean>;
}

export class NoopAudioEngine implements AudioEngine {
  readonly isReady = false;
  async start(): Promise<void> {}
  pop(): void {}
  miss(): void {}
  creature(): void {}
  stormStart(): void {}
  stormFinale(): void {}
  stopAll(): void {}
  comboMilestone(): void {}
  comboEnd(): void {}
  setEnergy(): void {}
  getAmp(): number {
    return 0;
  }
  getDiagnostics(): Record<string, string | number | boolean> {
    return { engine: "noop" };
  }
}

import { PrismAudioEngine } from "./prism-engine";

/** URL に ?mute を付けると無音（視覚のみ）で起動する */
export function createAudioEngine(): AudioEngine {
  if (new URLSearchParams(location.search).has("mute")) {
    return new NoopAudioEngine();
  }
  return new PrismAudioEngine();
}
