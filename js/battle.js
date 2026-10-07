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
    return Math.round(1.6 * Math.pow(keys, 1.12));
  }

  function healAmount(keys) {
    return Math.round(2 * keys);
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

  function computeDamage({ base, spellElement, enemyElement, misses = 0, disrupts = 0, combo = 0 }) {
    const elementMult = elementMultiplier(spellElement, enemyElement);
    const missMult = missMultiplier(misses);
    const disruptMult = disruptMultiplier(disrupts);
    const comboMult = comboMultiplier(combo);
    const damage = Math.max(1, Math.round(base * elementMult * missMult * disruptMult * comboMult));
    return { damage, elementMult, missMult, disruptMult, comboMult };
  }

  function computeHeal({ base, misses = 0, disrupts = 0 }) {
    return Math.max(1, Math.round(base * missMultiplier(misses) * disruptMultiplier(disrupts)));
  }

  return {
    BEATS, spellPower, healAmount, elementMultiplier, missMultiplier,
    disruptMultiplier, comboMultiplier, computeDamage, computeHeal,
  };
});
