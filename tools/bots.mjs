/*
 * バランス検証用の自動プレイ bot (Node 専用)
 * エンジンを直接動かすので、ブラウザなしで高速に何百戦でも回せる。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine, mulberry32 } = require('../js/engine.js');
const { ENEMIES } = require('../js/data.js');
const Battle = require('../js/battle.js');

/** 盾で受けたい大技 (バスター、または強力な全体攻撃) */
const isBig = (ab) => ab.type === 'buster' || (ab.type === 'raidwide' && ab.damage >= 40);

/**
 * 条件に合う技の詠唱開始 (start=true) または着弾までのおおよその時間 (ms)。
 * タイムラインを先読みする。
 */
function timeUntil(engine, match, { start = false } = {}) {
  const e = engine.state.enemy;
  const castMult = engine.diff().castMult;
  const gap = e.def.gap * castMult * 1000;
  let t = 0;
  if (e.cast) {
    t = e.cast.duration - e.cast.elapsed;
    if (match(e.cast.ability)) return start ? 0 : t;
    t += gap;
  } else {
    t = Math.max(0, e.gapLeft);
  }
  for (const ab of engine.upcoming(4)) {
    if (start && match(ab)) return t;
    t += ab.cast * castMult * 1000;
    if (match(ab)) return t;
    t += gap;
  }
  return Infinity;
}

const finder = (engine) => {
  const list = engine.cards();
  const index = (id) => list.findIndex((c) => c.id === id);
  return { list, index, ok: (i) => i >= 0 && engine.isEnabled(list[i]) };
};

/** (a) 長い攻撃呪文だけを打ち続ける */
export function greedyPolicy(engine) {
  const { ok } = finder(engine);
  return ok(2) ? 2 : null; // 2 = ★★★枠
}

/** (b) ギミックに適切に対応する */
export function properPolicy(engine, { keyMs, reaction }) {
  const { list, index, ok } = finder(engine);
  const { player: p, enemy: e } = engine.state;
  const ab = e.cast && e.cast.ability;
  const typeMs = (i) => list[i].romaji.length * keyMs * 1.1 + reaction;
  const id = (name) => index(name);
  const skill = (name) => list[id(name)];

  // 中断: 詠唱中なら即
  const si = id('silence');
  if (ab && ab.type === 'interruptible' && ok(si)) return si;

  // 盾: 大技の着弾前に張る。間に別の大技が来ると先に消費されるので、そのときは待つ。
  // 窓が近いときに長い呪文を始めて間に合わなくならないよう、短い呪文か待機でつなぐ
  const bi = id('barrier');
  const tb = timeUntil(engine, isBig);
  const tn = timeUntil(engine, (a) => Battle.consumesBarrier(a.type));
  const window = skill('barrier').duration * 1000 - 500;
  const cdLeft = engine.state.cooldowns.barrier || 0;
  if (!p.barrier && tn >= tb && cdLeft + typeMs(bi) < tb && tb < window + 4000) {
    if (tb <= window) return ok(bi) ? bi : null;
    return typeMs(0) < tb - window && ok(0) ? 0 : null;
  }

  // 次の大技を受けても耐えられる HP を保つ (バスターは盾込みで見積もる)
  const nextBig = [ab, ...engine.upcoming(2)].find((a) => a && Battle.consumesBarrier(a.type));
  if (nextBig && ok(id('heal'))) {
    const mult = engine.diff().damageMult * (p.vuln ? p.vuln.mult : 1) * (nextBig.type === 'buster' ? 0.25 : 1);
    if (p.hp <= nextBig.damage * mult + 12) return id('heal');
  }

  // 中断の先行入力: 次に来るなら構えておく
  const ts = timeUntil(engine, (a) => a.type === 'interruptible', { start: true });
  if (!p.silenceReady && ok(si) && ts < skill('silence').ready * 1000 - 500) return si;

  // 浄化: 継続ダメージの着弾前に加護を張る (先行入力)、付いてしまったら解除
  const ci = id('cleanse');
  const td = timeUntil(engine, (a) => a.type === 'dot');
  if (!p.ward && ok(ci) && (td < skill('cleanse').ward * 1000 - 500 || (p.dot && p.dot.remaining > 5000))) return ci;

  if (p.hp < 45 && ok(id('heal'))) return id('heal');
  if (p.hp < 75 && !p.regen && ok(id('regen'))) return id('regen');
  if (!p.empower && p.mp >= 55 && ok(id('empower'))) return id('empower');

  const reserve = 26; // 盾 + 回復ぶんは残す
  const resisted = (i) => Battle.elementMultiplier(list[i].element, e.element) < 1;
  // 撃てて有効な攻撃カードが1枚もなければ引き直す
  if (![0, 1, 2].some((i) => ok(i) && !resisted(i)) && engine.canRedraw()) return 'redraw';
  // 人間と同じく耐性属性はなるべく避ける (他に撃てるものがなければ使う)
  for (const avoidResist of [true, false]) {
    for (const i of [2, 1, 0]) {
      const s = list[i];
      if (!ok(i) || (avoidResist && resisted(i))) continue;
      if (s.mp && p.mp - s.mp < reserve) continue;
      return i;
    }
  }
  return 0;
}

