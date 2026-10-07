/*
 * ゲームデータ (難易度・呪文・敵とタイムライン・属性)
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
  const DIFFICULTIES = {
    easy: { label: 'Easy', desc: '敵の詠唱が遅く、被ダメージ控えめ。一部ギミックなし。', level: 0,
      castMult: 1.4, damageMult: 0.5, enrageMult: 1.6, enemyHpMult: 0.7, mpRegen: 2.0, showNext: true },
    normal: { label: 'Normal', desc: '標準。ギミックに対応しないと勝てない。', level: 1,
      castMult: 1.0, damageMult: 1.0, enrageMult: 1.0, enemyHpMult: 1.0, mpRegen: 1.0, showNext: true },
    hard: { label: 'Hard', desc: '詠唱が速く被ダメ増。次の技は表示されない。', level: 2,
      castMult: 0.85, damageMult: 1.2, enrageMult: 0.9, enemyHpMult: 1.1, mpRegen: 0.8, showNext: false },
    savage: { label: 'Savage', desc: '零式。追加ギミックあり。タイムラインを覚えて挑め。', level: 3,
      castMult: 0.8, damageMult: 1.3, enrageMult: 0.85, enemyHpMult: 1.2, mpRegen: 0.6, showNext: false },
  };
  const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'savage'];

  const ELEMENTS = {
    fire: { name: '火', icon: '🔥' },
    water: { name: '水', icon: '💧' },
    thunder: { name: '雷', icon: '⚡' },
    ice: { name: '氷', icon: '❄️' },
    heal: { name: '癒', icon: '✨' },
    guard: { name: '守', icon: '🛡️' },
    silence: { name: '封', icon: '🤐' },
    pure: { name: '浄', icon: '💠' },
    buff: { name: '強', icon: '🔮' },
  };

  // 攻撃呪文の MP: ★は消費なしで MP 回復、★★★は大量消費
  const ATTACK_MP = { 1: { mp: 0, mpGain: 10 }, 2: { mp: 18, mpGain: 0 }, 3: { mp: 40, mpGain: 0 } };

  const ATTACKS = [
    ['fire', 1, '火の粉', 'ひのこ'],
    ['fire', 2, '燃え盛る炎', 'もえさかるほのお'],
    ['fire', 3, '紅蓮の業火よ焼き尽くせ', 'ぐれんのごうかよやきつくせ'],
    ['water', 1, '水弾', 'すいだん'],
    ['water', 2, '渦巻く激流', 'うずまくげきりゅう'],
    ['water', 3, '深淵の大海よ全てを呑め', 'しんえんのたいかいよすべてをのめ'],
    ['thunder', 1, '稲妻', 'いなずま'],
    ['thunder', 2, '轟く雷鳴', 'とどろくらいめい'],
    ['thunder', 3, '天を裂く雷神の鉄槌', 'てんをさくらいじんのてっつい'],
    ['ice', 1, '氷柱', 'つらら'],
    ['ice', 2, '凍える吹雪', 'こごえるふぶき'],
    ['ice', 3, '永久凍土の氷棺に眠れ', 'えいきゅうとうどのひょうかんにねむれ'],
  ].map(([element, tier, name, kana]) => ({
    id: `${element}${tier}`, name, kana, element, role: 'attack', tier, ...ATTACK_MP[tier],
  }));

  // 常に並ぶ支援呪文 (cd: リキャスト秒)
  const SKILLS = [
    { id: 'heal', name: '治癒の光', kana: 'ちゆのひかり', element: 'heal', role: 'heal', mp: 16, cd: 0,
      amount: 30, desc: 'HPを即時回復' },
    { id: 'regen', name: '再生の祈り', kana: 'さいせいのいのり', element: 'heal', role: 'regen', mp: 14, cd: 20,
      perSec: 4, duration: 12, desc: '12秒間HPを継続回復' },
    { id: 'barrier', name: '守りの盾', kana: 'まもりのたて', element: 'guard', role: 'barrier', mp: 10, cd: 12,
      reduce: 0.75, duration: 6, desc: '6秒間 被ダメ75%減・詠唱保護' },
    { id: 'silence', name: '黙れ', kana: 'だまれ', element: 'silence', role: 'interrupt', mp: 5, cd: 10,
      desc: '中断可能な敵の詠唱を止める' },
    { id: 'cleanse', name: '浄化', kana: 'じょうか', element: 'pure', role: 'cleanse', mp: 8, cd: 8,
      desc: '継続ダメージを解除' },
    { id: 'empower', name: '増幅', kana: 'ぞうふく', element: 'buff', role: 'buff', mp: 10, cd: 25,
      mult: 1.6, desc: '次の攻撃呪文の威力1.6倍' },
  ];

  const ABILITY_TYPES = {
    auto: { label: '通常攻撃', hint: '' },
    raidwide: { label: '全体攻撃', hint: '回復の準備を' },
    buster: { label: 'タンクバスター', hint: '障壁で軽減せよ！' },
    interruptible: { label: '中断可能', hint: '「黙れ」で中断せよ！' },
    dot: { label: '継続ダメージ', hint: '「浄化」で解除できる' },
    enrage: { label: '時間切れ', hint: '倒しきれなかった…' },
  };

  const ENRAGE = { name: '終焉', type: 'enrage', cast: 6, damage: 9999 };

  /*
   * 敵の技 (cast: 詠唱秒 / damage: 基礎ダメージ)
   * phases: until (HP割合) を下回ると次のフェーズへ。timeline は順番に繰り返す。
   */
  const ENEMIES = [
    {
      id: 'slime', name: 'アクアスライム', sprite: '💧', element: 'water', maxHp: 360, enrage: 100, gap: 1.6,
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
      id: 'salamander', name: 'サラマンダー', sprite: '🦎', element: 'fire', maxHp: 500, enrage: 110, gap: 1.5,
      text: '炎の大トカゲ。「灼熱の牙」は障壁なしでは致命傷。',
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
      id: 'thunderbird', name: 'サンダーバード', sprite: '🦅', element: 'thunder', maxHp: 560, enrage: 120, gap: 1.4,
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
      id: 'dragon', name: '氷の魔竜', sprite: '🐉', element: 'ice', maxHp: 900, enrage: 210, gap: 1.4,
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
        { until: 0, name: '最終', timeline: ['zero', 'bite', 'nova', 'tail', 'blizzard', 'frostbite', 'bite@2', 'tail@3'] },
      ],
    },
  ];

  const PLAYER = { maxHp: 100, maxMp: 100, startMp: 60 };

  /*
   * 攻撃呪文の手札 (3枠: ★ / ★★ / ★★★)
   * weatherAfter: 使われないまま他の呪文をこの回数唱えると風化して入れ替わる
   * elementWeight: ドロー時の属性の重み (敵の弱点 / 等倍 / 耐性)
   * usableBoost: 手札に「撃てて有効」なカードが他にないとき、該当候補の重みを何倍にするか
   * lowMpTier3: MP不足時に★★★枠へ★★★が来る確率 (残りは★★)
   * redraw: Tab で攻撃3枠を引き直すコスト
   */
  const HAND = {
    weatherAfter: 5,
    elementWeight: { weak: 2, neutral: 1.5, resist: 0.5 },
    usableBoost: 4,
    lowMpTier3: 0.5,
    redraw: { mp: 5, cd: 8 },
  };

  return { DIFFICULTIES, DIFFICULTY_ORDER, ELEMENTS, ATTACKS, SKILLS, SPELLS: [...ATTACKS, ...SKILLS],
    ABILITY_TYPES, ENRAGE, ENEMIES, PLAYER, HAND };
});
