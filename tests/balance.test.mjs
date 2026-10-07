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
