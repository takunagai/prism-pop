# Prism Pop ─ web

虹色の泡をタップ / なぞって割るインタラクティブアート。仕様の正本は `docs/architecture.md`（本ファイルはノブの早見表）。

```bash
pnpm install
pnpm dev      # 開発サーバー
pnpm build    # tsc --noEmit → vite build
```

デプロイ: `pnpm build` の後に `wrangler deploy`（Cloudflare Workers の静的アセット配信、設定は `wrangler.jsonc`）。公開 URL: https://prism-pop.nagai-shouten.workers.dev

開発用クエリ: `?mute`（無音）/ `?quality=standard|rich`（画質固定）/ `?debug`（診断オーバーレイ + `window.__prismDebug()`）

## 視覚・操作・品質のノブ（`src/tuning.ts`）

数値の意味・根拠は `docs/architecture.md`。ここでは体感への効き方だけをまとめる。

### パレット

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `PALETTE_LIME` / `PALETTE_VIOLET` | `#C6FF00` / `#7C4DFF` | 泡の縁・しぶき・リングなど明るい要素の原色。上げ下げ不要、他色を足すときの基準 |
| `BG_BLOB_COLORS` | インディゴ/バイオレット/ティール/マゼンタ | 背景ブロブ 4 個の基調色。差し替えると作品全体の色気が変わる |
| `MUDDY_HUE_MIN` / `MUDDY_HUE_MAX` | 15 / 125 | この色相帯（橙〜黄緑）を `avoidMuddyHue()` が避ける。広げると安全だが選べる色相が減る |

### 泡のシミュレーション（`bubbles.ts`）

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `MAX_BUBBLES` | 40 | 同時存在数の絶対上限。GL シェーダの uniform 配列長と直結するため、変えたら `render/rich-gl.ts` の再ビルドが必要 |
| `BUBBLE_COUNT_REFERENCE_SHORT_EDGE` / `_COUNT` / `_POWER` | 375 / 16 / 0.6 | 画面短辺から目標泡数を算出する冪乗則。`_COUNT` を上げると全体的に賑やかに、`_POWER` を上げると大画面ほど増える |
| `BUBBLE_COUNT_MIN` | 10 | 極端に小さい画面でも寂しくならない下限 |
| `BUBBLE_RADIUS_MIN_RATIO` / `_MAX_RATIO` | 0.035 / 0.11 | 泡半径 = 画面短辺 × この範囲。上げると大玉が増え、分裂演出が目立つ |
| `BUBBLE_SIZE_SKEW` | 2.2 | 大きいほど小さい泡に偏る（`Math.pow(random(), skew)`） |
| `BUBBLE_RISE_SPEED_MIN` / `_MAX` | 0.05 / 0.12（画面高さ比/秒） | 上昇の速さ。上げるとせわしなくなる |
| `BUBBLE_WOBBLE_AMPLITUDE_RATIO` | 0.12 | 横揺れの振幅（半径比）。0 にすると直線上昇になる |
| `BUBBLE_WOBBLE_PERIOD_MIN_S` / `_MAX_S` | 2.2 / 4.2 | 横揺れの周期。短くすると忙しない印象に |
| `POP_ANIM_MS` | 140 | 割れる演出（膨らみ→破れ）の尺。標準・rich 両レンダラで共有 |
| `SPLIT_SIZE_THRESHOLD` | 0.7 | これを超える `sizeNorm` の泡を割ると分裂する |
| `SPLIT_MIN_COUNT` / `_MAX_COUNT` | 2 / 3 | 分裂数の範囲 |
| `SPLIT_CHILD_SIZE_RATIO` | 0.55 | 分裂後の子泡サイズ（親比） |
| `SPLIT_SCATTER_SPEED` | 0.35（画面短辺比/秒） | 分裂した子泡の飛び散る初速 |
| `POP_PUSH_RADIUS_RATIO` / `POP_PUSH_STRENGTH` | 0.22 / 0.18 | 割れ・ミスの衝撃が周囲の泡を押す到達距離・強さ |

### 入力

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `HIT_SLOP_PX_MOUSE` / `HIT_SLOP_PX_TOUCH` | 6 / 14 | 当たり判定の甘さ（半径に加算する px）。小さいと厳密、大きいと親切 |
| `HOVER_HIGHLIGHT_RADIUS_SLOP_PX` | 4 | デスクトップのホバー判定の甘さ |

