import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine, mulberry32, resolveTimeline } = require('../js/engine.js');
const { ENEMIES } = require('../js/data.js');

function setup({ difficulty = 'normal', stage = 0 } = {}) {
  const engine = createEngine({ difficulty, rng: mulberry32(42) });
  engine.startStage(stage);
  engine.state.enemy.gapLeft = Infinity; // 勝手に技を出さないように
  return engine;
}

/** カードを id (または手札の位置) で指定して詠唱しきる */
function castCard(engine, idOrIndex) {
  const list = engine.cards();
  const i = typeof idOrIndex === 'number' ? idOrIndex : list.findIndex((c) => c.id === idOrIndex);
  for (const ch of list[i].romaji) engine.key(ch);
}

/** 敵に指定の技を詠唱させる */
function forceEnemyCast(engine, key) {
  const e = engine.state.enemy;
  const ability = e.def.abilities[key];
  e.cast = { ability, elapsed: 0, duration: ability.cast * 1000 };
  return e.cast.duration;
}

test('★攻撃は MP を回復、★★★は MP を消費する', () => {
  const engine = setup();
  const p = engine.state.player;
  p.mp = 50;
  castCard(engine, 0);
  assert.equal(p.mp, 60);
  castCard(engine, 2);
  assert.equal(p.mp, 20);
});

test('MP が足りないと長い呪文は詠唱できない', () => {
  const engine = setup();
  const e = engine.state.enemy;
  engine.state.player.mp = 10;
  const spell = engine.cards()[2];
  assert.equal(engine.isEnabled(spell), false);
  castCard(engine, 2);
  assert.equal(e.hp, e.maxHp);
});

test('タンクバスター: 障壁なしでは致命傷、障壁ありなら耐える', () => {
  const noShield = setup({ stage: 1 });
  noShield.tick(forceEnemyCast(noShield, 'fang'));
  assert.equal(noShield.state.phase, 'gameover');

  const shield = setup({ stage: 1 });
  castCard(shield, 'barrier');
  shield.tick(forceEnemyCast(shield, 'fang'));
  assert.equal(shield.state.phase, 'battle');
  assert.ok(shield.state.player.hp > 60);
});

test('障壁はリキャスト中は使えない', () => {
  const engine = setup();
  castCard(engine, 'barrier');
  const barrier = engine.cards().find((c) => c.id === 'barrier');
  assert.equal(engine.isEnabled(barrier), false);
  engine.tick(barrier.cd * 1000);
  assert.equal(engine.isEnabled(barrier), true);
});

test('中断可能技: 「黙せよ」で中断、失敗すると被ダメージ増加', () => {
  const ok = setup({ stage: 2 });
  forceEnemyCast(ok, 'hammer');
  ok.tick(1000);
  castCard(ok, 'silence');
  assert.equal(ok.state.enemy.cast, null);
  assert.equal(ok.state.stats.interrupts, 1);

  const ng = setup({ stage: 2 });
  ng.tick(forceEnemyCast(ng, 'hammer'));
  assert.ok(ng.state.player.vuln);
  const hp = ng.state.player.hp;
  ng.tick(forceEnemyCast(ng, 'peck'));
  assert.equal(hp - ng.state.player.hp, Math.round(6 * 1.5));
});

test('継続ダメージは浄化で解除できる', () => {
  const engine = setup();
  engine.tick(forceEnemyCast(engine, 'acid'));
  const p = engine.state.player;
  assert.ok(p.dot);
  const before = p.hp;
  engine.tick(2000);
  assert.ok(p.hp < before);
  castCard(engine, 'cleanse');
  assert.equal(p.dot, null);
});

test('詠唱中に被弾しても入力も威力も一切変わらない', () => {
  const hit = setup();
  const calm = setup();
  const romaji = hit.cards()[2].romaji;
  assert.equal(calm.cards()[2].romaji, romaji);
  for (const ch of romaji.slice(0, 5)) { hit.key(ch); calm.key(ch); }
  const typed = hit.state.cast.matchers[2].typed;
  const live = [...hit.state.cast.live];
  hit.tick(forceEnemyCast(hit, 'tackle'));
  hit.tick(forceEnemyCast(hit, 'tsunami'));
  const c = hit.state.cast;
  assert.equal(c.started, true);
  assert.equal(c.matchers[2].typed, typed, '入力済みの文字列はそのまま');
  assert.deepEqual(c.live, live, '候補の絞り込みもそのまま');
  for (const ch of romaji.slice(5)) { hit.key(ch); calm.key(ch); }
  const dmg = (eng) => eng.state.enemy.maxHp - eng.state.enemy.hp;
  assert.equal(dmg(hit), dmg(calm), '被弾してもダメージは同じ');
});

test('盾は通常攻撃では消えず、大技1回で消費される', () => {
  const engine = setup();
  castCard(engine, 'barrier');
  const p = engine.state.player;
  engine.tick(forceEnemyCast(engine, 'tackle'));
  assert.ok(p.barrier, '通常攻撃では消えない');
  engine.tick(forceEnemyCast(engine, 'tsunami'));
  assert.equal(p.barrier, null, '大技で消費');
});

