import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../js/sfx.js', import.meta.url), 'utf8');

/** 最小限の WebAudio モック (呼び出しの妥当性と NaN の混入を検査する) */
function mockAudio() {
  const stats = { nodes: 0, started: 0, bad: [] };
  const param = (v = 0) => {
    const p = { value: v };
    const check = (name) => (x, t) => {
      if (!Number.isFinite(x) || (t !== undefined && !Number.isFinite(t))) stats.bad.push(`${name}(${x}, ${t})`);
      if (name === 'exponentialRampToValueAtTime' && x <= 0) stats.bad.push(`exp ramp to ${x}`);
      return p;
    };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) p[m] = check(m);
    p.setTargetAtTime = check('setTargetAtTime');
    p.cancelScheduledValues = () => p;
    return p;
  };
  const node = (extra = {}) => {
    stats.nodes++;
    return Object.assign({ connect: (n) => n, disconnect() {} }, extra);
  };
  const source = (extra) => node(Object.assign({
    start(t) { if (!Number.isFinite(t)) stats.bad.push(`start(${t})`); stats.started++; },
    stop(t) { if (!Number.isFinite(t)) stats.bad.push(`stop(${t})`); },
  }, extra));
  class AudioContext {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    resume() { return Promise.resolve(); }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return source({ type: 'sine', frequency: param(440), detune: param(0) }); }
    createBufferSource() { return source({ buffer: null, loop: false }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createDelay() { return node({ delayTime: param(0) }); }
    createConvolver() { return node({ buffer: null }); }
    createDynamicsCompressor() {
      return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    }
    createBuffer(ch, len) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { getChannelData: (i) => d[i] }; }
  }
  return { AudioContext, stats };
}

function load(globals = {}) {
  const sandbox = { setTimeout, clearTimeout, Math, ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(SRC, sandbox);
  return sandbox.Sfx;
}

const SFX = ['key', 'miss', 'cast', 'heal', 'warn', 'hurt', 'win', 'lose', 'interrupt', 'barrier', 'cleanse',
  'buff', 'phase', 'select', 'confirm', 'redraw', 'weather', 'complete', 'combo', 'danger', 'pause'];

test('AudioContext が無い環境でも読み込め、全メソッドが例外を出さない', () => {
  const Sfx = load();
  assert.equal(typeof Sfx, 'object');
  for (const k of [...SFX, 'unlock', 'stopBgm', 'suspendBgm', 'resumeBgm']) assert.doesNotThrow(() => Sfx[k](), k);
  assert.equal(Sfx.enabled, true);
  assert.equal(Sfx.toggle(), false);
  assert.equal(Sfx.toggle(), true);
});

test('unlock 前の playBgm は保留され、unlock で再生される', () => {
  const { AudioContext, stats } = mockAudio();
  const Sfx = load({ AudioContext });
  assert.equal(Sfx.playBgm('battle'), true);
  assert.equal(Sfx.bgm, 'battle');
  assert.equal(stats.started, 0);
  Sfx.unlock();
  assert.ok(stats.started > 0, 'unlock 後に BGM の音が予約される');
  Sfx.stopBgm();
  assert.equal(Sfx.bgm, null);
  assert.equal(Sfx.playBgm('nope'), false);
});

test('全効果音・全 BGM が不正な値 (NaN / 0 への指数ランプ) を使わない', () => {
  const { AudioContext, stats } = mockAudio();
  const Sfx = load({ AudioContext });
  Sfx._attach(new AudioContext());
  for (const k of SFX) Sfx[k]();
  Sfx.cast(true); Sfx.hurt(true); Sfx.complete(2); Sfx.complete(3); Sfx.complete(99); Sfx.combo(25); Sfx.key(40);
  for (const id of Sfx.tracks) {
    Sfx.playBgm(id);
    Sfx._pump(120); // 2 分ぶん予約 (ループ・終端の処理も通る)
  }
  assert.deepEqual(stats.bad, []);
  assert.ok(stats.started > 1000);
});

test('音量 API は 0..1 に丸め、toggle はマスターミュート', () => {
  const { AudioContext } = mockAudio();
  const Sfx = load({ AudioContext });
  Sfx.unlock();
  const v = Sfx.setVolume({ master: 2, sfx: -1, bgm: 0.25 });
  assert.equal(v.master, 1);
  assert.equal(v.sfx, 0);
  assert.equal(v.bgm, 0.25);
  Sfx.setVolume({ bgm: NaN });
  assert.equal(Sfx.getVolume().bgm, 0.25);
  assert.equal(Sfx.toggle(), false);
  assert.equal(Sfx.getVolume().muted, true);
  assert.equal(Sfx.enabled, false);
  Sfx.toggle();
});
