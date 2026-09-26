// ============================================================
// tuning.ts ─ 視覚・操作・品質の定数を一元管理する
// 正本は docs/architecture.md（数値の意味・根拠はそちら）。
// ここに書いた値の一覧・体感への効き方は README.md の表に転記する。
// 音響側の定数は audio/audio-tuning.ts（本ファイルでは扱わない）。
// ============================================================

// ---- パレット（docs/architecture.md 7.2） ----
export const PALETTE_LIME = "#C6FF00";
export const PALETTE_VIOLET = "#7C4DFF";
export const PALETTE_BASE = "#0D0A1F";
export const BG_BLOB_COLORS = ["#1B1446", "#3B2380", "#0E5A56", "#4A1B5E"] as const;

// 暗い背景・低 alpha で泥色化する色相帯（橙〜黄緑）。avoidMuddyHue() が使う
export const MUDDY_HUE_MIN = 15;
export const MUDDY_HUE_MAX = 125;

// ---- 泡のシミュレーション（3.2） ----
/** 同時存在数の上限。GL の uniform 配列長と一致させる */
export const MAX_BUBBLES = 40;
/**
 * 目標泡数は画面短辺の長さから冪乗則で算出する（面積そのものだと PC で過剰に増える）。
 * 基準: 短辺 375px（スマホ縦）で 16 個。短辺 1080px（PC）で約 30 個になるよう指数 0.6 を選定
 */
export const BUBBLE_COUNT_REFERENCE_SHORT_EDGE = 375;
export const BUBBLE_COUNT_REFERENCE_COUNT = 16;
export const BUBBLE_COUNT_POWER = 0.6;
export const BUBBLE_COUNT_MIN = 10;
/** 半径 = 画面短辺 × [MIN, MAX] */
export const BUBBLE_RADIUS_MIN_RATIO = 0.035;
export const BUBBLE_RADIUS_MAX_RATIO = 0.11;
/** サイズ分布の歪み指数（1 より大きいほど小さい泡に偏る） */
export const BUBBLE_SIZE_SKEW = 2.2;
/** 上昇速度（画面高さに対する比 / 秒） */
export const BUBBLE_RISE_SPEED_MIN = 0.05;
export const BUBBLE_RISE_SPEED_MAX = 0.12;
/** 横揺れ（ウォブル）の振幅・周期 */
export const BUBBLE_WOBBLE_AMPLITUDE_RATIO = 0.12;
export const BUBBLE_WOBBLE_PERIOD_MIN_S = 2.2;
export const BUBBLE_WOBBLE_PERIOD_MAX_S = 4.2;
/** 楕円変形の揺れ幅 */
export const BUBBLE_SQUASH_RATIO = 0.03;

/** 湧き出しの間隔。不足率 0 → MAX、不足率 50% 以上 → MIN（連打で画面が空にならないように） */
export const SPAWN_INTERVAL_MAX_MS = 220;
export const SPAWN_INTERVAL_MIN_MS = 35;
/** 不足率がこれを超えたら、画面外でなく画面内（下側）に直接湧かせる */
export const IN_VIEW_SPAWN_DEFICIT_RATIO = 0.3;
/** 画面内に湧かせる範囲の上端（画面高さ比）。下端は 0.95 */
export const IN_VIEW_SPAWN_TOP_RATIO = 0.35;
/** 画面内に湧いた泡が膨らみきるまでの時間 */
export const SPAWN_GROW_MS = 260;

/** 割れるアニメーションの尺 */
export const POP_ANIM_MS = 140;
/** 分裂を起こすサイズ閾値（0..1 正規化） */
export const SPLIT_SIZE_THRESHOLD = 0.7;
export const SPLIT_MIN_COUNT = 2;
export const SPLIT_MAX_COUNT = 3;
/** 分裂した小泡のサイズ比（親サイズに対して） */
export const SPLIT_CHILD_SIZE_RATIO = 0.55;
/** 分裂した小泡が飛び散る初速（画面短辺比 / 秒） */
export const SPLIT_SCATTER_SPEED = 0.35;

