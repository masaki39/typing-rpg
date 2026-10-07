/*
 * WebAudio による簡易効果音 (音声ファイル不要)
 */
(function (root) {
  'use strict';

  let ctx = null;
  let enabled = true;

  function unlock() {
    if (ctx || !enabled) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (AC) ctx = new AC();
  }

  function tone(freq, dur, { type = 'square', vol = 0.04, slide = 0, delay = 0 } = {}) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  root.Sfx = {
    unlock,
    get enabled() { return enabled; },
    toggle() { enabled = !enabled; if (enabled) unlock(); return enabled; },
    key() { tone(1200, 0.03, { vol: 0.02 }); },
    miss() { tone(160, 0.12, { type: 'sawtooth', vol: 0.05 }); },
    cast(weak) {
      tone(440, 0.12, { type: 'triangle', vol: 0.06, slide: 440 });
      tone(660, 0.18, { type: 'triangle', vol: 0.05, slide: 660, delay: 0.06 });
      if (weak) tone(990, 0.2, { type: 'square', vol: 0.04, slide: 500, delay: 0.12 });
    },
    heal() {
      [523, 659, 784].forEach((f, i) => tone(f, 0.15, { type: 'sine', vol: 0.06, delay: i * 0.07 }));
    },
    hurt(heavy) { tone(heavy ? 90 : 130, heavy ? 0.35 : 0.2, { type: 'sawtooth', vol: 0.07, slide: -60 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.06, delay: i * 0.1 })); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.06, delay: i * 0.15 })); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
