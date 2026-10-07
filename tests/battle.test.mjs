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
