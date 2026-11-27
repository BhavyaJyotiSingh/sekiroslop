import type { MemeSfxKind, PowerUpKind } from "@sekiroslop/shared";

/**
 * Hybrid Web Audio API sound engine combining real recorded CC0 combat/foley WAV samples,
 * Indian meme hit cues, and Sekiro-inspired steel-modal / physical-modeling synthesis
 * for crisp deflections, blocks, perilous attack warnings, combat arts, and taiko/bell cues.
 */

const SAMPLE_MANIFEST = {
  lockOn: "/assets/audio/ui_click.wav",
  // SekiroSoundpack1.20.1-1.0.0 — 7 authentic blade slash hits, 9 steel clashes, and posture-break/deathblow
  bladeHit1: "/assets/audio/sekiro/blade_hit1.ogg",
  bladeHit2: "/assets/audio/sekiro/blade_hit2.ogg",
  bladeHit3: "/assets/audio/sekiro/blade_hit3.ogg",
  bladeHit4: "/assets/audio/sekiro/blade_hit4.ogg",
  bladeHit5: "/assets/audio/sekiro/blade_hit5.ogg",
  bladeHit6: "/assets/audio/sekiro/blade_hit6.ogg",
  bladeHit7: "/assets/audio/sekiro/blade_hit7.ogg",
  clash0: "/assets/audio/sekiro/clash.ogg",
  clash1: "/assets/audio/sekiro/clash1.ogg",
  clash2: "/assets/audio/sekiro/clash2.ogg",
  clash3: "/assets/audio/sekiro/clash3.ogg",
  clash4: "/assets/audio/sekiro/clash4.ogg",
  clash5: "/assets/audio/sekiro/clash5.ogg",
  clash6: "/assets/audio/sekiro/clash6.ogg",
  clash7: "/assets/audio/sekiro/clash7.ogg",
  clash8: "/assets/audio/sekiro/clash8.ogg",
  neutralizeMobs: "/assets/audio/sekiro/neutralize_mobs.ogg",
} as const;

const BLADE_HIT_KEYS = [
  "bladeHit1",
  "bladeHit2",
  "bladeHit3",
  "bladeHit4",
  "bladeHit5",
  "bladeHit6",
  "bladeHit7",
] as const satisfies readonly (keyof typeof SAMPLE_MANIFEST)[];

const CLASH_KEYS = [
  "clash0",
  "clash1",
  "clash2",
  "clash3",
  "clash4",
  "clash5",
  "clash6",
  "clash7",
  "clash8",
] as const satisfies readonly (keyof typeof SAMPLE_MANIFEST)[];

const MEME_MANIFEST: Record<MemeSfxKind, string> = {
  aayein: "/assets/audio/memes/aayein.mp3",
  roberto: "/assets/audio/effects/roberto.mp3",
  fahh: "/assets/audio/effects/fahh.mp3",
  sekiroDeath: "/assets/audio/effects/sekiro_death.mp3",
};

const MEME_HIT_COOLDOWN_SEC = 2.2;
const MEME_HIT_VOLUME = 0.68;
const MEME_FADE_OUT_SEC = 0.25;
const PERILOUS_COOLDOWN_SEC = 0.65;

type SampleKey = keyof typeof SAMPLE_MANIFEST;
type MemeKey = MemeSfxKind;

const AUDIO_STORAGE_KEY = "sekiroslop_audio_v1";

