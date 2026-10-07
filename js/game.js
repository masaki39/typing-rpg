/*
 * ゲーム進行・描画・入力
 * 依存: Romaji, Battle, GameData, Sfx (いずれも window グローバル)
 */
(function () {
  'use strict';

  const { SPELLS, ENEMIES, ELEMENTS, PLAYER } = window.GameData;
  const { Battle, Romaji, Sfx } = window;

  for (const s of SPELLS) {
    s.romaji = Romaji.toRomaji(s.kana);
    s.value = s.kind === 'heal' ? Battle.healAmount(s.romaji.length) : Battle.spellPower(s.romaji.length);
  }

  // 手札の枠: 短・中・長 + 自由枠 (回復呪文はここにだけ出る)
  const HAND_SLOTS = [{ tier: 1 }, { tier: 2 }, { tier: 3 }, { tier: null }];
  const LOG_MAX = 6;

  const $ = (id) => document.getElementById(id);
  const dom = {
    stageLabel: $('stage-label'), sound: $('sound-toggle'),
    enemyArea: $('enemy-area'), enemyName: $('enemy-name'), enemyElement: $('enemy-element'),
    enemySprite: $('enemy-sprite'), enemyHpFill: $('enemy-hp-fill'), enemyHpText: $('enemy-hp-text'),
    enemyTimerFill: $('enemy-timer-fill'), enemyIntent: $('enemy-intent'), enemyFx: $('enemy-fx'),
    playerArea: $('player-area'), playerHpFill: $('player-hp-fill'), playerHpText: $('player-hp-text'),
    playerFx: $('player-fx'),
    combo: $('stat-combo'), kpm: $('stat-kpm'), acc: $('stat-acc'), miss: $('stat-miss'),
    log: $('log'), hand: $('hand'), overlay: $('overlay'), overlayContent: $('overlay-content'),
    imeWarning: $('ime-warning'),
  };

  const state = {
    phase: 'title', // title | battle | paused | stageClear | allClear | gameover
    stage: 0,
    player: { hp: PLAYER.maxHp, maxHp: PLAYER.maxHp },
    enemy: null,
    enemyTimer: 0,
    enemyAttackCount: 0,
    hand: [],
    cast: null,
    combo: 0,
    stats: newStats(),
    log: [],
  };

  function newStats() {
    return { correct: 0, miss: 0, activeMs: 0, casts: 0, maxCombo: 0, damage: 0 };
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // ---------- 手札 ----------

  function drawSpell(slot, exclude) {
    const free = SPELLS.filter((s) => !exclude.includes(s));
    if (slot.tier === null) {
      const heals = free.filter((s) => s.kind === 'heal');
      if (heals.length && Math.random() < 0.5) return pick(heals);
      return pick(free.filter((s) => s.kind === 'attack'));
    }
    return pick(free.filter((s) => s.kind === 'attack' && s.tier === slot.tier));
  }

  function drawHand() {
    state.hand = [];
    for (const slot of HAND_SLOTS) state.hand.push(drawSpell(slot, state.hand));
  }

  function resetCast() {
    state.cast = {
      matchers: state.hand.map((s) => new Romaji.Matcher(s.kana)),
      live: state.hand.map((_, i) => i),
      misses: 0,
      disrupts: 0,
      started: false,
    };
  }

  // ---------- 進行 ----------

  function startRun() {
    state.stage = 0;
    state.player.hp = state.player.maxHp;
    state.combo = 0;
    state.stats = newStats();
    state.log = [];
    startStage();
  }

  function startStage() {
    const base = ENEMIES[state.stage];
    state.enemy = { ...base, hp: base.maxHp };
    state.enemyTimer = 0;
    state.enemyAttackCount = 0;
    drawHand();
    resetCast();
    addLog(`${base.name}が現れた！`);
    state.phase = 'battle';
    hideOverlay();
    renderAll();
  }

  function retryStage() {
    state.player.hp = state.player.maxHp;
    state.combo = 0;
    startStage();
  }

  function nextStage() {
    const heal = Math.round(state.player.maxHp * PLAYER.healBetweenStages);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
    state.stage++;
    startStage();
  }

  function pause() {
    if (state.phase !== 'battle') return;
    state.phase = 'paused';
    showOverlay(`<h2>一時停止中</h2><p class="blink"><kbd>Space</kbd> で再開</p>`);
  }

  function resume() {
    state.phase = 'battle';
    hideOverlay();
  }

  // ---------- 入力 ----------

  function handleTypingKey(key) {
    const c = state.cast;
    const accepted = c.live.filter((i) => c.matchers[i].input(key));
    if (accepted.length === 0) {
      onMiss();
      return;
    }
    c.live = accepted;
    c.started = true;
    state.stats.correct++;
    Sfx.key();
    const done = accepted.find((i) => c.matchers[i].finished);
    if (done !== undefined) castSpell(done);
    renderHand();
    renderStats();
  }

  function onMiss() {
    const c = state.cast;
    state.stats.miss++;
    if (c.started) c.misses++;
    if (state.combo > 0) addLog(`コンボが途切れた… (${state.combo})`);
    state.combo = 0;
    Sfx.miss();
    retrigger(dom.hand, 'shake');
    renderHand();
    renderStats();
  }

  function cancelCast() {
    if (!state.cast.started) return;
    addLog('詠唱を破棄した。');
    resetCast();
    renderHand();
  }

  // ---------- 戦闘 ----------

  function castSpell(slotIndex) {
    const spell = state.hand[slotIndex];
    const c = state.cast;
    const enemy = state.enemy;
    state.stats.casts++;
    if (c.misses === 0) {
      state.combo++;
      state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
    }

    if (spell.kind === 'heal') {
      const amount = Battle.computeHeal({ base: spell.value, misses: c.misses, disrupts: c.disrupts });
      const before = state.player.hp;
      state.player.hp = Math.min(state.player.maxHp, before + amount);
      floatText(dom.playerFx, `+${state.player.hp - before}`, 'heal');
      addLog(`「${spell.name}」！ HPが${state.player.hp - before}回復した。`);
      Sfx.heal();
    } else {
      const r = Battle.computeDamage({
        base: spell.value, spellElement: spell.element, enemyElement: enemy.element,
        misses: c.misses, disrupts: c.disrupts, combo: state.combo,
      });
      enemy.hp = Math.max(0, enemy.hp - r.damage);
      state.stats.damage += r.damage;
      const tag = r.elementMult > 1 ? 'weak' : r.elementMult < 1 ? 'resist' : '';
      floatText(dom.enemyFx, String(r.damage), `dmg ${tag}`);
      if (tag === 'weak') floatText(dom.enemyFx, '弱点！', 'label weak', 120);
      if (tag === 'resist') floatText(dom.enemyFx, 'いまひとつ…', 'label resist', 120);
      retrigger(dom.enemySprite, `hit-${spell.element}`);
      const notes = [];
      if (c.misses) notes.push(`ミス${c.misses}`);
      if (c.disrupts) notes.push(`乱れ${c.disrupts}`);
      if (state.combo > 1) notes.push(`${state.combo}コンボ`);
      addLog(`「${spell.name}」！ ${enemy.name}に${r.damage}ダメージ${tag === 'weak' ? '（弱点）' : ''}${notes.length ? ` [${notes.join(' / ')}]` : ''}`);
      Sfx.cast(tag === 'weak');
    }

    const others = state.hand.filter((_, i) => i !== slotIndex);
    state.hand[slotIndex] = drawSpell(HAND_SLOTS[slotIndex], [...others, spell]);
    resetCast();

    if (enemy.hp <= 0) onEnemyDefeated();
    renderAll();
  }

  function nextAttackIsHeavy() {
    const e = state.enemy;
    return !!e.heavyEvery && (state.enemyAttackCount + 1) % e.heavyEvery === 0;
  }

  function enemyAttack() {
    const e = state.enemy;
    const heavy = nextAttackIsHeavy();
    state.enemyAttackCount++;
    const variance = 0.85 + Math.random() * 0.3;
    const dmg = Math.round(e.attack * (heavy ? 2 : 1) * variance);
    state.player.hp = Math.max(0, state.player.hp - dmg);
    floatText(dom.playerFx, `-${dmg}`, heavy ? 'hurt heavy' : 'hurt');
    retrigger(dom.playerArea, 'shake');
    retrigger(document.body, heavy ? 'flash-heavy' : 'flash');
    retrigger(dom.enemySprite, 'lunge');
    addLog(`${e.name}の${heavy ? '渾身の一撃' : '攻撃'}！ ${dmg}ダメージを受けた。`);
    if (state.cast.started) {
      state.cast.disrupts++;
      addLog('詠唱が乱れた！ (威力 ×0.8)');
    }
    Sfx.hurt(heavy);
    if (state.player.hp <= 0) onPlayerDefeated();
    renderAll();
  }

  function onEnemyDefeated() {
    Sfx.win();
    const e = state.enemy;
    addLog(`${e.name}を倒した！`);
    if (state.stage >= ENEMIES.length - 1) {
      state.phase = 'allClear';
      showOverlay(`<h2>全ての魔物を討伐した！</h2>${statsHtml()}<p class="blink"><kbd>Space</kbd> でもう一度</p>`);
      return;
    }
    state.phase = 'stageClear';
    const heal = Math.round(state.player.maxHp * PLAYER.healBetweenStages);
    const next = ENEMIES[state.stage + 1];
    showOverlay(`
      <h2>${escapeHtml(e.name)}を倒した！</h2>
      <p>HPが最大${heal}回復する。</p>
      <p>次の相手: <strong>${escapeHtml(next.name)}</strong> ${elementBadge(next.element)}</p>
      <p class="blink"><kbd>Space</kbd> で次の戦いへ</p>`);
  }

  function onPlayerDefeated() {
    Sfx.lose();
    state.phase = 'gameover';
    showOverlay(`
      <h2 class="lose">力尽きた…</h2>
      <p>${escapeHtml(state.enemy.name)}に敗れた。</p>
      ${statsHtml()}
      <p class="blink"><kbd>Space</kbd> でこの敵に再挑戦（HP全快）</p>
      <p><kbd>Esc</kbd> で最初から</p>`);
  }

  // ---------- ループ ----------

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;
    if (state.phase === 'battle') {
      state.stats.activeMs += dt;
      state.enemyTimer += dt;
      if (state.enemyTimer >= state.enemy.interval * 1000) {
        state.enemyTimer = 0;
        enemyAttack();
      }
      renderTimer();
    }
    requestAnimationFrame(frame);
  }

  // ---------- 描画 ----------

  function elementBadge(element) {
    const el = ELEMENTS[element];
    return `<span class="badge el-${element}">${el.icon}${el.name}</span>`;
  }

  function addLog(text) {
    state.log.unshift(text);
    state.log.length = Math.min(state.log.length, LOG_MAX);
    renderLog();
  }

  function renderAll() {
    renderEnemy();
    renderPlayer();
    renderHand();
    renderStats();
    renderTimer();
    renderLog();
  }

  function renderEnemy() {
    const e = state.enemy;
    if (!e) return;
    dom.stageLabel.textContent = `STAGE ${state.stage + 1} / ${ENEMIES.length}`;
    dom.enemyName.textContent = e.name;
    dom.enemyName.title = e.text;
    dom.enemyElement.className = `badge el-${e.element}`;
    dom.enemyElement.textContent = `${ELEMENTS[e.element].icon}${ELEMENTS[e.element].name}`;
    dom.enemySprite.textContent = e.sprite;
    dom.enemySprite.classList.toggle('dead', e.hp <= 0);
    dom.enemyHpFill.style.width = `${(e.hp / e.maxHp) * 100}%`;
    dom.enemyHpText.textContent = `${e.hp} / ${e.maxHp}`;
  }

  function renderTimer() {
    const e = state.enemy;
    if (!e) return;
    const ratio = Math.min(1, state.enemyTimer / (e.interval * 1000));
    dom.enemyTimerFill.style.width = `${ratio * 100}%`;
    const heavy = nextAttackIsHeavy();
    dom.enemyTimerFill.classList.toggle('heavy', heavy);
    dom.enemyIntent.textContent = heavy ? '⚠ 力を溜めている！（次は強攻撃）' : '';
  }

  function renderPlayer() {
    const p = state.player;
    const ratio = p.hp / p.maxHp;
    dom.playerHpFill.style.width = `${ratio * 100}%`;
    dom.playerHpFill.classList.toggle('low', ratio <= 0.3);
    dom.playerHpText.textContent = `${p.hp} / ${p.maxHp}`;
  }

  function renderStats() {
    const s = state.stats;
    const total = s.correct + s.miss;
    dom.combo.textContent = state.combo;
    dom.kpm.textContent = s.activeMs > 0 ? Math.round(s.correct / (s.activeMs / 60000)) : 0;
    dom.acc.textContent = total ? `${((s.correct / total) * 100).toFixed(1)}%` : '-';
    dom.miss.textContent = s.miss;
  }

  function statsHtml() {
    const s = state.stats;
    const total = s.correct + s.miss;
    const kpm = s.activeMs > 0 ? Math.round(s.correct / (s.activeMs / 60000)) : 0;
    const acc = total ? ((s.correct / total) * 100).toFixed(1) : '0.0';
    return `<dl class="stats result">
      <dt>詠唱数</dt><dd>${s.casts}</dd>
      <dt>総ダメージ</dt><dd>${s.damage}</dd>
      <dt>最大コンボ</dt><dd>${s.maxCombo}</dd>
      <dt>KPM</dt><dd>${kpm}</dd>
      <dt>正確率</dt><dd>${acc}%</dd>
      <dt>戦闘時間</dt><dd>${(s.activeMs / 1000).toFixed(1)}秒</dd>
    </dl>`;
  }

  function renderLog() {
    dom.log.innerHTML = state.log.map((t, i) => `<li class="${i === 0 ? 'latest' : ''}">${escapeHtml(t)}</li>`).join('');
  }

  function renderHand() {
    const c = state.cast;
    if (!c) return;
    const enemy = state.enemy;
    dom.hand.innerHTML = state.hand.map((spell, i) => {
      const m = c.matchers[i];
      const live = c.live.includes(i);
      const status = !c.started ? 'idle' : live ? 'live' : 'out';
      const typed = live ? m.typed : '';
      const rest = live ? m.remaining : spell.romaji;
      const kanaDone = live ? m.pos : 0;

      let power;
      if (spell.kind === 'heal') {
        const v = live && c.started ? Battle.computeHeal({ base: spell.value, misses: c.misses, disrupts: c.disrupts }) : spell.value;
        power = `回復 <strong>${v}</strong>`;
      } else {
        const mult = Battle.elementMultiplier(spell.element, enemy.element);
        const v = live && c.started
          ? Math.round(spell.value * mult * Battle.missMultiplier(c.misses) * Battle.disruptMultiplier(c.disrupts))
          : Math.round(spell.value * mult);
        const tag = mult > 1 ? '<span class="tag weak">弱点×2</span>' : mult < 1 ? '<span class="tag resist">耐性×½</span>' : '';
        power = `威力 <strong>${v}</strong> ${tag}`;
      }
      const penalty = live && c.started && (c.misses || c.disrupts)
        ? `<span class="tag penalty">${c.misses ? `ミス${c.misses}` : ''}${c.misses && c.disrupts ? '・' : ''}${c.disrupts ? `乱れ${c.disrupts}` : ''}</span>`
        : '';

      return `<article class="card el-${spell.element} ${status}">
        <header class="card-head">${elementBadge(spell.element)}<span class="tier">${'★'.repeat(spell.tier)}</span></header>
        <div class="card-name">${escapeHtml(spell.name)}</div>
        <div class="card-kana"><span class="done">${escapeHtml(m.text.slice(0, kanaDone))}</span>${escapeHtml(m.text.slice(kanaDone))}</div>
        <div class="card-romaji"><span class="typed">${escapeHtml(typed)}</span><span class="rest">${escapeHtml(rest)}</span></div>
        <footer class="card-power">${power}${penalty}</footer>
      </article>`;
    }).join('');
  }

  function showOverlay(html) {
    dom.overlayContent.innerHTML = html;
    dom.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    dom.overlay.classList.add('hidden');
  }

  function floatText(layer, text, cls, delay = 0) {
    const node = document.createElement('div');
    node.className = `float ${cls}`;
    node.textContent = text;
    node.style.left = `${40 + Math.random() * 20}%`;
    node.style.animationDelay = `${delay}ms`;
    node.addEventListener('animationend', () => node.remove());
    layer.appendChild(node);
  }

  /** CSS アニメーションを毎回再生し直す */
  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 450);
  }

  function showTitle() {
    showOverlay(`
      <h2 class="title">呪文詠唱タイピングRPG</h2>
      <p>呪文を<strong>ローマ字でタイピング</strong>して詠唱し、魔物を倒そう。</p>
      <ul class="rules">
        <li>手札の呪文から好きなものを打ち始める。打った文字で呪文が自動的に決まる。</li>
        <li>★が多い長い呪文ほど高威力。ただし詠唱中も敵の攻撃は止まらず、被弾すると詠唱が乱れて威力ダウン。</li>
        <li>敵の弱点属性なら <strong>2倍</strong>、同属性は <strong>半減</strong>。</li>
        <li>ミスタイプ1回につき威力 -10%。ノーミス詠唱を続けるとコンボで威力アップ。</li>
        <li>全${ENEMIES.length}体の魔物を連続で倒せばクリア。</li>
      </ul>
      <p class="note">※ 入力は半角英数（IMEオフ）で。し=shi/si、ん=nn/n' など一般的な綴りに対応。</p>
      <p class="blink"><kbd>Space</kbd> で冒険を始める</p>`);
  }

  // ---------- イベント ----------

  const TYPABLE = /^[a-z0-9\-',.!?]$/i;

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
      dom.imeWarning.classList.remove('hidden');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    dom.imeWarning.classList.add('hidden');
    Sfx.unlock();

    const key = e.key;
    const confirm = key === ' ' || key === 'Enter';

    if (state.phase === 'battle') {
      if (key === 'Escape' || key === 'Backspace') {
        e.preventDefault();
        cancelCast();
      } else if (TYPABLE.test(key)) {
        e.preventDefault();
        handleTypingKey(key.toLowerCase());
      } else if (confirm) {
        e.preventDefault();
      }
      return;
    }

    if (confirm) e.preventDefault();
    if (e.repeat) return;
    switch (state.phase) {
      case 'title':
      case 'allClear':
        if (confirm) startRun();
        break;
      case 'paused':
        if (confirm) resume();
        break;
      case 'stageClear':
        if (confirm) nextStage();
        break;
      case 'gameover':
        if (confirm) retryStage();
        else if (key === 'Escape') startRun();
        break;
    }
  });

  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  dom.sound.addEventListener('click', (e) => {
    dom.sound.textContent = Sfx.toggle() ? '🔊' : '🔇';
    e.currentTarget.blur();
  });

  showTitle();
  requestAnimationFrame(frame);
})();