/** pop / miss で周囲の泡を押し出す力の到達距離・強さ */
export const POP_PUSH_RADIUS_RATIO = 0.22;
export const POP_PUSH_STRENGTH = 0.18;

// ---- 入力（3.5） ----
export const HIT_SLOP_PX_MOUSE = 6;
export const HIT_SLOP_PX_TOUCH = 14;

// ---- コンボ（3.3） ----
export const COMBO_WINDOW_MS = 900;
export const MILESTONE_EVERY = 8;
export const ENERGY_PER_POP = 0.12;
/** 1 秒あたりの energy 減衰量 */
export const ENERGY_DECAY_PER_S = 0.35;

// ---- プリズムバースト（3.4） ----
export const PRISM_BURST_DURATION_MS = 600;
/** 輪の到達半径（画面対角線に対する比） */
export const PRISM_BURST_RADIUS_RATIO = 0.5;
export const PRISM_CHAIN_INTERVAL_MS = 45;
export const SHAKE_MILESTONE_DURATION_MS = 260;
export const SHAKE_MILESTONE_AMPLITUDE_PX = 6;

// ---- プリズムストーム（3.4.1） ----
/** 累計でこの個数を割るたびにストームが起きる */
export const STORM_EVERY = 1000;
/** 閾値の何個手前から予告（背景の揺らぎ）を始めるか */
export const STORM_ANTICIPATION_POPS = 100;
/** 予告が最大のときの背景の虹色の強さ（ストーム中は 1） */
export const STORM_ANTICIPATION_PRISM = 0.35;
/** 持続時間 = BASE + PER_LEVEL ×（level−1）。level は STORM_MAX_SCALING_LEVEL で頭打ち */
export const STORM_BASE_DURATION_MS = 12000;
export const STORM_DURATION_PER_LEVEL_MS = 2000;
export const STORM_MAX_SCALING_LEVEL = 5;
/** 強さの立ち上がり・収まりの ms */
export const STORM_RAMP_IN_MS = 1200;
export const STORM_RAMP_OUT_MS = 2000;
/** 波（プリズムバースト）の間隔 = BASE − PER_LEVEL ×（level−1）、下限 MIN。点滅にならないよう 1.2s 未満にしない */
export const STORM_WAVE_INTERVAL_MS = 1800;
export const STORM_WAVE_INTERVAL_PER_LEVEL_MS = 150;
export const STORM_WAVE_INTERVAL_MIN_MS = 1200;
/** 泡の湧く量の倍率 = BASE + PER_LEVEL ×（level−1） */
export const STORM_SPAWN_BOOST = 1.4;
export const STORM_SPAWN_BOOST_PER_LEVEL = 0.1;
/** 生き物が中央から散るタイミング（進行度 0..1） */
export const STORM_SCATTER_AT = 0.65;
/** 生き物が集まる輪の半径（画面短辺比） */
export const STORM_GATHER_RADIUS_RATIO = 0.22;
/** 生き物の光 = BASE + PER_LEVEL ×（level−1）（強さを掛ける） */
export const STORM_CREATURE_GLOW = 0.55;
export const STORM_CREATURE_GLOW_PER_LEVEL = 0.08;
/** 締めの輪の半径（画面対角線比）。中央から画面全体を覆う */
export const STORM_FINALE_RADIUS_RATIO = 0.75;
/** 開始・締めの揺れの振幅 px */
export const STORM_SHAKE_AMPLITUDE_PX = 10;

// ---- しぶき粒子（7.4） ----
export const SPLASH_PARTICLES_PER_SIZE = 18;
export const SPLASH_CAP_STANDARD_INITIAL = 1200;
export const SPLASH_CAP_STANDARD_STEPS = [1200, 800, 500] as const;
export const SPLASH_CAP_RICH = 4000;
export const SPLASH_PARTICLE_LIFE_MS_MIN = 260;
export const SPLASH_PARTICLE_LIFE_MS_MAX = 520;
export const RING_LIFE_MS = 420;
export const RIPPLE_LIFE_MS = 520;
export const MISS_RIPPLE_LIFE_MS = 380;

