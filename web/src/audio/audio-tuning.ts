// ============================================================
// audio-tuning.ts ─ 音響の定数（一元管理）
// 正本は docs/architecture.md 4 節（音響反応）・6 節（音響設計）
// 値を変えたら README のノブ一覧（音響のノブ）も合わせて更新する
// ============================================================

// ---- マスター ------------------------------------------------

/** コンプレッサ手前のマスターゲイン。上げると全体が大きくなるが、リミッタに当たる頻度も増える */
export const MASTER_GAIN = 0.6;
/** 声（pop・miss・マイルストーン）1 つのピーク基準。上げると 1 タップが太くなるが連打で飽和しやすい */
export const VOICE_GAIN = 0.3;
/** 原音の量。下げると響きに埋もれて遠く感じる */
export const DRY_GAIN = 1.0;
/** 残響の量。上げると空間が広がるが、連打で濁りやすい */
export const REVERB_WET_GAIN = 0.28;

/** リミッタ代わりのコンプレッサの閾値 dB。下げると早くから潰れて音圧が揃う */
export const LIMITER_THRESHOLD_DB = -8;
/** コンプレッサのニー dB。広げると潰れ始めが柔らかくなる */
export const LIMITER_KNEE_DB = 4;
/** 圧縮比。上げるほど天井が硬くなる（リミッタに近づく） */
export const LIMITER_RATIO = 16;
/** アタック秒。短いほどクリックの頭を抑えるが、手応えも削れる */
export const LIMITER_ATTACK_SECONDS = 0.002;
/** リリース秒。短いと連打でポンピングが目立ち、長いと音量が戻るのが遅い */
export const LIMITER_RELEASE_SECONDS = 0.12;

/** getAmp の Analyser の窓長（サンプル数）。大きいほど滑らかだが反応が遅れる */
export const ANALYSER_FFT_SIZE = 512;
/** RMS → 0..1 の倍率。上げるとグローの脈動が大きくなる */
export const AMP_NORMALIZE = 3.5;
/** getAmp の減衰（1 フレームあたり掛ける値）。1 に近いほど光の余韻が長い */
export const AMP_RELEASE_PER_FRAME = 0.9;

// ---- 声の管理 ------------------------------------------------

/** 同時発音の上限。超えたら最も古い声を奪う */
export const MAX_VOICES = 28;
/** コンテキストが止まっている間（解錠前など）に溜めてよい声の数。解錠時の音の塊を防ぐ */
export const SUSPENDED_MAX_VOICES = 4;
/** 声を奪うときのフェード秒。短いとプチッと鳴り、長いと重なりが残る */
export const VOICE_STEAL_FADE_SECONDS = 0.03;
/** エンベロープの下限値（指数ランプは 0 を目標にできない） */
export const MIN_GAIN = 0.0001;
/** 部分音をナイキスト周波数の何割までに制限するか。上げると最高音域で折り返しノイズが出うる */
export const PARTIAL_NYQUIST_RATIO = 0.45;

// ---- 連打のダッキング（DENSITY_DUCK） ----------------------------

/** 何秒以内の pop を「密度」として数えるか */
export const DENSITY_DUCK_WINDOW_SECONDS = 0.25;
/** この個数までは下げない。上げると軽い連打は素のまま鳴る */
export const DENSITY_DUCK_FREE_POPS = 2;
/** 1 個増えるごとの減衰の強さ。上げると連打の音量が早く頭打ちになる */
export const DENSITY_DUCK_PER_POP = 0.18;
/** ダッキングの下限ゲイン。下げると激しい連打ほど静かになる */
export const DENSITY_DUCK_MIN_GAIN = 0.45;
/** 下げるときの時定数秒。短いほど連打の頭から効く */
export const DENSITY_DUCK_ATTACK_SECONDS = 0.02;
/** 戻すときの時定数秒。長いほど連打の後に音量がゆっくり戻る */
export const DENSITY_DUCK_RELEASE_SECONDS = 0.25;

// ---- pop の共通写像 ----------------------------------------------

