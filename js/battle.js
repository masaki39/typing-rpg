/*
 * 戦闘計算 (DOM 非依存)
 * ブラウザでは window.Battle、Node では module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Battle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // key が value に強い: 水→火→氷→雷→水
  const BEATS = { water: 'fire', fire: 'ice', ice: 'thunder', thunder: 'water' };

  /** 打鍵数から威力。長い呪文ほど1打あたりの効率が上がる */
  function spellPower(keys) {
    return Math.round(1.6 * Math.pow(keys, 1.2));
  }

  function elementMultiplier(spellElement, enemyElement) {
    if (!spellElement || !enemyElement) return 1;
    if (BEATS[spellElement] === enemyElement) return 2;
    if (spellElement === enemyElement) return 0.5;
    return 1;
  }

  /** ミス1回ごとに -10%、下限 40% */
  function missMultiplier(misses) {
    return Math.max(0.4, 1 - 0.1 * misses);
  }

  /** 詠唱中に被弾するたび ×0.8 */
  function disruptMultiplier(disrupts) {
    return Math.pow(0.8, disrupts);
  }

  /** ノーミス連続詠唱でコンボ1ごとに +5%、上限 +50% */
  function comboMultiplier(combo) {
    return 1 + 0.05 * Math.min(Math.max(combo, 0), 10);
  }

  function computeDamage({ base, spellElement, enemyElement, misses = 0, disrupts = 0, combo = 0, empower = 1 }) {
    const elementMult = elementMultiplier(spellElement, enemyElement);
    const missMult = missMultiplier(misses);
    const disruptMult = disruptMultiplier(disrupts);
    const comboMult = comboMultiplier(combo);
    const damage = Math.max(1, Math.round(base * elementMult * missMult * disruptMult * comboMult * empower));
    return { damage, elementMult, missMult, disruptMult, comboMult };
  }

  function computeHeal({ base, misses = 0, disrupts = 0 }) {
    return Math.max(1, Math.round(base * missMultiplier(misses) * disruptMultiplier(disrupts)));
  }

  /** MP とリキャストから詠唱可能か */
  function canCast(spell, mp, cooldownMs = 0) {
    return mp >= (spell.mp || 0) && !(cooldownMs > 0);
  }

  /** 詠唱完了時の MP 変化後の値 */
  function applyMp(mp, spell, maxMp) {
    return Math.min(maxMp, Math.max(0, mp - (spell.mp || 0) + (spell.mpGain || 0)));
  }

  /** 敵の技による被ダメージ。barrier は軽減率 (0〜1)、vulnMult は被ダメージ増加倍率 */
  function incomingDamage({ base, barrier = 0, vulnMult = 1 }) {
    return { damage: Math.round(base * vulnMult * (1 - barrier)), barrierUsed: barrier > 0 };
  }

  /**
   * 詠唱中に被弾したときの影響。障壁で守られていれば影響なし、
   * 通常攻撃・継続ダメージ付与は「乱れ」(威力減)、大技は詠唱が途切れる。
   */
  function castDisruption(abilityType, shielded) {
    if (shielded) return 'none';
    if (abilityType === 'auto' || abilityType === 'dot') return 'disrupt';
    return 'interrupt';
  }

  return {
    BEATS, spellPower, canCast, applyMp, incomingDamage, castDisruption, elementMultiplier, missMultiplier,
    disruptMultiplier, comboMultiplier, computeDamage, computeHeal,
  };
});