// ---- 画質判定（quality.ts / docs 8 節） ----
export const QUALITY_STORAGE_KEY = "prism-pop:quality";
export const QUALITY_BASELINE_DELAY_MS = 3000;
export const QUALITY_RICH_TRIAL_MS = 2500;
/** rich 維持条件: 中央値 ≤ 基準 × この係数 */
export const QUALITY_RICH_KEEP_RATIO = 1.12;
/** rich 維持条件: 50ms 超フレームの割合がこの値未満 */
export const QUALITY_RICH_KEEP_SLOW_FRAME_RATIO = 0.03;
export const QUALITY_SLOW_FRAME_MS = 50;
/** 降格条件: 中央値 > 基準 × この係数 が 2 窓連続 */
export const QUALITY_DOWNGRADE_RATIO = 1.35;
export const QUALITY_DOWNGRADE_WINDOW_MS = 2000;
export const QUALITY_DOWNGRADE_CONSECUTIVE = 2;
export const QUALITY_MIN_HARDWARE_CONCURRENCY = 4;

// ---- GL 描画 ----
export const GL_RENDER_SCALE_BASE = 1.0;
export const GL_MAX_DEVICE_PIXEL_RATIO = 1.5;

// ---- 低解像度レイヤー（#bg, #glow は CSS px の 1/4 で描く） ----
export const LOW_RES_DIVISOR = 4;

// ---- 浮遊生物（7.5） ----
/** 全種共通の不透明度 */
export const CREATURE_OPACITY = 0.25;
/** 大きさの基準長 = min(画面幅, 画面高さ × この比)。16:9 基準で調整した比率を縦長・超横長でも破綻させない */
export const CREATURE_BASE_ASPECT = 16 / 9;
/** 縦長画面（スマホ縦持ち）では基準長が画面幅になり小さく見えるので、この倍率を掛ける */
export const CREATURE_PORTRAIT_SCALE = 2;
/** 昇る種類の速さ（画面高さ比 / 秒）。画面を抜けるまで 40〜70 秒 */
export const CREATURE_RISE_SPEED_MIN = 0.014;
export const CREATURE_RISE_SPEED_MAX = 0.024;
/** 横に進む種類の速さ（画面幅比 / 秒） */
export const CREATURE_GLIDE_SPEED_MIN = 0.018;
export const CREATURE_GLIDE_SPEED_MAX = 0.03;

// ---- 浮遊生物の驚きの反応（7.5.1） ----
/** 当たり判定のマスク 1 辺のマス数 */
export const CREATURE_HIT_MASK_SIZE = 64;
/** 画像の最大 α のこの割合以上を「体」とみなす。下げると薄い触手やヒレでも反応する */
export const CREATURE_HIT_ALPHA_RATIO = 0.25;
/** 驚いた直後に再反応しない秒 */
export const CREATURE_STARTLE_COOLDOWN_S = 0.4;
/** 縮んで膨らみ返す減衰振動の周波数 Hz と減衰の速さ（1/秒）。周波数を上げるとプルプル、減衰を下げると長く揺れる */
export const CREATURE_SQUASH_HZ = 2.4;
export const CREATURE_SQUASH_DAMPING = 5;
/** 光ったときに不透明度へ上乗せする倍率（glow 1 で CREATURE_OPACITY × (1 + この値)） */
export const CREATURE_GLOW_OPACITY_BOOST = 1.4;
/** 光ったときに加算する明るさ（glow 1 のとき画像の色 × この値） */
export const CREATURE_GLOW_ADD = 0.35;
/** 向きを反転する動きの秒（リーフィーシードラゴン） */
export const CREATURE_TURN_S = 0.4;
/** 逃げ去った生き物が再登場するまでの秒 */
export const CREATURE_FLEE_RETURN_MIN_S = 4;
export const CREATURE_FLEE_RETURN_MAX_S = 8;

// ---- ホバー（デスクトップ） ----
export const HOVER_HIGHLIGHT_RADIUS_SLOP_PX = 4;