test('盾は最大持続時間で切れる', () => {
  const engine = setup();
  castCard(engine, 'barrier');
  const barrier = engine.cards().find((c) => c.id === 'barrier');
  engine.tick(barrier.duration * 1000 - 100);
  assert.ok(engine.state.player.barrier);
  engine.tick(200);
  assert.equal(engine.state.player.barrier, null);
});

test('浄化の先行入力: 着弾前に唱えると加護で継続ダメージを防ぐ', () => {
  const engine = setup();
  const ms = forceEnemyCast(engine, 'acid');
  engine.tick(ms / 2);
  castCard(engine, 'cleanse'); // 詠唱バーが出ている間に唱える
  assert.ok(engine.state.player.ward);
  engine.tick(ms);
  assert.equal(engine.state.player.dot, null);
  assert.equal(engine.state.player.ward, null, '加護は1回で消費');
  assert.equal(engine.state.stats.warded, 1);
});

test('加護は時間で切れる', () => {
  const engine = setup();
  castCard(engine, 'cleanse');
  const cleanse = engine.cards().find((c) => c.id === 'cleanse');
  engine.tick(cleanse.ward * 1000 + 100);
  engine.tick(forceEnemyCast(engine, 'acid'));
  assert.ok(engine.state.player.dot);
});

test('「黙せよ」の先行入力: 構え中に中断可能技の詠唱が始まると即座に止める', () => {
  const engine = setup({ stage: 2 });
  const e = engine.state.enemy;
  castCard(engine, 'silence');
  assert.ok(engine.state.player.silenceReady);
  // タイムラインを中断可能技の直前にして、次の詠唱を始めさせる
  e.timelineIndex = e.timelines[0].indexOf('hammer');
  e.gapLeft = 100;
  engine.tick(200);
  assert.equal(e.cast, null);
  assert.equal(engine.state.stats.interrupts, 1);
  assert.equal(engine.state.player.silenceReady, null);
});

test('「黙せよ」の構えは時間で切れる', () => {
  const engine = setup({ stage: 2 });
  const e = engine.state.enemy;
  castCard(engine, 'silence');
  const silence = engine.cards().find((c) => c.id === 'silence');
  engine.tick(silence.ready * 1000 + 100);
  e.timelineIndex = e.timelines[0].indexOf('hammer');
  e.gapLeft = 100;
  engine.tick(200);
  assert.equal(e.cast.ability.type, 'interruptible');
});

test('増幅で次の攻撃が強化され、使うと消える', () => {
  const engine = setup();
  castCard(engine, 'empower');
  assert.ok(engine.state.player.empower);
  castCard(engine, 0);
  assert.equal(engine.state.player.empower, null);
});

test('HP しきい値でフェーズ移行', () => {
  const engine = setup({ stage: 1 });
  const e = engine.state.enemy;
  e.hp = Math.floor(e.maxHp * 0.5) + 1;
  castCard(engine, 0);
  assert.equal(e.phaseIndex, 1);
  assert.equal(e.timelineIndex, 0);
});

test('時間切れで終焉を詠唱し、完了すると敗北', () => {
  const engine = setup();
  engine.state.player.hp = 100;
  engine.tick(engine.state.enemy.enrageLeft);
  assert.equal(engine.state.enemy.cast.ability.type, 'enrage');
  engine.tick(6000);
  assert.equal(engine.state.phase, 'gameover');
  assert.equal(engine.state.result.reason, 'enrage');
});

test('敵を倒すと次のステージへ進める', () => {
  const engine = setup();
  engine.state.enemy.hp = 1;
  castCard(engine, 0);
  assert.equal(engine.state.phase, 'stageClear');
  engine.nextStage();
  assert.equal(engine.state.enemy.name, ENEMIES[1].name);
  assert.equal(engine.state.player.hp, engine.state.player.maxHp);
});

test('難易度でタイムラインのギミックが増減する', () => {
  const tl = ['a', 'b@1', 'c@3'];
  assert.deepEqual(resolveTimeline(tl, 0), ['a']);
  assert.deepEqual(resolveTimeline(tl, 1), ['a', 'b']);
  assert.deepEqual(resolveTimeline(tl, 3), ['a', 'b', 'c']);
});

test('撃破するとステージの評価が記録され、再挑戦回数が通しの評価に反映される', () => {
  const engine = createEngine({ difficulty: 'normal', rng: mulberry32(1) });
  engine.startRun();
  engine.state.enemy.gapLeft = Infinity;
  engine.state.enemy.hp = 1;
  castCard(engine, 0);
  const r = engine.state.result;
  assert.equal(r.win, true);
  assert.ok(['S', 'A', 'B', 'C'].includes(r.rank));
  assert.equal(engine.state.runResults[0], r);
  assert.equal(r.stats.casts, 1);
  engine.retryStage();
  assert.equal(engine.state.stageStats.casts, 0);
  assert.equal(engine.state.stats.casts, 1);
  assert.equal(engine.runSummary().retries, 1);
});
