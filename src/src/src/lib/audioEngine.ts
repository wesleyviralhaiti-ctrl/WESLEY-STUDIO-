export interface StemState {
  vocal: boolean;
  drums: boolean;
  bass: boolean;
  melody: boolean;
}

export interface DeckTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  album: string;
  length: string;
  genre: string;
  musicalKey: string;
  buffer: AudioBuffer | null;
  peaks: { low: number; mid: number; high: number }[];
}

export class SeratoDeckEngine {
  public ctx: AudioContext;
  public buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  public isPlaying = false;
  public playbackRate = 1.0;
  public startTime = 0;
  public pauseOffset = 0;
  public cuePoint = 0;
  public loopActive = false;
  public loopStart = 0;
  public loopEnd = 0;

  private trimGain: GainNode;
  private lowEQ: BiquadFilterNode;
  private midEQ: BiquadFilterNode;
  private highEQ: BiquadFilterNode;
  private filterNode: BiquadFilterNode;
  private channelFader: GainNode;
  public crossfaderGain: GainNode;
  public analyser: AnalyserNode;

  private bassStemGain: GainNode;
  private drumsStemGain: GainNode;
  private vocalStemGain: GainNode;
  private melodyStemGain: GainNode;
  public stems: StemState = { vocal: true, drums: true, bass: true, melody: true };

  constructor(ctx: AudioContext, masterBus: GainNode) {
    this.ctx = ctx;
    this.trimGain = ctx.createGain();
    this.trimGain.gain.value = 1.0;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 180;
    this.bassStemGain = ctx.createGain();

    const drumsFilter = ctx.createBiquadFilter();
    drumsFilter.type = 'bandpass';
    drumsFilter.frequency.value = 120;
    drumsFilter.Q.value = 0.7;
    const drumsHigh = ctx.createBiquadFilter();
    drumsHigh.type = 'highpass';
    drumsHigh.frequency.value = 4500;
    this.drumsStemGain = ctx.createGain();

    const vocalLowCut = ctx.createBiquadFilter();
    vocalLowCut.type = 'highpass';
    vocalLowCut.frequency.value = 280;
    const vocalHighCut = ctx.createBiquadFilter();
    vocalHighCut.type = 'lowpass';
    vocalHighCut.frequency.value = 3400;
    this.vocalStemGain = ctx.createGain();

    const melodyBand = ctx.createBiquadFilter();
    melodyBand.type = 'peaking';
    melodyBand.frequency.value = 1800;
    melodyBand.Q.value = 0.6;
    this.melodyStemGain = ctx.createGain();

    const stemSum = ctx.createGain();
    stemSum.gain.value = 0.85;

    this.trimGain.connect(bassFilter);
    bassFilter.connect(this.bassStemGain);
    this.bassStemGain.connect(stemSum);

    this.trimGain.connect(drumsFilter);
    drumsFilter.connect(this.drumsStemGain);
    this.trimGain.connect(drumsHigh);
    drumsHigh.connect(this.drumsStemGain);
    this.drumsStemGain.connect(stemSum);

    this.trimGain.connect(vocalLowCut);
    vocalLowCut.connect(vocalHighCut);
    vocalHighCut.connect(this.vocalStemGain);
    this.vocalStemGain.connect(stemSum);

    this.trimGain.connect(melodyBand);
    melodyBand.connect(this.melodyStemGain);
    this.melodyStemGain.connect(stemSum);

    this.lowEQ = ctx.createBiquadFilter();
    this.lowEQ.type = 'lowshelf';
    this.lowEQ.frequency.value = 250;

    this.midEQ = ctx.createBiquadFilter();
    this.midEQ.type = 'peaking';
    this.midEQ.frequency.value = 1000;
    this.midEQ.Q.value = 0.9;

    this.highEQ = ctx.createBiquadFilter();
    this.highEQ.type = 'highshelf';
    this.highEQ.frequency.value = 3500;

    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'allpass';
    this.filterNode.frequency.value = 1000;

    this.channelFader = ctx.createGain();
    this.channelFader.gain.value = 0.85;

    this.crossfaderGain = ctx.createGain();
    this.crossfaderGain.gain.value = 1.0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;

    stemSum.connect(this.lowEQ);
    this.lowEQ.connect(this.midEQ);
    this.midEQ.connect(this.highEQ);
    this.highEQ.connect(this.filterNode);
    this.filterNode.connect(this.channelFader);
    this.channelFader.connect(this.crossfaderGain);
    this.crossfaderGain.connect(this.analyser);
    this.analyser.connect(masterBus);
  }

  public loadBuffer(buf: AudioBuffer) {
    this.stop();
    this.buffer = buf;
    this.pauseOffset = 0;
    this.cuePoint = 0;
    this.loopActive = false;
  }

  public play() {
    if (!this.buffer || this.isPlaying) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.playbackRate;
    if (this.loopActive && this.loopEnd > this.loopStart) {
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = this.loopEnd;
    }
    src.connect(this.trimGain);
    const offset = Math.max(0, Math.min(this.pauseOffset, this.buffer.duration - 0.05));
    src.start(0, offset);
    this.source = src;
    this.startTime = this.ctx.currentTime - offset / this.playbackRate;
    this.isPlaying = true;

    src.onended = () => {
      if (this.source === src) {
        this.isPlaying = false;
        this.pauseOffset = 0;
      }
    };
  }