/** (c) 雑なプレイ: 中断・浄化は使わず、回復も遅め */
export function sloppyPolicy(engine) {
  const { list, index, ok } = finder(engine);
  const { player: p, enemy: e } = engine.state;
  const ab = e.cast && e.cast.ability;
  const next = engine.upcoming(1)[0];
  const busterSoon = (ab && ab.type === 'buster') || (!e.cast && next && next.type === 'buster');
  if (busterSoon && !p.barrier && ok(index('barrier'))) return index('barrier');
  if (p.hp < 40 && ok(index('heal'))) return index('heal');
  for (const i of [2, 1, 0]) if (ok(i)) return i;
  return 0;
}

export const BOTS = {
  greedy: { policy: greedyPolicy, kps: 5, missRate: 0.02 },
  proper: { policy: properPolicy, kps: 4.5, missRate: 0.03 },
  sloppy: { policy: sloppyPolicy, kps: 3.5, missRate: 0.08 },
  expert: { policy: properPolicy, kps: 6.5, missRate: 0.02 },
};

/** 1ステージを bot で戦う */
export function runStage({
  difficulty, stage, bot, seed = 1, reaction = 300, maxMs = 600000, trace = null, onDecision = null,
  kps: kpsOverride, missRate: missOverride,
}) {
  const { policy } = BOTS[bot];
  const kps = kpsOverride ?? BOTS[bot].kps;
  const missRate = missOverride ?? BOTS[bot].missRate;
  const rng = mulberry32(seed);
  const engine = createEngine({ difficulty, rng: mulberry32(seed * 7919) });
  engine.startStage(stage);
  const keyMs = 1000 / kps;
  let elapsed = 0;
  const wait = (ms) => {
    engine.tick(ms);
    elapsed += ms;
    if (trace) {
      for (const ev of engine.drain()) {
        if (ev.type === 'log') trace(`${(elapsed / 1000).toFixed(1)}s HP${Math.round(engine.state.player.hp)} MP${Math.round(engine.state.player.mp)} ${ev.text}`);
      }
    }
  };

  while (engine.state.phase === 'battle' && elapsed < maxMs) {
    if (onDecision) onDecision(engine);
    const choice = policy(engine, { keyMs, reaction });
    if (choice == null) { wait(100); continue; }
    if (choice === 'redraw') { wait(reaction); engine.redraw(); continue; }
    wait(reaction);
    if (engine.state.phase !== 'battle') break;
    if (!engine.isEnabled(engine.cards()[choice])) continue;
    const romaji = engine.cards()[choice].romaji;
    for (const ch of romaji) {
      if (rng() < missRate) { engine.key(';'); wait(keyMs); }
      if (engine.state.phase !== 'battle') break;
      const r = engine.key(ch);
      wait(keyMs);
      if (!r.ok || engine.state.phase !== 'battle' || !engine.state.cast.started) break;
    }
    if (engine.state.phase === 'battle' && engine.state.cast.started) engine.cancelCast();
  }
  engine.drain();
  const s = engine.state;
  return {
    win: s.phase === 'stageClear' || s.phase === 'allClear',
    reason: s.result && s.result.reason,
    timeLeft: Math.round(s.enemy.enrageLeft / 1000),
    hp: Math.max(0, Math.round(s.player.hp)),
    enemyHpRatio: s.enemy.hp / s.enemy.maxHp,
    seconds: Math.round(s.stats.activeMs / 1000),
  };
}

/** 全ステージをリトライなしで通す */
export function runAll({ difficulty, bot, seed = 1, ...opts }) {
  const stages = [];
  for (let stage = 0; stage < ENEMIES.length; stage++) {
    const r = runStage({ difficulty, stage, bot, seed: seed * 100 + stage, ...opts });
    stages.push(r);
    if (!r.win) break;
  }
  return { clear: stages.length === ENEMIES.length && stages.every((r) => r.win), stages };
}