function loadAudioSettings(): { masterVolume: number; footstepVolume: number } {
  if (typeof window === "undefined") {
    return { masterVolume: 1.0, footstepVolume: 1.0 };
  }
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return { masterVolume: 1.0, footstepVolume: 1.0 };
    const parsed = JSON.parse(raw) as { masterVolume?: unknown; footstepVolume?: unknown };
    const clamp = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
    return {
      masterVolume: clamp(parsed.masterVolume, 1.0),
      footstepVolume: clamp(parsed.footstepVolume, 1.0),
    };
  } catch {
    return { masterVolume: 1.0, footstepVolume: 1.0 };
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private buffers = new Map<SampleKey, AudioBuffer>();
  private memeBuffers = new Map<MemeKey, AudioBuffer>();
  private activeMemeSource: AudioBufferSourceNode | null = null;
  private activeMemeGain: GainNode | null = null;
  private lastMemeAt = -MEME_HIT_COOLDOWN_SEC;
  private lastPerilousAt = -PERILOUS_COOLDOWN_SEC;
  private loadingStarted = false;
  private muted = false;
  private stepFlip = false;
  private lastClashIdx = -1;
  private lastBladeHitIdx = -1;
  private masterVolume = loadAudioSettings().masterVolume;
  private footstepVolume = loadAudioSettings().footstepVolume;

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public getFootstepVolume(): number {
    return this.footstepVolume;
  }

  private persistAudioSettings(): void {
    try {
      window.localStorage.setItem(
        AUDIO_STORAGE_KEY,
        JSON.stringify({
          masterVolume: this.masterVolume,
          footstepVolume: this.footstepVolume,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100;
    this.persistAudioSettings();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.85 * this.masterVolume,
        this.ctx.currentTime,
        0.03
      );
    }
  }

  public setFootstepVolume(volume: number): void {
    this.footstepVolume = Math.round(Math.min(1, Math.max(0, volume)) * 100) / 100;
    this.persistAudioSettings();
  }

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.85 * this.masterVolume;

      // Soft-limiter between masterGain and destination so overlapping combat/meme SFX never clip
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(-10, this.ctx.currentTime);
      limiter.knee.setValueAtTime(12, this.ctx.currentTime);
      limiter.ratio.setValueAtTime(12, this.ctx.currentTime);
      limiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
      limiter.release.setValueAtTime(0.18, this.ctx.currentTime);

      this.masterGain.connect(limiter);
      limiter.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    if (!this.loadingStarted) {
      this.loadingStarted = true;
      void this.preloadSamples();
    }
  }

  private async preloadSamples(): Promise<void> {
    if (!this.ctx) return;
    const entries = Object.entries(SAMPLE_MANIFEST) as [SampleKey, string][];
    const coreLoads = entries.map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        if (!this.ctx) return;
        const decoded = await this.ctx.decodeAudioData(arr);
        this.buffers.set(key, decoded);
      } catch {
        // Graceful fallback to synthesis if any sample fails to decode
      }
    });

    const memeEntries = Object.entries(MEME_MANIFEST) as [MemeKey, string][];
    const memeLoads = memeEntries.map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        if (!this.ctx || arr.byteLength === 0) return;
        const decoded = await this.ctx.decodeAudioData(arr);
        this.memeBuffers.set(key, decoded);
      } catch {
        // Gracefully skip missing or undecodable meme clips
      }
    });

    await Promise.allSettled([...coreLoads, ...memeLoads]);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopActiveMeme();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : 0.85 * this.masterVolume,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private stopActiveMeme(): void {
    if (this.activeMemeSource) {
      try {
        this.activeMemeSource.onended = null;
        this.activeMemeSource.stop();
        this.activeMemeSource.disconnect();
      } catch {
        // Already stopped
      }
      this.activeMemeSource = null;
    }
    if (this.activeMemeGain) {
      try {
        this.activeMemeGain.disconnect();
      } catch {
        // Already disconnected
      }
      this.activeMemeGain = null;
    }
  }

  /** Cleanly fades out and stops any currently playing meme clip (e.g., on player respawn). */
  public stopMeme(fadeSec = 0.15): void {
    if (
      fadeSec <= 0 ||
      !this.ctx ||
      this.ctx.state !== "running" ||
      !this.activeMemeSource ||
      !this.activeMemeGain
    ) {
      this.stopActiveMeme();
      return;
    }

    const src = this.activeMemeSource;
    const gain = this.activeMemeGain;
    this.activeMemeSource = null;
    this.activeMemeGain = null;

    const now = this.ctx.currentTime;
    try {
      const currentGain = Math.max(0, gain.gain.value);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(currentGain, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    } catch {
      // Ignore gain automation errors
    }

    src.onended = () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };

    try {
      src.stop(now + fadeSec + 0.02);
    } catch {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    }
  }

  private playMeme(key: MemeKey, ignoreCooldown = false, maxDurationSec?: number): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const buf = this.memeBuffers.get(key);
    if (!buf) return;

    const now = this.ctx.currentTime;
    if (!ignoreCooldown && now - this.lastMemeAt < MEME_HIT_COOLDOWN_SEC) return;
    this.lastMemeAt = now;

    // Stop/replace any currently playing meme clip so two meme clips never talk over each other
    this.stopActiveMeme();

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(MEME_HIT_VOLUME, now);

    const cappedDuration =
      maxDurationSec !== undefined && maxDurationSec > 0 && buf.duration > maxDurationSec
        ? maxDurationSec
        : undefined;

    if (cappedDuration !== undefined) {
      const fadeOut = Math.min(MEME_FADE_OUT_SEC, cappedDuration * 0.25);
      gain.gain.setValueAtTime(MEME_HIT_VOLUME, now + cappedDuration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, now + cappedDuration);
    }

    src.connect(gain);
    gain.connect(this.masterGain);

    this.activeMemeSource = src;
    this.activeMemeGain = gain;
    src.onended = () => {
      if (this.activeMemeSource === src) {
        this.activeMemeSource = null;
        this.activeMemeGain = null;
      }
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    };

    if (cappedDuration !== undefined) {
      src.start(now, 0, cappedDuration);
    } else {
      src.start(now);
    }
  }

  private playSample(
    key: SampleKey,
    volume = 0.6,
    rate = 1.0,
    jitter = 0.06,
    offsetSec = 0
  ): boolean {
    if (this.muted || !this.ctx || !this.masterGain) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rand = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
    src.playbackRate.value = Math.max(0.4, rate * rand);

    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.masterGain);
    src.start(this.ctx.currentTime + Math.max(0, offsetSec));
    return true;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private pickRandomPoolKey<T extends SampleKey>(
    pool: readonly T[],
    lastIdx: number
  ): { key: T; idx: number } {
    const available = pool
      .map((key, idx) => ({ key, idx }))
      .filter(({ key }) => this.buffers.has(key));
    if (available.length === 0) {
      return { key: pool[0], idx: 0 };
    }
    if (available.length === 1) {
      return available[0];
    }
    const candidates = available.filter((item) => item.idx !== lastIdx);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? available[0];
    return chosen;
  }

  private playRandomClash(volume: number, rate: number, jitter = 0.025, offsetSec = 0): boolean {
    const { key, idx } = this.pickRandomPoolKey(CLASH_KEYS, this.lastClashIdx);
    this.lastClashIdx = idx;
    return this.playSample(key, volume, rate, jitter, offsetSec);
  }

  private playRandomBladeHit(volume: number, rate: number, jitter = 0.04, offsetSec = 0): boolean {
    const { key, idx } = this.pickRandomPoolKey(BLADE_HIT_KEYS, this.lastBladeHitIdx);
    this.lastBladeHitIdx = idx;
    return this.playSample(key, volume, rate, jitter, offsetSec);
  }

  /** Authentic Sekiro steel deflect clash (9-sample non-repeating pool from SekiroSoundpack). */
  public playDeflect(heavy = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    if (this.playRandomClash(heavy ? 0.94 : 0.84, heavy ? 0.97 : 1.02, 0.025)) {
      return;
    }
    const now = this.ctx.currentTime;
    this.playTone(now, 1680, 1650, 0.45, "triangle", 0.28, 0.002);
  }

  /** Authentic Sekiro steel guard clash (tighter pitch/volume from SekiroSoundpack clash pool). */
  public playBlock(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    if (this.playRandomClash(0.62, 0.86, 0.03)) {
      return;
    }
    const now = this.ctx.currentTime;
    this.playTone(now, 580, 495, 0.11, "triangle", 0.2, 0.002);
  }

  /** Subtle crisp steel snap (shk!) when raising guard. */
  public playGuardRaise(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    this.burstNoise(now, 0.042, 3200, 3.2, 0.11, 5100, "bandpass");
    this.playTone(now, 1420, 1860, 0.048, "triangle", 0.075, 0.002);
    this.playTone(now, 2280, 2140, 0.055, "sine", 0.05, 0.002);
  }

  /**
   * Iconic Sekiro 危 Perilous Attack telegraph sting:
   * sharp wooden hyoshigi/biwa pluck + tense breathy shakuhachi harmonic swell + sub-drop.
   * Throttled to fire at most once every 650ms.
   */
  public playPerilousWarning(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPerilousAt < PERILOUS_COOLDOWN_SEC) return;
    this.lastPerilousAt = now;

    // 1. Sharp wooden hyoshigi clack + tense biwa pluck transient
    this.burstNoise(now, 0.045, 2550, 4.0, 0.32, 1950, "bandpass");
    this.playTone(now, 1960, 1780, 0.065, "triangle", 0.18, 0.002);
    this.playTone(now, 2940, 2720, 0.05, "sine", 0.12, 0.002);

    // Resonant biwa twang
    const biwaOsc = this.ctx.createOscillator();
    biwaOsc.type = "sawtooth";
    biwaOsc.frequency.setValueAtTime(311, now);
    biwaOsc.frequency.exponentialRampToValueAtTime(293, now + 0.24);
    const biwaFilter = this.ctx.createBiquadFilter();
    biwaFilter.type = "bandpass";
    biwaFilter.frequency.setValueAtTime(1180, now);
    biwaFilter.frequency.exponentialRampToValueAtTime(640, now + 0.24);
    biwaFilter.Q.value = 3.2;
    const biwaGain = this.ctx.createGain();
    biwaGain.gain.setValueAtTime(0.001, now);
    biwaGain.gain.linearRampToValueAtTime(0.24, now + 0.006);
    biwaGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    biwaOsc.connect(biwaFilter);
    biwaFilter.connect(biwaGain);
    biwaGain.connect(this.masterGain);
    biwaOsc.start(now);
    biwaOsc.stop(now + 0.3);

    // 2. Tense breathy shakuhachi harmonic swell (minor-2nd tension)
    this.burstNoise(now + 0.02, 0.56, 1180, 7.5, 0.16, 1520, "bandpass");
    const shakuFreqs = [587.33, 622.25, 1174.66];
    shakuFreqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      osc.type = idx === 2 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(f * 0.985, now + 0.02);
      osc.frequency.linearRampToValueAtTime(f * 1.01, now + 0.22);
      osc.frequency.exponentialRampToValueAtTime(f * 0.99, now + 0.6);

      const g = this.ctx.createGain();
      const peak = idx === 0 ? 0.14 : idx === 1 ? 0.11 : 0.06;
      g.gain.setValueAtTime(0.001, now + 0.02);
      g.gain.linearRampToValueAtTime(peak, now + 0.14);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.62);

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now + 0.02);
      osc.stop(now + 0.64);
    });

    // 3. Ominous sub-bass drop
    this.playTone(now + 0.01, 118, 42, 0.44, "sine", 0.34, 0.012);
  }

  /**
   * Default attack swing sounds removed — only Sekiro counter clash remains on swing;
   * all weapon impacts and clashes use the SekiroSoundpack OGGs.
   */
  public playSwing(_heavy = false, moveKind?: string): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    if (moveKind === "counter") {
      this.playRandomClash(0.62, 1.16, 0.03);
    }
  }

  public playPickup(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    this.playSample("lockOn", 0.11, 1.38, 0.03);
    const now = this.ctx.currentTime;
    this.playTone(now, 880, 1320, 0.12, "sine", 0.0275, 0.004);
  }

  /**
   * Healing Gourd ceramic gulp + warm chime for `healing_flask` / `true`,
   * mystical Japanese prayer bell + spirit shimmer for Sugar / Tonic buffs.
   */
  public playPowerUp(kind?: PowerUpKind | boolean | string): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const isHeal = kind === true || kind === "healing_flask";

    if (isHeal) {
      // Wooden gourd cork pop
      this.playTone(now, 520, 960, 0.045, "sine", 0.16, 0.002);
      // Hollow ceramic gourd double-gulp
      this.playTone(now + 0.045, 290, 460, 0.095, "sine", 0.18, 0.012);
      this.playTone(now + 0.155, 330, 520, 0.105, "sine", 0.18, 0.012);
      this.burstNoise(now + 0.05, 0.18, 680, 3.2, 0.08, 1080, "bandpass");

      // Warm golden restorative chime
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((f, idx) => {
        this.playTone(now + 0.14 + idx * 0.045, f, f * 1.004, 0.62 - idx * 0.06, "sine", 0.12 - idx * 0.015, 0.015);
      });
      return;
    }

    // Mystical Japanese prayer bell (orin) + spirit shimmer for Sugar/Tonic buffs
    const bellBase =
      kind === "warriors_fury"
        ? 587.33
        : kind === "iron_will"
          ? 392.0
          : kind === "swift_feet"
            ? 659.25
            : 523.25; // posture_tonic / default

    this.playTempleBell(now, bellBase, 1.35, 0.24);
    // Ascending spirit wind shimmer
    this.burstNoise(now + 0.03, 0.55, 1600, 5.0, 0.11, 3600, "bandpass");
    this.playTone(now + 0.08, bellBase * 1.5, bellBase * 2.0, 0.58, "sine", 0.09, 0.05);
  }

  public playPilumThrow(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.burstNoise(now, 0.18, 1650, 2.6, 0.22, 3400, "bandpass");
    this.playTone(now, 1480, 740, 0.14, "sine", 0.08, 0.004);
  }

  /**
   * Authentic Sekiro blade slash impact (`blade_hit1..7` from SekiroSoundpack),
   * replacing previous generic hit samples and synthesis.
   */
  public playHit(heavy = false, _selfHurt = false, memeSfx?: MemeSfxKind): void {
    if (this.muted || !this.ctx || !this.masterGain) return;

    const played = this.playRandomBladeHit(heavy ? 0.88 : 0.74, heavy ? 0.94 : 1.02, 0.035);
    if (!played) {
      const now = this.ctx.currentTime;
      this.burstNoise(now, heavy ? 0.075 : 0.05, 3600, 1.8, heavy ? 0.28 : 0.2, 1300, "bandpass");
      this.playTone(now, heavy ? 165 : 142, heavy ? 38 : 48, heavy ? 0.18 : 0.12, "sine", heavy ? 0.34 : 0.24, 0.002);
    }

    if (memeSfx) this.playMeme(memeSfx, true);
  }

  /** Authentic Sekiro Posture-Break / Deathblow-Opening sting (`neutralize_mobs.ogg` from SekiroSoundpack). */
  public playStagger(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    if (this.playSample("neutralizeMobs", 0.9, 1.0, 0.02)) {
      return;
    }
    const now = this.ctx.currentTime;
    this.playTone(now, 110, 34, 0.52, "sine", 0.42, 0.006);
  }

  /** Quick step dodge whoosh & i-frame evade chime. */
  public playDodge(): void {
    if (this.muted || !this.ctx) return;
    this.burstNoise(this.ctx.currentTime, 0.15, 760, 1.4, 0.15, 340, "bandpass");
  }

  public playEvade(): void {
    if (this.muted || !this.ctx) return;
    this.playTone(this.ctx.currentTime, 1120, 1580, 0.14, "sine", 0.12, 0.004);
  }

  /** Short synthesized takeoff whoosh with a light upward tonal cue. */
  public playJump(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.burstNoise(now, 0.11, 620, 1.7, 0.12, 260, "bandpass");
    this.playTone(now, 190, 310, 0.12, "sine", 0.075, 0.006);
  }

  public playFootstep(): void {
    if (this.muted || !this.ctx || this.footstepVolume <= 0.001) return;
    this.stepFlip = !this.stepFlip;
    const now = this.ctx.currentTime;
    const freq = this.stepFlip ? 460 : 410;
    this.burstNoise(now, 0.065, freq, 1.4, 0.11 * this.footstepVolume, 190, "bandpass");
  }

  /** Sparse, randomized synthesized meow for the stray cats around the arena. */
  public playCatMeow(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const pitch = 0.92 + Math.random() * 0.2;
    const voice = this.ctx.createOscillator();
    const formant = this.ctx.createBiquadFilter();
    const envelope = this.ctx.createGain();
    voice.type = "triangle";
    voice.frequency.setValueAtTime(610 * pitch, now);
    voice.frequency.exponentialRampToValueAtTime(910 * pitch, now + 0.16);
    voice.frequency.exponentialRampToValueAtTime(430 * pitch, now + 0.56);
    formant.type = "bandpass";
    formant.frequency.setValueAtTime(980 * pitch, now);
    formant.frequency.exponentialRampToValueAtTime(1450 * pitch, now + 0.18);
    formant.frequency.exponentialRampToValueAtTime(720 * pitch, now + 0.56);
    formant.Q.value = 1.2;
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.linearRampToValueAtTime(0.14, now + 0.035);
    envelope.gain.setValueAtTime(0.11, now + 0.16);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    voice.connect(formant);
    formant.connect(envelope);
    envelope.connect(this.masterGain);
    voice.start(now);
    voice.stop(now + 0.65);
  }

  /**
   * Deathblow / player death cues:
   * - `roberto`: randomly when a player dies (everyone hears it)
   * - `fahh` (30%) / `sekiroDeath` (70%): when the last player dies (everyone hears it)
   * Plays cleanly without conflicting old death SFX when a custom death cue is active.
   */
  public playKill(isPvP = false, memeSfx?: MemeSfxKind): void {
    if (this.muted || !this.ctx || !this.masterGain) return;

    if (memeSfx === "roberto" || memeSfx === "fahh" || memeSfx === "sekiroDeath") {
      this.playMeme(memeSfx, true);
      return;
    }

    // Authentic Sekiro neutralize_mobs deathblow + final blade cut
    this.playRandomBladeHit(0.76, 0.92, 0.03);
    if (!this.playSample("neutralizeMobs", 0.86, isPvP ? 0.94 : 1.0, 0.02)) {
      const now = this.ctx.currentTime;
      this.playTone(now, 108, 30, 0.62, "sine", 0.4, 0.005);
    }

    if (memeSfx) {
      this.playMeme(memeSfx, true);
    }
  }

  /** Japanese taiko war drum double-strike + ominous boss war-horn on wave start. */
  public playWaveStart(isBoss = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // Taiko war drum double-strike (accent + thunderous main hit)
    this.playTaikoStrike(now, isBoss ? 0.9 : 1.05, 0.38);
    this.playTaikoStrike(now + 0.22, isBoss ? 0.78 : 0.92, 0.48);
    if (isBoss) {
      this.playTaikoStrike(now + 0.48, 0.72, 0.52);

      // Deep horagai / boss war-horn swell
      const hornFreqs = [110, 165, 220];
      hornFreqs.forEach((f, idx) => {
        if (!this.ctx || !this.masterGain) return;
        const osc = this.ctx.createOscillator();
        osc.type = idx === 0 ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(f * 0.94, now + 0.14);
        osc.frequency.linearRampToValueAtTime(f, now + 0.48);
        osc.frequency.linearRampToValueAtTime(f * 0.985, now + 1.55);

        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(420, now + 0.14);
        filter.frequency.linearRampToValueAtTime(760, now + 0.6);
        filter.frequency.exponentialRampToValueAtTime(280, now + 1.55);

        const g = this.ctx.createGain();
        const peak = idx === 0 ? 0.2 : idx === 1 ? 0.11 : 0.07;
        g.gain.setValueAtTime(0.001, now + 0.14);
        g.gain.linearRampToValueAtTime(peak, now + 0.46);
        g.gain.exponentialRampToValueAtTime(0.001, now + 1.62);

        osc.connect(filter);
        filter.connect(g);
        g.connect(this.masterGain);
        osc.start(now + 0.14);
        osc.stop(now + 1.66);
      });
    }
  }

  /** Serene Buddhist temple bell chime on wave clear. */
  public playWaveClear(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    this.playTempleBell(now, 293.66, 2.3, 0.3);
    this.playTempleBell(now + 0.28, 587.33, 1.7, 0.16);
  }

  /**
   * Multi-stage timed Web Audio choreography (`ctx.currentTime + offsetSec`)
   * for all 14 Sekiro Combat Arts.
   */
  public playCombatArt(artKind: string): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    switch (artKind) {
      case "sakura_dance": {
        // Leaping blossom lift + 3 aerial crescent cuts with pentatonic petal chimes
        this.burstNoise(now, 0.26, 1200, 2.6, 0.14, 2800, "bandpass");
        this.playTone(now + 0.06, 880, 1174.66, 0.32, "sine", 0.09, 0.02);

        this.playArtSlash(now + 0.26, { freqStart: 1900, freqEnd: 880, dur: 0.18, sample: "bladeHit1", rate: 1.15, glint: 1760 });
        this.playArtSlash(now + 0.6, { freqStart: 2200, freqEnd: 940, dur: 0.2, sample: "bladeHit2", rate: 1.24, glint: 2093 });
        this.playArtSlash(now + 0.98, {
          freqStart: 2400,
          freqEnd: 620,
          dur: 0.28,
          sample: "bladeHit3",
          rate: 0.98,
          glint: 2637,
          subDrop: true,
        });
        break;
      }

      case "mortal_draw": {
        // Cursed crimson inhale + colossal dark-flame blade wave
        this.playSheatheGlint(now + 0.03, 0.2);
        this.burstNoise(now + 0.04, 0.42, 320, 2.2, 0.16, 860, "bandpass");
        this.playTone(now + 0.04, 92, 148, 0.42, "sawtooth", 0.11, 0.08);

        this.playArtSlash(now + 0.47, {
          freqStart: 1200,
          freqEnd: 240,
          dur: 0.42,
          sample: "bladeHit4",
          rate: 0.78,
          subDrop: true,
          crimsonRoar: true,
        });
        break;
      }

      case "mortal_draw_empowered": {
        // Deep Mortal Blade curse charge + twin colossal devastating waves
        this.playSheatheGlint(now + 0.02, 0.24);
        this.burstNoise(now + 0.04, 0.44, 260, 2.0, 0.2, 980, "bandpass");
        this.playTone(now + 0.04, 82, 164, 0.44, "sawtooth", 0.14, 0.08);

        this.playArtSlash(now + 0.46, {
          freqStart: 1320,
          freqEnd: 260,
          dur: 0.36,
          sample: "bladeHit5",
          rate: 0.82,
          subDrop: true,
          crimsonRoar: true,
        });

        // Second reversed colossal wave
        this.burstNoise(now + 0.78, 0.26, 360, 2.2, 0.15, 1100, "bandpass");
        this.playArtSlash(now + 1.04, {
          freqStart: 1480,
          freqEnd: 200,
          dur: 0.48,
          sample: "bladeHit6",
          rate: 0.74,
          subDrop: true,
          crimsonRoar: true,
        });
        this.playTempleBell(now + 1.08, 196, 1.35, 0.16);
        break;
      }

      case "ichimonji": {
        // Centered breath + heavy overhead posture-splitting cleave
        this.burstNoise(now + 0.02, 0.26, 520, 3.0, 0.12, 940, "bandpass");
        this.playArtSlash(now + 0.35, {
          freqStart: 1350,
          freqEnd: 310,
          dur: 0.26,
          sample: "bladeHit7",
          rate: 0.86,
          subDrop: true,
        });
        this.playTaikoStrike(now + 0.37, 0.95, 0.34);
        break;
      }

      case "ichimonji_double": {
        // Breath + twin overhead vertical posture splits
        this.burstNoise(now + 0.02, 0.24, 520, 3.0, 0.11, 920, "bandpass");
        this.playArtSlash(now + 0.33, {
          freqStart: 1400,
          freqEnd: 340,
          dur: 0.24,
          sample: "bladeHit1",
          rate: 0.92,
          subDrop: true,
        });
        this.playTaikoStrike(now + 0.35, 1.02, 0.28);

        this.burstNoise(now + 0.62, 0.22, 620, 2.6, 0.11, 1080, "bandpass");
        this.playArtSlash(now + 0.87, {
          freqStart: 1280,
          freqEnd: 260,
          dur: 0.3,
          sample: "bladeHit2",
          rate: 0.82,
          subDrop: true,
          glint: 2180,
        });
        this.playTaikoStrike(now + 0.89, 0.85, 0.4);
        break;
      }

      case "ashina_cross": {
        // Iaijutsu scabbard glint + blinding twin X-cut flashes
        this.playSheatheGlint(now + 0.04, 0.28);
        this.burstNoise(now + 0.06, 0.22, 2200, 4.0, 0.1, 3600, "bandpass");

        this.playArtSlash(now + 0.33, {
          freqStart: 2800,
          freqEnd: 980,
          dur: 0.14,
          sample: "clash1",
          rate: 1.24,
          glint: 3100,
        });
        this.playArtSlash(now + 0.45, {
          freqStart: 3200,
          freqEnd: 840,
          dur: 0.18,
          sample: "clash0",
          rate: 1.18,
          glint: 3820,
          subDrop: true,
        });
        break;
      }

      case "dragon_flash": {
        // Sword-Saint sheathe wind gather + gale cut + piercing shockwave beam
        this.playSheatheGlint(now + 0.03, 0.24);
        this.burstNoise(now + 0.05, 0.32, 740, 2.8, 0.15, 2200, "bandpass");

        this.playArtSlash(now + 0.38, {
          freqStart: 2200,
          freqEnd: 740,
          dur: 0.22,
          sample: "bladeHit3",
          rate: 1.12,
          glint: 2480,
        });
        // Colossal shockwave beam crack
        this.playArtSlash(now + 0.75, {
          freqStart: 2600,
          freqEnd: 380,
          dur: 0.42,
          sample: "clash2",
          rate: 0.88,
          subDrop: true,
          glint: 3440,
        });
        this.burstNoise(now + 0.76, 0.38, 1900, 1.5, 0.24, 520, "bandpass");
        break;
      }

      case "whirlwind_slash": {
        // 360° twin shinobi spinning chip-damage cuts
        this.playArtSlash(now + 0.21, {
          freqStart: 1650,
          freqEnd: 620,
          dur: 0.22,
          sample: "bladeHit4",
          rate: 1.12,
        });
        this.playArtSlash(now + 0.51, {
          freqStart: 1950,
          freqEnd: 540,
          dur: 0.26,
          sample: "bladeHit5",
          rate: 1.02,
          glint: 2350,
        });
        break;
      }

      case "nightjar_slash": {
        // Acrobatic somersault leap + hawk air-whistle + plunging cleave
        this.burstNoise(now + 0.04, 0.32, 920, 2.5, 0.16, 2400, "bandpass");
        this.playTone(now + 0.16, 1680, 1120, 0.2, "sine", 0.09, 0.02);

        this.playArtSlash(now + 0.43, {
          freqStart: 1750,
          freqEnd: 340,
          dur: 0.28,
          sample: "bladeHit6",
          rate: 1.0,
          subDrop: true,
        });
        break;
      }

      case "floating_passage": {
        // Tomoe 5-stroke flowing flurry with ascending silky blade cadence
        const offsets = [0.15, 0.35, 0.55, 0.75, 0.95];
        offsets.forEach((off, idx) => {
          const isFinal = idx === offsets.length - 1;
          this.playArtSlash(now + off, {
            freqStart: 1600 + idx * 240,
            freqEnd: isFinal ? 520 : 760 + idx * 80,
            dur: isFinal ? 0.26 : 0.14,
            sample: BLADE_HIT_KEYS[idx % BLADE_HIT_KEYS.length],
            rate: isFinal ? 1.04 : 1.05 + idx * 0.09,
            glint: isFinal ? 2760 : undefined,
            subDrop: isFinal,
          });
        });
        break;
      }

      case "shadowrush": {
        // Charge + piercing lance thrust + owl vault + falcon plunge cut
        this.burstNoise(now, 0.22, 600, 2.6, 0.13, 1850, "bandpass");
        this.playArtSlash(now + 0.25, {
          freqStart: 1450,
          freqEnd: 3200,
          dur: 0.2,
          sample: "bladeHit7",
          rate: 1.24,
          glint: 2650,
        });
        // Owl vault upward air spring
        this.burstNoise(now + 0.56, 0.22, 1100, 2.2, 0.14, 2400, "bandpass");
        // Descending falcon cleave
        this.playArtSlash(now + 0.87, {
          freqStart: 1900,
          freqEnd: 340,
          dur: 0.28,
          sample: "bladeHit1",
          rate: 0.94,
          subDrop: true,
        });
        break;
      }

      case "spiral_cloud_passage": {
        // Mushin cyclone wind dance — 4 escalating cyclone cuts
        this.burstNoise(now, 0.35, 680, 2.2, 0.14, 1900, "bandpass");
        const stages = [
          { off: 0.17, f0: 1700, f1: 720, rate: 1.1, sample: "bladeHit2" as SampleKey },
          { off: 0.38, f0: 1950, f1: 760, rate: 1.2, sample: "bladeHit3" as SampleKey },
          { off: 0.59, f0: 2250, f1: 820, rate: 1.3, sample: "bladeHit4" as SampleKey },
        ];
        for (const s of stages) {
          this.playArtSlash(now + s.off, {
            freqStart: s.f0,
            freqEnd: s.f1,
            dur: 0.16,
            sample: s.sample,
            rate: s.rate,
          });
        }
        this.playArtSlash(now + 0.85, {
          freqStart: 2500,
          freqEnd: 380,
          dur: 0.36,
          sample: "bladeHit5",
          rate: 0.88,
          glint: 2920,
          subDrop: true,
        });
        break;
      }

      case "one_mind": {
        // Sheathed judgment glint -> first flash -> rapid phantom flurry -> decisive finale
        this.playSheatheGlint(now + 0.03, 0.3);
        this.playArtSlash(now + 0.27, {
          freqStart: 2800,
          freqEnd: 920,
          dur: 0.16,
          sample: "clash3",
          rate: 1.25,
          glint: 3180,
        });

        // Rapid phantom cuts across 0.54s..0.92s
        const phantomOffsets = [0.54, 0.63, 0.72, 0.81, 0.9];
        phantomOffsets.forEach((off, idx) => {
          this.burstNoise(now + off, 0.09, 2600 + idx * 260, 2.8, 0.17, 1100, "bandpass");
          this.playTone(now + off, 2400 + idx * 240, 1950 + idx * 180, 0.075, "sine", 0.075, 0.002);
          if (idx % 2 === 0) {
            this.playSample(BLADE_HIT_KEYS[idx % BLADE_HIT_KEYS.length], 0.36, 1.22 + idx * 0.05, 0.04, off);
          }
        });

        // Decisive crimson cut + resonant steel bell finish
        this.playArtSlash(now + 1.07, {
          freqStart: 2900,
          freqEnd: 420,
          dur: 0.36,
          sample: "bladeHit6",
          rate: 0.84,
          glint: 3680,
          subDrop: true,
          crimsonRoar: true,
        });
        this.playRandomClash(0.48, 1.12, 0.03, 1.08);
        break;
      }

      case "high_monk": {
        // Senpou Temple bell + leaping sweep-counter + cascading martial flurry
        this.playTempleBell(now + 0.02, 440, 1.15, 0.16);
        this.playTaikoStrike(now + 0.24, 1.25, 0.3);
        this.burstNoise(now + 0.23, 0.16, 1450, 2.2, 0.2, 640, "bandpass");

        this.playArtSlash(now + 0.55, {
          freqStart: 1850,
          freqEnd: 680,
          dur: 0.18,
          sample: "bladeHit2",
          rate: 1.18,
        });
        this.playArtSlash(now + 0.81, {
          freqStart: 1620,
          freqEnd: 340,
          dur: 0.28,
          sample: "bladeHit7",
          rate: 0.98,
          subDrop: true,
          glint: 2240,
        });
        break;
      }

      default: {
        this.playSheatheGlint(now + 0.04, 0.18);
        break;
      }
    }
  }

  /** Heavy iron portcullis grinding + Colosseum emergence. */
  public playGateOpen(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.linearRampToValueAtTime(96, now + 0.95);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.15);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.2);

    this.burstNoise(now, 0.85, 420, 2.0, 0.12);
  }

  public playEnemySpawn(): void {
    if (this.muted || !this.ctx) return;
    this.playSample("lockOn", 0.3, 0.72, 0.04);
  }

  // === Internal Web Audio Synthesis Helpers (all finite one-shots, zero loops) ===

  private playTone(
    startTime: number,
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    attackSec = 0.004
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + Math.max(0.01, duration));

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(attackSec, duration * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private playSheatheGlint(startTime: number, volume = 0.22): void {
    if (!this.ctx || !this.masterGain) return;
    this.playTone(startTime, 2940, 3620, 0.16, "sine", volume * 0.55, 0.003);
    this.playTone(startTime + 0.012, 4380, 4120, 0.22, "sine", volume * 0.4, 0.004);
    this.burstNoise(startTime, 0.08, 4800, 3.6, volume * 0.65, 6400, "bandpass");
  }

  private playTaikoStrike(startTime: number, pitch = 1.0, volume = 0.42): void {
    if (!this.ctx || !this.masterGain) return;
    // Deep skin membrane thump
    this.playTone(startTime, 138 * pitch, 46 * pitch, 0.44, "sine", volume, 0.004);
    this.playTone(startTime, 215 * pitch, 82 * pitch, 0.22, "triangle", volume * 0.48, 0.003);
    // Crisp wooden bachi attack transient
    this.burstNoise(startTime, 0.04, 1650 * pitch, 1.8, volume * 0.52, 620 * pitch, "bandpass");
  }

  private playTempleBell(startTime: number, baseFreq = 261.63, duration = 2.0, volume = 0.26): void {
    if (!this.ctx || !this.masterGain) return;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(volume, startTime);
    bus.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);
    bus.connect(this.masterGain);

    // Authentic inharmonic Japanese bonsho / orin temple bell ratios
    const partials = [
      { ratio: 1.0, amp: 0.55, dur: duration },
      { ratio: 1.006, amp: 0.22, dur: duration * 0.92 }, // gentle beating shimmer
      { ratio: 2.02, amp: 0.3, dur: duration * 0.72 },
      { ratio: 2.98, amp: 0.18, dur: duration * 0.54 },
      { ratio: 4.17, amp: 0.1, dur: duration * 0.38 },
    ];

    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq * p.ratio, startTime);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, startTime);
      g.gain.linearRampToValueAtTime(p.amp, startTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + p.dur);

      osc.connect(g);
      g.connect(bus);
      osc.start(startTime);
      osc.stop(startTime + p.dur + 0.03);
    }
  }

  private playArtSlash(
    startTime: number,
    opts: {
      freqStart: number;
      freqEnd: number;
      dur: number;
      sample: SampleKey;
      rate: number;
      glint?: number;
      subDrop?: boolean;
      crimsonRoar?: boolean;
    }
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const offset = Math.max(0, startTime - this.ctx.currentTime);
    this.playSample(opts.sample, 0.56, opts.rate, 0.03, offset);
    this.burstNoise(startTime, opts.dur, opts.freqStart, 1.9, 0.24, opts.freqEnd, "bandpass");

    if (opts.glint) {
      this.playTone(startTime, opts.glint, opts.glint * 0.94, 0.24, "sine", 0.12, 0.003);
    }
    if (opts.subDrop) {
      this.playTone(startTime, 128, 38, 0.28, "sine", 0.32, 0.005);
    }
    if (opts.crimsonRoar) {
      this.burstNoise(startTime, opts.dur * 1.08, 420, 1.3, 0.24, 160, "lowpass");
      this.playTone(startTime, 190, 68, opts.dur * 0.9, "sawtooth", 0.12, 0.01);
    }
  }

  private burstNoise(
    startTime: number,
    duration: number,
    freqStart: number,
    q: number,
    volume: number,
    freqEnd?: number,
    filterType: BiquadFilterType = "bandpass"
  ): void {
    if (!this.ctx || !this.noiseBuffer || !this.masterGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, freqStart), startTime);
    if (freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + Math.max(0.01, duration));
    }
    filter.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, startTime);
    g.gain.linearRampToValueAtTime(volume, startTime + Math.min(0.008, duration * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.02);
  }
}

export const soundEngine = new SoundEngine();
