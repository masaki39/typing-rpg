/*
 * 画面描画とキー入力 (戦闘ロジックは engine.js)
 * 依存: Engine, GameData, Battle, Sfx (いずれも window グローバル)
 */
(function () {
  'use strict';

  const { ENEMIES, ELEMENTS, DIFFICULTIES, DIFFICULTY_ORDER, ABILITY_TYPES, HAND } = window.GameData;
  const { Battle, Sfx } = window;
  const engine = window.Engine.createEngine({ difficulty: loadDifficulty() });
  const state = engine.state;

  const LOG_MAX = 7;
  const $ = (id) => document.getElementById(id);
  const dom = {
    diffLabel: $('diff-label'), stageLabel: $('stage-label'), sound: $('sound-toggle'),
    enemyName: $('enemy-name'), enemyElement: $('enemy-element'), enemyPhase: $('enemy-phase'),
    enrageTime: $('enrage-time'), enemySprite: $('enemy-sprite'),
    enemyHpFill: $('enemy-hp-fill'), enemyHpText: $('enemy-hp-text'),
    bossCast: $('boss-cast'), castType: $('cast-type'), castName: $('cast-name'), castHint: $('cast-hint'),
    castFill: $('cast-fill'), castTime: $('cast-time'), nextLine: $('next-line'), enemyFx: $('enemy-fx'),
    playerHpFill: $('player-hp-fill'), playerHpText: $('player-hp-text'),
    playerMpFill: $('player-mp-fill'), playerMpText: $('player-mp-text'),
    statusRow: $('status-row'), playerFx: $('player-fx'),
    combo: $('stat-combo'), kpm: $('stat-kpm'), acc: $('stat-acc'), int: $('stat-int'),
    log: $('log'), hand: $('hand'), attackRow: $('attack-row'), skillRow: $('skill-row'),
    overlay: $('overlay'), overlayContent: $('overlay-content'), imeWarning: $('ime-warning'),
    redrawTile: $('redraw-tile'), redrawCost: $('redraw-cost'), redrawCd: $('redraw-cd'),
  };

  // UI 側の状態 (一時停止とタイトルの難易度選択)
  const ui = { paused: false, selected: DIFFICULTY_ORDER.indexOf(state.difficulty), log: [] };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtSec = (ms) => `${Math.max(0, ms / 1000).toFixed(1)}s`;
  const fmtClock = (ms) => {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function loadDifficulty() {
    try {
      const v = localStorage.getItem('typing-rpg:difficulty');
      if (v && window.GameData.DIFFICULTIES[v]) return v;
    } catch (e) { /* 保存できない環境では既定値 */ }
    return 'normal';
  }

  function saveDifficulty(v) {
    try { localStorage.setItem('typing-rpg:difficulty', v); } catch (e) { /* noop */ }
  }

  function elementBadge(element) {
    const el = ELEMENTS[element];
    return `<span class="badge el-${element}">${el.icon}${el.name}</span>`;
  }

  // ---------- 手札 ----------

  // カードは詠唱のたびに作り直さず、中身だけ書き換える (レイアウトを安定させるため)
  let cardNodes = [];

  function buildCards() {
    const list = engine.cards();
    dom.attackRow.innerHTML = '';
    dom.skillRow.innerHTML = '';
    cardNodes = list.map((spell, i) => {
      const node = document.createElement('article');
      node.className = `card ${spell.role === 'attack' ? 'attack' : 'skill'}`;
      node.innerHTML = `
        <header class="card-head"><span class="slot-badge"></span><span class="card-meta num"></span></header>
        <div class="card-name"></div>
        <div class="card-kana"></div>
        <div class="card-romaji"><span class="typed"></span><span class="rest"></span></div>
        <footer class="card-foot"></footer>
        <div class="wear" title="使わずにいると風化して入れ替わる"></div>
        <div class="cd-veil"><span class="cd-text num"></span></div>`;
      (spell.role === 'attack' ? dom.attackRow : dom.skillRow).appendChild(node);
      const q = (sel) => node.querySelector(sel);
      return {
        node, spellId: null, badge: q('.slot-badge'), meta: q('.card-meta'), name: q('.card-name'),
        kana: q('.card-kana'), typed: q('.typed'), rest: q('.rest'), foot: q('.card-foot'),
        veil: q('.cd-veil'), cdText: q('.cd-text'), wear: q('.wear'), i,
      };
    });
  }

  function cardFooter(spell, c, live) {
    if (spell.role !== 'attack') return escapeHtml(spell.desc);
    const p = state.player;
    const mult = Battle.elementMultiplier(spell.element, state.enemy.element);
    let v = spell.value * mult * (p.empower ? p.empower.mult : 1);
    if (live && c.started) v *= Battle.missMultiplier(c.misses) * Battle.disruptMultiplier(c.disrupts);
    const tag = mult > 1 ? '<span class="tag weak">弱点×2</span>' : mult < 1 ? '<span class="tag resist">耐性×½</span>' : '';
    const pen = live && c.started && (c.misses || c.disrupts)
      ? `<span class="tag penalty">${c.misses ? `ミス${c.misses}` : ''}${c.disrupts ? ` 乱れ${c.disrupts}` : ''}</span>` : '';
    return `威力 <strong class="num">${Math.round(v)}</strong>${tag}${pen}`;
  }

  function renderHand() {
    const c = state.cast;
    if (!c) return;
    const list = engine.cards();
    if (cardNodes.length !== list.length) buildCards();
    list.forEach((spell, i) => {
      const n = cardNodes[i];
      const m = c.matchers[i];
      const live = c.live.includes(i);
      if (n.spellId !== spell.id) {
        n.spellId = spell.id;
        // className を丸ごと書き換えると演出用クラス (renew 等) が消えるので属性クラスだけ差し替える
        n.node.classList.remove(...[...n.node.classList].filter((cls) => cls.startsWith('el-')));
        n.node.classList.add(`el-${spell.element}`);
        n.badge.innerHTML = elementBadge(spell.element);
        n.name.textContent = spell.name;
        n.meta.textContent = spell.role === 'attack'
          ? `${'★'.repeat(spell.tier)} ${spell.mpGain ? `MP+${spell.mpGain}` : `MP${spell.mp}`}`
          : `MP${spell.mp}${spell.cd ? ` / ${spell.cd}s` : ''}`;
      }
      const status = !c.started ? 'idle' : live ? 'live' : 'out';
      n.node.classList.toggle('idle', status === 'idle');
      n.node.classList.toggle('live', status === 'live');
      n.node.classList.toggle('out', status === 'out');
      const done = live ? m.pos : 0;
      n.kana.innerHTML = `<span class="done">${escapeHtml(m.text.slice(0, done))}</span>${escapeHtml(m.text.slice(done))}`;
      n.typed.textContent = live ? m.typed : '';
      n.rest.textContent = live ? m.remaining : spell.romaji;
      n.foot.innerHTML = cardFooter(spell, c, live);
      if (spell.role === 'attack') renderWear(n, state.attackAge[i]);
    });
    renderCooldowns();
  }

  /** 風化の進み具合 (使われずに過ぎた詠唱回数) */
  function renderWear(n, age) {
    const limit = HAND.weatherAfter;
    for (let k = 0; k <= limit; k++) n.node.classList.toggle(`wear-${k}`, k === age);
    n.wear.textContent = `${'●'.repeat(age)}${'○'.repeat(Math.max(0, limit - age))}`;
    n.wear.title = `あと${limit - age}回ほかの呪文を唱えると風化して入れ替わる`;
  }

  function renderRedraw() {
    const cd = state.cooldowns.redraw || 0;
    const ready = engine.canRedraw();
    dom.redrawTile.classList.toggle('disabled', !ready);
    dom.redrawCost.textContent = `MP${HAND.redraw.mp} / ${HAND.redraw.cd}s`;
    dom.redrawCd.textContent = cd > 0 ? fmtSec(cd) : !ready && state.phase === 'battle' ? 'MP不足' : '';
    dom.redrawTile.querySelector('.cd-veil').style.setProperty('--cd', cd > 0 ? cd / (HAND.redraw.cd * 1000) : 0);
  }

  function tryRedraw() {
    if (engine.redraw()) {
      flushEvents();
      renderFrame();
    } else {
      retrigger(dom.redrawTile, 'deny');
    }
  }

  /** リキャスト・MP不足の表示 (毎フレーム) */
  function renderCooldowns() {
    const list = engine.cards();
    list.forEach((spell, i) => {
      const n = cardNodes[i];
      if (!n) return;
      const cd = state.cooldowns[spell.id] || 0;
      const enabled = engine.isEnabled(spell);
      n.node.classList.toggle('disabled', !enabled);
      n.veil.style.setProperty('--cd', cd > 0 ? cd / (spell.cd * 1000) : 0);
      n.cdText.textContent = cd > 0 ? fmtSec(cd) : !enabled ? 'MP不足' : '';
    });
    renderRedraw();
  }

  // ---------- 描画 ----------

  function renderStatic() {
    const e = state.enemy;
    const d = DIFFICULTIES[state.difficulty];
    dom.diffLabel.textContent = d.label;
    dom.diffLabel.className = `diff-label diff-${state.difficulty}`;
    if (!e) return;
    dom.stageLabel.textContent = `STAGE ${state.stage + 1} / ${ENEMIES.length}`;
    dom.enemyName.textContent = e.name;
    dom.enemyElement.className = `badge el-${e.element}`;
    dom.enemyElement.textContent = `${ELEMENTS[e.element].icon}${ELEMENTS[e.element].name}`;
    dom.enemySprite.textContent = e.def.sprite;
  }

  function renderFrame() {
    const e = state.enemy;
    const p = state.player;
    if (!e) return;

    dom.enemySprite.classList.toggle('dead', e.hp <= 0);
    dom.enemyHpFill.style.width = `${(e.hp / e.maxHp) * 100}%`;
    dom.enemyHpText.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}`;
    const phaseName = e.def.phases.length > 1 ? (e.def.phases[e.phaseIndex].name || 'フェーズ1') : '';
    dom.enemyPhase.textContent = phaseName;
    dom.enemyPhase.style.visibility = phaseName ? 'visible' : 'hidden';
    dom.enrageTime.textContent = fmtClock(e.enrageLeft);
    dom.enrageTime.parentElement.classList.toggle('danger', e.enrageLeft < 20000);

    const cast = e.cast;
    if (cast) {
      const type = ABILITY_TYPES[cast.ability.type];
      dom.bossCast.className = `boss-cast casting type-${cast.ability.type}`;
      dom.castType.textContent = type.label;
      dom.castName.textContent = cast.ability.name;
      dom.castHint.textContent = type.hint;
      dom.castFill.style.width = `${Math.min(1, cast.elapsed / cast.duration) * 100}%`;
      dom.castTime.textContent = fmtSec(cast.duration - cast.elapsed);
    } else {
      dom.bossCast.className = 'boss-cast';
      dom.castType.textContent = '待機';
      dom.castName.textContent = '…';
      dom.castHint.textContent = '';
      dom.castFill.style.width = '0%';
      dom.castTime.textContent = '';
    }
    const next = DIFFICULTIES[state.difficulty].showNext ? engine.upcoming(2) : [];
    dom.nextLine.textContent = next.length ? `NEXT ▸ ${next.map((a) => a.name).join(' ▸ ')}` : '';

    dom.playerHpFill.style.width = `${(Math.max(0, p.hp) / p.maxHp) * 100}%`;
    dom.playerHpFill.classList.toggle('low', p.hp / p.maxHp <= 0.3);
    dom.playerHpText.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    dom.playerMpFill.style.width = `${(p.mp / p.maxMp) * 100}%`;
    dom.playerMpText.textContent = `${Math.floor(p.mp)} / ${p.maxMp}`;

    for (const node of dom.statusRow.children) {
      const key = node.dataset.status;
      const eff = p[key];
      node.classList.toggle('on', !!eff);
      if (!eff) continue;
      const num = node.querySelector('.num');
      if (num) num.textContent = fmtSec(eff.remaining);
      const label = node.querySelector('.label');
      if (label) label.textContent = eff.name;
    }

    renderCooldowns();
    renderStats();
  }

  function renderStats() {
    const s = state.stats;
    const total = s.correct + s.miss;
    dom.combo.textContent = state.combo;
    dom.kpm.textContent = s.activeMs > 0 ? Math.round(s.correct / (s.activeMs / 60000)) : 0;
    dom.acc.textContent = total ? `${((s.correct / total) * 100).toFixed(1)}%` : '-';
    dom.int.textContent = s.interrupts;
  }

  function renderLog() {
    const items = [];
    for (let i = 0; i < LOG_MAX; i++) {
      const t = ui.log[i];
      items.push(`<li class="${i === 0 ? 'latest' : ''}">${t ? escapeHtml(t) : '&nbsp;'}</li>`);
    }
    dom.log.innerHTML = items.join('');
  }

  function statsHtml() {
    const s = state.stats;
    const total = s.correct + s.miss;
    const kpm = s.activeMs > 0 ? Math.round(s.correct / (s.activeMs / 60000)) : 0;
    const acc = total ? ((s.correct / total) * 100).toFixed(1) : '0.0';
    return `<dl class="stats result">
      <dt>総ダメージ</dt><dd class="num">${s.damage}</dd>
      <dt>最大コンボ</dt><dd class="num">${s.maxCombo}</dd>
      <dt>中断成功</dt><dd class="num">${s.interrupts}</dd>
      <dt>詠唱が途切れた</dt><dd class="num">${s.broken}</dd>
      <dt>KPM</dt><dd class="num">${kpm}</dd>
      <dt>正確率</dt><dd class="num">${acc}%</dd>
    </dl>`;
  }

  /** 次の敵のタイムライン (予習用) */
  function timelineHtml(def) {
    const level = DIFFICULTIES[state.difficulty].level;
    const rows = def.phases.map((ph, i) => {
      const ids = window.Engine.resolveTimeline(ph.timeline, level);
      const label = def.phases.length > 1 ? `${ph.name || 'フェーズ1'}${i > 0 ? `（HP${Math.round(def.phases[i - 1].until * 100)}%以下）` : ''}` : '';
      const items = ids.map((id) => {
        const a = def.abilities[id];
        return `<span class="tl-item type-${a.type}" title="${ABILITY_TYPES[a.type].label}">${escapeHtml(a.name)}</span>`;
      }).join('<span class="tl-arrow">▸</span>');
      return `<div class="tl-row">${label ? `<div class="tl-phase">${escapeHtml(label)}</div>` : ''}<div class="tl-items">${items}</div></div>`;
    }).join('');
    return `<div class="timeline"><h3>${escapeHtml(def.name)} のタイムライン</h3>${rows}
      <p class="note">${escapeHtml(def.text)}</p></div>`;
  }

  // ---------- オーバーレイ ----------

  function showOverlay(html) {
    dom.overlayContent.innerHTML = html;
    dom.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    dom.overlay.classList.add('hidden');
  }

  function showTitle() {
    const buttons = DIFFICULTY_ORDER.map((key, i) => {
      const d = DIFFICULTIES[key];
      return `<button type="button" class="diff-btn diff-${key} ${i === ui.selected ? 'selected' : ''}" data-index="${i}">
        <span class="diff-key">${i + 1}</span>${d.label}</button>`;
    }).join('');
    const sel = DIFFICULTIES[DIFFICULTY_ORDER[ui.selected]];
    showOverlay(`
      <h2 class="title">呪文詠唱タイピングRPG</h2>
      <p>呪文を<strong>ローマ字で詠唱</strong>し、ボスの技に対応しながら倒そう。</p>
      <ul class="rules">
        <li><strong>攻撃</strong>：★は MP 回復、★★★は高威力だが MP を大きく消費。</li>
        <li><strong>ボスの詠唱バー</strong>を見て対応：<span class="tl-item type-buster">タンクバスター</span>は<strong>守りの盾</strong>、
          <span class="tl-item type-interruptible">中断可能</span>は<strong>黙れ</strong>、<span class="tl-item type-dot">継続ダメージ</span>は<strong>浄化</strong>、
          <span class="tl-item type-raidwide">全体攻撃</span>の後は回復。</li>
        <li>詠唱中に大技を受けると<strong>詠唱が途切れる</strong>。間に合うかを見極めよう。</li>
        <li>⏱ が 0 になると<strong>時間切れ（全滅技）</strong>。守ってばかりでは勝てない。</li>
      </ul>
      <div class="diff-select">${buttons}</div>
      <p class="diff-desc">${escapeHtml(sel.desc)}</p>
      <p class="blink"><kbd>←</kbd><kbd>→</kbd> / <kbd>1</kbd>〜<kbd>4</kbd> で難易度を選び、<kbd>Space</kbd> で開始</p>`);
    dom.overlayContent.querySelectorAll('.diff-btn').forEach((b) => {
      b.addEventListener('click', () => { selectDifficulty(Number(b.dataset.index)); start(); });
    });
  }

  function selectDifficulty(i) {
    ui.selected = (i + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length;
    engine.setDifficulty(DIFFICULTY_ORDER[ui.selected]);
    saveDifficulty(state.difficulty);
    showTitle();
    renderStatic();
  }

  function start() {
    engine.setDifficulty(DIFFICULTY_ORDER[ui.selected]);
    ui.log = [];
    engine.startRun();
    afterStageStart();
  }

  function afterStageStart() {
    hideOverlay();
    buildCards();
    renderStatic();
    flushEvents();
    renderHand();
    renderFrame();
    renderLog();
  }

  function showStageClear() {
    const r = state.result;
    const next = ENEMIES[state.stage + 1];
    showOverlay(`
      <h2>${escapeHtml(state.enemy.name)}を倒した！</h2>
      <p>残り時間 <strong class="num">${fmtClock(r.timeLeft)}</strong> ／ 残りHP <strong class="num">${Math.ceil(r.hp)}</strong></p>
      ${timelineHtml(next)}
      <p class="blink"><kbd>Space</kbd> で次の戦いへ（HP・MPは全快）</p>`);
  }

  function showAllClear() {
    showOverlay(`
      <h2>全ての魔物を討伐した！</h2>
      <p>難易度 <strong>${DIFFICULTIES[state.difficulty].label}</strong> クリア</p>
      ${statsHtml()}
      <p class="blink"><kbd>Space</kbd> でタイトルへ</p>`);
  }

  function defeatTip() {
    const r = state.result;
    const hit = state.lastHit;
    if (r.reason === 'enrage') return '時間切れ。回復や防御に偏りすぎず、MPを循環させて火力を出そう。';
    if (r.reason === 'dot') return '継続ダメージで倒れた。「浄化」で解除しよう。';
    if (!hit) return '';
    if (hit.type === 'buster') return `「${hit.name}」はタンクバスター。着弾前に「守りの盾」を張ろう。`;
    if (hit.type === 'interruptible' || state.player.vuln) return '中断可能技は「黙れ」で止めよう。失敗すると被ダメージが増える。';
    if (hit.type === 'raidwide') return '全体攻撃の前にHPを戻しておこう。「再生の祈り」は先に置いておくと効率的。';
    return 'HPが減ったら早めに回復しよう。';
  }

  function showGameOver() {
    const r = state.result;
    const pct = Math.round((r.enemyHp / state.enemy.maxHp) * 100);
    showOverlay(`
      <h2 class="lose">${r.reason === 'enrage' ? '時間切れ…' : '力尽きた…'}</h2>
      <p>${escapeHtml(state.enemy.name)} の残りHP <strong class="num">${pct}%</strong></p>
      <p class="tip">💡 ${escapeHtml(defeatTip())}</p>
      ${timelineHtml(state.enemy.def)}
      <p class="blink"><kbd>Space</kbd> で再挑戦</p>
      <p><kbd>Esc</kbd> でタイトルへ</p>`);
  }

  function pause() {
    if (state.phase !== 'battle' || ui.paused) return;
    ui.paused = true;
    showOverlay('<h2>一時停止中</h2><p class="blink"><kbd>Space</kbd> で再開</p>');
  }

  function resume() {
    ui.paused = false;
    hideOverlay();
  }

  // ---------- イベント反映 ----------

  function flushEvents() {
    let handDirty = false;
    let logDirty = false;
    for (const ev of engine.drain()) {
      switch (ev.type) {
        case 'log':
          ui.log.unshift(ev.text);
          ui.log.length = Math.min(ui.log.length, LOG_MAX);
          logDirty = true;
          break;
        case 'key':
          Sfx.key();
          handDirty = true;
          break;
        case 'miss':
          Sfx.miss();
          retrigger(dom.hand, 'miss-flash');
          handDirty = true;
          break;
        case 'enemyHit':
          floatText(dom.enemyFx, String(ev.amount), `dmg ${ev.tag}`);
          if (ev.tag === 'weak') floatText(dom.enemyFx, '弱点！', 'label weak', 120);
          if (ev.tag === 'resist') floatText(dom.enemyFx, 'いまひとつ…', 'label resist', 120);
          retrigger(dom.enemySprite, `hit-${ev.element}`);
          Sfx.cast(ev.tag === 'weak');
          handDirty = true;
          break;
        case 'heal':
          floatText(dom.playerFx, `+${ev.amount}`, 'heal');
          Sfx.heal();
          handDirty = true;
          break;
        case 'buff':
          floatText(dom.playerFx, ev.spell.name, 'buff');
          Sfx.heal();
          handDirty = true;
          break;
        case 'fizzle':
          floatText(dom.playerFx, '効果なし', 'buff');
          handDirty = true;
          break;
        case 'interrupted':
          floatText(dom.enemyFx, '中断！', 'label weak');
          Sfx.cast(true);
          handDirty = true;
          break;
        case 'playerHit': {
          const heavy = ev.abilityType !== 'auto' && ev.abilityType !== 'dot';
          floatText(dom.playerFx, `-${ev.amount}${ev.blocked ? ' 🛡️' : ''}`, heavy ? 'hurt heavy' : 'hurt');
          retrigger(document.body, heavy && !ev.blocked ? 'flash-heavy' : 'flash');
          retrigger(dom.enemySprite, 'lunge');
          Sfx.hurt(heavy);
          handDirty = true;
          break;
        }
        case 'weathered': {
          const n = cardNodes[ev.slot];
          if (n) retrigger(n.node, 'renew', 700);
          handDirty = true;
          break;
        }
        case 'redraw':
          cardNodes.slice(0, 3).forEach((n) => retrigger(n.node, 'renew', 700));
          Sfx.key();
          handDirty = true;
          break;
        case 'castBroken':
          floatText(dom.playerFx, '詠唱中断！', 'hurt');
          handDirty = true;
          break;
        case 'enemyCast':
          if (ev.ability.type !== 'auto') Sfx.warn();
          break;
        case 'phase':
          floatText(dom.enemyFx, `〈${ev.name}〉`, 'label phase');
          break;
        case 'win':
          Sfx.win();
          break;
        case 'lose':
          Sfx.lose();
          break;
      }
    }
    if (logDirty) renderLog();
    if (handDirty) renderHand();
    if (state.phase === 'stageClear' && !ui.overlayShown) { ui.overlayShown = true; renderFrame(); showStageClear(); }
    if (state.phase === 'allClear' && !ui.overlayShown) { ui.overlayShown = true; renderFrame(); showAllClear(); }
    if (state.phase === 'gameover' && !ui.overlayShown) { ui.overlayShown = true; renderFrame(); showGameOver(); }
    if (state.phase === 'battle') ui.overlayShown = false;
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
  function retrigger(node, cls, ms = 450) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms);
  }

  // ---------- ループ ----------

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;
    if (state.phase === 'battle' && !ui.paused) {
      engine.tick(dt);
      flushEvents();
      renderFrame();
    }
    requestAnimationFrame(frame);
  }

  // ---------- 入力 ----------

  const TYPABLE = /^[a-z0-9\-',.!?]$/i;

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
      dom.imeWarning.classList.add('show');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    dom.imeWarning.classList.remove('show');
    Sfx.unlock();

    const key = e.key;
    const confirm = key === ' ' || key === 'Enter';

    if (key === 'Tab') e.preventDefault(); // フォーカス移動させない
    if (state.phase === 'battle' && !ui.paused) {
      if (key === 'Tab') {
        if (!e.repeat) tryRedraw();
      } else if (key === 'Escape' || key === 'Backspace') {
        e.preventDefault();
        engine.cancelCast();
        flushEvents();
        renderHand();
      } else if (TYPABLE.test(key)) {
        e.preventDefault();
        engine.key(key.toLowerCase());
        flushEvents();
        renderStats();
      } else if (confirm) {
        e.preventDefault();
      }
      return;
    }

    if (confirm) e.preventDefault();
    if (e.repeat) return;
    if (ui.paused) {
      if (confirm) resume();
      return;
    }
    switch (state.phase) {
      case 'title':
        if (confirm) start();
        else if (key === 'ArrowLeft') selectDifficulty(ui.selected - 1);
        else if (key === 'ArrowRight') selectDifficulty(ui.selected + 1);
        else if (/^[1-4]$/.test(key)) selectDifficulty(Number(key) - 1);
        break;
      case 'stageClear':
        if (confirm) { engine.nextStage(); afterStageStart(); }
        break;
      case 'allClear':
        if (confirm) toTitle();
        break;
      case 'gameover':
        if (confirm) { engine.retryStage(); afterStageStart(); }
        else if (key === 'Escape') toTitle();
        break;
    }
  });

  function toTitle() {
    state.phase = 'title';
    showTitle();
  }

  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  dom.redrawTile.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (state.phase === 'battle' && !ui.paused) tryRedraw();
  });

  dom.sound.addEventListener('click', (e) => {
    dom.sound.textContent = Sfx.toggle() ? '🔊' : '🔇';
    e.currentTarget.blur();
  });

  // タイトル画面の背後にも最初の敵を描いておく (レイアウトを確定させる)
  engine.startStage(0);
  engine.drain();
  state.phase = 'title';
  buildCards();
  renderStatic();
  renderHand();
  renderFrame();
  renderLog();
  showTitle();
  requestAnimationFrame(frame);

  // デバッグ・自動検証用
  window.TypingRPG = { engine };
})();
