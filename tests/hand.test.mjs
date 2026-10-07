import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine, mulberry32 } = require('../js/engine.js');
const { HAND, ENEMIES } = require('../js/data.js');
const Battle = require('../js/battle.js');

function setup({ stage = 0, seed = 7 } = {}) {
  const engine = createEngine({ difficulty: 'normal', rng: mulberry32(seed) });
  engine.startStage(stage);
  engine.state.enemy.gapLeft = Infinity;
  engine.state.enemy.hp = 1e6; // 撃破しないように
  engine.state.enemy.maxHp = 1e6;
  return engine;
}

function castCard(engine, idOrIndex) {
  const list = engine.cards();
  const i = typeof idOrIndex === 'number' ? idOrIndex : list.findIndex((c) => c.id === idOrIndex);
  for (const ch of list[i].romaji) engine.key(ch);
}

test('使われないカードは一定回数で風化して入れ替わる', () => {
  const engine = setup();
  const s = engine.state;
  const stale = s.attackHand[2];
  for (let n = 1; n < HAND.weatherAfter; n++) {
    castCard(engine, 0);
    assert.equal(s.attackHand[2], stale, `${n}回目ではまだ残る`);
    assert.equal(s.attackAge[2], n);
  }
  engine.drain();
  castCard(engine, 0);
  assert.notEqual(s.attackHand[2], stale);
  assert.equal(s.attackAge[2], 0);
  assert.ok(engine.drain().some((ev) => ev.type === 'weathered' && ev.slot === 2));
});

test('使ったカードの枠は経過回数がリセットされ、支援呪文の詠唱でも風化は進む', () => {
  const engine = setup();
  const s = engine.state;
  s.player.mp = 100;
  castCard(engine, 'empower');
  assert.deepEqual(s.attackAge, [1, 1, 1]);
  castCard(engine, 0);
  assert.deepEqual(s.attackAge, [0, 2, 2]);
});

test('引き直し: MP とリキャストを消費して攻撃3枠を入れ替える', () => {
  const engine = setup();
  const s = engine.state;
  s.player.mp = 50;
  const before = [...s.attackHand];
  for (const ch of before[2].romaji.slice(0, 3)) engine.key(ch);
  assert.equal(engine.redraw(), true);
  assert.equal(s.player.mp, 50 - HAND.redraw.mp);
  assert.equal(s.cast.started, false, '詠唱中の呪文は破棄');
  s.attackHand.forEach((card, i) => assert.notEqual(card, before[i], `枠${i}は別のカード`));
  assert.equal(engine.redraw(), false, 'リキャスト中は不可');
  engine.tick(HAND.redraw.cd * 1000);
  s.player.mp = HAND.redraw.mp - 1;
  assert.equal(engine.redraw(), false, 'MP不足では不可');
});

test('ドローは弱点属性に寄り、耐性属性は出にくい', () => {
  const counts = { weak: 0, neutral: 0, resist: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    for (let stage = 0; stage < ENEMIES.length; stage++) {
      const engine = setup({ stage, seed });
      for (const card of engine.state.attackHand) {
        const m = Battle.elementMultiplier(card.element, engine.state.enemy.element);
        counts[m > 1 ? 'weak' : m < 1 ? 'resist' : 'neutral']++;
      }
    }
  }
  const total = counts.weak + counts.neutral + counts.resist;
  assert.ok(counts.weak / total > 0.3, `弱点 ${counts.weak / total}`);
  assert.ok(counts.resist / total < 0.12, `耐性 ${counts.resist / total}`);
  assert.ok(counts.resist > 0, '耐性も完全には消えない');
});

test('撃てて有効な攻撃カードはほぼ常に1枚以上ある (完全保証ではない)', () => {
  let ok = 0;
  let n = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const engine = setup({ stage: seed % ENEMIES.length, seed });
    const s = engine.state;
    s.player.mp = (seed * 37) % 100; // さまざまな MP で
    for (let k = 0; k < 6; k++) {
      castCard(engine, 0);
      n++;
      if (s.attackHand.some((c) => engine.isUsefulAttack(c))) ok++;
    }
  }
  assert.ok(ok / n > 0.97, `${ok}/${n}`);
});

test('MP不足のときは★★★枠に★★が来ることがある', () => {
  let tier2 = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const engine = setup({ seed });
    engine.state.player.mp = 0;
    castCard(engine, 0); // ★は MP 0 で撃てる。★★★枠も風化を進める
    engine.state.player.mp = 0;
    engine.state.attackAge[2] = HAND.weatherAfter - 1;
    castCard(engine, 0);
    if (engine.state.attackHand[2].tier === 2) tier2++;
  }
  assert.ok(tier2 > 50 && tier2 < 150, `${tier2}/200`);
});
