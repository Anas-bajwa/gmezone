/*
 * GameZone sound engine — WebAudio bleeps + a tiny chiptune music loop.
 * No audio files needed. Respects saved settings (sound / music toggles).
 * Safe to load on any page; never throws if AudioContext is unavailable.
 */
(function (global) {
  'use strict';

  const store = {
    get settings() {
      try { return JSON.parse(localStorage.getItem('gz_settings')) || {}; }
      catch { return {}; }
    }
  };

  const Sound = {
    ctx: null,
    musicTimer: null,
    musicStep: 0,

    get sfxOn() { return store.settings.sound !== false; },
    get musicOn() { return store.settings.music !== false; },

    // Must be called from a user gesture at least once (autoplay policy)
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return true;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        return true;
      } catch { return false; }
    },

    tone(freq, dur, type, vol, delay) {
      if (!this.sfxOn || !this.ensure()) return;
      try {
        const t0 = this.ctx.currentTime + (delay || 0);
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(vol || 0.15, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g).connect(this.ctx.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch { /* audio is best-effort */ }
    },

    /* ---- named effects ---- */
    click()  { this.tone(600, 0.07, 'square', 0.08); },
    move()   { this.tone(440, 0.08, 'triangle', 0.12); },
    flip()   { this.tone(520, 0.09, 'triangle', 0.12); },
    match()  { this.tone(660, 0.1, 'sine', 0.15); this.tone(880, 0.14, 'sine', 0.15, 0.09); },
    eat()    { this.tone(700, 0.08, 'square', 0.1); this.tone(1050, 0.1, 'square', 0.1, 0.07); },
    notify() { this.tone(880, 0.12, 'sine', 0.12); this.tone(1174, 0.16, 'sine', 0.12, 0.1); },
    win()    { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, i * 0.12)); },
    lose()   { [400, 340, 280, 200].forEach((f, i) => this.tone(f, 0.2, 'sawtooth', 0.08, i * 0.13)); },
    gameover(){ this.tone(330, 0.25, 'sawtooth', 0.1); this.tone(220, 0.4, 'sawtooth', 0.1, 0.2); },
    drop()   { this.tone(300, 0.12, 'sine', 0.14); this.tone(180, 0.1, 'sine', 0.1, 0.05); },

    /* ---- background music: simple 16-step chiptune loop ---- */
    startMusic() {
      if (!this.musicOn || this.musicTimer || !this.ensure()) return;
      // A-minor-ish groove: bass line + sparkle lead, 16 steps
      const bass = [110, 0, 110, 0, 130.8, 0, 98, 0, 110, 0, 110, 0, 146.8, 0, 130.8, 0];
      const lead = [440, 0, 523.3, 659.3, 0, 523.3, 440, 0, 392, 0, 440, 523.3, 0, 659.3, 587.3, 0];
      const stepDur = 0.19;
      const tick = () => {
        if (!this.musicOn) { this.stopMusic(); return; }
        try {
          const t0 = this.ctx.currentTime + 0.05;
          const b = bass[this.musicStep], l = lead[this.musicStep];
          if (b) this.note(b, t0, stepDur, 'triangle', 0.05);
          if (l) this.note(l, t0, stepDur * 0.9, 'square', 0.025);
        } catch { /* ignore */ }
        this.musicStep = (this.musicStep + 1) % 16;
      };
      tick();
      this.musicTimer = setInterval(tick, stepDur * 1000);
    },
    note(freq, t0, dur, type, vol) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    stopMusic() {
      if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
      this.musicStep = 0;
    },
    refreshMusic() {
      // call after settings change
      if (this.musicOn) this.startMusic(); else this.stopMusic();
    }
  };

  // Start music on first user interaction (autoplay policy)
  const kick = () => {
    if (Sound.musicOn) Sound.startMusic();
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);

  global.Sound = Sound;
})(window);
