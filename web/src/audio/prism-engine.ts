// ============================================================
// prism-engine.ts ─ Prism Pop の Web Audio 実装
// 正本は docs/architecture.md 4 節（音響反応）・5 節（契約）・6 節（音響設計）
// 定数はすべて audio-tuning.ts に置く
//
// engine.ts がこのファイルを値として import するので、engine.ts からは型だけを import する
// （値の import にすると循環 import で TDZ になる）
// ============================================================

import type { AudioEngine, CreatureEvent, PopEvent } from "./engine";
import { midiToFrequency, milestoneGlissando, ROOT_MIDI } from "../music";
import * as Tuning from "./audio-tuning";

/** 停止時刻つきの音源。声を奪うときに停止時刻を前倒しする */
interface ScheduledSource {
  node: AudioScheduledSourceNode;
  stopTime: number;
}

/** 1 回の発音（pop 1 回 / miss 1 回 / グリッサンドの 1 音）。部分音はすべて input に集まる */
interface Voice {
  startTime: number;
  input: AudioNode;
  output: GainNode;
  nodes: AudioNode[];
  sources: ScheduledSource[];
  isReleasing: boolean;
  isDisposed: boolean;
}

interface PartialOptions {
  startTime: number;
  frequency: number;
  peak: number;
  attack: number;
  decay: number;
}

interface NoiseBurstOptions {
  startTime: number;
  duration: number;
  centerFrequency: number;
  q: number;
  peak: number;
  filterType: BiquadFilterType;
}

type SilentElementState = "idle" | "starting" | "playing" | "failed";

const UNLOCK_EVENT_TYPES = ["pointerup", "touchend", "click", "keydown"] as const;
/** -60dB = e^-6.9078 */
const DECAY_TO_MINUS_60_DB = 6.907755;
/** 停止を前倒しするときの安全マージン秒 */
const STOP_MARGIN_SECONDS = 0.005;
/** 部分音のエンベロープが終わってから発振器を止めるまでの余白秒 */
const SOURCE_TAIL_SECONDS = 0.01;
/** これ未満の重みの音色は作らない（ノードを節約する） */
const MIN_TIMBRE_WEIGHT = 0.01;
/** console に出すエラーの上限件数（連打中の同一エラーで埋めない） */
const MAX_LOGGED_ERRORS = 5;

