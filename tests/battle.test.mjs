import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../js/battle.js');

test('長い呪文ほど1打あたりの威力が高い', () => {
  assert.ok(B.spellPower(30) / 30 > B.spellPower(6) / 6);
});

test('ミスペナルティは下限 40%', () => {
  assert.equal(B.missMultiplier(0), 1);
  assert.equal(B.missMultiplier(3), 0.7);
  assert.equal(B.missMultiplier(100), 0.4);
});

test('ダメージ計算', () => {
  const r = B.computeDamage({ base: 50, misses: 2, combo: 2 });
  assert.equal(r.damage, Math.round(50 * 0.8 * 1.1));
  assert.equal(B.computeDamage({ base: 50, empower: 1.6 }).damage, 80);
  assert.equal(B.computeDamage({ base: 1, misses: 9 }).damage, 1);
  assert.equal(B.comboMultiplier(99), 1.5);
});

test('ステージ評価: 残り時間・HP・正確率が高いほど高得点', () => {
  const best = B.stageScore({ timeLeft: 50, timeTotal: 100, hp: 100, maxHp: 100, correct: 100, miss: 0 });
  assert.deepEqual(best, { score: 1000, rank: 'S' });
  const worst = B.stageScore({ timeLeft: 0, timeTotal: 100, hp: 1, maxHp: 100, correct: 80, miss: 20 });
  assert.equal(worst.rank, 'C');
  const mid = B.stageScore({ timeLeft: 20, timeTotal: 100, hp: 60, maxHp: 100, correct: 95, miss: 5 });
  assert.ok(mid.score > worst.score && mid.score < best.score);
});

test('通しの評価は再挑戦で減点される', () => {
  assert.equal(B.runScore([900, 900, 900, 900], 0).rank, 'S');
  assert.equal(B.runScore([900, 900, 900, 900], 2).score, 3400);
  assert.equal(B.runScore([100], 5).score, 0);
});
