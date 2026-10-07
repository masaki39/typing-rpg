import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Matcher, toRomaji, toHiragana } = require('../js/romaji.js');
const { SPELLS } = require('../js/data.js');

/** 全キーを打ち、受理されたか・完了したかを返す */
function type(kana, keys) {
  const m = new Matcher(kana);
  for (const [i, k] of [...keys].entries()) {
    if (!m.input(k)) return { ok: false, failedAt: i, finished: m.finished, m };
  }
  return { ok: true, finished: m.finished, m };
}

function accepts(kana, keys) {
  const r = type(kana, keys);
  return r.ok && r.finished;
}

test('標準綴りへの変換', () => {
  assert.equal(toRomaji('ほのお'), 'honoo');
  assert.equal(toRomaji('しんえん'), 'shinnenn');
  assert.equal(toRomaji('てっつい'), 'tettsui');
  assert.equal(toRomaji('りゅう'), 'ryuu');
  assert.equal(toRomaji('まっちゃ'), 'maccha');
});

test('カタカナはひらがなとして扱う', () => {
  assert.equal(toHiragana('サラマンダー'), 'さらまんだー');
  assert.ok(accepts('サラマンダー', 'saramanda-'));
  assert.ok(accepts('ヴァ', 'va'));
});

test('ほのお: honoo', () => {
  assert.ok(accepts('ほのお', 'honoo'));
  assert.ok(!accepts('ほのお', 'hono'));
});

test('揺れのある綴り (し/ち/つ/ふ/じ)', () => {
  for (const k of ['shi', 'si', 'ci']) assert.ok(accepts('し', k), k);
  for (const k of ['chi', 'ti']) assert.ok(accepts('ち', k), k);
  for (const k of ['tsu', 'tu']) assert.ok(accepts('つ', k), k);
  for (const k of ['fu', 'hu']) assert.ok(accepts('ふ', k), k);
  for (const k of ['ji', 'zi']) assert.ok(accepts('じ', k), k);
  for (const k of ['ka', 'ca']) assert.ok(accepts('か', k), k);
});

test('ん: nn / n\' / xn / 子音前の n', () => {
  for (const k of ['kanji', 'kannji', "kan'ji", 'kanzi', 'kaxnji']) assert.ok(accepts('かんじ', k), k);
  // 母音の前は n 1打では不可
  assert.ok(accepts('しんえん', 'shinnenn'));
  assert.ok(accepts('しんえん', "shin'enn"));
  assert.ok(!accepts('しんえん', 'shinenn'));
  // 末尾は nn が必要
  assert.ok(!accepts('ほん', 'hon'));
  assert.ok(accepts('ほん', 'honn'));
  // な行・や行の前も n 1打は不可
  assert.ok(accepts('こんな', 'konnna'));
  assert.equal(type('こんな', 'konna').failedAt, 4);
  assert.ok(accepts('こんや', 'konnya'));
});

test('っ: 子音重ね / xtu / ltsu', () => {
  for (const k of ['kitte', 'kixtute', 'kiltsute', 'kixtsute']) assert.ok(accepts('きって', k), k);
  for (const k of ['maccha', 'mattya', 'matcha', 'maccya']) assert.ok(accepts('まっちゃ', k), k);
  for (const k of ['tettsui', 'tettui']) assert.ok(accepts('てっつい', k), k);
});

test('拗音: 2文字綴りと分割綴り', () => {
  for (const k of ['kya', 'kixya', 'kilya']) assert.ok(accepts('きゃ', k), k);
  for (const k of ['ja', 'jya', 'zya', 'jixya']) assert.ok(accepts('じゃ', k), k);
  for (const k of ['sho', 'syo', 'shixyo', 'sixyo']) assert.ok(accepts('しょ', k), k);
  for (const k of ['ryuu', 'rixyuu']) assert.ok(accepts('りゅう', k), k);
  for (const k of ['fa', 'fuxa']) assert.ok(accepts('ふぁ', k), k);
});

test('ミス入力は状態を変えない', () => {
  const m = new Matcher('ほのお');
  assert.ok(m.input('h'));
  assert.equal(m.input('x'), false);
  assert.equal(m.typed, 'h');
  assert.equal(m.pos, 0);
  assert.ok(m.input('o'));
  assert.equal(m.pos, 1);
});

test('大文字も受け付ける', () => {
  assert.ok(accepts('ほのお', 'HONOO'));
});

test('入力済み/残りの表示', () => {
  const m = new Matcher('しんえん');
  assert.equal(m.remaining, 'shinnenn');
  m.input('s');
  assert.equal(m.typed, 's');
  assert.equal(m.remaining, 'hinnenn');
  m.input('i'); // si を選択
  assert.equal(m.typed, 'si');
  assert.equal(m.pos, 1);
  assert.equal(m.remaining, 'nnenn');

  // 子音前の「n」1打は保留状態でも残り表示が崩れない
  const k = new Matcher('かんじ');
  for (const c of 'kan') k.input(c);
  assert.equal(k.typed, 'kan');
  assert.equal(k.remaining, 'ji');
  k.input('n');
  assert.equal(k.typed, 'kann');
  assert.equal(k.remaining, 'ji');
});

test('完了後の入力は拒否', () => {
  const m = new Matcher('ちゆ');
  for (const c of 'chiyu') assert.ok(m.input(c));
  assert.ok(m.finished);
  assert.equal(m.input('a'), false);
});

test('全呪文が標準綴りで詠唱できる', () => {
  for (const s of SPELLS) {
    const romaji = toRomaji(s.kana);
    assert.ok(accepts(s.kana, romaji), `${s.name}: ${romaji}`);
  }
});

test('どの呪文の綴りも他の呪文の綴りの途中で完成しない', () => {
  const all = SPELLS.map((s) => ({ name: s.name, romaji: toRomaji(s.kana) }));
  for (const a of all) {
    for (const b of all) {
      if (a !== b) assert.ok(!b.romaji.startsWith(a.romaji), `${a.name} / ${b.name}`);
    }
  }
});
