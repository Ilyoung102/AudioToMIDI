/**
 * Web Audio Polyphonic Acoustic Piano Synthesizer
 * Uses additive synthesis with realistic harmonic distribution and ADSR envelope.
 */

class WebAudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<number, { oscillators: OscillatorNode[]; gain: GainNode; stopTimer?: number }> = new Map();
  private volume: number = 0.8;
  private isMuted: boolean = false;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  public noteOn(pitch: number, velocity: number = 80, durationSec?: number) {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    // Release existing voice for this pitch if active
    this.noteOff(pitch);

    const now = this.ctx.currentTime;
    const freq = 440.0 * Math.pow(2.0, (pitch - 69) / 12.0);
    const velNorm = Math.max(0.1, Math.min(1.0, velocity / 127.0));

    // Voice Gain Node
    const voiceGain = this.ctx.createGain();
    voiceGain.connect(this.masterGain);

    // Natural Piano ADSR
    const attackTime = 0.012;
    const decayTime = Math.min(2.5, Math.max(0.4, 0.05 * (108 - pitch))); // lower notes sustain longer
    
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(velNorm * 0.45, now + attackTime);
    // Exponential decay towards sustain level
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + attackTime + decayTime);

    // Harmonic Oscillators (Fundamental + 2nd + 3rd + 4th harmonic)
    const harmonics = [
      { ratio: 1.0, gain: 1.00 },
      { ratio: 2.0, gain: 0.38 },
      { ratio: 3.0, gain: 0.18 },
      { ratio: 4.0, gain: 0.08 }
    ];

    const oscillators: OscillatorNode[] = [];

    harmonics.forEach(({ ratio, gain }) => {
      if (!this.ctx) return;
      const hFreq = freq * ratio;
      // Skip frequencies above Nyquist (20kHz)
      if (hFreq > 20000) return;

      const osc = this.ctx.createOscillator();
      osc.type = ratio === 1.0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(hFreq, now);

      const hGain = this.ctx.createGain();
      hGain.gain.setValueAtTime(gain, now);

      osc.connect(hGain);
      hGain.connect(voiceGain);
      osc.start(now);
      oscillators.push(osc);
    });

    let stopTimer: number | undefined;
    if (durationSec && durationSec > 0) {
      stopTimer = window.setTimeout(() => {
        this.noteOff(pitch);
      }, durationSec * 1000);
    }

    this.activeVoices.set(pitch, {
      oscillators,
      gain: voiceGain,
      stopTimer
    });
  }

  public noteOff(pitch: number) {
    const voice = this.activeVoices.get(pitch);
    if (!voice || !this.ctx) return;

    if (voice.stopTimer) {
      clearTimeout(voice.stopTimer);
    }

    const now = this.ctx.currentTime;
    const releaseTime = 0.08;

    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.exponentialRampToValueAtTime(0.00001, now + releaseTime);

    setTimeout(() => {
      voice.oscillators.forEach(osc => {
        try {
          osc.stop();
          osc.disconnect();
        } catch (_) {}
      });
      voice.gain.disconnect();
    }, (releaseTime + 0.02) * 1000);

    this.activeVoices.delete(pitch);
  }

  public allNotesOff() {
    this.activeVoices.forEach((voice, pitch) => {
      this.noteOff(pitch);
    });
    this.activeVoices.clear();
  }
}

export const synth = new WebAudioSynth();