### コンボ・エネルギー・プリズムバースト

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `COMBO_WINDOW_MS` | 900 | この間隔以内に次を割るとコンボ継続。短くすると連打の要求がシビアに |
| `MILESTONE_EVERY` | 8 | このコンボ数ごとにプリズムバースト発動 |
| `ENERGY_PER_POP` | 0.12 | 1 pop あたりの energy 増加量（上限 1） |
| `ENERGY_DECAY_PER_S` | 0.35 | energy の秒あたり減衰量。大きいと手を止めた時にすぐ静かになる |
| `PRISM_BURST_DURATION_MS` | 600 | プリズムバーストの輪の演出尺 |
| `PRISM_BURST_RADIUS_RATIO` | 0.5（画面対角線比） | 輪が届く最大半径。連鎖対象の泡の範囲も兼ねる |
| `PRISM_CHAIN_INTERVAL_MS` | 45 | 連鎖ポップの間隔 |
| `SHAKE_MILESTONE_DURATION_MS` / `_AMPLITUDE_PX` | 260 / 6 | マイルストーン時の画面シェイクの尺・強さ |

#### プリズムストーム（`storm.ts`、`docs/architecture.md` 3.4.1）

開発ビルドでは `?pops=990` のように累計の初期値を入れると、予告とストームをすぐ確かめられる。

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `STORM_EVERY` | 1000 | 累計でこの個数ごとにストーム。× ボタンの進捗リング 1 周ぶん |
| `STORM_ANTICIPATION_POPS` / `STORM_ANTICIPATION_PRISM` | 100 / 0.35 | 予告を始める手前の個数と、予告の背景の虹色の強さ |
| `STORM_BASE_DURATION_MS` / `_DURATION_PER_LEVEL_MS` | 12000 / 2000 | 持続時間と、回を追うごとの延長（`STORM_MAX_SCALING_LEVEL` = 5 回目で頭打ち） |
| `STORM_WAVE_INTERVAL_MS` / `_PER_LEVEL_MS` / `_MIN_MS` | 1800 / 150 / 1200 | 波（プリズムバースト）の間隔。点滅にならないよう 1.2s 未満にしない |
| `STORM_SPAWN_BOOST` / `_PER_LEVEL` | 1.4 / 0.1 | ストーム中の泡の湧く量の倍率 |
| `STORM_SCATTER_AT` | 0.65 | 生き物が中央から散るタイミング（進行度） |
| `STORM_GATHER_RADIUS_RATIO` | 0.22（画面短辺比） | 生き物が集まる輪の半径 |
| `STORM_CREATURE_GLOW` / `_PER_LEVEL` | 0.55 / 0.08 | ストーム中の生き物の光 |
| `STORM_FINALE_RADIUS_RATIO` | 0.75（画面対角線比） | 締めの輪の半径。残りの泡をすべて連鎖させる |
| `STORM_SHAKE_AMPLITUDE_PX` | 10 | 開始・締めの揺れ（「視差効果を減らす」では揺らさない） |

### しぶき粒子・エフェクト（`effects.ts`）

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `SPLASH_PARTICLES_PER_SIZE` | 18 | 1 pop あたりの基準粒子数（`sizeNorm` で 0.4〜1.0 倍される） |
| `SPLASH_CAP_STANDARD_STEPS` | `[1200, 800, 500]` | standard での粒子上限の自動段階。fps が低いと main.ts が右へ進める |
| `SPLASH_CAP_RICH` | 4000 | rich での粒子上限 |
| `SPLASH_PARTICLE_LIFE_MS_MIN` / `_MAX` | 260 / 520 | しぶき 1 粒の寿命範囲 |
| `RING_LIFE_MS` / `RIPPLE_LIFE_MS` / `MISS_RIPPLE_LIFE_MS` | 420 / 520 / 380 | リング・波紋・ミス波紋それぞれの寿命 |

### 浮遊生物（`creatures.ts`）

