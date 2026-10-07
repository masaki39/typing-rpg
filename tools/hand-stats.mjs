/*
 * 手札の質の計測: node tools/hand-stats.mjs [試行回数] [難易度] [bot]
 * bot の各判断時点で、攻撃3枠のうち「撃てて有効」(MP足りる & 耐性でない) な枚数と、
 * カードが使われずに残った詠唱回数 (滞留) を集計する。
 */
import { runStage } from './bots.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ENEMIES } = require('../js/data.js');
const Battle = require('../js/battle.js');

const trials = Number(process.argv[2] || 20);
const difficulty = process.argv[3] || 'normal';
const bot = process.argv[4] || 'proper';

const usableHist = [0, 0, 0, 0];
const resistSlots = [0, 0, 0];
const lockedT3 = { n: 0 };
let decisions = 0;
const ages = []; // 入れ替わるまでの詠唱回数
let maxAge = 0;

for (let stage = 0; stage < ENEMIES.length; stage++) {
  for (let seed = 1; seed <= trials; seed++) {
    let prev = null;
    let born = [0, 0, 0];
    runStage({
      difficulty, stage, bot, seed,
      onDecision(engine) {
        const s = engine.state;
        const hand = s.attackHand;
        const casts = s.stats.casts;
        hand.forEach((card, i) => {
          if (!prev || prev[i] !== card) {
            if (prev) ages.push(casts - born[i]);
            born[i] = casts;
          }
          maxAge = Math.max(maxAge, casts - born[i]);
        });
        prev = [...hand];
        decisions++;
        let usable = 0;
        hand.forEach((card, i) => {
          const mult = Battle.elementMultiplier(card.element, s.enemy.element);
          if (mult < 1) resistSlots[i]++;
          if (engine.isEnabled(card) && mult >= 1) usable++;
        });
        if (!engine.isEnabled(hand[2])) lockedT3.n++;
        usableHist[usable]++;
      },
    });
  }
}

const pct = (n) => `${((n / decisions) * 100).toFixed(1)}%`;
const avg = ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length);
const sorted = [...ages].sort((a, b) => a - b);
console.log(`difficulty=${difficulty} bot=${bot} trials=${trials} decisions=${decisions}`);
console.log(`撃てて有効な攻撃カードの枚数: 0枚 ${pct(usableHist[0])} / 1枚 ${pct(usableHist[1])} / 2枚 ${pct(usableHist[2])} / 3枚 ${pct(usableHist[3])}`);
console.log(`耐性属性が並んでいる割合 (枠別): ${resistSlots.map(pct).join(' / ')}`);
console.log(`3枠目がMP不足/使用不可の割合: ${pct(lockedT3.n)}`);
console.log(`カードの滞留 (入れ替わるまでの詠唱回数): 平均 ${avg.toFixed(1)} / 中央値 ${sorted[Math.floor(sorted.length / 2)]} / 90%点 ${sorted[Math.floor(sorted.length * 0.9)]} / 最大 ${maxAge}`);