/** 音量 ∝ SIZE_GAIN_BASE + SIZE_GAIN_RANGE·size（仕様: 0.6 + 0.4·size） */
export const SIZE_GAIN_BASE = 0.6;
export const SIZE_GAIN_RANGE = 0.4;
/** kind 別の音量倍率（仕様: tap 1 / swipe 0.8 / chain 0.7） */
export const KIND_GAIN_TAP = 1.0;
export const KIND_GAIN_SWIPE = 0.8;
export const KIND_GAIN_CHAIN = 0.7;
/** pan ∝ x の幅。1 で画面端が完全に片側。下げると定位が中央に寄る */
export const PAN_WIDTH = 0.8;
/** 減衰の長さ = DECAY_SCALE_BASE + DECAY_SCALE_RANGE·size。上げると大きい泡の余韻が伸びる */
export const DECAY_SCALE_BASE = 0.8;
export const DECAY_SCALE_RANGE = 0.4;
/** コンボが伸びるほど余韻を伸ばす割合（和音として積み上がる感じ）。0 で無効 */
export const COMBO_SUSTAIN_BONUS = 0.4;
/** この combo 数で COMBO_SUSTAIN_BONUS を使い切る */
export const COMBO_SUSTAIN_FULL_COMBO = 16;

/** swipe で上の部分音を持ち上げる倍率（弾いた明るさ）。上げるほどキラキラする */
export const SWIPE_BRIGHTNESS = 1.5;
/** swipe で基音の減衰を縮める倍率（はじいた短さ） */
export const SWIPE_DECAY_SCALE = 0.8;
/** swipe で破裂音の中心周波数を上げる倍率 */
export const SWIPE_CLICK_PITCH = 1.2;
/** chain をベル側へ寄せる割合（0 で寄せない、1 で常にベル） */
export const CHAIN_BELL_LEAN = 0.5;

/** marimba → bell のクロスフェード区間（MIDI）。仕様: 72〜79 */
export const CROSSFADE_LOW_MIDI = 72;
export const CROSSFADE_HIGH_MIDI = 79;

// ---- marimba（モーダル合成） ---------------------------------------

/** 部分音の周波数比（仕様: 1 / 3.93 / 9.54） */
export const MARIMBA_RATIOS = [1, 3.93, 9.54] as const;
/** 部分音の振幅。上 2 つを上げると木の硬さが増す */
export const MARIMBA_AMPLITUDES = [1, 0.35, 0.12] as const;
/** 部分音の減衰秒（仕様: 0.9 / 0.25 / 0.08） */
export const MARIMBA_DECAYS = [0.9, 0.25, 0.08] as const;
/** 立ち上がり秒。短いほど打鍵が硬い */
export const MARIMBA_ATTACK_SECONDS = 0.0015;
/** 低い音で第 2 部分音を足す量（小型スピーカーで基音が聞こえなくても芯が残る） */
export const MARIMBA_LOW_NOTE_BOOST = 0.25;
/** この MIDI 以下で LOW_NOTE_BOOST が最大、+11 半音で 0 */
export const MARIMBA_LOW_NOTE_MIDI = 53;
/** マレットのクリック（帯域ノイズ）の長さ秒（仕様: 3ms） */
export const MALLET_NOISE_SECONDS = 0.003;
/** マレットのクリックの音量（声の中での比） */
export const MALLET_NOISE_GAIN = 0.6;
/** マレットのクリックの中心 = 基音 × この倍率（MALLET_MIN〜MAX_HZ に収める） */
export const MALLET_CENTER_RATIO = 4;
export const MALLET_MIN_HZ = 1500;
export const MALLET_MAX_HZ = 6000;

// ---- bell（加算合成） --------------------------------------------

