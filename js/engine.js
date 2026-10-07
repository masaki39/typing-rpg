/*
 * 戦闘エンジン (DOM 非依存)
 * 時間は tick(ms) で進め、入力は key(ch) で渡す。描画側は drain() でイベントを受け取る。
 * ブラウザでは window.Engine、Node では module.exports。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./romaji.js'), require('./battle.js'), require('./data.js'));
  } else {
    root.Engine = factory(root.Romaji, root.Battle, root.GameData);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Romaji, Battle, GameData) {
  'use strict';

  const { ATTACKS, SKILLS, SPELLS, ENEMIES, DIFFICULTIES, ENRAGE, PLAYER, HAND } = GameData;

  const ATTACK_COST = { 3: ATTACKS.find((s) => s.tier === 3).mp };

  for (const s of SPELLS) {
    s.romaji = Romaji.toRomaji(s.kana);
    if (s.role === 'attack') s.value = Battle.spellPower(s.romaji.length);
  }

  /** 再現可能な乱数 (シミュレーション用) */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 'id@N' 形式のタイムラインを難易度で絞り込む */
  function resolveTimeline(entries, level) {
    return entries
      .map((e) => { const [id, min] = e.split('@'); return { id, min: Number(min || 0) }; })
      .filter((e) => level >= e.min)
      .map((e) => e.id);
  }

  function newStats() {
    return { correct: 0, miss: 0, activeMs: 0, casts: 0, maxCombo: 0, damage: 0, interrupts: 0, warded: 0 };
  }

  function createEngine({ difficulty = 'normal', rng = Math.random } = {}) {
    const events = [];
    const emit = (type, payload = {}) => events.push({ type, ...payload });
    const log = (text) => emit('log', { text });
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    const state = {
      phase: 'title', // title | battle | stageClear | allClear | gameover
      difficulty,
      stage: 0,
      player: null,
      enemy: null,
      attackHand: [],
      attackAge: [0, 0, 0], // 各枠のカードが使われずに過ぎた詠唱回数
      cooldowns: {},
      cast: null,
      combo: 0,
      stats: newStats(),
      result: null,
      lastHit: null,
    };

    const diff = () => DIFFICULTIES[state.difficulty];

    // ---------- 手札 ----------

    function cards() {
      return [...state.attackHand, ...SKILLS];
    }

    function isEnabled(spell) {
      return state.player && Battle.canCast(spell, state.player.mp, state.cooldowns[spell.id]);
    }

    /** 撃てて (MP足りる) 有効 (耐性でない) か */
    function isUsefulAttack(spell) {
      const mp = state.player ? state.player.mp : 0;
      return Battle.canCast(spell, mp) && Battle.elementMultiplier(spell.element, state.enemy.element) >= 1;
    }

    /**
     * 攻撃カードを1枚引く。敵の弱点属性に寄せ、耐性属性は出にくくする。
     * 手札の他のカードに撃てて有効なものがなければ、そうなる候補をさらに出やすくする
     * (確定ではなく偏りなので、外れの手札もたまに来る)。
     */
    function drawAttack(slot, others) {
      const p = state.player;
      let tier = slot + 1;
      if (tier === 3 && p.mp < ATTACK_COST[3] && rng() >= HAND.lowMpTier3) tier = 2;
      const candidates = ATTACKS.filter((s) => s.tier === tier && !others.includes(s));
      const needUseful = !others.some(isUsefulAttack);
      const weights = candidates.map((s) => {
        const mult = Battle.elementMultiplier(s.element, state.enemy.element);
        const w = HAND.elementWeight[mult > 1 ? 'weak' : mult < 1 ? 'resist' : 'neutral'];
        return w * (needUseful && isUsefulAttack(s) ? HAND.usableBoost : 1);
      });
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (r < 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    }

    function replaceAttack(slot) {
      const others = state.attackHand.filter((_, i) => i !== slot);
      state.attackHand[slot] = drawAttack(slot, [...others, state.attackHand[slot]]);
      state.attackAge[slot] = 0;
    }

    function dealAttackHand() {
      state.attackHand = [];
      for (const slot of [0, 1, 2]) state.attackHand.push(drawAttack(slot, state.attackHand));
      state.attackAge = [0, 0, 0];
    }

    /** 使われない攻撃カードを風化させる (呪文を唱えるたびに呼ぶ) */
    function weatherAttacks(usedSlot) {
      for (let i = 0; i < state.attackHand.length; i++) {
        if (i === usedSlot) continue;
        state.attackAge[i]++;
        if (state.attackAge[i] >= HAND.weatherAfter) {
          const old = state.attackHand[i];
          replaceAttack(i);
          log(`「${old.name}」は風化して消えた。`);
          emit('weathered', { slot: i, from: old, to: state.attackHand[i] });
        }
      }
    }

    function canRedraw() {
      return state.phase === 'battle' && state.player.mp >= HAND.redraw.mp && !(state.cooldowns.redraw > 0);
    }

    /** 攻撃3枠を引き直す (MP とリキャストを消費、詠唱中なら破棄) */
    function redraw() {
      if (!canRedraw()) return false;
      state.player.mp -= HAND.redraw.mp;
      state.cooldowns.redraw = HAND.redraw.cd * 1000;
      const old = state.attackHand;
      state.attackHand = [];
      for (const slot of [0, 1, 2]) state.attackHand.push(drawAttack(slot, [...state.attackHand, old[slot]]));
      state.attackAge = [0, 0, 0];
      resetCast();
      log('手札を引き直した。');
      emit('redraw');
      return true;
    }

    function resetCast() {
      const list = cards();
      state.cast = {
        matchers: list.map((s) => new Romaji.Matcher(s.kana)),
        live: list.map((_, i) => i),
        misses: 0,
        started: false,
      };
    }

    // ---------- 進行 ----------

    function setDifficulty(key) {
      if (DIFFICULTIES[key]) state.difficulty = key;
    }

    function startRun() {
      state.stats = newStats();
      startStage(0);
    }

    function startStage(index) {
      const d = diff();
      const def = ENEMIES[index];
      const maxHp = Math.round(def.maxHp * d.enemyHpMult);
      state.stage = index;
      state.player = {
        hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, mp: PLAYER.startMp, maxMp: PLAYER.maxMp,
        barrier: null, regen: null, dot: null, vuln: null, empower: null, ward: null, silenceReady: null,
      };
      state.enemy = {
        def, name: def.name, element: def.element, hp: maxHp, maxHp,
        phaseIndex: 0,
        timelines: def.phases.map((p) => resolveTimeline(p.timeline, d.level)),
        timelineIndex: 0,
        cast: null,
        gapLeft: def.gap * d.castMult * 1000,
        enrageTotal: def.enrage * d.enrageMult * 1000,
        enrageLeft: def.enrage * d.enrageMult * 1000,
        enraged: false,
      };
      state.cooldowns = {};
      state.combo = 0;
      dealAttackHand();
      resetCast();
      state.result = null;
      state.lastHit = null;
      state.phase = 'battle';
      log(`${def.name}が現れた！`);
      emit('stageStart');
    }

    function retryStage() {
      startStage(state.stage);
    }

    function nextStage() {
      startStage(state.stage + 1);
    }

    // ---------- 敵 ----------

    function currentTimeline() {
      const e = state.enemy;
      return e.timelines[e.phaseIndex];
    }

    /** 次に使う技 (n 個) */
    function upcoming(n = 1) {
      const e = state.enemy;
      if (!e || e.enraged) return [];
      const tl = currentTimeline();
      const out = [];
      for (let i = 0; i < n && tl.length; i++) out.push(e.def.abilities[tl[(e.timelineIndex + i) % tl.length]]);
      return out;
    }

    function startEnemyCast(ability) {
      const e = state.enemy;
      const mult = ability.type === 'enrage' ? 1 : diff().castMult;
      e.cast = { ability, elapsed: 0, duration: ability.cast * mult * 1000 };
      emit('enemyCast', { ability });
      // 「黙れ」の構え中なら詠唱開始と同時に止める (先行入力を正当な対応にする)
      const p = state.player;
      if (ability.type === 'interruptible' && p.silenceReady) {
        p.silenceReady = null;
        interruptEnemy('構えていた「黙れ」が');
      }
    }

    function interruptEnemy(prefix) {
      const e = state.enemy;
      log(`${prefix}${e.cast.ability.name}を中断させた！`);
      e.cast = null;
      e.gapLeft = e.def.gap * diff().castMult * 1000;
      state.stats.interrupts++;
      emit('interrupted');
    }

    function startNextCast() {
      const e = state.enemy;
      const tl = currentTimeline();
      const ability = e.def.abilities[tl[e.timelineIndex % tl.length]];
      e.timelineIndex++;
      startEnemyCast(ability);
    }

    function checkPhase() {
      const e = state.enemy;
      const ratio = e.hp / e.maxHp;
      while (e.phaseIndex < e.def.phases.length - 1 && ratio <= e.def.phases[e.phaseIndex].until) {
        e.phaseIndex++;
        e.timelineIndex = 0;
        const name = e.def.phases[e.phaseIndex].name || `フェーズ${e.phaseIndex + 1}`;
        log(`${e.name}の様子が変わった！ 〈${name}〉`);
        emit('phase', { index: e.phaseIndex, name });
      }
    }

    function resolveEnemyCast(ability) {
      const p = state.player;
      const d = diff();
      log(`${state.enemy.name}の「${ability.name}」！`);
      state.lastHit = ability;
      const base = ability.type === 'enrage' ? ability.damage : ability.damage * d.damageMult;
      const barrier = ability.type !== 'enrage' && p.barrier ? p.barrier.reduce : 0;
      const r = Battle.incomingDamage({ base, barrier, vulnMult: p.vuln ? p.vuln.mult : 1 });
      if (r.barrierUsed && Battle.consumesBarrier(ability.type)) {
        p.barrier = null;
        log('盾がダメージを軽減して砕けた！');
      }
      p.hp -= r.damage;
      emit('playerHit', { amount: r.damage, abilityType: ability.type, blocked: r.barrierUsed });

      if (ability.type === 'dot') {
        if (p.ward) {
          p.ward = null;
          state.stats.warded++;
          log(`加護が${ability.dot.name}を防いだ！`);
          emit('warded');
        } else {
          p.dot = { name: ability.dot.name, perSec: ability.dot.perSec * d.damageMult, remaining: ability.dot.duration * 1000 };
          log(`${ability.dot.name}状態になった（継続ダメージ）`);
        }
      }
      if (ability.type === 'interruptible') {
        p.vuln = { name: ability.vuln.name, mult: ability.vuln.mult, remaining: ability.vuln.duration * 1000 };
        log(`${ability.vuln.name}状態になった（被ダメージ ×${ability.vuln.mult}）`);
      }
      // 被弾しても入力中の詠唱には一切影響しない (入力状態も威力もそのまま)
      if (p.hp <= 0) lose(ability.type === 'enrage' ? 'enrage' : 'hp');
    }

    // ---------- 時間経過 ----------

    function tick(ms) {
      if (state.phase !== 'battle') return;
      const sec = ms / 1000;
      const p = state.player;
      const e = state.enemy;
      state.stats.activeMs += ms;

      p.mp = Math.min(p.maxMp, p.mp + diff().mpRegen * sec);
      for (const id of Object.keys(state.cooldowns)) {
        state.cooldowns[id] -= ms;
        if (state.cooldowns[id] <= 0) delete state.cooldowns[id];
      }
      for (const key of ['barrier', 'regen', 'dot', 'vuln', 'ward', 'silenceReady']) {
        const eff = p[key];
        if (!eff) continue;
        const t = Math.min(ms, eff.remaining) / 1000;
        if (key === 'regen') p.hp = Math.min(p.maxHp, p.hp + eff.perSec * t);
        if (key === 'dot') p.hp -= eff.perSec * t;
        eff.remaining -= ms;
        if (eff.remaining <= 0) p[key] = null;
      }
      if (p.hp <= 0) {
        lose('dot');
        return;
      }

      e.enrageLeft = Math.max(0, e.enrageLeft - ms);
      if (e.enrageLeft <= 0 && !e.enraged) {
        e.enraged = true;
        log(`${e.name}が力を解き放とうとしている…！（時間切れ）`);
        startEnemyCast(ENRAGE);
        return;
      }
      if (e.cast) {
        e.cast.elapsed += ms;
        if (e.cast.elapsed >= e.cast.duration) {
          const ability = e.cast.ability;
          e.cast = null;
          e.gapLeft = e.def.gap * diff().castMult * 1000;
          resolveEnemyCast(ability);
        }
      } else if (!e.enraged) {
        e.gapLeft -= ms;
        if (e.gapLeft <= 0) startNextCast();
      }
    }

    // ---------- 入力 ----------

    function key(ch) {
      if (state.phase !== 'battle') return { ok: false };
      const c = state.cast;
      const list = cards();
      const accepted = c.live.filter((i) => isEnabled(list[i]) && c.matchers[i].input(ch));
      if (accepted.length === 0) {
        state.stats.miss++;
        if (c.started) c.misses++;
        if (state.combo > 0) log(`コンボが途切れた… (${state.combo})`);
        state.combo = 0;
        emit('miss');
        return { ok: false };
      }
      c.live = accepted;
      c.started = true;
      state.stats.correct++;
      emit('key');
      const done = accepted.find((i) => c.matchers[i].finished);
      if (done !== undefined) castSpell(done);
      return { ok: true, cast: done !== undefined };
    }

    function cancelCast() {
      if (state.phase !== 'battle' || !state.cast.started) return;
      log('詠唱を破棄した。');
      resetCast();
    }

    // ---------- プレイヤーの呪文 ----------

    function castSpell(index) {
      const spell = cards()[index];
      const c = state.cast;
      const p = state.player;
      const e = state.enemy;
      state.stats.casts++;
      if (c.misses === 0) {
        state.combo++;
        state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
      }
      p.mp = Battle.applyMp(p.mp, spell, p.maxMp);
      if (spell.cd) state.cooldowns[spell.id] = spell.cd * 1000;

      switch (spell.role) {
        case 'attack': {
          const r = Battle.computeDamage({
            base: spell.value, spellElement: spell.element, enemyElement: e.element,
            misses: c.misses, combo: state.combo, empower: p.empower ? p.empower.mult : 1,
          });
          p.empower = null;
          e.hp = Math.max(0, e.hp - r.damage);
          state.stats.damage += r.damage;
          const tag = r.elementMult > 1 ? 'weak' : r.elementMult < 1 ? 'resist' : '';
          emit('enemyHit', { amount: r.damage, tag, element: spell.element });
          log(`「${spell.name}」！ ${e.name}に${r.damage}ダメージ${tag === 'weak' ? '（弱点）' : ''}`);
          replaceAttack(index);
          break;
        }
        case 'heal': {
          const amount = Battle.computeHeal({ base: spell.amount, misses: c.misses });
          const before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + amount);
          emit('heal', { amount: Math.round(p.hp - before) });
          log(`「${spell.name}」！ HPが${Math.round(p.hp - before)}回復した。`);
          break;
        }
        case 'regen':
          p.regen = { perSec: spell.perSec, remaining: spell.duration * 1000 };
          emit('buff', { spell });
          log(`「${spell.name}」！ しばらくHPが回復し続ける。`);
          break;
        case 'barrier':
          p.barrier = { reduce: spell.reduce, remaining: spell.duration * 1000 };
          emit('buff', { spell });
          log(`「${spell.name}」！ 盾を構えた（次の大技を軽減）。`);
          break;
        case 'interrupt':
          if (e.cast && e.cast.ability.type === 'interruptible') {
            interruptEnemy(`「${spell.name}」！ `);
          } else {
            // 早すぎても無駄にしない: 構えておき、中断可能技の詠唱が始まった瞬間に止める
            p.silenceReady = { remaining: spell.ready * 1000 };
            emit('buff', { spell });
            log(`「${spell.name}」！ 敵の詠唱に備えて構えた。`);
          }
          break;
        case 'cleanse':
          if (p.dot) log(`「${spell.name}」！ ${p.dot.name}が消えた。`);
          else log(`「${spell.name}」！ 加護に包まれた（継続ダメージを防ぐ）。`);
          p.dot = null;
          p.ward = { remaining: spell.ward * 1000 };
          emit('buff', { spell });
          break;
        case 'buff':
          p.empower = { mult: spell.mult };
          emit('buff', { spell });
          log(`「${spell.name}」！ 魔力が高まった。`);
          break;
      }
      if (e.hp > 0) weatherAttacks(spell.role === 'attack' ? index : -1);
      resetCast();

      if (e.hp <= 0) win();
      else checkPhase();
    }

    // ---------- 勝敗 ----------

    function win() {
      const e = state.enemy;
      log(`${e.name}を倒した！`);
      state.result = { win: true, timeLeft: e.enrageLeft, hp: state.player.hp };
      state.phase = state.stage >= ENEMIES.length - 1 ? 'allClear' : 'stageClear';
      emit('win');
    }

    function lose(reason) {
      state.player.hp = 0;
      state.result = { win: false, reason, timeLeft: state.enemy.enrageLeft, enemyHp: state.enemy.hp };
      state.phase = 'gameover';
      log('力尽きた…');
      emit('lose', { reason });
    }

    function drain() {
      return events.splice(0, events.length);
    }

    return {
      state, cards, isEnabled, upcoming, setDifficulty, startRun, startStage, retryStage, nextStage,
      tick, key, cancelCast, drain, diff, redraw, canRedraw, isUsefulAttack,
    };
  }

  return { createEngine, mulberry32, resolveTimeline };
});
