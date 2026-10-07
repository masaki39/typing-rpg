/*
 * 指別の打鍵負荷: node tools/finger-load.mjs [data.js のパス]
 * 1) 呪文プール全体 (各呪文の推奨ローマ字を1回ずつ) の指別打鍵数
 * 2) 実プレイ相当 (Normal・proper bot が実際に正しく打ったキー) の指別打鍵数
 * を表示する。指の割り当ては一般的なタッチタイピング (JIS/US 配列のホームポジション)。
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Romaji = require('../js/romaji.js');

const FINGERS = ['左小指', '左薬指', '左中指', '左人差指', '右人差指', '右中指', '右薬指', '右小指'];
const KEYMAP = {
  左小指: '`1qaz', 左薬指: '2wsx', 左中指: '3edc', 左人差指: '45rtfgvb',
  右人差指: '67yuhjnm', 右中指: '8ik,', 右薬指: '9ol.', 右小指: "0-=p;/'[]",
};
const fingerOf = (ch) => FINGERS.find((f) => KEYMAP[f].includes(ch)) || '?';

export function loadPool(dataPath) {
  const data = require(dataPath ? path.resolve(dataPath) : '../js/data.js');
  return data.SPELLS.map((s) => ({ name: s.name, kana: s.kana, romaji: Romaji.toRomaji(s.kana), tier: s.tier, role: s.role }));
}

export function fingerCounts(text) {
  const counts = Object.fromEntries(FINGERS.map((f) => [f, 0]));
  for (const ch of text) {
    const f = fingerOf(ch);
    if (f !== '?') counts[f]++;
  }
  return counts;
}

export function table(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return FINGERS.map((f) => `${f} ${((counts[f] / total) * 100).toFixed(1)}%`).join(' / ');
}

async function main() {
  const dataPath = process.argv[2];
  const pool = loadPool(dataPath);
  const all = pool.map((s) => s.romaji).join('');
  const vowels = [...all].filter((c) => 'aiueo'.includes(c));
  const share = (v) => ((vowels.filter((c) => c === v).length / vowels.length) * 100).toFixed(1);
  console.log(`呪文数 ${pool.length} (攻撃 ${pool.filter((s) => s.role === 'attack').length})、総打鍵 ${all.length}`);
  console.log(`[プール全体] ${table(fingerCounts(all))}`);
  console.log(`  左小指のキー内訳: ${[...KEYMAP['左小指']].map((k) => `${k}=${[...all].filter((c) => c === k).length}`).join(' ')}`);
  console.log(`  母音の比率: a ${share('a')}% / i ${share('i')}% / u ${share('u')}% / e ${share('e')}% / o ${share('o')}%`);

  if (!dataPath) {
    // 実プレイ相当 (現在のデータのみ)
    const { runStage } = await import('./bots.mjs');
    const { ENEMIES } = require('../js/data.js');
    let typed = '';
    for (let stage = 0; stage < ENEMIES.length; stage++) {
      for (let seed = 1; seed <= 10; seed++) {
        runStage({
          difficulty: 'normal', stage, bot: 'proper', seed,
          onKey: (ch) => { typed += ch; },
        });
      }
    }
    console.log(`[実プレイ相当 Normal・proper bot ${typed.length}打] ${table(fingerCounts(typed))}`);
    console.log(`  左小指のキー内訳: ${[...KEYMAP['左小指']].map((k) => `${k}=${[...typed].filter((c) => c === k).length}`).join(' ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