/** 非整数倍音の比（仕様: 1 / 2.76 / 5.40 / 8.93） */
export const BELL_RATIOS = [1, 2.76, 5.4, 8.93] as const;
/** 部分音の振幅。上を上げるとガラスっぽく、下げると丸い鐘になる */
export const BELL_AMPLITUDES = [1, 0.55, 0.3, 0.18] as const;
/** 部分音の減衰秒（仕様: 2.5s〜0.3s） */
export const BELL_DECAYS = [2.5, 1.5, 0.8, 0.3] as const;
/** 立ち上がり秒 */
export const BELL_ATTACK_SECONDS = 0.002;
/** ベルは部分音が多く余韻が長いので、marimba と音量感を揃えるための補正 */
export const BELL_GAIN_TRIM = 0.7;
/** ビブラートの速さ Hz */
export const BELL_VIBRATO_HZ = 5.2;
/** ビブラートの深さ（セント）。上げると揺れが目立つ（仕様: ごく軽い） */
export const BELL_VIBRATO_CENTS = 6;
/** ビブラートがかかり始めるまでの秒。打った瞬間は揺らさない */
export const BELL_VIBRATO_DELAY_SECONDS = 0.35;

// ---- popClick（泡が割れる感触の要） --------------------------------

/** ノイズの長さ秒: size 0 → MIN、size 1 → MAX（仕様: 10〜25ms） */
export const CLICK_MIN_SECONDS = 0.01;
export const CLICK_MAX_SECONDS = 0.025;
/** バンドパスの中心 Hz: size 0 → HIGH、size 1 → LOW（仕様: 2〜5kHz、大きい泡ほど低い） */
export const CLICK_CENTER_HIGH_HZ = 5000;
export const CLICK_CENTER_LOW_HZ = 2000;
/** バンドパスの Q。上げると「チッ」、下げると「サッ」 */
export const CLICK_Q = 1.2;
/** 破裂ノイズの音量（声の中での比）。バンドパスで実効値が 1/3 程度に落ちる分を見込んだ値。上げるほど「パチン」が前に出る */
export const CLICK_GAIN = 1.2;
/** 上昇サイン「プッ」の長さ秒（仕様: 20ms） */
export const PLIP_SECONDS = 0.02;
/** 「プッ」の開始周波数: size 0 → HIGH、size 1 → LOW */
export const PLIP_START_HIGH_HZ = 900;
export const PLIP_START_LOW_HZ = 420;
/** 「プッ」の上昇幅（終わり = 開始 × この倍率） */
export const PLIP_SWEEP_RATIO = 2.2;
/** 「プッ」の音量（声の中での比） */
export const PLIP_GAIN = 0.25;

// ---- missTick ------------------------------------------------------

/** 空振りの音の高さ（MIDI）。音程なし寄りにするため固定 + 微小なゆらぎ */
export const MISS_MIDI = 65;
/** 空振りのたびに揺らす幅（半音）。0 で毎回同じ音 */
export const MISS_PITCH_JITTER = 1;
/** ミュートしたマリンバの減衰秒（仕様: 60ms） */
export const MISS_DECAY_SECONDS = 0.06;
/** 空振り音のローパス Hz（仕様: 1.2kHz） */
export const MISS_LOWPASS_HZ = 1200;
/** 空振り音の音量（VOICE_GAIN に掛ける） */
export const MISS_GAIN = 0.35;

// ---- creature*（浮遊生物を驚かせたときの効果音） --------------------
// 音程のある音はすべて F リディアンの構成音（MIDI）。周波数 Hz で書いた値は音程感の薄い効果音の成分

/** 生き物の効果音の音量（VOICE_GAIN に掛ける）。泡の pop より控えめにする */
export const CREATURE_GAIN = 0.55;

/** エイ: 翼の風切り（下降するバンドパスノイズ）を 2 回 + 柔らかいマリンバ */
export const CREATURE_RAY_WHOOSH_FROM_HZ = 1800;
export const CREATURE_RAY_WHOOSH_TO_HZ = 450;
export const CREATURE_RAY_WHOOSH_SECONDS = 0.4;
/** 2 回目の羽ばたきまでの秒 */
export const CREATURE_RAY_WHOOSH_GAP_SECONDS = 0.3;
export const CREATURE_RAY_WHOOSH_GAIN = 0.9;
export const CREATURE_RAY_MIDI = 60; // C4
export const CREATURE_RAY_TONE_WEIGHT = 0.45;

