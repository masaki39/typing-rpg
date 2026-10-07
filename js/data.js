/*
 * ゲームデータ (難易度・呪文・敵とタイムライン)
 * ブラウザでは window.GameData、Node では module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // level: タイムラインの「@N」付きの技は level >= N のときだけ使われる
  // castMult: 敵の詠唱時間 / damageMult: 被ダメージ / enrageMult: 時間切れまでの時間
  // enemyHpMult: 敵HP / mpRegen: MP自然回復(毎秒) / showNext: 次の技を表示するか
  // speedGuide: 打鍵速度の目安 (正打鍵/秒 = 寿司打の平均キータイプ数相当)。全4面を再挑戦なしで
  //   通せる確率が 50% / 80% になる速度。node tools/speed.mjs 80 0.05 の結果 (ミス率5%) から転記
  const DIFFICULTIES = {
    easy: { label: 'Easy', desc: '敵の詠唱が遅く、被ダメージ控えめ。一部ギミックなし。', level: 0, speedGuide: { p50: 1.7, p80: 1.9 },
      castMult: 1.4, damageMult: 0.5, enrageMult: 1.6, enemyHpMult: 0.7, mpRegen: 2.0, showNext: true },
    normal: { label: 'Normal', desc: '標準。ギミックに対応しないと勝てない。', level: 1, speedGuide: { p50: 4.1, p80: 4.3 },
      castMult: 1.0, damageMult: 1.0, enrageMult: 1.0, enemyHpMult: 1.0, mpRegen: 1.3, showNext: true },
    hard: { label: 'Hard', desc: '詠唱が速く被ダメ増。次の技は表示されない。', level: 2, speedGuide: { p50: 5.6, p80: 6.2 },
      castMult: 0.85, damageMult: 1.2, enrageMult: 0.95, enemyHpMult: 1.0, mpRegen: 1.1, showNext: false },
    savage: { label: 'Savage', desc: '零式。追加ギミックあり。タイムラインを覚えて挑め。', level: 3, speedGuide: { p50: 7.6, p80: 8.7 },
      castMult: 0.8, damageMult: 1.22, enrageMult: 0.85, enemyHpMult: 1.2, mpRegen: 1.0, showNext: false },
  };
  const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'savage'];

  // 呪文の種類 (カードの色分けと表示名)
  const KINDS = {
    attack: { name: '攻撃', icon: '✦' },
    heal: { name: '回復', icon: '✚' },
    guard: { name: '防御', icon: '◆' },
    silence: { name: '中断', icon: '✕' },
    pure: { name: '浄化', icon: '❖' },
    buff: { name: '強化', icon: '▲' },
  };

  // 攻撃呪文の MP: ★は消費なしで MP 回復、★★★は大量消費
  const ATTACK_MP = { 1: { mp: 0, mpGain: 10 }, 2: { mp: 18, mpGain: 0 }, 3: { mp: 40, mpGain: 0 } };

  /*
   * 攻撃呪文の語彙。威力は打鍵数から自動計算 (長いほど強い)。
   * 左手小指 (a/q/z) の負荷を下げるため、あ段が少なく z を含まない語を選んでいる。
   * 支援呪文 (ち/さ/ま/も/じ/み) と頭のかなが重ならないようにし、
   * どの呪文のローマ字も他の呪文の途中で完成しないこと (テストで検査)。
   */
  const ATTACKS = [
    [1, '火の粉', 'ひのこ'],
    [1, '炎', 'ほのお'],
    [1, '氷', 'こおり'],
    [1, '吹雪', 'ふぶき'],
    [1, '息吹', 'いぶき'],
    [1, '剣', 'つるぎ'],
    [1, '雲切り', 'くもきり'],
    [1, '夕立', 'ゆうだち'],
    [1, '鬼火', 'おにび'],
    [1, '熱風', 'ねっぷう'],
    [2, '命の焔', 'いのちのほむら'],
    [2, '霜降る森', 'しもふるもり'],
    [2, '轟く雷鳴', 'とどろくらいめい'],
    [2, 'うねる激流', 'うねるげきりゅう'],
    [2, '光の矛', 'ひかりのほこ'],
    [2, '星降る夜', 'ほしふるよる'],
    [2, '黒き閃光', 'くろきせんこう'],
    [2, '吹き荒れる疾風', 'ふきあれるしっぷう'],
    [3, '紅蓮の業火よ焼き尽くせ', 'ぐれんのごうかよやきつくせ'],
    [3, '天を裂く雷神の鉄槌', 'てんをさくらいじんのてっつい'],
    [3, '永久凍土の氷棺に眠れ', 'えいきゅうとうどのひょうかんにねむれ'],
    [3, '深淵の大海よ全てを呑め', 'しんえんのたいかいよすべてをのめ'],
    [3, '冥府の門よ今開け', 'めいふのもんよいまひらけ'],
    [3, '常しえの闇へ消え失せろ', 'とこしえのやみへきえうせろ'],
    [3, '滅びの歌よ響き渡れ', 'ほろびのうたよひびきわたれ'],
  ].map(([tier, name, kana], i) => ({
    id: `atk${tier}-${i}`, name, kana, kind: 'attack', role: 'attack', tier, ...ATTACK_MP[tier],
  }));

  // 常に並ぶ支援呪文 (cd: リキャスト秒)
  const SKILLS = [
    { id: 'heal', name: '治癒の光', kana: 'ちゆのひかり', kind: 'heal', role: 'heal', mp: 14, cd: 0,
      amount: 30, desc: 'HPを即時回復' },
    { id: 'regen', name: '再生の祈り', kana: 'さいせいのいのり', kind: 'heal', role: 'regen', mp: 14, cd: 20,
      perSec: 4, duration: 12, desc: '12秒間HPを継続回復' },
    { id: 'barrier', name: '守りの壁', kana: 'まもりのかべ', kind: 'guard', role: 'barrier', mp: 10, cd: 12,
      reduce: 0.75, duration: 10, desc: '大技1回を75%軽減(最大10秒)' },
    { id: 'silence', name: '黙せよ', kana: 'もくせよ', kind: 'silence', role: 'interrupt', mp: 5, cd: 10,
      ready: 5, desc: '中断技を止める／構え5秒' },
    { id: 'cleanse', name: '浄化', kana: 'じょうか', kind: 'pure', role: 'cleanse', mp: 8, cd: 8,
      ward: 6, desc: 'DoT解除＋6秒間の加護' },
    { id: 'empower', name: '漲れ', kana: 'みなぎれ', kind: 'buff', role: 'buff', mp: 10, cd: 25,
      mult: 1.6, desc: '次の攻撃呪文の威力1.6倍' },
  ];

  const ABILITY_TYPES = {
    auto: { label: '通常攻撃', hint: '' },
    raidwide: { label: '全体攻撃', hint: '回復の準備を' },
    buster: { label: 'タンクバスター', hint: '「守りの壁」で軽減せよ！' },
    interruptible: { label: '中断可能', hint: '「黙せよ」で中断せよ！（先行入力可）' },
    dot: { label: '継続ダメージ', hint: '着弾前の「浄化」で防げる' },
    enrage: { label: '時間切れ', hint: '倒しきれなかった…' },
  };

  const ENRAGE = { name: '終焉', type: 'enrage', cast: 6, damage: 9999 };

  /*
   * 敵の技 (cast: 詠唱秒 / damage: 基礎ダメージ)
   * phases: until (HP割合) を下回ると次のフェーズへ。timeline は順番に繰り返す。
   */
  const ENEMIES = [
    {
      id: 'slime', name: 'アクアスライム', sprite: '💧', maxHp: 360, enrage: 75, gap: 1.6,
      text: '水の魔物。全体攻撃と継続ダメージに慣れよう。',
      abilities: {
        tackle: { name: '体当たり', type: 'auto', cast: 2.0, damage: 5 },
        tsunami: { name: '大津波', type: 'raidwide', cast: 4.0, damage: 24 },
        acid: { name: '溶解液', type: 'dot', cast: 3.0, damage: 3, dot: { name: '溶解', perSec: 2, duration: 15 } },
      },
      phases: [
        { until: 0, timeline: ['tackle', 'tsunami', 'tackle', 'acid@1', 'tackle', 'tackle', 'tsunami', 'acid@3'] },
      ],
    },
    {
      id: 'salamander', name: 'サラマンダー', sprite: '🦎', maxHp: 500, enrage: 90, gap: 1.5,
      text: '炎の大トカゲ。「灼熱の牙」は守りの壁なしでは致命傷。',
      abilities: {
        claw: { name: '爪撃', type: 'auto', cast: 2.0, damage: 6 },
        fang: { name: '灼熱の牙', type: 'buster', cast: 5.0, damage: 110 },
        firestorm: { name: '火炎旋風', type: 'raidwide', cast: 4.0, damage: 24 },
        burn: { name: '延焼', type: 'dot', cast: 3.0, damage: 3, dot: { name: '火傷', perSec: 3, duration: 12 } },
      },
      phases: [
        { until: 0.5, timeline: ['claw', 'fang', 'claw', 'firestorm', 'claw', 'burn@1'] },
        { until: 0, name: '怒り', timeline: ['firestorm', 'claw', 'fang', 'burn', 'claw', 'claw@2', 'firestorm@3'] },
      ],
    },
    {
      id: 'thunderbird', name: 'サンダーバード', sprite: '🦅', maxHp: 560, enrage: 100, gap: 1.4,
      text: '雷の怪鳥。「雷槌召喚」は中断しないと被ダメージ増加。',
      abilities: {
        peck: { name: 'ついばみ', type: 'auto', cast: 1.8, damage: 6 },
        hammer: { name: '雷槌召喚', type: 'interruptible', cast: 6.0, damage: 32,
          vuln: { name: '感電', mult: 1.5, duration: 20 } },
        storm: { name: '雷雲嵐', type: 'raidwide', cast: 3.5, damage: 22 },
        talon: { name: '迅雷の鉤爪', type: 'buster', cast: 4.5, damage: 105 },
        static: { name: '帯電', type: 'dot', cast: 2.5, damage: 3, dot: { name: '帯電', perSec: 3, duration: 12 } },
      },
      phases: [
        { until: 0.4, timeline: ['peck', 'hammer', 'peck', 'storm', 'talon', 'peck', 'static@1'] },
        { until: 0, name: '雷雲', timeline: ['hammer', 'storm', 'peck', 'talon', 'static', 'peck', 'hammer@2', 'storm@3'] },
      ],
    },
    {
      id: 'dragon', name: '氷の魔竜', sprite: '🐉', maxHp: 900, enrage: 170, gap: 1.4,
      text: '最終ボス。3フェーズ制。後半は大技「絶対零度」が来る。',
      abilities: {
        bite: { name: '噛みつき', type: 'auto', cast: 2.0, damage: 7 },
        blizzard: { name: 'ブリザード', type: 'raidwide', cast: 4.0, damage: 24 },
        tail: { name: '氷尾の一撃', type: 'buster', cast: 5.0, damage: 115 },
        nova: { name: 'フロストノヴァ', type: 'interruptible', cast: 5.5, damage: 36,
          vuln: { name: '凍傷', mult: 1.5, duration: 20 } },
        frostbite: { name: '凍てつく息', type: 'dot', cast: 3.0, damage: 4, dot: { name: '凍結', perSec: 3, duration: 15 } },
        zero: { name: '絶対零度', type: 'raidwide', cast: 6.0, damage: 48 },
      },
      phases: [
        { until: 0.65, timeline: ['bite', 'blizzard', 'bite', 'tail', 'bite', 'frostbite@1'] },
        { until: 0.3, name: '覚醒', timeline: ['nova', 'bite', 'blizzard', 'tail', 'nova@2', 'frostbite', 'bite'] },
        { until: 0, name: '最終', timeline: ['zero', 'bite', 'nova', 'blizzard', 'tail', 'frostbite', 'bite@2', 'tail@3'] },
      ],
    },
  ];

  const PLAYER = { maxHp: 100, maxMp: 100, startMp: 60 };

  /*
   * 攻撃呪文の手札 (3枠: ★ / ★★ / ★★★)
   * 使った枠だけが入れ替わる (使わないカードは残り続ける。詰まったら引き直し)
   * usableBoost: 手札に撃てる (MPが足りる) カードが他にないとき、撃てる候補の重みを何倍にするか
   * sameHeadWeight: 手札の他の呪文と頭のかなが同じ候補の重み (打ち始めで候補が絞れるように)
   * lowMpTier3: MP不足時に★★★枠へ★★★が来る確率 (残りは★★)
   * redraw: 攻撃3枠を引き直すコスト / keys: 操作キー (左手小指を避け、入力と衝突しないキー)
   */
  const HAND = {
    usableBoost: 4,
    sameHeadWeight: 0.15,
    lowMpTier3: 0.5,
    redraw: { mp: 5, cd: 8 },
    keys: { redraw: 'Space', cancel: 'Backspace' },
  };

  return { DIFFICULTIES, DIFFICULTY_ORDER, KINDS, ATTACKS, SKILLS, SPELLS: [...ATTACKS, ...SKILLS],
    ABILITY_TYPES, ENRAGE, ENEMIES, PLAYER, HAND };
});