種類ごとの大きさ比率・脈動・傾きは `creatures.ts` の `CREATURE_SPECS`（一覧は `docs/architecture.md` 7.5 節）。

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `CREATURE_OPACITY` | 0.25 | 全種共通の不透明度。上げると存在感が増すが泡の視認性が落ちる |
| `CREATURE_PORTRAIT_SCALE` | 2 | 縦長画面（幅 < 高さ）で基準長に掛ける倍率。スマホでの大きさだけを変える |
| `CREATURE_BASE_ASPECT` | 16/9 | 大きさの基準長 = min(画面幅, 画面高さ × この比)。超横長画面で巨大化しないための頭打ち |
| `CREATURE_RISE_SPEED_MIN` / `_MAX` | 0.014 / 0.024（画面高さ比/秒） | 昇る種類（クラゲ・クリオネ・クシクラゲ）の速さ。グラスオクトパスはこの 0.7 倍で斜めに漂う |
| `CREATURE_GLIDE_SPEED_MIN` / `_MAX` | 0.018 / 0.03（画面幅比/秒） | 横に進む種類（エイ・リーフィーシードラゴン）の速さ |

#### 驚きの反応（7.5.1）

種類ごとの反応（逃げ方・縮み・羽ばたき・震え・回転・光）は `CREATURE_SPECS[].startle`。

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `CREATURE_HIT_ALPHA_RATIO` | 0.25 | 画像の最大 α のこの割合以上を体とみなす。下げると薄い触手やヒレでも反応する |
| `CREATURE_HIT_MASK_SIZE` | 64 | 当たり判定マスクの 1 辺のマス数。上げると輪郭に忠実になる |
| `CREATURE_STARTLE_COOLDOWN_S` | 0.4 | 驚いた直後に再反応しない秒。下げると連打で何度も鳴る |
| `CREATURE_SQUASH_HZ` / `_DAMPING` | 2.4 / 5 | 縮んで膨らみ返す揺れの速さと収まる速さ |
| `CREATURE_GLOW_OPACITY_BOOST` | 1.4 | 光ったときに不透明度へ上乗せする倍率 |
| `CREATURE_GLOW_ADD` | 0.35 | 光ったときに加算する明るさ。上げると強く発光する |
| `CREATURE_TURN_S` | 0.4 | 向きを反転する動きの秒（リーフィーシードラゴン） |
| `CREATURE_FLEE_RETURN_MIN_S` / `_MAX_S` | 4 / 8 | 逃げ去った生き物（エイ・グラスオクトパス）が再登場するまでの秒 |

### 適応型画質（`quality.ts`）

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `QUALITY_STORAGE_KEY` | `prism-pop:quality` | 端末ごとの判定結果を覚えておく localStorage キー |
| `QUALITY_BASELINE_DELAY_MS` | 3000 | 基準フレーム間隔を測るまでの待ち時間 |
| `QUALITY_RICH_TRIAL_MS` | 2500 | rich 試行の尺 |
| `QUALITY_RICH_KEEP_RATIO` | 1.12 | 試行後、中央値がこの倍率以内なら rich 維持 |
| `QUALITY_RICH_KEEP_SLOW_FRAME_RATIO` | 0.03 | 50ms 超フレームの許容割合 |
| `QUALITY_DOWNGRADE_RATIO` | 1.35 | 運用中の降格しきい値（基準比） |
| `QUALITY_DOWNGRADE_WINDOW_MS` / `_CONSECUTIVE` | 2000 / 2 | 監視窓の長さと、降格に必要な連続悪化窓数 |
| `QUALITY_MIN_HARDWARE_CONCURRENCY` | 4 | rich 昇格の前提となる `navigator.hardwareConcurrency` |

### GL 描画・低解像度レイヤー

| 定数 | 既定値 | 効き方 |
|---|---|---|
| `GL_RENDER_SCALE_BASE` | 1.0 | `#gl` の描画解像度倍率（CSS px 基準） |
| `GL_MAX_DEVICE_PIXEL_RATIO` | 1.5 | devicePixelRatio の上限クランプ（retina での過描画を防ぐ） |
| `LOW_RES_DIVISOR` | 4 | `#bg` / `#glow` の解像度分母（CSS px の 1/4 で描いて CSS 拡大） |

## 音響のノブ

音響側の定数は `src/audio/audio-tuning.ts`、主なノブの一覧表は [`src/audio/README-audio.md`](src/audio/README-audio.md) を参照。
