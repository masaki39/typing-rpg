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

  /** 打鍵数から威力。長い呪文ほど1打あたりの効率が上がる */
  const POWER_COEF = 2.1;
  function spellPower(keys) {
    return Math.round(POWER_COEF * Math.pow(keys, 1.2));
  }

  /** ミス1回ごとに -10%、下限 40% */
  function missMultiplier(misses) {
    return Math.max(0.4, 1 - 0.1 * misses);
  }

  /** ノーミス連続詠唱でコンボ1ごとに +5%、上限 +50% */
  function comboMultiplier(combo) {
    return 1 + 0.05 * Math.min(Math.max(combo, 0), 10);
  }

  function computeDamage({ base, misses = 0, combo = 0, empower = 1 }) {
    const missMult = missMultiplier(misses);
    const comboMult = comboMultiplier(combo);
    const damage = Math.max(1, Math.round(base * missMult * comboMult * empower));
    return { damage, missMult, comboMult };
  }

  function computeHeal({ base, misses = 0 }) {
    return Math.max(1, Math.round(base * missMultiplier(misses)));
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

  /** 盾を消費する技 (通常攻撃と継続ダメージ付与では消費しない) */
  function consumesBarrier(abilityType) {
    return abilityType !== 'auto' && abilityType !== 'dot';
  }

  /*
   * ステージの評価 (0〜1000点)。残り時間・残りHP・正確率から算出する。
   * 正確率は 80% 以下を 0、100% を満点とする (ミスの少なさを重く見る)。
   */
  const RANKS = [['S', 850], ['A', 700], ['B', 550], ['C', 0]];
  const RETRY_PENALTY = 100;

  function rankOf(score) {
    return RANKS.find(([, min]) => score >= min)[0];
  }

  function stageScore({ timeLeft, timeTotal, hp, maxHp, correct, miss }) {
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const total = correct + miss;
    const acc = total ? correct / total : 0;
    const score = Math.round(
      450 * clamp01(timeLeft / timeTotal / 0.5)
      + 200 * clamp01(hp / maxHp)
      + 350 * clamp01((acc - 0.8) / 0.2),
    );
    return { score, rank: rankOf(score) };
  }

  /** 通しの評価: ステージの合計点から再挑戦 1 回ごとに減点。ランクは 1 面あたりの平均で判定 */
  function runScore(stageScores, retries) {
    const sum = stageScores.reduce((a, b) => a + b, 0);
    const score = Math.max(0, sum - RETRY_PENALTY * retries);
    return { score, rank: rankOf(score / Math.max(1, stageScores.length)) };
  }

  return {
    rankOf, stageScore, runScore,
    spellPower, canCast, applyMp, incomingDamage, consumesBarrier, missMultiplier,
    comboMultiplier, computeDamage, computeHeal,
  };
});