/** クリオネ: 短いベル 2 音（上昇）+ 上昇サインの「ピッ」 */
export const CREATURE_CLIONE_MIDIS = [84, 89] as const; // C6, F6
export const CREATURE_CLIONE_STEP_SECONDS = 0.07;
export const CREATURE_CLIONE_DECAY_SCALE = 0.3;
export const CREATURE_CLIONE_BELL_WEIGHT = 0.6;
export const CREATURE_CLIONE_CHIRP_FROM_HZ = 1200;
export const CREATURE_CLIONE_CHIRP_TO_HZ = 2400;
export const CREATURE_CLIONE_CHIRP_GAIN = 0.25;

/** クシクラゲ: 高音ベルの速いアルペジオ（ガラスのきらめき）。1 音ごとに pan を左右へ振る */
export const CREATURE_CTENOPHORE_MIDIS = [89, 93, 96, 100] as const; // F6, A6, C7, E7
export const CREATURE_CTENOPHORE_STEP_SECONDS = 0.03;
export const CREATURE_CTENOPHORE_DECAY_SCALE = 0.5;
export const CREATURE_CTENOPHORE_BELL_WEIGHT = 0.35;
export const CREATURE_CTENOPHORE_BRIGHTNESS = 1.2;
export const CREATURE_CTENOPHORE_PAN_SPREAD = 0.25;

/** グラスオクトパス: 下降サインの「ポコッ」2 回 + ローパスノイズの噴射 */
export const CREATURE_OCTOPUS_BLOOPS = [
  { delay: 0, fromHz: 520, toHz: 180, gain: 0.8 },
  { delay: 0.11, fromHz: 420, toHz: 180, gain: 0.5 },
] as const;
export const CREATURE_OCTOPUS_BLOOP_GLIDE_SECONDS = 0.16;
export const CREATURE_OCTOPUS_BLOOP_DECAY_SECONDS = 0.22;
export const CREATURE_OCTOPUS_JET_FROM_HZ = 900;
export const CREATURE_OCTOPUS_JET_TO_HZ = 200;
export const CREATURE_OCTOPUS_JET_SECONDS = 0.35;
export const CREATURE_OCTOPUS_JET_GAIN = 0.5;

/** リーフィーシードラゴン: 高域の短いノイズを不規則に並べたカサカサ + ミュートしたマリンバ */
export const CREATURE_SEADRAGON_RUSTLE_COUNT = 5;
export const CREATURE_SEADRAGON_RUSTLE_SPREAD_SECONDS = 0.25;
export const CREATURE_SEADRAGON_RUSTLE_MIN_HZ = 3000;
export const CREATURE_SEADRAGON_RUSTLE_MAX_HZ = 4500;
export const CREATURE_SEADRAGON_RUSTLE_GAIN = 0.8;
export const CREATURE_SEADRAGON_MIDI = 69; // A4
export const CREATURE_SEADRAGON_TONE_DECAY_SCALE = 0.35;
export const CREATURE_SEADRAGON_TONE_WEIGHT = 0.6;

/** クラゲ: ビブラート付きの柔らかい上昇サイン「ぽよん」を傘の拍動に合わせて 2 回 */
export const CREATURE_JELLYFISH_FROM_MIDI = 69; // A4
export const CREATURE_JELLYFISH_TO_MIDI = 72; // C5
export const CREATURE_JELLYFISH_GLIDE_SECONDS = 0.12;
export const CREATURE_JELLYFISH_ATTACK_SECONDS = 0.03;
export const CREATURE_JELLYFISH_DECAY_SECONDS = 0.45;
export const CREATURE_JELLYFISH_VIBRATO_HZ = 7;
export const CREATURE_JELLYFISH_VIBRATO_CENTS = 35;
/** 2 回目までの秒（creatures.ts のクラゲの flapHz 2.3 の 1 周期） */
export const CREATURE_JELLYFISH_GAP_SECONDS = 0.435;
export const CREATURE_JELLYFISH_GAINS = [0.7, 0.45] as const;

// ---- milestoneGliss ------------------------------------------------

/** グリッサンドの音の間隔秒（仕様: 35ms） */
export const MILESTONE_STEP_SECONDS = 0.035;
/** グリッサンドの音量（VOICE_GAIN に掛ける） */
export const MILESTONE_GAIN = 0.7;
/** グリッサンドの pan の広がり（両端） */
export const MILESTONE_PAN_WIDTH = 0.9;
/** level が 1 上がるごとに余韻を伸ばす割合 */
export const MILESTONE_LENGTH_PER_LEVEL = 0.25;
/** 余韻の伸びを頭打ちにする level */
export const MILESTONE_MAX_LEVEL = 4;

