/*
 * WebAudio による手続き生成サウンド (効果音 + BGM / 音声ファイル不要)
 *
 * 構成:  [各ボイス] → sfxBus ─┐
 *                    bgmBus ─┼→ master(ミュート/音量) → compressor → limiter → destination
 *        [送り] → reverb(畳み込み・IRは手続き生成) / echo(フィードバックディレイ) ─┘
 *
 * BGM は lookahead スケジューラ (setTimeout で起床し AudioContext の時刻で予約) で
 * テンポ同期して鳴らす。AudioContext はユーザー操作後 (unlock) に初めて作る。
 * Node 等 AudioContext の無い環境では全メソッドが何もしない。
 */
(function (root) {
  'use strict';

  const LOOKAHEAD = 0.15; // 何秒先まで予約するか
  const TICK_MS = 25;     // スケジューラの起床間隔
  const XFADE = 0.6;      // BGM のクロスフェード秒

  let ctx = null;
  let N = null;           // ミキサーのノード群
  let muted = false;
  const vol = { master: 0.8, sfx: 0.9, bgm: 0.6 };
  let pendingTrack = null;
  let current = null;     // 再生中の BGM インスタンス
  let bgmPaused = false;
  let timer = null;
  let timeOffset = 0;     // テスト用 (オフライン描画で効果音を時間差で鳴らす)
  let lastKeyAt = -1;
  let manualPump = false; // テスト用: setTimeout スケジューラを使わない

  const rand = Math.random;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const now = () => ctx.currentTime + timeOffset;
  const curve = (v) => { const x = Math.max(0, Math.min(1, Number(v) || 0)); return x * x; };

  // ---------------------------------------------------------------- 初期化

  function getAC() { return root.AudioContext || root.webkitAudioContext || null; }

  function attach(c) {
    ctx = c;
    const sr = ctx.sampleRate;

    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 2.5;
    comp.attack.value = 0.006; comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.1;
    const out = ctx.createGain();
    out.gain.value = 1.2;
    master.connect(comp); comp.connect(limiter); limiter.connect(out); out.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    const bgmBus = ctx.createGain();
    sfxBus.connect(master); bgmBus.connect(master);

    // リバーブ: 減衰ノイズの IR を手続き生成 (ステレオ 2.2 秒)
    const verb = ctx.createConvolver();
    const len = Math.floor(sr * 2.2);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        d[i] = (rand() * 2 - 1) * Math.pow(1 - x, 3.2) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
      }
    }
    verb.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.32;
    verb.connect(verbOut); verbOut.connect(master);
    // バス音量に追従させるため送りもバスごとに持つ
    const sfxVerb = ctx.createGain();
    const bgmVerb = ctx.createGain();
    sfxVerb.connect(verb); bgmVerb.connect(verb);

    // エコー (BGM 用。テンポに合わせて delayTime を変える)
    const echoIn = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    echoIn.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay);
    tone.connect(bgmBus);

    // ノイズバッファ (1 秒・使い回し)
    const noise = ctx.createBuffer(1, sr, sr);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    N = { master, comp, limiter, out, sfxBus, bgmBus, verb, sfxVerb, bgmVerb, echoIn, delay, noise };
    N.S = { out: sfxBus, wet: sfxVerb, echo: null };
    applyVolume(true);
  }

  function applyVolume(immediate) {
    if (!N) return;
    const t = ctx.currentTime;
    const set = (p, v) => {
      if (immediate) { p.value = v; return; }
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + 0.05);
    };
    set(N.master.gain, muted ? 0 : curve(vol.master));
    set(N.sfxBus.gain, curve(vol.sfx));
    set(N.sfxVerb.gain, curve(vol.sfx));
    set(N.bgmBus.gain, curve(vol.bgm));
    set(N.bgmVerb.gain, curve(vol.bgm));
    set(N.echoIn.gain, curve(vol.bgm));
  }

  function unlock() {
    if (!ctx) {
      const AC = getAC();
      if (!AC) return;
      try { attach(new AC()); } catch (e) { ctx = null; N = null; return; }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    if (pendingTrack) { const id = pendingTrack; pendingTrack = null; playBgm(id); }
  }

  const ready = () => !!(ctx && N && !muted);

  // ---------------------------------------------------------------- 音源

  function cleanup(src, nodes) {
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* noop */ } } };
  }

  /** 出力 (dest.out) とリバーブ/エコー送りへつなぐ */
  function route(node, dest, wet, echo, nodes) {
    node.connect(dest.out);
    if (wet > 0 && dest.wet) { const g = ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(dest.wet); nodes.push(g); }
    if (echo > 0 && dest.echo) { const g = ctx.createGain(); g.gain.value = echo; node.connect(g); g.connect(dest.echo); nodes.push(g); }
  }

  /**
   * 音程のある 1 音 (ADSR)。
   * o: { f, type, t, dur, a, d, s, r, g, slide(終端周波数), detune, lp, lpEnd, q, wet, echo }
   */
  function note(dest, o) {
    const t = o.t, a = o.a ?? 0.005, d = o.d ?? 0.08, s = o.s ?? 0.6, r = o.r ?? 0.08, g = o.g ?? 0.1;
    const dur = Math.max(o.dur ?? 0.1, 0.001);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideT ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    const env = ctx.createGain();
    const nodes = [osc, env];
    let head = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = o.q ?? 0.7;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpEnd), t + (o.lpT ?? dur));
      osc.connect(f); head = f; nodes.push(f);
    }
    head.connect(env);
    const p = env.gain;
    const hold = Math.max(t + a + d, t + dur);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(g, t + a);
    p.linearRampToValueAtTime(g * s, t + a + d);
    p.setValueAtTime(g * s, hold);
    p.linearRampToValueAtTime(0, hold + r);
    route(env, dest, o.wet || 0, o.echo || 0, nodes);
    osc.start(t);
    osc.stop(hold + r + 0.02);
    cleanup(osc, nodes);
  }

  /** 減衰だけの打撃音 (指数減衰) */
  function perc(dest, o) {
    const t = o.t, dec = o.dec ?? 0.1;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideT ?? dec));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(o.g ?? 0.1, t + (o.a ?? 0.002));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    osc.connect(env);
    const nodes = [osc, env];
    route(env, dest, o.wet || 0, o.echo || 0, nodes);
    osc.start(t); osc.stop(t + dec + 0.02);
    cleanup(osc, nodes);
  }

  /** フィルタしたノイズ (キャッシュしたバッファを任意位置から再生) */
  function noise(dest, o) {
    const t = o.t, dec = o.dec ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = N.noise;
    src.loop = dec > 0.9;
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'highpass';
    f.frequency.setValueAtTime(o.f ?? 1000, t);
    if (o.fEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fEnd), t + (o.fT ?? dec));
    f.Q.value = o.q ?? 0.7;
    const env = ctx.createGain();
    const g = o.g ?? 0.1, a = o.a ?? 0.001;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + a);
    if (o.lin) env.gain.linearRampToValueAtTime(0, t + dec);
    else env.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    src.connect(f); f.connect(env);
    const nodes = [src, f, env];
    route(env, dest, o.wet || 0, o.echo || 0, nodes);
    src.start(t, rand() * 0.5, dec + 0.05);
    cleanup(src, nodes);
  }

  // ---------------------------------------------------------------- 楽器 (BGM)

  const inst = {
    kick(d, t, g = 0.5) {
      perc(d, { t, f: 150, slide: 42, slideT: 0.12, dec: 0.32, g });
      noise(d, { t, ft: 'lowpass', f: 1800, dec: 0.02, g: g * 0.25 });
    },
    snare(d, t, g = 0.22) {
      perc(d, { t, f: 200, slide: 150, dec: 0.1, g: g * 0.6, type: 'triangle' });
      noise(d, { t, ft: 'bandpass', f: 2600, q: 0.6, dec: 0.16, g, wet: 0.25 });
    },
    hat(d, t, g = 0.06, open = false) {
      noise(d, { t, ft: 'highpass', f: 7500, dec: open ? 0.22 : 0.04, g });
    },
    crash(d, t, g = 0.09) {
      noise(d, { t, ft: 'highpass', f: 5000, fEnd: 3000, dec: 1.4, g, wet: 0.4 });
    },
    tom(d, t, m, g = 0.3) {
      perc(d, { t, f: mtof(m), slide: mtof(m) * 0.6, dec: 0.25, g, wet: 0.15 });
    },
    bass(d, t, m, dur, g = 0.16) {
      note(d, { t, f: mtof(m), type: 'sawtooth', dur, a: 0.004, d: 0.12, s: 0.5, r: 0.04, g, lp: 900, lpEnd: 240, lpT: 0.15, q: 3 });
      note(d, { t, f: mtof(m - 12), type: 'sine', dur, a: 0.004, d: 0.05, s: 0.8, r: 0.04, g: g * 0.7 });
    },
    subBass(d, t, m, dur, g = 0.16) {
      note(d, { t, f: mtof(m), type: 'triangle', dur, a: 0.04, d: 0.2, s: 0.7, r: 0.3, g });
    },
    pad(d, t, notes, dur, g = 0.035, lp = 1400) {
      for (const m of notes) {
        for (const dt of [-7, 7]) {
          note(d, { t, f: mtof(m), type: 'sawtooth', detune: dt, dur, a: 0.6, d: 0.4, s: 0.8, r: 0.9, g, lp, wet: 0.5 });
        }
      }
    },
    organ(d, t, notes, dur, g = 0.03) {
      for (const m of notes) note(d, { t, f: mtof(m), type: 'square', dur, a: 0.2, d: 0.3, s: 0.7, r: 0.5, g, lp: 900, wet: 0.5 });
    },
    pluck(d, t, m, g = 0.06, dec = 0.35) {
      note(d, { t, f: mtof(m), type: 'triangle', dur: 0.02, a: 0.003, d: dec, s: 0, r: 0.05, g, wet: 0.35, echo: 0.5 });
    },
    bell(d, t, m, g = 0.05) {
      perc(d, { t, f: mtof(m), dec: 1.6, g, wet: 0.6, echo: 0.4 });
      perc(d, { t, f: mtof(m) * 2.76, dec: 0.5, g: g * 0.35, wet: 0.6 });
    },
    lead(d, t, m, dur, g = 0.055) {
      note(d, { t, f: mtof(m), type: 'sawtooth', dur, a: 0.01, d: 0.12, s: 0.7, r: 0.12, g, lp: 3200, lpEnd: 1800, lpT: 0.2, wet: 0.25, echo: 0.3 });
      note(d, { t, f: mtof(m), type: 'square', detune: 9, dur, a: 0.01, d: 0.12, s: 0.6, r: 0.12, g: g * 0.45, lp: 2200 });
    },
    brass(d, t, m, dur, g = 0.05) {
      note(d, { t, f: mtof(m), type: 'sawtooth', dur, a: 0.03, d: 0.15, s: 0.75, r: 0.18, g, lp: 700, lpEnd: 2600, lpT: 0.08, wet: 0.35 });
      note(d, { t, f: mtof(m), type: 'sawtooth', detune: -8, dur, a: 0.03, d: 0.15, s: 0.75, r: 0.18, g: g * 0.6, lp: 1800 });
    },
    stab(d, t, notes, dur, g = 0.03) {
      for (const m of notes) note(d, { t, f: mtof(m), type: 'sawtooth', dur, a: 0.005, d: 0.1, s: 0.4, r: 0.08, g, lp: 1600, lpEnd: 500, q: 2, wet: 0.2 });
    },
  };

  // ---------------------------------------------------------------- BGM 定義

  /** [[step, midi, lenSteps], ...] → step 添字の配列 */
  function mel(list) {
    const a = [];
    for (const [s, m, l] of list) a[s] = [m, l];
    return a;
  }
  const MIN = [0, 3, 7], MAJ = [0, 4, 7], DIM = [0, 3, 6];
  const chordNotes = (root, q, base) => q.map((x) => root + x).map((m) => { while (m < base) m += 12; while (m >= base + 12) m -= 12; return m; }).sort((a, b) => a - b);

  // --- title: A マイナー / 静かで神秘的。パッド + アルペジオ + 鐘
  const TITLE_CH = [
    [57, 60, 64, 71], [53, 57, 60, 64], [50, 53, 57, 64], [52, 57, 59, 64],
    [57, 60, 64, 67], [53, 57, 60, 64], [55, 60, 64, 67], [52, 56, 59, 62],
  ];
  const TITLE_BELL = mel([
    [0, 76, 8], [24, 74, 4], [32, 72, 8], [56, 71, 8],
    [64, 69, 8], [88, 72, 4], [96, 76, 8], [112, 79, 4], [120, 77, 8],
    [128, 76, 8], [152, 74, 4], [160, 72, 8], [176, 71, 4], [184, 74, 4],
    [192, 72, 8], [216, 71, 4], [224, 68, 8], [240, 71, 8],
  ]);
  const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3];

  // --- battle: D マイナー 136bpm / 駆け抜けるファンタジー戦闘曲
  const BAT_ROOT = [38, 38, 34, 36, 38, 38, 43, 45, 34, 36, 38, 43, 34, 36, 45, 45];
  const BAT_Q = [MIN, MIN, MAJ, MAJ, MIN, MIN, MIN, MAJ, MAJ, MAJ, MIN, MIN, MAJ, MAJ, MAJ, MAJ];
  const BAT_LEAD = mel([
    [0, 74, 4], [4, 76, 2], [6, 77, 2], [8, 79, 4], [12, 77, 2], [14, 76, 2],
    [16, 74, 6], [22, 69, 2], [24, 72, 4], [28, 74, 4],
    [32, 77, 4], [36, 74, 2], [38, 77, 2], [40, 82, 4], [44, 81, 4],
    [48, 79, 6], [54, 76, 2], [56, 72, 4], [60, 76, 4],
    [64, 74, 4], [68, 76, 2], [70, 77, 2], [72, 79, 4], [76, 81, 4],
    [80, 82, 4], [84, 81, 2], [86, 79, 2], [88, 77, 8],
    [96, 79, 4], [100, 77, 2], [102, 74, 2], [104, 70, 4], [108, 74, 4],
    [112, 73, 8], [120, 76, 4], [124, 79, 4],
    [128, 77, 6], [134, 74, 2], [136, 70, 4], [140, 74, 4],
    [144, 76, 6], [150, 72, 2], [152, 67, 4], [156, 72, 4],
    [160, 74, 4], [164, 77, 4], [168, 81, 8],
    [176, 82, 4], [180, 81, 2], [182, 79, 2], [184, 77, 4], [188, 79, 4],
    [192, 77, 4], [196, 79, 2], [198, 81, 2], [200, 82, 8],
    [208, 84, 4], [212, 82, 2], [214, 81, 2], [216, 79, 8],
    [224, 81, 8], [232, 76, 4], [236, 73, 4],
    [240, 69, 8],
  ]);
  const GALLOP = { 0: 0, 2: 0, 3: 0, 4: 12, 6: 0, 7: 0, 8: 0, 10: 0, 11: 0, 12: 12, 14: 7, 15: 0 };

  // --- boss: E マイナー(和声的/フリギア) 152bpm / 重く緊迫
  const BOSS_ROOT = [40, 41, 40, 38, 40, 41, 36, 35, 40, 41, 40, 38, 36, 38, 35, 35];
  const BOSS_Q = [MIN, MAJ, MIN, MAJ, MIN, MAJ, MAJ, MAJ, MIN, MAJ, MIN, MAJ, MAJ, MAJ, MAJ, MAJ];
  const BOSS_LEAD = mel([
    [0, 76, 2], [2, 77, 2], [4, 76, 2], [6, 71, 2], [8, 76, 4], [12, 79, 4],
    [16, 77, 2], [18, 76, 2], [20, 77, 2], [22, 72, 2], [24, 77, 4], [28, 81, 4],
    [32, 83, 4], [36, 81, 2], [38, 79, 2], [40, 77, 2], [42, 76, 2], [44, 75, 4],
    [48, 74, 6], [54, 78, 2], [56, 81, 4], [60, 78, 4],
    [64, 76, 4], [68, 83, 4], [72, 81, 2], [74, 79, 2], [76, 77, 4],
    [80, 77, 4], [84, 84, 4], [88, 83, 2], [90, 81, 2], [92, 77, 4],
    [96, 79, 4], [100, 76, 4], [104, 72, 4], [108, 76, 4],
    [112, 75, 8], [120, 78, 4], [124, 71, 4],
  ]);

  // --- clear: C メジャー 120bpm / ファンファーレ 4 小節 → 穏やかなアウトロをループ
  const CLR_FAN = mel([
    [0, 67, 2], [2, 72, 2], [4, 76, 2], [6, 79, 4], [10, 76, 2], [12, 79, 4],
    [16, 81, 4], [20, 79, 2], [22, 81, 2], [24, 84, 8],
    [32, 83, 4], [36, 81, 2], [38, 79, 2], [40, 77, 4], [44, 79, 4],
    [48, 84, 14],
  ]);
  const CLR_FAN_CH = [[60, 64, 67], [53, 57, 60, 65], [55, 59, 62, 67], [48, 55, 60, 64]];
  const CLR_OUT_CH = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];
  const CLR_OUT_BELL = mel([[0, 79, 8], [16, 76, 8], [32, 77, 8], [48, 74, 8], [64, 76, 8], [80, 72, 8], [96, 74, 8], [112, 79, 8]]);

  // --- gameover: A マイナー 72bpm / 下降する短いフレーズ
  const GO_MEL = mel([[0, 76, 8], [8, 74, 4], [12, 72, 4], [16, 71, 8], [24, 69, 8], [32, 65, 8], [40, 64, 8], [48, 69, 16]]);
  const GO_CH = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59], [45, 52, 57]];

  const TRACKS = {
    title: {
      bpm: 76, bars: 16, loopFrom: 0, echo: 0.75,
      step(s, t, d, sd, pass) {
        const bar = s >> 4, k = s & 15;
        const ch = TITLE_CH[bar >> 1];
        if (k === 0 && (bar & 1) === 0) {
          inst.pad(d, t, ch, sd * 32 - 0.3, 0.03, 1100);
          inst.subBass(d, t, ch[0] - 12, sd * 30, 0.12);
        }
        if ((k & 1) === 0) {
          const i = ((bar & 1) * 8 + (k >> 1)) % 8;
          const m = ch[ARP_ORDER[i]] + 12 + (pass % 2 === 1 && bar >= 8 ? 12 : 0);
          inst.pluck(d, t, m, k === 0 ? 0.07 : 0.05, 0.45);
        }
        const b = TITLE_BELL[s];
        if (b && (pass > 0 || bar >= 4)) inst.bell(d, t, b[0] + 12, 0.04);
      },
    },
    battle: {
      bpm: 136, bars: 16, loopFrom: 0, echo: 0.75,
      step(s, t, d, sd, pass) {
        const bar = s >> 4, k = s & 15;
        const root = BAT_ROOT[bar], q = BAT_Q[bar];
        // ドラム
        const fill = (bar === 7 || bar === 15) && k >= 12;
        if (k === 0 || k === 8 || k === 10 || (k === 6 && (bar & 1))) inst.kick(d, t, 0.42);
        if ((k === 4 || k === 12) && !fill) inst.snare(d, t, 0.18);
        if (fill) inst.snare(d, t, 0.08 + (k - 12) * 0.03);
        if ((k & 1) === 0 && !fill) inst.hat(d, t, k % 4 === 2 ? 0.05 : 0.03, k === 14 && (bar & 3) === 3);
        if (k === 0 && (bar === 0 || bar === 8)) inst.crash(d, t, 0.07);
        // ベース
        if (k in GALLOP) inst.bass(d, t, root + GALLOP[k], sd * 0.9, 0.13);
        // 和音の刻み (裏拍) — 後半はアルペジオ
        if (bar < 8) {
          if (k === 2 || k === 6 || k === 10 || k === 14) inst.stab(d, t, chordNotes(root, q, 62), sd * 1.2, 0.016);
        } else if ((k & 1) === 0) {
          const cn = chordNotes(root, q, 62);
          inst.pluck(d, t, cn[(k >> 1) % 3] + (k >= 8 ? 12 : 0), 0.03, 0.2);
        }
        if (k === 0 && bar >= 8) inst.pad(d, t, chordNotes(root, q, 55), sd * 16, 0.012, 1200);
        // リード (2 周目の前半は休ませて変化をつける)
        const n = BAT_LEAD[s];
        if (n && !(pass % 2 === 1 && bar < 4)) inst.lead(d, t, n[0], n[1] * sd * 0.92, 0.045);
      },
    },
    boss: {
      bpm: 152, bars: 16, loopFrom: 0, echo: 0.75,
      step(s, t, d, sd, pass) {
        const bar = s >> 4, k = s & 15;
        const root = BOSS_ROOT[bar], q = BOSS_Q[bar];
        const breakdown = bar >= 8 && bar < 12;
        const fill = bar === 15 && k >= 8;
        // ドラム: 4 つ打ち + 2 連キック
        if (!breakdown) {
          if (k % 4 === 0 || k === 3 || k === 11) inst.kick(d, t, 0.42);
          if ((k === 4 || k === 12) && !fill) inst.snare(d, t, 0.2);
          if (!fill) inst.hat(d, t, k % 2 ? 0.018 : 0.035);
        } else {
          if (k === 0 || k === 8) inst.kick(d, t, 0.45);
          if (k === 12 && (bar & 1)) inst.snare(d, t, 0.14);
          if (k % 4 === 2) inst.hat(d, t, 0.03);
        }
        if (fill) { if (k % 2 === 0) inst.tom(d, t, 52 - (k - 8), 0.22); else inst.snare(d, t, 0.1); }
        if (k === 0 && (bar === 0 || bar === 12)) inst.crash(d, t, 0.08);
        // ベース: 16 分刻み (ブレイクダウンは半音で這う)
        if (!breakdown) inst.bass(d, t, root + (k % 8 === 6 ? 12 : 0), sd * 0.8, k % 4 === 0 ? 0.13 : 0.1);
        else if (k % 4 === 0) inst.bass(d, t, root + [0, 1, 0, -1][k >> 2], sd * 3.5, 0.12);
        // 不穏な和音
        if (k === 0) inst.organ(d, t, chordNotes(root, q, 59), sd * 16, breakdown ? 0.028 : 0.018);
        if (!breakdown && (k === 0 || k === 6 || k === 12)) inst.stab(d, t, [root + 24, root + 31], sd * 1.5, 0.018);
        if (breakdown && k === 0) inst.bell(d, t, root + 36 + 1, 0.025);
        // リード
        if (!breakdown) {
          const ls = bar >= 12 ? s - 128 : s;
          const n = BOSS_LEAD[ls];
          if (n) inst.lead(d, t, n[0] + (pass % 2 === 1 && bar < 4 ? 12 : 0), n[1] * sd * 0.9, 0.042);
        }
      },
    },
    clear: {
      bpm: 120, bars: 12, loopFrom: 4, echo: 0.75,
      step(s, t, d, sd) {
        const bar = s >> 4, k = s & 15;
        if (bar < 4) {
          if (bar === 0 && k < 2) inst.snare(d, t, 0.08);
          if (k === 0) {
            inst.pad(d, t, CLR_FAN_CH[bar], sd * 15, 0.02, 2200);
            inst.subBass(d, t, CLR_FAN_CH[bar][0] - 12, sd * 15, 0.13);
            inst.kick(d, t, 0.35);
          }
          if (k === 0 && bar === 3) inst.crash(d, t, 0.09);
          if (bar < 3 && (k === 4 || k === 12)) inst.snare(d, t, 0.1);
          const n = CLR_FAN[s];
          if (n) {
            inst.brass(d, t, n[0], n[1] * sd * 0.9, 0.05);
            inst.brass(d, t, n[0] - 12, n[1] * sd * 0.9, 0.025);
          }
        } else {
          const ob = (bar - 4) & 3, os = s - 64;
          const ch = CLR_OUT_CH[ob];
          if (k === 0) { inst.pad(d, t, ch, sd * 16, 0.016, 1300); inst.subBass(d, t, ch[0] - 12, sd * 15, 0.09); }
          if ((k & 1) === 0) inst.pluck(d, t, ch[ARP_ORDER[(k >> 1) % 8]] + 12, 0.028, 0.4);
          const b = CLR_OUT_BELL[os];
          if (b) inst.bell(d, t, b[0] + 12, 0.025);
        }
      },
    },
    gameover: {
      bpm: 72, bars: 5, loopFrom: null, echo: 0.75,
      step(s, t, d, sd) {
        const bar = s >> 4, k = s & 15;
        if (k === 0) {
          inst.pad(d, t, GO_CH[bar], sd * 16, 0.03, 900);
          inst.subBass(d, t, GO_CH[bar][0] - 12, sd * 16, 0.12);
        }
        const n = GO_MEL[s];
        if (n) inst.lead(d, t, n[0], n[1] * sd * 0.95, 0.035);
        if (bar === 4 && k === 0) inst.bell(d, t, 81, 0.03);
      },
    },
  };

  // ---------------------------------------------------------------- スケジューラ

  function makeInstance(id, fadeIn) {
    const tr = TRACKS[id];
    const out = ctx.createGain();
    const wet = ctx.createGain();
    const echo = ctx.createGain();
    out.connect(N.bgmBus); wet.connect(N.bgmVerb); echo.connect(N.echoIn);
    const t = ctx.currentTime;
    for (const g of [out, wet, echo]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + fadeIn);
    }
    const sd = 60 / tr.bpm / 4;
    N.delay.delayTime.setValueAtTime(sd * 3, t); // 付点 8 分
    return { id, tr, sd, step: 0, pass: 0, nextTime: t + 0.06, done: false, dest: { out, wet, echo }, gains: [out, wet, echo] };
  }

  function fadeOutAndDispose(ins, sec) {
    const t = ctx.currentTime;
    for (const g of ins.gains) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + sec);
    }
    ins.done = true;
    const kill = () => { for (const g of ins.gains) { try { g.disconnect(); } catch (e) { /* noop */ } } };
    if (manualPump) return;
    setTimeout(kill, (sec + 3) * 1000);
  }

  function pump(until) {
    const ins = current;
    if (!ins || ins.done) return;
    const total = ins.tr.bars * 16;
    // タブ非表示などで大きく遅れたら、拍位置を保ったまま追いつく
    const lateBy = ctx.currentTime - ins.nextTime;
    if (lateBy > 0.1 && !manualPump) {
      const skip = Math.ceil(lateBy / ins.sd);
      for (let i = 0; i < skip && !ins.done; i++) advance(ins, total);
      ins.nextTime += skip * ins.sd;
    }
    while (!ins.done && ins.nextTime < until) {
      try { ins.tr.step(ins.step, ins.nextTime, ins.dest, ins.sd, ins.pass); } catch (e) { /* 1 ステップの失敗で止めない */ }
      ins.nextTime += ins.sd;
      advance(ins, total);
    }
  }

  function advance(ins, total) {
    ins.step++;
    if (ins.step >= total) {
      if (ins.tr.loopFrom == null) {
        ins.done = true;
        const ref = ins;
        if (!manualPump) setTimeout(() => { if (current === ref) current = null; fadeOutAndDispose(ref, 0.01); }, 6000);
      } else { ins.step = ins.tr.loopFrom * 16; ins.pass++; }
    }
  }

  function tick() {
    timer = null;
    if (!ctx || !current || bgmPaused || current.done) return;
    pump(ctx.currentTime + LOOKAHEAD);
    timer = setTimeout(tick, TICK_MS);
  }

  function kick() {
    if (manualPump || timer || bgmPaused) return;
    tick();
  }

  function playBgm(id) {
    if (!TRACKS[id]) return false;
    if (!ctx || !N) { pendingTrack = id; return true; }
    if (current && current.id === id && !current.done) return true;
    const oneShot = TRACKS[id].loopFrom == null || id === 'clear';
    if (current) fadeOutAndDispose(current, oneShot ? 0.25 : XFADE);
    current = makeInstance(id, oneShot ? 0.03 : XFADE);
    if (bgmPaused) {
      // 一時停止中に切り替えた場合は無音のまま待機
      for (const g of current.gains) { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(0, ctx.currentTime); }
    }
    kick();
    return true;
  }

  function stopBgm(fade = XFADE) {
    pendingTrack = null;
    if (!ctx || !current) return;
    fadeOutAndDispose(current, fade);
    current = null;
  }

  function suspendBgm() {
    if (bgmPaused) return;
    bgmPaused = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!ctx || !current) return;
    const t = ctx.currentTime;
    for (const g of current.gains) {
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.12);
    }
  }

  function resumeBgm() {
    if (!bgmPaused) return;
    bgmPaused = false;
    if (!ctx || !current) return;
    const t = ctx.currentTime;
    current.nextTime = Math.max(current.nextTime, t + 0.05);
    if (current.nextTime > t + 0.5) current.nextTime = t + 0.05;
    for (const g of current.gains) {
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.4);
    }
    kick();
  }

  // ---------------------------------------------------------------- 効果音

  function arp(freqs, gap, o) {
    const t = now();
    freqs.forEach((f, i) => note(N.S, Object.assign({ f, t: t + i * gap }, o)));
  }

  const Sfx = {
    unlock,
    get enabled() { return !muted; },
    /** マスターミュートの切り替え。戻り値は有効かどうか */
    toggle() {
      muted = !muted;
      if (!muted) unlock();
      applyVolume(false);
      return !muted;
    },
    setVolume(v = {}) {
      for (const k of ['master', 'sfx', 'bgm']) if (typeof v[k] === 'number' && isFinite(v[k])) vol[k] = Math.max(0, Math.min(1, v[k]));
      applyVolume(false);
      return Sfx.getVolume();
    },
    getVolume() { return { master: vol.master, sfx: vol.sfx, bgm: vol.bgm, muted }; },

    playBgm, stopBgm, suspendBgm, resumeBgm,
    get bgm() { return current && !current.done ? current.id : pendingTrack; },
    tracks: Object.keys(TRACKS),

    /** 打鍵音: ごく短く柔らかい。毎回わずかに音程を揺らす */
    key(combo = 0) {
      if (!ready()) return;
      const t = now();
      if (t - lastKeyAt < 0.012) return;
      lastKeyAt = t;
      const lift = Math.pow(2, Math.min(combo | 0, 60) / 5 / 36); // コンボで僅かに上がる
      const f = 1650 * lift * (1 + (rand() - 0.5) * 0.08);
      perc(N.S, { t, f, dec: 0.045, g: 0.07, a: 0.001 });
      noise(N.S, { t, ft: "bandpass", f: 3800, q: 1.2, dec: 0.012, g: 0.04 });
    },
    /** 打ち間違い: 低めの濁った「コッ」。耳障りにならないよう低域通過 */
    miss() {
      if (!ready()) return;
      const t = now();
      note(N.S, { t, f: 196, slide: 150, type: 'square', dur: 0.09, a: 0.003, d: 0.06, s: 0.3, r: 0.05, g: 0.07, lp: 900 });
      note(N.S, { t, f: 208, slide: 160, type: 'square', dur: 0.09, a: 0.003, d: 0.06, s: 0.3, r: 0.05, g: 0.05, lp: 900 });
      noise(N.S, { t, ft: 'lowpass', f: 600, dec: 0.06, g: 0.08 });
    },
    /** 攻撃命中。weak=true で大技 (弱点/会心) */
    cast(weak) {
      if (!ready()) return;
      const t = now();
      noise(N.S, { t, ft: 'bandpass', f: 600, fEnd: 3200, fT: 0.12, q: 1.5, dec: 0.18, g: 0.12, a: 0.03, wet: 0.2 });
      perc(N.S, { t: t + 0.08, f: 260, slide: 90, dec: 0.22, g: 0.22 });
      note(N.S, { t: t + 0.08, f: 660, slide: 990, type: 'triangle', dur: 0.1, d: 0.1, s: 0.3, r: 0.15, g: 0.06, wet: 0.3 });
      if (weak) {
        perc(N.S, { t: t + 0.08, f: 110, slide: 40, dec: 0.5, g: 0.3 });
        noise(N.S, { t: t + 0.08, ft: 'lowpass', f: 2000, fEnd: 300, dec: 0.45, g: 0.12, wet: 0.3 });
        [1320, 1760, 2640].forEach((f, i) => perc(N.S, { t: t + 0.1 + i * 0.04, f, dec: 0.35, g: 0.03, wet: 0.5 }));
      }
    },
    heal() {
      if (!ready()) return;
      arp([523, 659, 784, 1046], 0.06, { type: 'sine', dur: 0.12, d: 0.1, s: 0.5, r: 0.35, g: 0.055, wet: 0.5 });
      noise(N.S, { t: now(), ft: 'highpass', f: 5000, fEnd: 9000, dec: 0.5, g: 0.015, a: 0.15, lin: true, wet: 0.5 });
    },
    warn() {
      if (!ready()) return;
      const t = now();
      for (const dt of [0, 0.14]) {
        note(N.S, { t: t + dt, f: 880, type: 'square', dur: 0.06, a: 0.004, d: 0.05, s: 0.4, r: 0.06, g: 0.04, lp: 2200, wet: 0.2 });
        note(N.S, { t: t + dt, f: 1245, type: 'sine', dur: 0.06, a: 0.004, d: 0.05, s: 0.4, r: 0.06, g: 0.025 });
      }
    },
    hurt(heavy) {
      if (!ready()) return;
      const t = now();
      perc(N.S, { t, f: heavy ? 140 : 180, slide: heavy ? 38 : 60, dec: heavy ? 0.45 : 0.22, g: heavy ? 0.4 : 0.28 });
      noise(N.S, { t, ft: 'lowpass', f: heavy ? 2400 : 1600, fEnd: 200, dec: heavy ? 0.4 : 0.18, g: heavy ? 0.2 : 0.12 });
      if (heavy) note(N.S, { t, f: 92, slide: 55, type: 'sawtooth', dur: 0.25, d: 0.2, s: 0.3, r: 0.15, g: 0.08, lp: 500 });
    },
    win() {
      if (!ready()) return;
      arp([523, 659, 784, 1046], 0.09, { type: 'triangle', dur: 0.14, d: 0.1, s: 0.6, r: 0.3, g: 0.06, wet: 0.4 });
    },
    lose() {
      if (!ready()) return;
      arp([392, 330, 262, 196], 0.16, { type: 'triangle', dur: 0.2, d: 0.15, s: 0.5, r: 0.4, g: 0.06, lp: 1600, wet: 0.4 });
    },

    /** 敵の詠唱を中断させた: ガラスが割れるような音 */
    interrupt() {
      if (!ready()) return;
      const t = now();
      noise(N.S, { t, ft: 'bandpass', f: 3000, q: 0.8, dec: 0.25, g: 0.14, wet: 0.3 });
      note(N.S, { t, f: 1200, slide: 240, type: 'sawtooth', dur: 0.2, d: 0.1, s: 0.4, r: 0.08, g: 0.04, lp: 2500 });
      for (let i = 0; i < 5; i++) perc(N.S, { t: t + 0.02 + i * 0.035, f: 2400 + rand() * 2600, dec: 0.18, g: 0.025, wet: 0.5 });
      perc(N.S, { t, f: 160, slide: 70, dec: 0.25, g: 0.2 });
    },
    /** 防御障壁: 金属的な響き + うなり */
    barrier() {
      if (!ready()) return;
      const t = now();
      note(N.S, { t, f: 220, type: 'sawtooth', dur: 0.35, a: 0.05, d: 0.2, s: 0.5, r: 0.3, g: 0.05, lp: 300, lpEnd: 1800, lpT: 0.25, q: 6, wet: 0.3 });
      [1320, 1985, 2640].forEach((f, i) => perc(N.S, { t: t + 0.05, f, dec: 0.9 - i * 0.2, g: 0.025, wet: 0.6 }));
    },
    /** 浄化: 上昇するきらめき */
    cleanse() {
      if (!ready()) return;
      const t = now();
      note(N.S, { t, f: 700, slide: 1700, slideT: 0.35, type: 'sine', dur: 0.35, a: 0.03, d: 0.1, s: 0.7, r: 0.3, g: 0.05, wet: 0.5 });
      noise(N.S, { t, ft: 'highpass', f: 2500, fEnd: 9000, fT: 0.4, dec: 0.5, a: 0.1, g: 0.03, lin: true, wet: 0.5 });
      [1568, 2093, 2637].forEach((f, i) => perc(N.S, { t: t + 0.2 + i * 0.05, f, dec: 0.4, g: 0.025, wet: 0.5 }));
    },
    /** 強化: 力強い上昇アルペジオ */
    buff() {
      if (!ready()) return;
      arp([392, 494, 587, 784], 0.045, { type: 'square', dur: 0.06, d: 0.06, s: 0.5, r: 0.12, g: 0.035, lp: 2400, wet: 0.3 });
      note(N.S, { t: now() + 0.18, f: 784, type: 'triangle', dur: 0.2, d: 0.1, s: 0.6, r: 0.3, g: 0.05, wet: 0.4 });
    },
    /** ボスのフェーズ移行: 低い衝撃 + うねり上がるノイズ + 不協和のブラス */
    phase() {
      if (!ready()) return;
      const t = now();
      perc(N.S, { t, f: 90, slide: 30, dec: 1.0, g: 0.35 });
      noise(N.S, { t, ft: 'bandpass', f: 300, fEnd: 2500, fT: 1.0, q: 2, dec: 1.1, a: 0.6, g: 0.1, lin: true, wet: 0.4 });
      for (const m of [40, 46, 47]) note(N.S, { t: t + 0.9, f: mtof(m + 12), type: 'sawtooth', dur: 0.35, a: 0.01, d: 0.2, s: 0.5, r: 0.5, g: 0.035, lp: 1400, wet: 0.5 });
      perc(N.S, { t: t + 0.9, f: 120, slide: 40, dec: 0.6, g: 0.3 });
    },
    /** メニューのカーソル移動 */
    select() {
      if (!ready()) return;
      perc(N.S, { t: now(), f: 1100, dec: 0.05, g: 0.05, type: 'triangle' });
    },
    /** メニュー決定 */
    confirm() {
      if (!ready()) return;
      arp([784, 1175], 0.06, { type: 'triangle', dur: 0.06, d: 0.08, s: 0.4, r: 0.15, g: 0.06, wet: 0.3 });
    },
    /** 呪文の詠唱完了。tier 1〜3 で段階的に豪華になる */
    complete(tier = 1) {
      if (!ready()) return;
      const t = now();
      const tr = Math.max(1, Math.min(3, tier | 0));
      const notes = tr === 1 ? [1319, 1760] : tr === 2 ? [1047, 1319, 1760] : [784, 1047, 1319, 1568, 2093];
      notes.forEach((f, i) => perc(N.S, { t: t + i * 0.045, f, dec: 0.35 + tr * 0.1, g: 0.04, wet: 0.4 + tr * 0.1 }));
      if (tr >= 2) noise(N.S, { t, ft: 'highpass', f: 6000, dec: 0.3 * tr, a: 0.02, g: 0.012 * tr, lin: true, wet: 0.5 });
      if (tr === 3) {
        perc(N.S, { t, f: 100, slide: 45, dec: 0.5, g: 0.22 });
        note(N.S, { t: t + 0.05, f: 523, type: 'sawtooth', dur: 0.3, a: 0.02, d: 0.2, s: 0.5, r: 0.4, g: 0.03, lp: 2000, wet: 0.5 });
      }
    },
    /** コンボ: 5 の倍数ごとに小さな合図、段が進むほど少し高く */
    combo(n) {
      if (!ready()) return;
      n |= 0;
      if (n < 5 || n % 5 !== 0) return;
      const lv = Math.min(n / 5, 12);
      const f = 1047 * Math.pow(2, (lv - 1) * 2 / 12);
      const t = now();
      perc(N.S, { t, f, dec: 0.18, g: 0.03, wet: 0.4 });
      perc(N.S, { t: t + 0.05, f: f * 1.5, dec: 0.25, g: 0.025, wet: 0.4 });
    },
    /** 危険 (残り時間僅少 / 低 HP): 心拍。周期的に呼ぶ (~0.8〜1 秒間隔推奨) */
    danger() {
      if (!ready()) return;
      const t = now();
      perc(N.S, { t, f: 70, slide: 45, dec: 0.16, g: 0.3 });
      perc(N.S, { t: t + 0.17, f: 62, slide: 40, dec: 0.2, g: 0.22 });
    },
    /** 一時停止 */
    pause() {
      if (!ready()) return;
      arp([880, 587], 0.07, { type: 'triangle', dur: 0.05, d: 0.08, s: 0.3, r: 0.1, g: 0.05, wet: 0.2 });
    },

    // ---- テスト用 (本番コードからは使わない) ----
    _attach(c) { ctx = null; N = null; current = null; bgmPaused = false; manualPump = true; attach(c); },
    _pump(seconds) { if (ctx && current) pump(seconds); },
    _at(t) { timeOffset = t; },
  };

  root.Sfx = Sfx;
})(typeof globalThis !== 'undefined' ? globalThis : this);
