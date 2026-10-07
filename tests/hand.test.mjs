import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine, mulberry32 } = require('../js/engine.js');
const { HAND, ENEMIES, ATTACKS, SKILLS } = require('../js/data.js');

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

test('使った攻撃カードの枠だけが入れ替わり、他の枠はそのまま残る', () => {
  const engine = setup();
  const s = engine.state;
  s.player.mp = 100;
  const [a, b, c] = s.attackHand;
  for (let n = 0; n < 8; n++) castCard(engine, 'empower'), (s.cooldowns.empower = 0), (s.player.mp = 100);
  assert.deepEqual(s.attackHand, [a, b, c], '支援呪文では入れ替わらない');
  castCard(engine, 0);
  assert.notEqual(s.attackHand[0], a);
  assert.equal(s.attackHand[1], b);
  assert.equal(s.attackHand[2], c);
});

test('手札の他の呪文と頭のかなが同じ攻撃カードは出にくい', () => {
  let same = 0;
  let n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const engine = setup({ seed });
    const hand = engine.cards();
    hand.slice(0, 3).forEach((card, i) => {
      n++;
      if (hand.some((other, j) => j !== i && other.kana[0] === card.kana[0])) same++;
    });
  }
  assert.ok(same / n < 0.1, `${same}/${n}`);
});

test('支援呪文の頭のかなは攻撃呪文と重ならない', () => {
  const heads = new Set(SKILLS.map((s) => s.kana[0]));
  assert.equal(heads.size, SKILLS.length);
  for (const a of ATTACKS) assert.ok(!heads.has(a.kana[0]), a.name);
});

test('撃てる攻撃カードはほぼ常に1枚以上ある (完全保証ではない)', () => {
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
    engine.state.player.mp = 40; // ★★★を撃つと MP 0 になり、その枠の次のカードを引く
    castCard(engine, 2);
    if (engine.state.attackHand[2].tier === 2) tier2++;
  }
  assert.ok(tier2 > 50 && tier2 < 150, `${tier2}/200`);
});
