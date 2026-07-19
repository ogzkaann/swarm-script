import type { CombatEvent } from '@swarm-script/shared';

class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.34;
  private muted = false;
  private lastPlayed = new Map<CombatEvent['type'], number>();

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    this.master ??= this.context.createGain();
    this.master.connect(this.context.destination);
    this.applyVolume();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyVolume();
  }

  play(event: CombatEvent): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running' || this.muted) return;
    const nowMs = performance.now();
    const minimumGap = event.type === 'impact' ? 34 : event.type === 'death' ? 58 : 20;
    if (nowMs - (this.lastPlayed.get(event.type) ?? 0) < minimumGap) return;
    this.lastPlayed.set(event.type, nowMs);

    const profile = soundProfile(event);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const variation = (((event.id * 17) % 9) - 4) * 0.012;
    oscillator.type = profile.wave;
    oscillator.frequency.setValueAtTime(profile.frequency * (1 + variation), context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(34, profile.endFrequency * (1 + variation)),
      context.currentTime + profile.duration,
    );
    filter.type = 'lowpass';
    filter.frequency.value = profile.filter;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(profile.gain, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + profile.duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + profile.duration + 0.02);
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
}

function soundProfile(event: CombatEvent): {
  wave: OscillatorType;
  frequency: number;
  endFrequency: number;
  duration: number;
  gain: number;
  filter: number;
} {
  if (event.type === 'shot')
    return event.team === 'squad'
      ? {
          wave: 'triangle',
          frequency: 620,
          endFrequency: 310,
          duration: 0.07,
          gain: 0.09,
          filter: 2200,
        }
      : {
          wave: 'sawtooth',
          frequency: 210,
          endFrequency: 120,
          duration: 0.11,
          gain: 0.075,
          filter: 1100,
        };
  if (event.type === 'impact')
    return {
      wave: 'square',
      frequency: 145,
      endFrequency: 65,
      duration: 0.055,
      gain: 0.05,
      filter: 780,
    };
  if (event.type === 'death')
    return {
      wave: event.intensity === 'boss' ? 'sawtooth' : 'triangle',
      frequency: event.intensity === 'boss' ? 185 : 320,
      endFrequency: 48,
      duration: event.intensity === 'boss' ? 0.48 : 0.18,
      gain: event.intensity === 'boss' ? 0.16 : 0.1,
      filter: 1200,
    };
  if (event.type === 'ability')
    return {
      wave: 'sine',
      frequency: 240,
      endFrequency: 760,
      duration: 0.24,
      gain: 0.13,
      filter: 1800,
    };
  if (event.type === 'upgrade')
    return {
      wave: 'triangle',
      frequency: 330,
      endFrequency: 660,
      duration: 0.28,
      gain: 0.11,
      filter: 2200,
    };
  if (event.type === 'wave-start')
    return {
      wave: 'square',
      frequency: 92,
      endFrequency: 220,
      duration: 0.32,
      gain: 0.08,
      filter: 800,
    };
  if (event.type === 'victory')
    return {
      wave: 'triangle',
      frequency: 330,
      endFrequency: 990,
      duration: 0.62,
      gain: 0.14,
      filter: 2600,
    };
  if (event.type === 'defeat')
    return {
      wave: 'sawtooth',
      frequency: 180,
      endFrequency: 42,
      duration: 0.65,
      gain: 0.12,
      filter: 700,
    };
  return {
    wave: 'sine',
    frequency: 170,
    endFrequency: 110,
    duration: 0.16,
    gain: 0.07,
    filter: 900,
  };
}

export const audioEngine = new AudioEngine();