  public pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this.stopSource();
    this.isPlaying = false;
  }

  public stop() {
    this.stopSource();
    this.isPlaying = false;
    this.pauseOffset = 0;
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch {
        // ignore
      }
      this.source = null;
    }
  }

  public getCurrentTime(): number {
    if (!this.buffer) return 0;
    if (!this.isPlaying) return this.pauseOffset;
    const elapsed = (this.ctx.currentTime - this.startTime) * this.playbackRate;
    if (this.loopActive && this.loopEnd > this.loopStart) {
      const loopLen = this.loopEnd - this.loopStart;
      if (elapsed >= this.loopStart) {
        return this.loopStart + ((elapsed - this.loopStart) % loopLen);
      }
    }
    return Math.min(elapsed, this.buffer.duration);
  }

  public seek(seconds: number) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(seconds, this.buffer.duration - 0.05));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.stopSource();
      this.isPlaying = false;
    }
    this.pauseOffset = clamped;
    if (wasPlaying) {
      this.play();
    }
  }

  public triggerCue() {
    if (!this.buffer) return;
    if (this.isPlaying) {
      this.pause();
      this.pauseOffset = this.cuePoint;
    } else {
      this.cuePoint = this.pauseOffset;
      this.play();
    }
  }

  public setPitch(rate: number) {
    const current = this.getCurrentTime();
    this.playbackRate = Math.max(0.75, Math.min(1.25, rate));
    if (this.source && this.isPlaying) {
      this.source.playbackRate.value = this.playbackRate;
      this.startTime = this.ctx.currentTime - current / this.playbackRate;
    }
  }

  public scratchNudge(deltaRate: number) {
    if (!this.source || !this.isPlaying) return;
    const target = Math.max(0.2, Math.min(2.2, this.playbackRate + deltaRate));
    this.source.playbackRate.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  public releaseScratch() {
    if (!this.source || !this.isPlaying) return;
    this.source.playbackRate.setTargetAtTime(this.playbackRate, this.ctx.currentTime, 0.03);
  }

  public setEQ(band: 'low' | 'mid' | 'high', norm: number) {
    const db = norm < 0.5 ? (norm - 0.5) * 48 : (norm - 0.5) * 24;
    if (band === 'low') this.lowEQ.gain.value = db;
    if (band === 'mid') this.midEQ.gain.value = db;
    if (band === 'high') this.highEQ.gain.value = db;
  }

  public setFilter(norm: number) {
    if (Math.abs(norm - 0.5) < 0.03) {
      this.filterNode.type = 'allpass';
      return;
    }
    if (norm < 0.5) {
      this.filterNode.type = 'lowpass';
      const ratio = norm / 0.47;
      this.filterNode.frequency.value = 120 * Math.pow(150, ratio);
      this.filterNode.Q.value = 2.5;
    } else {
      this.filterNode.type = 'highpass';
      const ratio = (norm - 0.53) / 0.47;
      this.filterNode.frequency.value = 80 * Math.pow(100, ratio);
      this.filterNode.Q.value = 2.5;
    }
  }

  public setVolume(norm: number) {
    this.channelFader.gain.value = Math.max(0, Math.min(1, norm));
  }

  public toggleStem(stem: keyof StemState) {
    this.stems[stem] = !this.stems[stem];
    this.applyStems();
    return { ...this.stems };
  }

  public setStemPreset(preset: 'all' | 'acapella' | 'instrumental') {
    if (preset === 'all') {
      this.stems = { vocal: true, drums: true, bass: true, melody: true };
    } else if (preset === 'acapella') {
      this.stems = { vocal: true, drums: false, bass: false, melody: false };
    } else {
      this.stems = { vocal: false, drums: true, bass: true, melody: true };
    }
    this.applyStems();
    return { ...this.stems };
  }

  private applyStems() {
    const t = this.ctx.currentTime;
    this.vocalStemGain.gain.setTargetAtTime(this.stems.vocal ? 1.15 : 0, t, 0.02);
    this.drumsStemGain.gain.setTargetAtTime(this.stems.drums ? 1.1 : 0, t, 0.02);
    this.bassStemGain.gain.setTargetAtTime(this.stems.bass ? 1.15 : 0, t, 0.02);
    this.melodyStemGain.gain.setTargetAtTime(this.stems.melody ? 1.0 : 0, t, 0.02);
  }

  public toggleAutoLoop(beats: number, bpm: number) {
    if (this.loopActive) {
      this.loopActive = false;
      if (this.source) this.source.loop = false;
      return false;
    }
    const secPerBeat = 60 / (bpm || 120);
    const start = this.getCurrentTime();
    this.loopStart = start;
    this.loopEnd = start + secPerBeat * beats;
    this.loopActive = true;
    if (this.source && this.isPlaying) {
      this.source.loop = true;
      this.source.loopStart = this.loopStart;
      this.source.loopEnd = this.loopEnd;
    }
    return true;
  }

  public getLevel(): number {
