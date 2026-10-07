/*
 * ローマ字入力エンジン
 * かな文字列に対して、複数の綴り (shi/si, chi/ti, nn/n' など) を許容しながら
 * 1キーずつ入力を判定する。ブラウザでは window.Romaji、Node では module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Romaji = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 1文字単位の綴り。先頭が表示用の標準綴り。
  const SINGLE = {
    'あ': ['a'], 'い': ['i', 'yi'], 'う': ['u', 'wu', 'whu'], 'え': ['e'], 'お': ['o'],
    'か': ['ka', 'ca'], 'き': ['ki'], 'く': ['ku', 'cu', 'qu'], 'け': ['ke'], 'こ': ['ko', 'co'],
    'さ': ['sa'], 'し': ['shi', 'si', 'ci'], 'す': ['su'], 'せ': ['se', 'ce'], 'そ': ['so'],
    'た': ['ta'], 'ち': ['chi', 'ti'], 'つ': ['tsu', 'tu'], 'て': ['te'], 'と': ['to'],
    'な': ['na'], 'に': ['ni'], 'ぬ': ['nu'], 'ね': ['ne'], 'の': ['no'],
    'は': ['ha'], 'ひ': ['hi'], 'ふ': ['fu', 'hu'], 'へ': ['he'], 'ほ': ['ho'],
    'ま': ['ma'], 'み': ['mi'], 'む': ['mu'], 'め': ['me'], 'も': ['mo'],
    'や': ['ya'], 'ゆ': ['yu'], 'よ': ['yo'],
    'ら': ['ra'], 'り': ['ri'], 'る': ['ru'], 'れ': ['re'], 'ろ': ['ro'],
    'わ': ['wa'], 'ゐ': ['wyi'], 'ゑ': ['wye'], 'を': ['wo'],
    'が': ['ga'], 'ぎ': ['gi'], 'ぐ': ['gu'], 'げ': ['ge'], 'ご': ['go'],
    'ざ': ['za'], 'じ': ['ji', 'zi'], 'ず': ['zu'], 'ぜ': ['ze'], 'ぞ': ['zo'],
    'だ': ['da'], 'ぢ': ['di'], 'づ': ['du'], 'で': ['de'], 'ど': ['do'],
    'ば': ['ba'], 'び': ['bi'], 'ぶ': ['bu'], 'べ': ['be'], 'ぼ': ['bo'],
    'ぱ': ['pa'], 'ぴ': ['pi'], 'ぷ': ['pu'], 'ぺ': ['pe'], 'ぽ': ['po'],
    'ゔ': ['vu'],
    'ぁ': ['xa', 'la'], 'ぃ': ['xi', 'li', 'xyi', 'lyi'], 'ぅ': ['xu', 'lu'],
    'ぇ': ['xe', 'le', 'xye', 'lye'], 'ぉ': ['xo', 'lo'],
    'ゃ': ['xya', 'lya'], 'ゅ': ['xyu', 'lyu'], 'ょ': ['xyo', 'lyo'], 'ゎ': ['xwa', 'lwa'],
    'っ': ['xtu', 'ltu', 'xtsu', 'ltsu'],
    'ー': ['-'], '、': [','], '。': ['.'], '！': ['!'], '？': ['?'],
  };

  // 2文字 (拗音など) の綴り
  const DOUBLE = {
    'しゃ': ['sha', 'sya'], 'しぃ': ['syi'], 'しゅ': ['shu', 'syu'], 'しぇ': ['she', 'sye'], 'しょ': ['sho', 'syo'],
    'じゃ': ['ja', 'jya', 'zya'], 'じぃ': ['jyi', 'zyi'], 'じゅ': ['ju', 'jyu', 'zyu'],
    'じぇ': ['je', 'jye', 'zye'], 'じょ': ['jo', 'jyo', 'zyo'],
    'ちゃ': ['cha', 'tya', 'cya'], 'ちぃ': ['tyi', 'cyi'], 'ちゅ': ['chu', 'tyu', 'cyu'],
    'ちぇ': ['che', 'tye', 'cye'], 'ちょ': ['cho', 'tyo', 'cyo'],
    'ふぁ': ['fa', 'fwa'], 'ふぃ': ['fi', 'fyi'], 'ふぇ': ['fe', 'fye'], 'ふぉ': ['fo', 'fwo'], 'ふゅ': ['fyu'],
    'てぃ': ['thi'], 'てゅ': ['thu'], 'でぃ': ['dhi'], 'でゅ': ['dhu'],
    'とぅ': ['twu'], 'どぅ': ['dwu'],
    'うぃ': ['wi', 'whi'], 'うぇ': ['we', 'whe'], 'うぉ': ['who'],
    'ゔぁ': ['va'], 'ゔぃ': ['vi'], 'ゔぇ': ['ve'], 'ゔぉ': ['vo'],
    'つぁ': ['tsa'], 'つぃ': ['tsi'], 'つぇ': ['tse'], 'つぉ': ['tso'],
    'くぁ': ['qa', 'kwa'], 'くぃ': ['qi'], 'くぇ': ['qe'], 'くぉ': ['qo'],
  };
  const YOON_ROWS = { 'き': 'k', 'ぎ': 'g', 'に': 'n', 'ひ': 'h', 'び': 'b', 'ぴ': 'p', 'み': 'm', 'り': 'r', 'ぢ': 'd' };
  const YOON_SMALL = { 'ゃ': 'ya', 'ぃ': 'yi', 'ゅ': 'yu', 'ぇ': 'ye', 'ょ': 'yo' };
  for (const [base, c] of Object.entries(YOON_ROWS)) {
    for (const [small, v] of Object.entries(YOON_SMALL)) DOUBLE[base + small] = [c + v];
  }

  // 促音を子音重ねで打てる先頭文字 (n, 母音, x/l は不可)
  const SOKUON_LEAD = /^[bcdfghjkmpqrstvwyz]/;
  // 「ん」を n 1打で確定できない次文字の先頭
  const N_BLOCKERS = /^[aiueoyn']/;

  function toHiragana(str) {
    return String(str).replace(/[ァ-ヴ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  /** 各位置で取りうる {len: 消費かな数, romaji} の一覧を返す関数を作る */
  function buildOptions(kana) {
    const memo = [];
    function at(i) {
      if (i >= kana.length) return [];
      if (memo[i]) return memo[i];
      const ch = kana[i];
      const opts = [];
      const push = (len, romaji) => {
        if (!opts.some((o) => o.len === len && o.romaji === romaji)) opts.push({ len, romaji });
      };
      const pair = kana.slice(i, i + 2);
      if (pair.length === 2 && DOUBLE[pair]) DOUBLE[pair].forEach((r) => push(2, r));

      if (ch === 'っ') {
        for (const o of at(i + 1)) {
          if (!SOKUON_LEAD.test(o.romaji)) continue;
          push(1 + o.len, o.romaji[0] + o.romaji);
          if (o.romaji.startsWith('ch')) push(1 + o.len, 't' + o.romaji);
        }
        SINGLE['っ'].forEach((r) => push(1, r));
      } else if (ch === 'ん') {
        const next = at(i + 1);
        ['nn', "n'", 'xn'].forEach((r) => push(1, r));
        if (next.length > 0 && !next.some((o) => N_BLOCKERS.test(o.romaji))) push(1, 'n');
      } else if (SINGLE[ch]) {
        SINGLE[ch].forEach((r) => push(1, r));
      } else {
        push(1, ch.toLowerCase()); // 英数字などはそのまま
      }
      memo[i] = opts;
      return opts;
    }
    return at;
  }

  // 表示用: 長くかなを消費する綴りを優先、同長なら定義順
  function pickBest(opts) {
    let best = opts[0];
    for (const o of opts) if (o.len > best.len) best = o;
    return best;
  }

  function canonicalFrom(at, kana, i) {
    let out = '';
    while (i < kana.length) {
      const o = pickBest(at(i));
      out += o.romaji;
      i += o.len;
    }
    return out;
  }

  function toRomaji(kana) {
    const text = toHiragana(kana);
    return canonicalFrom(buildOptions(text), text, 0);
  }

  class Matcher {
    constructor(kana) {
      this.text = toHiragana(kana);
      this._at = buildOptions(this.text);
      this.pos = 0;        // 確定済みかな数
      this.pending = '';   // 確定前の入力
      this.committed = ''; // 確定済みローマ字
    }

    get finished() {
      return this.pos >= this.text.length;
    }

    /** 入力済みローマ字 */
    get typed() {
      return this.committed + this.pending;
    }

    /** 残りの推奨ローマ字 */
    get remaining() {
      if (this.finished) return '';
      const opts = this._at(this.pos).filter((o) => o.romaji.startsWith(this.pending));
      const best = (this.pending && opts.find((o) => o.romaji === this.pending)) || pickBest(opts);
      return best.romaji.slice(this.pending.length) + canonicalFrom(this._at, this.text, this.pos + best.len);
    }

    /** 1キー入力。受理なら true、不正なら false (状態は変わらない) */
    input(key) {
      if (this.finished) return false;
      key = String(key).toLowerCase();
      const opts = this._at(this.pos);
      const cand = this.pending + key;
      const matches = opts.filter((o) => o.romaji.startsWith(cand));
      if (matches.length > 0) {
        this.pending = cand;
        const exact = matches.find((o) => o.romaji === cand);
        const longer = matches.some((o) => o.romaji.length > cand.length);
        if (exact && (!longer || this.pos + exact.len >= this.text.length)) this._commit(exact);
        return true;
      }
      // 「n」のように確定可能な入力が保留中なら確定して次の文字として再判定
      if (this.pending) {
        const exact = opts.find((o) => o.romaji === this.pending);
        if (exact) {
          const snap = [this.pos, this.pending, this.committed];
          this._commit(exact);
          if (this.input(key)) return true;
          [this.pos, this.pending, this.committed] = snap;
        }
      }
      return false;
    }

    _commit(opt) {
      this.committed += opt.romaji;
      this.pending = '';
      this.pos += opt.len;
    }
  }

  return { toHiragana, toRomaji, buildOptions, Matcher };
});
