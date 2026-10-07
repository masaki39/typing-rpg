/*
 * 難易度ごとの打鍵速度の目安: node tools/speed.mjs [試行回数] [ミス率]
 * proper bot (ギミックに適切に対応する判断。expert も同じ判断で速度だけ違う) の打鍵速度を
 * 1.0〜10.0 打/秒で振り、全4面を再挑戦なしで通す率が 50% / 80% になる速度を線形補間で求める。
 *
 * 速度の定義:
 *   - 打/秒 (kps): bot が1キーを押す間隔の逆数。ミスタイプも1打として時間を使う。
 *   - 正打鍵/秒: kps / (1 + ミス率)。寿司打の「平均キータイプ数(回/秒)」は正しく打った
 *     キー数 ÷ 時間なので、こちらが寿司打の数値に相当する。
 *   - e-typing の WPM は「1分間の入力文字数 (ローマ字のキー数)」なので 正打鍵/秒 × 60。
 */
import { runAll } from './bots.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DIFFICULTY_ORDER } = require('../js/data.js');

const trials = Number(process.argv[2] || 40);
const missRate = Number(process.argv[3] || 0.05);
const speeds = [];
for (let k = 1.0; k <= 10.0001; k += 0.5) speeds.push(Math.round(k * 10) / 10);

/** rate が target を初めて超える速度を線形補間 */
function threshold(rows, target) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rate >= target) {
      if (i === 0) return rows[0].kps;
      const a = rows[i - 1];
      const b = rows[i];
      return a.kps + ((target - a.rate) / (b.rate - a.rate)) * (b.kps - a.kps);
    }
  }
  return null;
}

const fmt = (kps) => {
  if (kps == null) return '10.0超';
  const correct = kps / (1 + missRate);
  return `${kps.toFixed(1)}打/秒 (正打 ${correct.toFixed(1)}/秒・WPM ${Math.round(correct * 60)})`;
};

console.log(`trials=${trials} missRate=${missRate} bot=proper`);
console.log(`| 難易度 | ${speeds.map((k) => k.toFixed(1)).join(' | ')} |`);
console.log(`|---|${speeds.map(() => '---').join('|')}|`);
const result = {};
for (const difficulty of DIFFICULTY_ORDER) {
  const rows = speeds.map((kps) => {
    let clear = 0;
    for (let seed = 1; seed <= trials; seed++) {
      if (runAll({ difficulty, bot: 'proper', seed, kps, missRate }).clear) clear++;
    }
    return { kps, rate: clear / trials };
  });
  result[difficulty] = { p50: threshold(rows, 0.5), p80: threshold(rows, 0.8) };
  console.log(`| ${difficulty} | ${rows.map((r) => `${Math.round(r.rate * 100)}%`).join(' | ')} |`);
}
console.log('');
for (const [d, r] of Object.entries(result)) {
  console.log(`${d}: 50% ${fmt(r.p50)} / 80% ${fmt(r.p80)}`);
}
