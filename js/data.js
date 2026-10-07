/*
 * ゲームデータ (呪文・敵・属性)
 * ブラウザでは window.GameData、Node では module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ELEMENTS = {
    fire: { name: '火', icon: '🔥' },
    water: { name: '水', icon: '💧' },
    thunder: { name: '雷', icon: '⚡' },
    ice: { name: '氷', icon: '❄️' },
    heal: { name: '癒', icon: '✨' },
  };

  // tier: 1=短詠唱 2=中詠唱 3=長詠唱。威力は打鍵数から自動計算
  const SPELLS = [
    { id: 'fire1', name: '火の粉', kana: 'ひのこ', element: 'fire', kind: 'attack', tier: 1 },
    { id: 'fire2', name: '燃え盛る炎', kana: 'もえさかるほのお', element: 'fire', kind: 'attack', tier: 2 },
    { id: 'fire3', name: '紅蓮の業火よ焼き尽くせ', kana: 'ぐれんのごうかよやきつくせ', element: 'fire', kind: 'attack', tier: 3 },
    { id: 'water1', name: '水弾', kana: 'すいだん', element: 'water', kind: 'attack', tier: 1 },
    { id: 'water2', name: '渦巻く激流', kana: 'うずまくげきりゅう', element: 'water', kind: 'attack', tier: 2 },
    { id: 'water3', name: '深淵の大海よ全てを呑め', kana: 'しんえんのたいかいよすべてをのめ', element: 'water', kind: 'attack', tier: 3 },
    { id: 'thunder1', name: '稲妻', kana: 'いなずま', element: 'thunder', kind: 'attack', tier: 1 },
    { id: 'thunder2', name: '轟く雷鳴', kana: 'とどろくらいめい', element: 'thunder', kind: 'attack', tier: 2 },
    { id: 'thunder3', name: '天を裂く雷神の鉄槌', kana: 'てんをさくらいじんのてっつい', element: 'thunder', kind: 'attack', tier: 3 },
    { id: 'ice1', name: '氷柱', kana: 'つらら', element: 'ice', kind: 'attack', tier: 1 },
    { id: 'ice2', name: '凍える吹雪', kana: 'こごえるふぶき', element: 'ice', kind: 'attack', tier: 2 },
    { id: 'ice3', name: '永久凍土の氷棺に眠れ', kana: 'えいきゅうとうどのひょうかんにねむれ', element: 'ice', kind: 'attack', tier: 3 },
    { id: 'heal1', name: '治癒', kana: 'ちゆ', element: 'heal', kind: 'heal', tier: 1 },
    { id: 'heal2', name: '聖なる癒し', kana: 'せいなるいやし', element: 'heal', kind: 'heal', tier: 2 },
  ];

  // interval: 攻撃間隔(秒) / heavyEvery: N回に1回 2倍の強攻撃
  const ENEMIES = [
    { id: 'slime', name: 'アクアスライム', sprite: '💧', element: 'water', maxHp: 90, attack: 8, interval: 6.5,
      text: 'ぷるぷる震える水の魔物。' },
    { id: 'salamander', name: 'サラマンダー', sprite: '🦎', element: 'fire', maxHp: 150, attack: 10, interval: 6.0,
      text: '炎をまとう大トカゲ。' },
    { id: 'thunderbird', name: 'サンダーバード', sprite: '🦅', element: 'thunder', maxHp: 180, attack: 11, interval: 5.0,
      text: '雷雲を呼ぶ怪鳥。攻撃が速い。' },
    { id: 'dragon', name: '氷の魔竜', sprite: '🐉', element: 'ice', maxHp: 280, attack: 12, interval: 5.5, heavyEvery: 3,
      text: '凍てつく息を吐く竜。時おり力を溜めて強攻撃を放つ。' },
  ];

  const PLAYER = { maxHp: 120, healBetweenStages: 0.4 };

  return { ELEMENTS, SPELLS, ENEMIES, PLAYER };
});