export class PrismAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private hasWiring = false;

  private voiceBus: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> = new Float32Array(0);
  private analyserByteData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private padFilter: BiquadFilterNode | null = null;
  private padEnergyGain: GainNode | null = null;
  private padSwellGain: GainNode | null = null;
  private canPan = false;

  private readonly activeVoices: Voice[] = [];
  private noiseBuffer: AudioBuffer | null = null;

  // 残響 IR の小分け生成の状態
  private impulseBuffer: AudioBuffer | null = null;
  private impulseFrameCursor = 0;
  private readonly impulseFilterStates = [0, 0];
  private isImpulseReady = false;
  private hasScheduledPrecompute = false;

  // energy とダッキング
  private targetEnergy = 0;
  private appliedEnergy = -1;
  private lastEnergyUpdateTime = -Infinity;
  private readonly recentPopTimes: number[] = [];
  private lastDuckCount = 0;
  private duckTarget = 1;
  private ampEnvelope = 0;

  // 解錠と iOS 対策
  private hasUnlockListeners = false;
  private resumeAttempts = 0;
  private audioSessionType = "unchecked";
  private shouldUseSilentElement = false;
  private silentElement: HTMLAudioElement | null = null;
  private silentElementState: SilentElementState = "idle";

  // 診断
  private lastError = "";
  private errorCount = 0;

  get isReady(): boolean {
    return this.hasWiring;
  }

  // ---- 公開 API ------------------------------------------------

  async start(): Promise<void> {
    // resume() は待たない。タッチ端末の pointerdown はユーザー活性化にならないため、
    // ここで待つと解決しないまま配線が止まる。配線は同期で最後まで済ませる
    if (!this.hasWiring) {
      try {
        this.buildGraph();
      } catch (error) {
        this.recordError("start", error);
        this.discardFailedContext();
        return;
      }
    }
    this.installUnlockListeners();
    this.configureAudioSession();
    this.tryResume();
    this.startSilentElement();
    this.schedulePrecompute();
  }

  pop(event: PopEvent): void {
    if (!this.canPlay()) return;
    try {
      this.playPop(event);
    } catch (error) {
      this.recordError("pop", error);
    }
  }

  miss(x: number, _y: number): void {
    if (!this.canPlay()) return;
    try {
      this.playMiss(x);
    } catch (error) {
      this.recordError("miss", error);
    }
  }

  creature(event: CreatureEvent): void {
    if (!this.canPlay()) return;
    try {
      this.playCreature(event);
    } catch (error) {
      this.recordError("creature", error);
    }
  }

  comboMilestone(level: number, x: number, _y: number): void {
    if (!this.canPlay()) return;
    try {
      this.playMilestone(level, x);
    } catch (error) {
      this.recordError("comboMilestone", error);
    }
  }

  comboEnd(combo: number): void {
    if (!this.canPlay()) return;
    try {
      this.playComboEnd(combo);
    } catch (error) {
      this.recordError("comboEnd", error);
    }
  }

  setEnergy(energy: number): void {
    this.targetEnergy = clampUnit(finiteOr(energy, 0));
    if (!this.canPlay() || !this.isRunning()) return;
    try {
      this.applyEnergy(false);
    } catch (error) {
      this.recordError("setEnergy", error);
    }
  }

  getAmp(): number {
    if (!this.canPlay() || !this.isRunning() || this.analyser === null) {
      this.ampEnvelope *= Tuning.AMP_RELEASE_PER_FRAME;
      return this.ampEnvelope;
    }
    try {
      // ダッキングの戻りは pop が止んだ後に進むので、毎フレーム呼ばれるここで追従させる
      this.updateDensityDuck(performance.now());
      const rms = this.readAnalyserRms(this.analyser);
      const amplitude = Math.min(1, rms * Tuning.AMP_NORMALIZE);
      this.ampEnvelope = Math.max(amplitude, this.ampEnvelope * Tuning.AMP_RELEASE_PER_FRAME);
      return Number.isFinite(this.ampEnvelope) ? this.ampEnvelope : 0;
    } catch (error) {
      this.recordError("getAmp", error);
      return 0;
    }
  }

  getDiagnostics(): Record<string, string | number | boolean> {
    try {
      const context = this.context;
      const diagnostics: Record<string, string | number | boolean> = {
        engine: "prism",
        contextState: context?.state ?? "none",
        sampleRate: context?.sampleRate ?? 0,
        isReady: this.hasWiring,
        isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
        audioSession: this.audioSessionType,
        silentElement: this.shouldUseSilentElement ? this.silentElementState : "not-used",
        activeVoices: this.countSoundingVoices(),
        isImpulseReady: this.isImpulseReady,
        impulseProgress: this.impulseProgress(),
        duckGain: roundTo(this.duckTarget, 2),
        resumeAttempts: this.resumeAttempts,
        errorCount: this.errorCount,
        lastError: this.lastError === "" ? "none" : this.lastError,
      };
      if (context !== null && typeof context.baseLatency === "number") {
        diagnostics.baseLatencyMs = roundTo(context.baseLatency * 1000, 1);
      }
      if (context !== null && typeof context.outputLatency === "number") {
        diagnostics.outputLatencyMs = roundTo(context.outputLatency * 1000, 1);
      }
      return diagnostics;
    } catch (error) {
      this.recordError("getDiagnostics", error);
      return { engine: "prism", lastError: this.lastError };
    }
  }

  // ---- 配線 ----------------------------------------------------

  private buildGraph(): void {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor === undefined) {
      throw new Error("Web Audio API is not available");
    }
    let context: AudioContext;
    try {
      context = new AudioContextConstructor({ latencyHint: "interactive" });
    } catch {
      context = new AudioContextConstructor();
    }
    this.context = context;

    // 全音源 → fxIn → dry / wet → マスター → コンプレッサ（リミッタ代用）→ Analyser → 出力
    const fxInput = context.createGain();
    const dryGain = createGainNode(context, Tuning.DRY_GAIN);
    const convolver = context.createConvolver();
    const wetGain = createGainNode(context, Tuning.REVERB_WET_GAIN);
    const masterGain = createGainNode(context, Tuning.MASTER_GAIN);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = Tuning.LIMITER_THRESHOLD_DB;
    compressor.knee.value = Tuning.LIMITER_KNEE_DB;
    compressor.ratio.value = Tuning.LIMITER_RATIO;
    compressor.attack.value = Tuning.LIMITER_ATTACK_SECONDS;
    compressor.release.value = Tuning.LIMITER_RELEASE_SECONDS;
    const analyser = context.createAnalyser();
    analyser.fftSize = Tuning.ANALYSER_FFT_SIZE;

    fxInput.connect(dryGain);
    dryGain.connect(masterGain);
    // IR が出来るまで convolver.buffer は null（無音）なので、その間は dry だけで鳴る
    fxInput.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(context.destination);

    // 声はダッキング用のバスを通す（pad は通さない）
    const voiceBus = createGainNode(context, 1);
    voiceBus.connect(fxInput);

    this.buildPad(context, fxInput);

    this.voiceBus = voiceBus;
    this.convolver = convolver;
    this.analyser = analyser;
    this.analyserData = new Float32Array(analyser.fftSize);
    this.analyserByteData = new Uint8Array(analyser.fftSize);
    this.canPan = typeof context.createStereoPanner === "function";

    context.addEventListener("statechange", this.handleStateChange);
    this.hasWiring = true;
  }

  /** 主音 + 5 度 + 9th のデチューンした持続音。energy の経路と comboEnd の膨らみの経路を並列に持つ */
  private buildPad(context: AudioContext, destination: AudioNode): void {
    const padMix = context.createGain();
    const weightSum = Tuning.PAD_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    Tuning.PAD_SEMITONES.forEach((semitone, index) => {
      const frequency = midiToFrequency(ROOT_MIDI + semitone);
      const oscillatorGain = Tuning.PAD_WEIGHTS[index] / (2 * weightSum);
      const oscillatorTypes: OscillatorType[] = ["sine", "triangle"];
      oscillatorTypes.forEach((type, typeIndex) => {
        const oscillator = context.createOscillator();
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.detune.value = typeIndex === 0 ? -Tuning.PAD_DETUNE_CENTS : Tuning.PAD_DETUNE_CENTS;
        const gain = createGainNode(context, oscillatorGain);
        oscillator.connect(gain);
        gain.connect(padMix);
        oscillator.start();
      });
    });

    const padFilter = context.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = Tuning.PAD_LOWPASS_MIN_HZ;
    padFilter.Q.value = 0.7;
    const padEnergyGain = createGainNode(context, 0);
    padMix.connect(padFilter);
    padFilter.connect(padEnergyGain);
    padEnergyGain.connect(destination);

    const swellFilter = context.createBiquadFilter();
    swellFilter.type = "lowpass";
    swellFilter.frequency.value = Tuning.PAD_SWELL_LOWPASS_HZ;
    swellFilter.Q.value = 0.7;
    const padSwellGain = createGainNode(context, 0);
    padMix.connect(swellFilter);
    swellFilter.connect(padSwellGain);
    padSwellGain.connect(destination);

    this.padFilter = padFilter;
    this.padEnergyGain = padEnergyGain;
    this.padSwellGain = padSwellGain;
  }

  private discardFailedContext(): void {
    const context = this.context;
    this.context = null;
    this.hasWiring = false;
    if (context !== null) {
      context.close().catch(() => undefined);
    }
  }

  // ---- 解錠（autoplay・iOS） -----------------------------------

  private readonly handleUnlockGesture = (): void => {
    this.tryResume();
    this.startSilentElement();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.tryResume();
  };

  private readonly handleStateChange = (): void => {
    try {
      if (this.isRunning()) this.applyEnergy(true);
    } catch (error) {
      this.recordError("statechange", error);
    }
  };

  /** pointerup / touchend / click / keydown は常駐させる（iOS の割り込み・バックグラウンド復帰でも鳴り直す） */
  private installUnlockListeners(): void {
    if (this.hasUnlockListeners) return;
    try {
      for (const type of UNLOCK_EVENT_TYPES) {
        window.addEventListener(type, this.handleUnlockGesture, { capture: true, passive: true });
      }
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      this.hasUnlockListeners = true;
    } catch (error) {
      this.recordError("installUnlockListeners", error);
    }
  }

  private tryResume(): void {
    const context = this.context;
    if (context === null || context.state === "running" || context.state === "closed") return;
    try {
      this.resumeAttempts += 1;
      context.resume().catch((error: unknown) => this.recordError("resume", error));
    } catch (error) {
      this.recordError("resume", error);
    }
  }

  /** iOS の消音スイッチでも鳴るようにする。audioSession が無い iOS だけ無音ループの <audio> で代替する */
  private configureAudioSession(): void {
    if (this.audioSessionType !== "unchecked") return;
    try {
      const navigatorWithSession = navigator as unknown as { audioSession?: { type?: string } };
      if ("audioSession" in navigator && navigatorWithSession.audioSession) {
        navigatorWithSession.audioSession.type = "playback";
        this.audioSessionType = String(navigatorWithSession.audioSession.type ?? "unknown");
        this.shouldUseSilentElement = false;
        return;
      }
      this.audioSessionType = "unavailable";
      this.shouldUseSilentElement = isAppleTouchDevice();
    } catch (error) {
      this.recordError("audioSession", error);
      this.audioSessionType = "error";
      this.shouldUseSilentElement = isAppleTouchDevice();
    }
  }

  private startSilentElement(): void {
    if (!this.shouldUseSilentElement) return;
    if (this.silentElementState === "playing" || this.silentElementState === "starting") return;
    try {
      if (this.silentElement === null) {
        const element = document.createElement("audio");
        element.src = buildSilentWavDataUri();
        element.loop = true;
        element.preload = "auto";
        element.setAttribute("playsinline", "");
        this.silentElement = element;
      }
      this.silentElementState = "starting";
      const playResult = this.silentElement.play();
      if (playResult !== undefined && typeof playResult.then === "function") {
        playResult
          .then(() => {
            this.silentElementState = "playing";
          })
          .catch((error: unknown) => {
            // pointerdown では活性化されないので失敗しうる。次の解錠ジェスチャで再試行する
            this.silentElementState = "failed";
            this.recordError("silentElement", error);
          });
      } else {
        this.silentElementState = "playing";
      }
    } catch (error) {
      this.silentElementState = "failed";
      this.recordError("silentElement", error);
    }
  }

  // ---- 素材の事前計算（setTimeout(0) で小分け） ----------------

  private schedulePrecompute(): void {
    if (this.hasScheduledPrecompute) return;
    this.hasScheduledPrecompute = true;
    setTimeout(() => {
      try {
        this.ensureNoiseBuffer();
        this.beginImpulse();
      } catch (error) {
        this.recordError("precompute", error);
      }
    }, 0);
  }

  /** 共有ノイズ。事前計算が間に合わない最初のタップでは同期で作る（0.5s 分なので短い） */
  private ensureNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer !== null) return this.noiseBuffer;
    const context = this.requireContext();
    const frameCount = Math.max(1, Math.round(context.sampleRate * Tuning.NOISE_BUFFER_SECONDS));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private beginImpulse(): void {
    if (this.impulseBuffer !== null || this.isImpulseReady) return;
    const context = this.requireContext();
    const frameCount = Math.max(1, Math.round(context.sampleRate * Tuning.REVERB_SECONDS));
    this.impulseBuffer = context.createBuffer(2, frameCount, context.sampleRate);
    this.impulseFrameCursor = 0;
    this.generateImpulseChunk();
  }

  /** 減衰するステレオノイズを、時間とともにカットオフが下がる 1 次ローパスに通す（頭は明るく尻尾は少し暗く） */
  private readonly generateImpulseChunk = (): void => {
    try {
      const context = this.context;
      const buffer = this.impulseBuffer;
      if (context === null || buffer === null) return;
      const sampleRate = buffer.sampleRate;
      const frameCount = buffer.length;
      const chunkStart = this.impulseFrameCursor;
      const chunkEnd = Math.min(frameCount, chunkStart + Tuning.REVERB_CHUNK_FRAMES);
      const predelayFrames = Math.round(Tuning.REVERB_PREDELAY_SECONDS * sampleRate);
      const fadeInFrames = Math.max(1, Math.round(Tuning.REVERB_FADE_IN_SECONDS * sampleRate));
      const decayFrames = Math.max(1, frameCount - predelayFrames);
      // チャンク内ではカットオフを一定とみなす（exp を毎サンプル計算しない）
      const progress = (chunkStart + chunkEnd) / 2 / frameCount;
      const cutoff = Tuning.REVERB_BRIGHT_HZ + (Tuning.REVERB_TAIL_HZ - Tuning.REVERB_BRIGHT_HZ) * progress;
      const smoothing = Math.exp((-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        const channel = buffer.getChannelData(channelIndex);
        let filterState = this.impulseFilterStates[channelIndex] ?? 0;
        for (let frame = chunkStart; frame < chunkEnd; frame += 1) {
          if (frame < predelayFrames) {
            channel[frame] = 0;
            continue;
          }
          const decayFrame = frame - predelayFrames;
          const envelope =
            Math.exp((-DECAY_TO_MINUS_60_DB * decayFrame) / decayFrames) * Math.min(1, decayFrame / fadeInFrames);
          filterState = (1 - smoothing) * (Math.random() * 2 - 1) + smoothing * filterState;
          channel[frame] = filterState * envelope;
        }
        this.impulseFilterStates[channelIndex] = filterState;
      }

      this.impulseFrameCursor = chunkEnd;
      if (chunkEnd < frameCount) {
        setTimeout(this.generateImpulseChunk, 0);
        return;
      }
      if (this.convolver !== null) {
        this.convolver.buffer = buffer;
        this.isImpulseReady = true;
      }
    } catch (error) {
      this.recordError("impulse", error);
    }
  };

  private impulseProgress(): number {
    if (this.isImpulseReady) return 1;
    if (this.impulseBuffer === null) return 0;
    return roundTo(this.impulseFrameCursor / this.impulseBuffer.length, 2);
  }

  // ---- 音色 ----------------------------------------------------

  private playPop(event: PopEvent): void {
    const context = this.requireContext();
    const size = clampUnit(finiteOr(event.size, 0.5));
    const x = clampUnit(finiteOr(event.x, 0.5));
    const midi = finiteOr(event.midi, Tuning.CROSSFADE_LOW_MIDI);
    const combo = Math.max(1, finiteOr(event.combo, 1));
    const isSwipe = event.kind === "swipe";
    const isChain = event.kind === "chain";

    this.registerPopForDensity();

    const kindGain = isSwipe ? Tuning.KIND_GAIN_SWIPE : isChain ? Tuning.KIND_GAIN_CHAIN : Tuning.KIND_GAIN_TAP;
    const startTime = context.currentTime;
    const voice = this.createVoice(startTime, panForX(x));
    voice.output.gain.value =
      Tuning.VOICE_GAIN * (Tuning.SIZE_GAIN_BASE + Tuning.SIZE_GAIN_RANGE * size) * kindGain;

    const comboProgress = Math.min(1, (combo - 1) / Math.max(1, Tuning.COMBO_SUSTAIN_FULL_COMBO - 1));
    const decayScale =
      (Tuning.DECAY_SCALE_BASE + Tuning.DECAY_SCALE_RANGE * size) * (1 + Tuning.COMBO_SUSTAIN_BONUS * comboProgress);
    let bellBlend = clampUnit(
      (midi - Tuning.CROSSFADE_LOW_MIDI) / (Tuning.CROSSFADE_HIGH_MIDI - Tuning.CROSSFADE_LOW_MIDI),
    );
    if (isChain) bellBlend += (1 - bellBlend) * Tuning.CHAIN_BELL_LEAN;
    // 等パワーのクロスフェード
    const marimbaWeight = Math.cos((bellBlend * Math.PI) / 2);
    const bellWeight = Math.sin((bellBlend * Math.PI) / 2);
    const brightness = isSwipe ? Tuning.SWIPE_BRIGHTNESS : 1;
    const frequency = midiToFrequency(midi);

    this.addPopClick(voice, startTime, size, isSwipe);
    if (marimbaWeight > MIN_TIMBRE_WEIGHT) {
      this.addMarimba(voice, {
        startTime,
        frequency,
        midi,
        weight: marimbaWeight,
        decayScale,
        brightness,
        fundamentalDecayScale: isSwipe ? Tuning.SWIPE_DECAY_SCALE : 1,
      });
    }
    if (bellWeight > MIN_TIMBRE_WEIGHT) {
      this.addBell(voice, { startTime, frequency, weight: bellWeight, decayScale, brightness });
    }
    this.finishVoice(voice);
  }

  private playMiss(x: number): void {
    const context = this.requireContext();
    const startTime = context.currentTime;
    const voice = this.createVoice(startTime, panForX(clampUnit(finiteOr(x, 0.5))), Tuning.MISS_LOWPASS_HZ);
    voice.output.gain.value = Tuning.VOICE_GAIN * Tuning.MISS_GAIN;
    const midi = Tuning.MISS_MIDI + (Math.random() * 2 - 1) * Tuning.MISS_PITCH_JITTER;
    const frequency = midiToFrequency(midi);
    // 強くミュートしたマリンバ: 基音と第 2 部分音だけを短く
    this.addPartial(voice, {
      startTime,
      frequency,
      peak: Tuning.MARIMBA_AMPLITUDES[0],
      attack: Tuning.MARIMBA_ATTACK_SECONDS,
      decay: Tuning.MISS_DECAY_SECONDS,
    });
    this.addPartial(voice, {
      startTime,
      frequency: frequency * Tuning.MARIMBA_RATIOS[1],
      peak: Tuning.MARIMBA_AMPLITUDES[1],
      attack: Tuning.MARIMBA_ATTACK_SECONDS,
      decay: Tuning.MISS_DECAY_SECONDS * 0.5,
    });
    this.addNoiseBurst(voice, {
      startTime,
      duration: Tuning.MALLET_NOISE_SECONDS,
      centerFrequency: Tuning.MISS_LOWPASS_HZ,
      q: 1,
      peak: Tuning.MALLET_NOISE_GAIN,
      filterType: "bandpass",
    });
    this.finishVoice(voice);
  }

  private playMilestone(level: number, x: number): void {
    const context = this.requireContext();
    const safeLevel = Math.max(1, Math.floor(finiteOr(level, 1)));
    const notes = milestoneGlissando(safeLevel);
    const lengthScale =
      1 + Tuning.MILESTONE_LENGTH_PER_LEVEL * (Math.min(safeLevel, Tuning.MILESTONE_MAX_LEVEL) - 1);
    // 割った側から反対側へ広がるように振る
    const direction = clampUnit(finiteOr(x, 0.5)) <= 0.5 ? 1 : -1;
    const now = context.currentTime;
    notes.forEach((midi, index) => {
      const startTime = now + index * Tuning.MILESTONE_STEP_SECONDS;
      const progress = notes.length > 1 ? index / (notes.length - 1) : 0.5;
      const pan = direction * Tuning.MILESTONE_PAN_WIDTH * (2 * progress - 1);
      const voice = this.createVoice(startTime, pan);
      voice.output.gain.value = Tuning.VOICE_GAIN * Tuning.MILESTONE_GAIN;
      this.addBell(voice, {
        startTime,
        frequency: midiToFrequency(midi),
        weight: 1,
        decayScale: lengthScale,
        brightness: 1,
      });
      this.finishVoice(voice);
    });
  }

  private playComboEnd(combo: number): void {
    const safeCombo = finiteOr(combo, 0);
    if (safeCombo < Tuning.COMBO_END_MIN_COMBO) return;
    const context = this.requireContext();
    const intensity = 0.4 + 0.6 * clampUnit(safeCombo / Tuning.COMBO_END_FULL_COMBO);
    const now = context.currentTime;

    const padSwellGain = this.padSwellGain;
    if (padSwellGain !== null) {
      const peakTime = now + Tuning.PAD_SWELL_ATTACK_SECONDS;
      holdParam(padSwellGain.gain, now);
      padSwellGain.gain.linearRampToValueAtTime(Tuning.PAD_SWELL_GAIN * intensity, peakTime);
      padSwellGain.gain.setTargetAtTime(0, peakTime, Tuning.PAD_SWELL_RELEASE_SECONDS);
    }

    const startTime = now + Tuning.COMBO_END_BELL_DELAY_SECONDS;
    const voice = this.createVoice(startTime, 0);
    voice.output.gain.value = Tuning.VOICE_GAIN * Tuning.COMBO_END_BELL_GAIN * intensity;
    this.addBell(voice, {
      startTime,
      frequency: midiToFrequency(Tuning.COMBO_END_BELL_MIDI),
      weight: 1,
      decayScale: 1.2,
      brightness: 1,
    });
    this.finishVoice(voice);
  }

  /** 浮遊生物を驚かせたときの種類ごとの効果音（architecture.md 6 節 creature*） */
  private playCreature(event: CreatureEvent): void {
    const context = this.requireContext();
    const startTime = context.currentTime;
    const pan = panForX(clampUnit(finiteOr(event.x, 0.5)));

    // クシクラゲは 1 音ごとに定位を散らすので声を分ける
    if (event.species === "ctenophore") {
      Tuning.CREATURE_CTENOPHORE_MIDIS.forEach((midi, index) => {
        const noteStart = startTime + index * Tuning.CREATURE_CTENOPHORE_STEP_SECONDS;
        const spread = (index % 2 === 0 ? -1 : 1) * Tuning.CREATURE_CTENOPHORE_PAN_SPREAD;
        const voice = this.createVoice(noteStart, pan + spread);
        voice.output.gain.value = Tuning.VOICE_GAIN * Tuning.CREATURE_GAIN;
        this.addBell(voice, {
          startTime: noteStart,
          frequency: midiToFrequency(midi),
          weight: Tuning.CREATURE_CTENOPHORE_BELL_WEIGHT,
          decayScale: Tuning.CREATURE_CTENOPHORE_DECAY_SCALE,
          brightness: Tuning.CREATURE_CTENOPHORE_BRIGHTNESS,
        });
        this.finishVoice(voice);
      });
      return;
    }

    const voice = this.createVoice(startTime, pan);
    voice.output.gain.value = Tuning.VOICE_GAIN * Tuning.CREATURE_GAIN;
    switch (event.species) {
      case "ray":
        this.addRaySound(voice, startTime);
        break;
      case "clione":
        this.addClioneSound(voice, startTime);
        break;
      case "octopus":
        this.addOctopusSound(voice, startTime);
        break;
      case "seadragon":
        this.addSeadragonSound(voice, startTime);
        break;
      case "jellyfish":
        this.addJellyfishSound(voice, startTime);
        break;
    }
    this.finishVoice(voice);
  }

  /** エイ: 翼の風切り 2 回 + 柔らかいマリンバ */
  private addRaySound(voice: Voice, startTime: number): void {
    for (let beat = 0; beat < 2; beat++) {
      this.addNoiseSweep(voice, {
        startTime: startTime + beat * Tuning.CREATURE_RAY_WHOOSH_GAP_SECONDS,
        duration: Tuning.CREATURE_RAY_WHOOSH_SECONDS,
        fromHz: Tuning.CREATURE_RAY_WHOOSH_FROM_HZ,
        toHz: Tuning.CREATURE_RAY_WHOOSH_TO_HZ,
        q: 1.4,
        peak: Tuning.CREATURE_RAY_WHOOSH_GAIN * (beat === 0 ? 1 : 0.7),
        attack: 0.08,
        filterType: "bandpass",
      });
    }
    this.addMarimba(voice, {
      startTime,
      frequency: midiToFrequency(Tuning.CREATURE_RAY_MIDI),
      midi: Tuning.CREATURE_RAY_MIDI,
      weight: Tuning.CREATURE_RAY_TONE_WEIGHT,
      decayScale: 0.8,
      brightness: 0.6,
      fundamentalDecayScale: 1,
    });
  }

  /** クリオネ: 短いベル 2 音の上昇 + 「ピッ」 */
  private addClioneSound(voice: Voice, startTime: number): void {
    Tuning.CREATURE_CLIONE_MIDIS.forEach((midi, index) => {
      this.addBell(voice, {
        startTime: startTime + index * Tuning.CREATURE_CLIONE_STEP_SECONDS,
        frequency: midiToFrequency(midi),
        weight: Tuning.CREATURE_CLIONE_BELL_WEIGHT,
        decayScale: Tuning.CREATURE_CLIONE_DECAY_SCALE,
        brightness: 0.8,
      });
    });
    this.addGlide(voice, {
      startTime,
      fromHz: Tuning.CREATURE_CLIONE_CHIRP_FROM_HZ,
      toHz: Tuning.CREATURE_CLIONE_CHIRP_TO_HZ,
      glideSeconds: 0.06,
      peak: Tuning.CREATURE_CLIONE_CHIRP_GAIN,
      attack: 0.004,
      decay: 0.08,
    });
  }

  /** グラスオクトパス: 「ポコッ」2 回 + 噴射 */
  private addOctopusSound(voice: Voice, startTime: number): void {
    for (const bloop of Tuning.CREATURE_OCTOPUS_BLOOPS) {
      this.addGlide(voice, {
        startTime: startTime + bloop.delay,
        fromHz: bloop.fromHz,
        toHz: bloop.toHz,
        glideSeconds: Tuning.CREATURE_OCTOPUS_BLOOP_GLIDE_SECONDS,
        peak: bloop.gain,
        attack: 0.005,
        decay: Tuning.CREATURE_OCTOPUS_BLOOP_DECAY_SECONDS,
      });
    }
    this.addNoiseSweep(voice, {
      startTime,
      duration: Tuning.CREATURE_OCTOPUS_JET_SECONDS,
      fromHz: Tuning.CREATURE_OCTOPUS_JET_FROM_HZ,
      toHz: Tuning.CREATURE_OCTOPUS_JET_TO_HZ,
      q: 0.7,
      peak: Tuning.CREATURE_OCTOPUS_JET_GAIN,
      attack: 0.02,
      filterType: "lowpass",
    });
  }

  /** リーフィーシードラゴン: 不規則なカサカサ + ミュートしたマリンバ */
  private addSeadragonSound(voice: Voice, startTime: number): void {
    for (let index = 0; index < Tuning.CREATURE_SEADRAGON_RUSTLE_COUNT; index++) {
      this.addNoiseBurst(voice, {
        startTime: startTime + Math.random() * Tuning.CREATURE_SEADRAGON_RUSTLE_SPREAD_SECONDS,
        duration: 0.015 + Math.random() * 0.015,
        centerFrequency:
          Tuning.CREATURE_SEADRAGON_RUSTLE_MIN_HZ +
          Math.random() * (Tuning.CREATURE_SEADRAGON_RUSTLE_MAX_HZ - Tuning.CREATURE_SEADRAGON_RUSTLE_MIN_HZ),
        q: 2,
        peak: Tuning.CREATURE_SEADRAGON_RUSTLE_GAIN * (0.6 + 0.4 * Math.random()),
        filterType: "bandpass",
      });
    }
    this.addMarimba(voice, {
      startTime,
      frequency: midiToFrequency(Tuning.CREATURE_SEADRAGON_MIDI),
      midi: Tuning.CREATURE_SEADRAGON_MIDI,
      weight: Tuning.CREATURE_SEADRAGON_TONE_WEIGHT,
      decayScale: Tuning.CREATURE_SEADRAGON_TONE_DECAY_SCALE,
      brightness: 1,
      fundamentalDecayScale: 1,
    });
  }

  /** クラゲ: 揺れる柔らかい上昇サイン「ぽよん」を 2 回 */
  private addJellyfishSound(voice: Voice, startTime: number): void {
    Tuning.CREATURE_JELLYFISH_GAINS.forEach((gain, index) => {
      this.addGlide(voice, {
        startTime: startTime + index * Tuning.CREATURE_JELLYFISH_GAP_SECONDS,
        fromHz: midiToFrequency(Tuning.CREATURE_JELLYFISH_FROM_MIDI),
        toHz: midiToFrequency(Tuning.CREATURE_JELLYFISH_TO_MIDI),
        glideSeconds: Tuning.CREATURE_JELLYFISH_GLIDE_SECONDS,
        peak: gain,
        attack: Tuning.CREATURE_JELLYFISH_ATTACK_SECONDS,
        decay: Tuning.CREATURE_JELLYFISH_DECAY_SECONDS,
        vibratoHz: Tuning.CREATURE_JELLYFISH_VIBRATO_HZ,
        vibratoCents: Tuning.CREATURE_JELLYFISH_VIBRATO_CENTS,
      });
    });
  }

  /** 周波数が滑らかに動くサイン 1 本（指数カーブで移動）。任意でビブラートをかける */
  private addGlide(
    voice: Voice,
    options: {
      startTime: number;
      fromHz: number;
      toHz: number;
      glideSeconds: number;
      peak: number;
      attack: number;
      decay: number;
      vibratoHz?: number;
      vibratoCents?: number;
    },
  ): void {
    const context = this.requireContext();
    const { startTime, fromHz, toHz, glideSeconds, peak, attack, decay } = options;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(fromHz, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, startTime + glideSeconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(Tuning.MIN_GAIN, startTime + attack + decay);
    oscillator.connect(gain);
    gain.connect(voice.input);
    const stopTime = startTime + attack + decay + SOURCE_TAIL_SECONDS;
    oscillator.start(startTime);
    oscillator.stop(stopTime);
    voice.nodes.push(oscillator, gain);
    voice.sources.push({ node: oscillator, stopTime });

    const vibratoCents = options.vibratoCents ?? 0;
    if (vibratoCents <= 0) return;
    const vibrato = context.createOscillator();
    vibrato.frequency.value = options.vibratoHz ?? Tuning.BELL_VIBRATO_HZ;
    const depth = context.createGain();
    depth.gain.value = vibratoCents;
    vibrato.connect(depth);
    depth.connect(oscillator.detune);
    vibrato.start(startTime);
    vibrato.stop(stopTime);
    voice.nodes.push(vibrato, depth);
    voice.sources.push({ node: vibrato, stopTime });
  }

  /** フィルタの周波数が動く帯域ノイズ（風切り・噴射）。共有ノイズをループさせて長さの制約を外す */
  private addNoiseSweep(
    voice: Voice,
    options: {
      startTime: number;
      duration: number;
      fromHz: number;
      toHz: number;
      q: number;
      peak: number;
      attack: number;
      filterType: BiquadFilterType;
    },
  ): void {
    const context = this.requireContext();
    const { startTime, duration, fromHz, toHz, q, peak, attack, filterType } = options;
    if (!(peak > Tuning.MIN_GAIN * 10) || !(duration > attack)) return;
    const buffer = this.ensureNoiseBuffer();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const nyquistLimit = context.sampleRate * Tuning.PARTIAL_NYQUIST_RATIO;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.min(fromHz, nyquistLimit), startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.min(toHz, nyquistLimit), startTime + duration);
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(Tuning.MIN_GAIN, startTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);
    const stopTime = startTime + duration + SOURCE_TAIL_SECONDS;
    source.start(startTime, Math.random() * buffer.duration);
    source.stop(stopTime);
    voice.nodes.push(source, filter, gain);
    voice.sources.push({ node: source, stopTime });
  }

  /** 泡が割れる感触の要: 帯域ノイズ（大きい泡ほど低く長い）+ 上昇サイン「プッ」 */
  private addPopClick(voice: Voice, startTime: number, size: number, isSwipe: boolean): void {
    const context = this.requireContext();
    const duration = Tuning.CLICK_MIN_SECONDS + (Tuning.CLICK_MAX_SECONDS - Tuning.CLICK_MIN_SECONDS) * size;
    const center =
      (Tuning.CLICK_CENTER_HIGH_HZ + (Tuning.CLICK_CENTER_LOW_HZ - Tuning.CLICK_CENTER_HIGH_HZ) * size) *
      (isSwipe ? Tuning.SWIPE_CLICK_PITCH : 1);
    this.addNoiseBurst(voice, {
      startTime,
      duration,
      centerFrequency: center,
      q: Tuning.CLICK_Q,
      peak: Tuning.CLICK_GAIN,
      filterType: "bandpass",
    });

    const plipStart = Tuning.PLIP_START_HIGH_HZ + (Tuning.PLIP_START_LOW_HZ - Tuning.PLIP_START_HIGH_HZ) * size;
    const plipEnd = startTime + Tuning.PLIP_SECONDS;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(plipStart, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(plipStart * Tuning.PLIP_SWEEP_RATIO, plipEnd);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(Tuning.PLIP_GAIN, startTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(Tuning.MIN_GAIN, plipEnd);
    oscillator.connect(gain);
    gain.connect(voice.input);
    const stopTime = plipEnd + SOURCE_TAIL_SECONDS;
    oscillator.start(startTime);
    oscillator.stop(stopTime);
    voice.nodes.push(oscillator, gain);
    voice.sources.push({ node: oscillator, stopTime });
  }

  /** モーダル合成: 部分音 1 / 3.93 / 9.54 の減衰サイン + 3ms のマレットのクリック */
  private addMarimba(
    voice: Voice,
    options: {
      startTime: number;
      frequency: number;
      midi: number;
      weight: number;
      decayScale: number;
      brightness: number;
      fundamentalDecayScale: number;
    },
  ): void {
    // 低い音は第 2 部分音を足して、基音が出ない小型スピーカーでも芯を残す
    const lowNoteBoost =
      clampUnit((Tuning.MARIMBA_LOW_NOTE_MIDI + 11 - options.midi) / 11) * Tuning.MARIMBA_LOW_NOTE_BOOST;
    Tuning.MARIMBA_RATIOS.forEach((ratio, index) => {
      let amplitude: number = Tuning.MARIMBA_AMPLITUDES[index];
      if (index === 1) amplitude += lowNoteBoost;
      if (index > 0) amplitude *= options.brightness;
      const decay =
        Tuning.MARIMBA_DECAYS[index] * options.decayScale * (index === 0 ? options.fundamentalDecayScale : 1);
      this.addPartial(voice, {
        startTime: options.startTime,
        frequency: options.frequency * ratio,
        peak: amplitude * options.weight,
        attack: Tuning.MARIMBA_ATTACK_SECONDS,
        decay,
      });
    });
    const malletCenter = Math.min(
      Tuning.MALLET_MAX_HZ,
      Math.max(Tuning.MALLET_MIN_HZ, options.frequency * Tuning.MALLET_CENTER_RATIO),
    );
    this.addNoiseBurst(voice, {
      startTime: options.startTime,
      duration: Tuning.MALLET_NOISE_SECONDS,
      centerFrequency: malletCenter,
      q: 1.5,
      peak: Tuning.MALLET_NOISE_GAIN * options.weight,
      filterType: "bandpass",
    });
  }

  /** 加算合成: 非整数倍音 1 / 2.76 / 5.40 / 8.93、長い減衰、遅れてかかるごく軽いビブラート */
  private addBell(
    voice: Voice,
    options: { startTime: number; frequency: number; weight: number; decayScale: number; brightness: number },
  ): void {
    const context = this.requireContext();
    const partials: Array<{ oscillator: OscillatorNode; stopTime: number }> = [];
    Tuning.BELL_RATIOS.forEach((ratio, index) => {
      const brightness = index > 0 ? options.brightness : 1;
      const partial = this.addPartial(voice, {
        startTime: options.startTime,
        frequency: options.frequency * ratio,
        peak: Tuning.BELL_AMPLITUDES[index] * options.weight * Tuning.BELL_GAIN_TRIM * brightness,
        attack: Tuning.BELL_ATTACK_SECONDS,
        decay: Tuning.BELL_DECAYS[index] * options.decayScale,
      });
      if (partial !== null) partials.push(partial);
    });
    if (partials.length === 0 || Tuning.BELL_VIBRATO_CENTS <= 0) return;

    const vibrato = context.createOscillator();
    vibrato.frequency.value = Tuning.BELL_VIBRATO_HZ;
    const depth = context.createGain();
    depth.gain.setValueAtTime(0, options.startTime);
    depth.gain.linearRampToValueAtTime(Tuning.BELL_VIBRATO_CENTS, options.startTime + Tuning.BELL_VIBRATO_DELAY_SECONDS);
    vibrato.connect(depth);
    for (const partial of partials) depth.connect(partial.oscillator.detune);
    const stopTime = Math.max(...partials.map((partial) => partial.stopTime));
    vibrato.start(options.startTime);
    vibrato.stop(stopTime);
    voice.nodes.push(vibrato, depth);
    voice.sources.push({ node: vibrato, stopTime });
  }

  /** 減衰するサイン 1 本。ナイキスト付近の部分音と、聞こえないほど小さい部分音は作らない */
  private addPartial(voice: Voice, options: PartialOptions): { oscillator: OscillatorNode; stopTime: number } | null {
    const context = this.requireContext();
    const { startTime, frequency, peak, attack, decay } = options;
    if (!(frequency > 0) || frequency > context.sampleRate * Tuning.PARTIAL_NYQUIST_RATIO) return null;
    if (!(peak > Tuning.MIN_GAIN * 10) || !(attack > 0) || !(decay > 0)) return null;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(Tuning.MIN_GAIN, startTime + attack + decay);
    oscillator.connect(gain);
    gain.connect(voice.input);
    const stopTime = startTime + attack + decay + SOURCE_TAIL_SECONDS;
    oscillator.start(startTime);
    oscillator.stop(stopTime);
    voice.nodes.push(oscillator, gain);
    voice.sources.push({ node: oscillator, stopTime });
    return { oscillator, stopTime };
  }

  /** 共有ノイズの一部を切り出して帯域を絞った短い破裂 */
  private addNoiseBurst(voice: Voice, options: NoiseBurstOptions): void {
    const context = this.requireContext();
    const { startTime, duration, centerFrequency, q, peak, filterType } = options;
    if (!(peak > Tuning.MIN_GAIN * 10) || !(duration > 0)) return;
    const buffer = this.ensureNoiseBuffer();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = Math.min(centerFrequency, context.sampleRate * Tuning.PARTIAL_NYQUIST_RATIO);
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(peak, startTime);
    gain.gain.exponentialRampToValueAtTime(Tuning.MIN_GAIN, startTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);
    const maxOffset = Math.max(0, buffer.duration - duration - SOURCE_TAIL_SECONDS * 2);
    const stopTime = startTime + duration + SOURCE_TAIL_SECONDS;
    source.start(startTime, Math.random() * maxOffset);
    source.stop(stopTime);
    voice.nodes.push(source, filter, gain);
    voice.sources.push({ node: source, stopTime });
  }

  // ---- 声の管理 ------------------------------------------------

  private createVoice(startTime: number, pan: number, lowpassHz?: number): Voice {
    const context = this.requireContext();
    const voiceBus = this.voiceBus;
    if (voiceBus === null) throw new Error("voice bus is not wired");
    this.makeRoomForVoice();

    const output = context.createGain();
    const nodes: AudioNode[] = [output];
    if (this.canPan) {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, finiteOr(pan, 0)));
      output.connect(panner);
      panner.connect(voiceBus);
      nodes.push(panner);
    } else {
      output.connect(voiceBus);
    }
    let input: AudioNode = output;
    if (lowpassHz !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpassHz;
      filter.connect(output);
      input = filter;
      nodes.push(filter);
    }
    const voice: Voice = { startTime, input, output, nodes, sources: [], isReleasing: false, isDisposed: false };
    this.activeVoices.push(voice);
    return voice;
  }

  /** 最後に止まる音源の ended で声ごと切り離す（ノードを溜めない） */
  private finishVoice(voice: Voice): void {
    if (voice.sources.length === 0) {
      this.disposeVoice(voice, false);
      return;
    }
    let lastSource = voice.sources[0];
    for (const source of voice.sources) {
      if (source.stopTime > lastSource.stopTime) lastSource = source;
    }
    lastSource.node.onended = () => this.disposeVoice(voice, false);
  }

  /** 上限を超えそうなら最も古い声を奪う。止まっている間は時間が進まずフェードが終わらないので即座に切る */
  private makeRoomForVoice(): void {
    const isRunning = this.isRunning();
    const limit = isRunning ? Tuning.MAX_VOICES : Tuning.SUSPENDED_MAX_VOICES;
    let soundingCount = this.countSoundingVoices();
    if (soundingCount < limit) return;
    for (const voice of [...this.activeVoices]) {
      if (soundingCount < limit) break;
      if (voice.isReleasing) continue;
      if (isRunning) {
        this.releaseVoice(voice);
      } else {
        this.disposeVoice(voice, true);
      }
      soundingCount -= 1;
    }
  }

  private releaseVoice(voice: Voice): void {
    const context = this.requireContext();
    voice.isReleasing = true;
    const now = context.currentTime;
    const fadeEnd = now + Tuning.VOICE_STEAL_FADE_SECONDS;
    holdParam(voice.output.gain, now);
    voice.output.gain.linearRampToValueAtTime(0, fadeEnd);
    // 未来に鳴る予定の声（グリッサンド）も、開始後に止めて ended を確実に発火させる
    const stopTime = Math.max(fadeEnd + STOP_MARGIN_SECONDS, voice.startTime + STOP_MARGIN_SECONDS);
    for (const source of voice.sources) {
      if (source.stopTime <= stopTime) continue;
      try {
        source.node.stop(stopTime);
        source.stopTime = stopTime;
      } catch (error) {
        this.recordError("releaseVoice", error);
      }
    }
  }

  private disposeVoice(voice: Voice, shouldStopSources: boolean): void {
    if (voice.isDisposed) return;
    voice.isDisposed = true;
    for (const source of voice.sources) {
      source.node.onended = null;
      if (shouldStopSources) {
        try {
          source.node.stop();
        } catch {
          // すでに止まっている音源は無視してよい
        }
      }
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // 接続が無いノードは無視してよい
      }
    }
    voice.sources.length = 0;
    voice.nodes.length = 0;
    const index = this.activeVoices.indexOf(voice);
    if (index >= 0) this.activeVoices.splice(index, 1);
  }

  private countSoundingVoices(): number {
    let count = 0;
    for (const voice of this.activeVoices) {
      if (!voice.isReleasing) count += 1;
    }
    return count;
  }

  // ---- energy・ダッキング・振幅 --------------------------------

  private applyEnergy(isForced: boolean): void {
    const context = this.context;
    const padEnergyGain = this.padEnergyGain;
    const padFilter = this.padFilter;
    if (context === null || padEnergyGain === null || padFilter === null) return;
    const now = context.currentTime;
    const target = this.targetEnergy;
    if (!isForced) {
      const hasMeaningfulChange =
        Math.abs(target - this.appliedEnergy) >= Tuning.PAD_UPDATE_THRESHOLD ||
        (target === 0 && this.appliedEnergy !== 0);
      if (!hasMeaningfulChange) return;
      if (now - this.lastEnergyUpdateTime < Tuning.PAD_UPDATE_INTERVAL_SECONDS) return;
    }
    const gain = Tuning.PAD_MAX_GAIN * Math.pow(target, Tuning.PAD_GAIN_CURVE);
    const cutoff =
      Tuning.PAD_LOWPASS_MIN_HZ * Math.pow(Tuning.PAD_LOWPASS_MAX_HZ / Tuning.PAD_LOWPASS_MIN_HZ, target);
    padEnergyGain.gain.setTargetAtTime(gain, now, Tuning.PAD_SMOOTHING_SECONDS);
    padFilter.frequency.setTargetAtTime(cutoff, now, Tuning.PAD_SMOOTHING_SECONDS);
    this.appliedEnergy = target;
    this.lastEnergyUpdateTime = now;
  }

  private registerPopForDensity(): void {
    const now = performance.now();
    this.recentPopTimes.push(now);
    this.updateDensityDuck(now);
  }

  /** 直近 DENSITY_DUCK_WINDOW_SECONDS の pop 数で声のバスを緩やかに下げる */
  private updateDensityDuck(nowMilliseconds: number): void {
    const windowStart = nowMilliseconds - Tuning.DENSITY_DUCK_WINDOW_SECONDS * 1000;
    while (this.recentPopTimes.length > 0 && this.recentPopTimes[0] < windowStart) {
      this.recentPopTimes.shift();
    }
    const count = this.recentPopTimes.length;
    if (count === this.lastDuckCount) return;
    const context = this.context;
    const voiceBus = this.voiceBus;
    // 止まっている間は自動化イベントを積まない（再開後の最初の変化で追いつく）
    if (context === null || voiceBus === null || context.state !== "running") return;
    const excess = Math.max(0, count - Tuning.DENSITY_DUCK_FREE_POPS);
    const target = Math.max(Tuning.DENSITY_DUCK_MIN_GAIN, 1 / (1 + Tuning.DENSITY_DUCK_PER_POP * excess));
    const timeConstant =
      target < this.duckTarget ? Tuning.DENSITY_DUCK_ATTACK_SECONDS : Tuning.DENSITY_DUCK_RELEASE_SECONDS;
    voiceBus.gain.setTargetAtTime(target, context.currentTime, timeConstant);
    this.lastDuckCount = count;
    this.duckTarget = target;
  }

  private readAnalyserRms(analyser: AnalyserNode): number {
    let sumOfSquares = 0;
    if (typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(this.analyserData);
      for (let index = 0; index < this.analyserData.length; index += 1) {
        const sample = this.analyserData[index];
        sumOfSquares += sample * sample;
      }
      return Math.sqrt(sumOfSquares / Math.max(1, this.analyserData.length));
    }
    analyser.getByteTimeDomainData(this.analyserByteData);
    for (let index = 0; index < this.analyserByteData.length; index += 1) {
      const sample = (this.analyserByteData[index] - 128) / 128;
      sumOfSquares += sample * sample;
    }
    return Math.sqrt(sumOfSquares / Math.max(1, this.analyserByteData.length));
  }

  // ---- 共通 ----------------------------------------------------

  /** 配線が済み、閉じていないときだけ鳴らす（止まっている間も呼び出し自体は安全） */
  private canPlay(): boolean {
    return this.hasWiring && this.context !== null && this.context.state !== "closed";
  }

  private isRunning(): boolean {
    return this.context !== null && this.context.state === "running";
  }

  private requireContext(): AudioContext {
    if (this.context === null) throw new Error("audio context is not created");
    return this.context;
  }

  private recordError(where: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = `${where}: ${message}`;
    this.errorCount += 1;
    if (this.errorCount <= MAX_LOGGED_ERRORS) {
      console.warn("[prism-audio]", { where, error: message });
    }
  }
}

// ---- 純粋関数 --------------------------------------------------

function createGainNode(context: BaseAudioContext, value: number): GainNode {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}

/** 進行中の自動化をいまの値で止める（cancelAndHoldAtTime が無いブラウザでは近似する） */
function holdParam(param: AudioParam, time: number): void {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(time);
    return;
  }
  const currentValue = param.value;
  param.cancelScheduledValues(time);
  param.setValueAtTime(currentValue, time);
}

function panForX(x: number): number {
  return (x * 2 - 1) * Tuning.PAN_WIDTH;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundTo(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function isAppleTouchDevice(): boolean {
  try {
    const userAgent = navigator.userAgent ?? "";
    if (/iPad|iPhone|iPod/.test(userAgent)) return true;
    // iPadOS はデスクトップの UA を名乗るので、タッチ点数で見分ける
    return /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/** 0.1 秒の無音 WAV（8kHz / 16bit / モノラル）の data URI */
function buildSilentWavDataUri(): string {
  const sampleRate = 8000;
  const frameCount = 800;
  const dataSize = frameCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
