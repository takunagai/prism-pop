# 音響のノブ

`web/README.md` の作成前に書いたため、ここに置く。README に「音響のノブ」見出しができたらこの表を移す。
定数の正本は `src/audio/audio-tuning.ts`（全定数と 1 行コメントはそちら）。ここには触る頻度の高いものだけ載せる。

| 定数 | 意味 | 既定値 | 体感への効き方 |
|---|---|---|---|
| `MASTER_GAIN` | コンプレッサ手前の全体音量 | 0.6 | 上げると大きくなるが、リミッタで潰れる頻度も増える |
| `VOICE_GAIN` | 1 回の発音のピーク基準 | 0.3 | 1 タップの太さ。上げすぎると連打で飽和する |
| `REVERB_WET_GAIN` | 残響の量 | 0.28 | 上げると空間が広がるが、連打で濁る |
| `REVERB_SECONDS` | 生成 IR の長さ（-60dB まで） | 2.8 | 余韻の長さ |
| `REVERB_BRIGHT_HZ` / `REVERB_TAIL_HZ` | 響きの頭 / 尻尾の明るさ | 11000 / 3500 | 下げると響きがこもる |
| `LIMITER_THRESHOLD_DB` | リミッタ代わりのコンプレッサの閾値 | -8 | 下げると音圧が揃い、強弱が減る |
| `MAX_VOICES` | 同時発音の上限（最も古い声を 30ms で奪う） | 28 | 下げると連打の余韻が早く切れる |
| `DENSITY_DUCK_PER_POP` | 直近 250ms の pop 1 個あたりの減衰の強さ | 0.18 | 上げると連打の音量が早く頭打ちになる |
| `DENSITY_DUCK_MIN_GAIN` | 連打時の下限ゲイン | 0.45 | 下げると激しい連打ほど静かになる |
| `CLICK_GAIN` | 泡が割れる破裂ノイズの音量 | 1.2 | 手応えの要。上げると「パチン」が前に出る |
| `CLICK_CENTER_HIGH_HZ` / `CLICK_CENTER_LOW_HZ` | 破裂音の中心（小さい泡 / 大きい泡） | 5000 / 2000 | 下げると「ポン」、上げると「チッ」 |
| `PLIP_GAIN` | 上昇サイン「プッ」の音量 | 0.25 | 上げると泡らしさが増す |
| `MARIMBA_AMPLITUDES` | マリンバ部分音の振幅（1 / 3.93 / 9.54） | 1 / 0.35 / 0.12 | 上 2 つを上げると木の硬さが増す |
| `MARIMBA_DECAYS` | マリンバ部分音の減衰秒 | 0.9 / 0.25 / 0.08 | 伸ばすと余韻が長く、連打で和音が積もる |
| `MARIMBA_LOW_NOTE_BOOST` | 低い音で第 2 部分音を足す量 | 0.25 | 小型スピーカーで低い泡の芯が残る |
| `BELL_DECAYS` | ベル部分音の減衰秒 | 2.5 / 1.5 / 0.8 / 0.3 | 伸ばすと高い泡がきらきら残る |
| `BELL_VIBRATO_CENTS` | ベルのビブラートの深さ | 6 | 上げると揺れが目立つ |
| `CROSSFADE_LOW_MIDI` / `CROSSFADE_HIGH_MIDI` | マリンバ → ベルの切り替え区間 | 72 / 79 | 下げるとベルの出番が増える |
| `SWIPE_BRIGHTNESS` | swipe の上の部分音の持ち上げ | 1.5 | なぞったときの明るさ |
| `CHAIN_BELL_LEAN` | chain をベル側へ寄せる割合 | 0.5 | 連鎖の鳴りの透明感 |
| `COMBO_SUSTAIN_BONUS` | コンボが伸びたときの余韻の延長 | 0.4 | 上げると連打の和音が積み上がる |
| `MILESTONE_STEP_SECONDS` | グリッサンドの音の間隔 | 0.035 | 広げるとアルペジオ、狭めると和音に近づく |
| `PAD_MAX_GAIN` | energy 1 のときのパッドの音量 | 0.12 | 上げると背景の持続音が前に出る |
| `PAD_LOWPASS_MIN_HZ` / `PAD_LOWPASS_MAX_HZ` | energy 0 / 1 のパッドの明るさ | 400 / 2400 | energy に応じて開く幅 |
| `PAD_SWELL_GAIN` | comboEnd の膨らみのピーク | 0.1 | 連打の後の余韻の大きさ |
| `AMP_NORMALIZE` | getAmp の倍率 | 3.5 | 上げるとグローの脈動が大きくなる |
| `AMP_RELEASE_PER_FRAME` | getAmp の減衰 | 0.9 | 1 に近いほど光の余韻が長い |
| `CREATURE_GAIN` | 浮遊生物を驚かせたときの効果音の音量（VOICE_GAIN に掛ける） | 0.55 | 上げると生き物の音が泡の音と並ぶ。種類ごとの音色は `CREATURE_<種類>_*` |
