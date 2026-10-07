/*
 * バランス検証: node tools/simulate.mjs [試行回数]
 * 難易度 × bot ごとに各ステージの勝率・残り時間・残りHPを表示する。
 */
import { runStage, BOTS } from './bots.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ENEMIES, DIFFICULTY_ORDER } = require('../js/data.js');
const trials = Number(process.argv[2] || 20);

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : '-');

for (const difficulty of DIFFICULTY_ORDER) {
  console.log(`\n## ${difficulty}`);
  console.log('| bot | ' + ENEMIES.map((e) => e.name).join(' | ') + ' |');
  console.log('|---|' + ENEMIES.map(() => '---').join('|') + '|');
  for (const bot of Object.keys(BOTS)) {
    const cells = ENEMIES.map((_, stage) => {
      const rs = Array.from({ length: trials }, (_, i) => runStage({ difficulty, stage, bot, seed: i + 1 }));
      const wins = rs.filter((r) => r.win);
      const losses = rs.filter((r) => !r.win);
      const reasons = {};
      losses.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
      const why = Object.entries(reasons).map(([k, v]) => `${k}${v}`).join(',');
      return `${wins.length}/${trials} 残${avg(wins.map((r) => r.timeLeft))}s HP${avg(wins.map((r) => r.hp))}${why ? ` (負:${why})` : ''}`;
    });
    console.log(`| ${bot} | ${cells.join(' | ')} |`);
  }
}
