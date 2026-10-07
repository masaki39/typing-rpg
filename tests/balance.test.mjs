// bot 自動プレイによるバランス回帰テスト (詳細は node tools/simulate.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll, runStage } from '../tools/bots.mjs';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const clearRate = (difficulty, bot) => SEEDS.filter((seed) => runAll({ difficulty, bot, seed }).clear).length / SEEDS.length;

test('(a) 長い攻撃呪文だけのごり押しは Normal 以上で勝てない', () => {
  for (const difficulty of ['normal', 'hard', 'savage']) {
    for (const seed of SEEDS) {
      assert.equal(runStage({ difficulty, stage: 0, bot: 'greedy', seed }).win, false, `${difficulty} seed${seed}`);
    }
  }
});

test('(b) ギミックに対応する bot は Normal をクリアできる', () => {
  assert.ok(clearRate('normal', 'proper') >= 0.6);
});

test('(c) Easy は雑なプレイでもクリアできる', () => {
  assert.ok(clearRate('easy', 'sloppy') >= 0.75);
});

test('Normal の火力チェックは緩すぎない (上手い bot でも時間に大きな余裕はない)', () => {
  for (let stage = 0; stage < 4; stage++) {
    const wins = SEEDS.map((seed) => runStage({ difficulty: 'normal', stage, bot: 'proper', seed })).filter((r) => r.win);
    const avgLeft = wins.reduce((a, r) => a + r.timeLeft, 0) / wins.length;
    assert.ok(avgLeft < 60, `stage${stage} 平均残り ${avgLeft}s`);
  }
});

test('(d) Savage は速い bot で一部だけクリアできる', () => {
  const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
  const rate = seeds.filter((seed) => runAll({ difficulty: 'savage', bot: 'expert', seed }).clear).length / seeds.length;
  assert.ok(rate >= 0.15 && rate <= 0.75, `Savage expert ${rate}`);
});

test('タイトルに出す打鍵速度の目安が実測と矛盾しない', async () => {
  const { createRequire } = await import('node:module');
  const { DIFFICULTIES } = createRequire(import.meta.url)('../js/data.js');
  const missRate = 0.05;
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const rateAt = (difficulty, correctPerSec) => {
    const kps = correctPerSec * (1 + missRate); // 正打鍵/秒 → ミス込みの打鍵速度
    return seeds.filter((seed) => runAll({ difficulty, bot: 'proper', seed, kps, missRate }).clear).length / seeds.length;
  };
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const g = d.speedGuide;
    assert.ok(g.p50 <= g.p80, key);
    assert.ok(rateAt(key, g.p80 + 0.5) >= 0.7, `${key}: 目安上限 +0.5 で 70% 以上`);
    assert.ok(rateAt(key, g.p50 - 0.7) <= 0.5, `${key}: 目安下限 -0.7 で 50% 以下`);
  }
});