// ---- pad（energy に追従する持続音） --------------------------------

/** 和音の構成（主音 F3 からの半音: 主音 + 5 度 + 9th） */
export const PAD_SEMITONES = [0, 7, 14] as const;
/** 構成音ごとの重み */
export const PAD_WEIGHTS = [1, 0.8, 0.5] as const;
/** 2 本の発振器をずらすセント。上げるとうねりが強くなる */
export const PAD_DETUNE_CENTS = 7;
/** energy 1 のときの音量（仕様: 0..0.12） */
export const PAD_MAX_GAIN = 0.12;
/** energy → 音量の曲線。1 で比例、上げると energy が高いときだけ鳴る */
export const PAD_GAIN_CURVE = 1.3;
/** energy 0 / 1 のときのローパス Hz（仕様: 400..2400） */
export const PAD_LOWPASS_MIN_HZ = 400;
export const PAD_LOWPASS_MAX_HZ = 2400;
/** energy 追従の時定数秒。長いほどゆったり追いかける */
export const PAD_SMOOTHING_SECONDS = 0.3;
/** setEnergy を音に反映する最短間隔秒（毎フレームの自動化イベントを溜めない） */
export const PAD_UPDATE_INTERVAL_SECONDS = 0.05;
/** これ未満の energy 変化は反映しない */
export const PAD_UPDATE_THRESHOLD = 0.01;

// ---- comboEnd の余韻 -----------------------------------------------

/** 余韻を鳴らす最小コンボ（仕様: combo≥3） */
export const COMBO_END_MIN_COMBO = 3;
/** パッドの膨らみのピーク音量。combo が COMBO_END_FULL_COMBO で最大 */
export const PAD_SWELL_GAIN = 0.1;
/** この combo で膨らみ・ベル音量が最大 */
export const COMBO_END_FULL_COMBO = 16;
/** 膨らみの立ち上がり秒 */
export const PAD_SWELL_ATTACK_SECONDS = 0.5;
/** 膨らみの減衰の時定数秒。長いほど余韻が残る */
export const PAD_SWELL_RELEASE_SECONDS = 0.9;
/** 膨らみ用のローパス Hz（energy が低くても小型スピーカーで聞こえるよう固定で開ける） */
export const PAD_SWELL_LOWPASS_HZ = 1600;
/** 余韻の高いベル 1 音（MIDI）。既定は F6 */
export const COMBO_END_BELL_MIDI = 89;
/** 余韻のベルの音量（VOICE_GAIN に掛ける） */
export const COMBO_END_BELL_GAIN = 0.6;
/** 余韻のベルが鳴るまでの遅れ秒（パッドの膨らみに乗せる） */
export const COMBO_END_BELL_DELAY_SECONDS = 0.12;

// ---- 残響（生成 IR） -----------------------------------------------

/** IR の長さ秒（仕様: 2.8s）。-60dB に達する時間 */
export const REVERB_SECONDS = 2.8;
/** 残響が始まるまでの秒。上げると原音と響きが分離して広く聞こえる */
export const REVERB_PREDELAY_SECONDS = 0.012;
/** 冒頭のフェードイン秒（IR の頭のクリック防止） */
export const REVERB_FADE_IN_SECONDS = 0.004;
/** 響きの頭の明るさ Hz（1 次ローパスのカットオフ）。上げると明るい */
export const REVERB_BRIGHT_HZ = 11000;
/** 響きの尻尾の明るさ Hz。下げると尻尾が暗くこもる */
export const REVERB_TAIL_HZ = 3500;
/** IR を 1 回の setTimeout で生成するサンプル数。上げると早く終わるが 1 回のタスクが長くなる */
export const REVERB_CHUNK_FRAMES = 4096;

/** 破裂音などに使う共有ノイズの長さ秒 */
export const NOISE_BUFFER_SECONDS = 0.5;
