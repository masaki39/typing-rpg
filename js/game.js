/*
 * 画面描画とキー入力 (戦闘ロジックは engine.js)
 * 依存: Engine, GameData, Battle, Sfx, Sprites (いずれも window グローバル。Sprites は無くても動く)
 */
(function () {
  'use strict';

  const { ENEMIES, KINDS, DIFFICULTIES, DIFFICULTY_ORDER, ABILITY_TYPES } = window.GameData;
  const { Battle, Sfx } = window;
  const Sprites = window.Sprites || { svg: () => '' };

  // ---------- 保存データ (設定・記録) ----------

  const STORE = { difficulty: 'typing-rpg:difficulty', settings: 'typing-rpg:settings', records: 'typing-rpg:records' };

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; } // 保存できない環境・壊れたデータは既定値
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ }
  }

  function loadDifficulty() {
    let v = null;
    try { v = localStorage.getItem(STORE.difficulty); } catch (e) { /* noop */ }
    // 旧版は文字列をそのまま保存していた
    if (v && v.startsWith('"')) v = load(STORE.difficulty, null);
    return v && DIFFICULTIES[v] ? v : 'normal';
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEFAULT_SETTINGS = { master: 0.8, bgm: 0.5, sfx: 0.8, muted: false, reduceMotion: prefersReducedMotion, shake: true };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const settings = { ...DEFAULT_SETTINGS };
  const savedSettings = load(STORE.settings, {});
  if (isObj(savedSettings)) {
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      const v = savedSettings[k];
      if (typeof def === 'boolean' && typeof v === 'boolean') settings[k] = v;
      if (typeof def === 'number' && Number.isFinite(v)) settings[k] = Math.max(0, Math.min(1, v));
    }
  }
  const savedRecords = load(STORE.records, {});
  const records = isObj(savedRecords) ? savedRecords : {};

  const engine = window.Engine.createEngine({ difficulty: loadDifficulty() });
  const state = engine.state;

  const LOG_MAX = 7;
  const TIMELINE_ROWS = 4;
  const INTRO_MS = 2000; // ステージ開始の「READY」演出
  const RESULT_DELAY = { win: 1300, lose: 1100 }; // 撃破・敗北の演出を見せてから結果を出す
  const RANK_ORDER = ['S', 'A', 'B', 'C'];

  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'), diffLabel: $('diff-label'), stageLabel: $('stage-label'), sound: $('sound-toggle'),
    pauseBtn: $('pause-btn'),
    enemyName: $('enemy-name'), enemyPhase: $('enemy-phase'), enemyArea: $('enemy-area'),
    enrage: $('enrage'), enrageTime: $('enrage-time'), enemySprite: $('enemy-sprite'),
    enemyHpFill: $('enemy-hp-fill'), enemyHpLag: $('enemy-hp-lag'), enemyHpText: $('enemy-hp-text'),
    bossCast: $('boss-cast'), castType: $('cast-type'), castName: $('cast-name'), castHint: $('cast-hint'),
    castFill: $('cast-fill'), castTime: $('cast-time'), timelineList: $('timeline-list'), tlHidden: $('tl-hidden'), enemyFx: $('enemy-fx'),
    playerHpFill: $('player-hp-fill'), playerHpLag: $('player-hp-lag'), playerHpText: $('player-hp-text'),
    playerMpFill: $('player-mp-fill'), playerMpText: $('player-mp-text'),
    statusRow: $('status-row'), playerFx: $('player-fx'),
    combo: $('stat-combo'), speed: $('stat-speed'), acc: $('stat-acc'), int: $('stat-int'),
    log: $('log'), hand: $('hand'), attackRow: $('attack-row'), skillRow: $('skill-row'),
    overlay: $('overlay'), overlayContent: $('overlay-content'), imeWarning: $('ime-warning'),
    chant: $('chant'), chantName: $('chant-name'), chantCandidates: $('chant-candidates'),
    chantTyped: $('chant-typed'), chantRest: $('chant-rest'), chantKana: $('chant-kana'),
    banner: $('banner'), bannerStage: $('banner-stage'), bannerName: $('banner-name'), bannerCall: $('banner-call'),
  };

  /*
   * UI 側の状態
   * screen: 何の画面か (キー入力の振り分けに使う)
   *   title | howto | settings | pause | battle | intro | outro | stageClear | allClear | gameover
   */
  const ui = {
    screen: 'title',
    selected: DIFFICULTY_ORDER.indexOf(state.difficulty),
    log: [],
    introMs: 0,
    outroMs: 0,
    howtoPage: 0,
    settingsFocus: 0,
    returnTo: 'title', // 設定・遊び方を閉じたときに戻る画面
    pauseFocus: 0,
    overlayAt: 0,
    lastDanger: 0,
    newRecord: false,
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmtSec = (ms) => `${Math.max(0, ms / 1000).toFixed(1)}s`;
  const fmtClock = (ms) => {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  /** 正しく打てたキー数/秒 (寿司打の「平均キータイプ数」と同じ定義) */
  const speedOf = (s) => (s.activeMs > 0 ? s.correct / (s.activeMs / 1000) : 0);
  const accOf = (s) => {
    const total = s.correct + s.miss;
    return total ? s.correct / total : 0;
  };

  /** Sfx の拡張 API が無い環境 (古い sfx.js) でも落ちないように呼ぶ */
  function sfx(name, ...args) {
    const fn = Sfx && Sfx[name];
    if (typeof fn === 'function') fn.apply(Sfx, args);
  }

  function bgm(track) {
    if (typeof Sfx.playBgm === 'function') Sfx.playBgm(track);
  }

  // ---------- 設定 ----------

  function applySettings() {
    if (typeof Sfx.setVolume === 'function') {
      Sfx.setVolume({ master: settings.muted ? 0 : settings.master, bgm: settings.bgm, sfx: settings.sfx });
    } else if (Sfx.enabled === settings.muted) {
      Sfx.toggle();
    }
    document.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
    dom.sound.textContent = settings.muted ? '🔇' : '🔊';
    dom.sound.setAttribute('aria-pressed', String(!settings.muted));
    save(STORE.settings, settings);
  }

  // ---------- 画面サイズ (固定レイアウトを拡大縮小して画面に収める) ----------

  const BASE_WIDTH = 1080;
  let baseHeight = 0;

  function fitToScreen() {
    if (!baseHeight) {
      dom.app.style.zoom = 1;
      baseHeight = dom.app.offsetHeight;
    }
    const scale = Math.min(window.innerWidth / BASE_WIDTH, window.innerHeight / baseHeight, 1.4);
    const z = Math.max(0.5, Math.floor(scale * 100) / 100);
    dom.app.style.zoom = z;
    document.documentElement.style.setProperty('--panel-zoom', Math.min(1, z * 1.1));
  }

  /** カードの色分けクラス (攻撃は★帯、支援は種類) */
  const cardClass = (spell) => (spell.role === 'attack' ? `tier-${spell.tier}` : `kind-${spell.kind}`);

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
        <header class="card-head"><span class="card-badge"></span><span class="card-meta num"></span></header>
        <div class="card-name"></div>
        <div class="card-kana"></div>
        <div class="card-romaji"><span class="typed"></span><span class="rest"></span></div>
        <footer class="card-foot"></footer>
        <div class="cd-veil"><span class="cd-text num"></span></div>`;
      (spell.role === 'attack' ? dom.attackRow : dom.skillRow).appendChild(node);
      const q = (sel) => node.querySelector(sel);
      return {
        node, spellId: null, badge: q('.card-badge'), meta: q('.card-meta'), name: q('.card-name'),
        kana: q('.card-kana'), typed: q('.typed'), rest: q('.rest'), foot: q('.card-foot'),
        veil: q('.cd-veil'), cdText: q('.cd-text'), i,
      };
    });
  }

  function cardFooter(spell, c, live) {
    if (spell.role !== 'attack') return escapeHtml(spell.desc);
    const p = state.player;
    let v = spell.value * (p.empower ? p.empower.mult : 1);
    if (live && c.started) v *= Battle.missMultiplier(c.misses);
    const boost = p.empower ? `<span class="tag boost">漲れ×${p.empower.mult}</span>` : '';
    const pen = live && c.started && c.misses ? `<span class="tag penalty">ミス${c.misses}</span>` : '';
    return `威力 <strong>${Math.round(v)}</strong>${boost}${pen}`;
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
        // className を丸ごと書き換えると演出用クラス (renew 等) が消えるので色分けクラスだけ差し替える
        n.node.classList.remove(...[...n.node.classList].filter((cls) => /^(tier|kind)-/.test(cls)));
        n.node.classList.add(cardClass(spell));
        n.badge.innerHTML = spell.role === 'attack'
          ? `<span class="card-tier">${'★'.repeat(spell.tier)}</span>`
          : `<i class="card-icon">${KINDS[spell.kind].icon}</i>`;
        n.name.textContent = spell.name;
        n.node.title = spell.desc || '';
        n.meta.innerHTML = spell.role === 'attack'
          ? (spell.mpGain ? `<span class="gain">MP+${spell.mpGain}</span>` : `<span class="mp">MP ${spell.mp}</span>`)
          : `<span class="mp">MP ${spell.mp}</span>${spell.cd ? ` · ${spell.cd}s` : ''}`;
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
    });
    renderChant();
    renderCooldowns();
  }

  /** 詠唱ライン: 入力中の呪文を大きく表示 (候補が複数なら先頭の候補で表示) */
  function renderChant() {
    const c = state.cast;
    const list = engine.cards();
    const active = c.started && c.live.length > 0;
    dom.chant.classList.toggle('active', active);
    if (!active) {
      dom.chantName.textContent = '詠唱待機';
      dom.chantCandidates.textContent = '打ち始めた文字で呪文が決まる';
      dom.chantTyped.textContent = '';
      dom.chantRest.textContent = '— 呪文を唱えよ —';
      dom.chantKana.textContent = '';
      return;
    }
    const i = c.live[0];
    const m = c.matchers[i];
    dom.chantName.textContent = c.live.length === 1 ? list[i].name : `${list[i].name} ほか`;
    dom.chantCandidates.textContent = c.live.length === 1 ? (c.misses ? `ミス ${c.misses}` : '') : `候補 ${c.live.length}`;
    dom.chantTyped.textContent = m.typed;
    dom.chantRest.textContent = m.remaining;
    dom.chantKana.innerHTML = `<span class="done">${escapeHtml(m.text.slice(0, m.pos))}</span>${escapeHtml(m.text.slice(m.pos))}`;
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
  }

  // ---------- 描画 ----------

  function renderStatic() {
    const e = state.enemy;
    const d = DIFFICULTIES[state.difficulty];
    dom.diffLabel.textContent = d.label;
    dom.diffLabel.className = `chip diff-${state.difficulty}`;
    if (!e) return;
    dom.stageLabel.textContent = `STAGE ${state.stage + 1}/${ENEMIES.length}`;
    dom.enemyName.textContent = e.name;
    const svg = Sprites.svg(e.def.id);
    dom.enemySprite.innerHTML = svg || `<span class="emoji">${escapeHtml(e.def.sprite)}</span>`;
    dom.enemySprite.className = 'sprite';
    dom.enemyArea.dataset.enemy = e.def.id;
    dom.enemySprite.setAttribute('aria-label', e.name);
  }

  function setWidth(node, ratio) {
    node.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  function renderFrame() {
    const e = state.enemy;
    const p = state.player;
    if (!e) return;

    dom.enemySprite.classList.toggle('dead', e.hp <= 0);
    dom.enemySprite.classList.toggle('enraged', e.enraged);
    for (let k = 1; k <= 3; k++) dom.enemySprite.classList.toggle(`phase-${k}`, e.phaseIndex + 1 === k);
    setWidth(dom.enemyHpFill, e.hp / e.maxHp);
    setWidth(dom.enemyHpLag, e.hp / e.maxHp);
    dom.enemyHpText.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}  (${Math.ceil((e.hp / e.maxHp) * 100)}%)`;
    const phaseName = e.def.phases.length > 1 ? (e.def.phases[e.phaseIndex].name || 'フェーズ1') : '';
    dom.enemyPhase.textContent = phaseName;
    dom.enemyPhase.style.visibility = phaseName ? 'visible' : 'hidden';
    dom.enrageTime.textContent = fmtClock(e.enrageLeft);
    dom.enrage.classList.toggle('danger', e.enrageLeft < 20000);

    const cast = e.cast;
    if (cast) {
      const type = ABILITY_TYPES[cast.ability.type];
      dom.bossCast.className = `castbar casting type-${cast.ability.type}`;
      dom.castType.textContent = type.label;
      dom.castName.textContent = cast.ability.name;
      dom.castHint.textContent = type.hint;
      setWidth(dom.castFill, cast.elapsed / cast.duration);
      dom.castTime.textContent = fmtSec(cast.duration - cast.elapsed);
    } else {
      dom.bossCast.className = 'castbar';
      dom.castType.textContent = '待機';
      dom.castName.textContent = '—';
      dom.castHint.textContent = '';
      setWidth(dom.castFill, 0);
      dom.castTime.textContent = '';
    }
    renderTimeline();

    const hpRatio = Math.max(0, p.hp) / p.maxHp;
    setWidth(dom.playerHpFill, hpRatio);
    setWidth(dom.playerHpLag, hpRatio);
    dom.playerHpFill.classList.toggle('low', hpRatio <= 0.3);
    dom.playerHpText.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    setWidth(dom.playerMpFill, p.mp / p.maxMp);
    dom.playerMpText.textContent = `${Math.floor(p.mp)} / ${p.maxMp}`;
    const danger = state.phase === 'battle' && p.hp > 0 && hpRatio <= 0.3;
    document.body.classList.toggle('danger', danger);

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

  /** タイムライン: 詠唱中の技 + 次の技 (Hard 以上は次の技を伏せる) */
  function renderTimeline() {
    const e = state.enemy;
    if (dom.timelineList.children.length !== TIMELINE_ROWS) {
      dom.timelineList.innerHTML = '<li><span class="tl-marker"></span><span class="tl-name"></span><span class="tl-type"></span></li>'.repeat(TIMELINE_ROWS);
    }
    const rows = [];
    if (e.cast) rows.push({ ability: e.cast.ability, now: true });
    const showNext = DIFFICULTIES[state.difficulty].showNext;
    dom.tlHidden.hidden = showNext;
    for (const ability of engine.upcoming(TIMELINE_ROWS)) {
      if (rows.length >= TIMELINE_ROWS) break;
      rows.push(showNext ? { ability } : { unknown: true });
    }
    [...dom.timelineList.children].forEach((li, i) => {
      const r = rows[i];
      const [marker, name, type] = li.children;
      li.className = !r ? 'empty' : r.unknown ? 'unknown' : `type-${r.ability.type}${r.now ? ' now' : ''}`;
      marker.textContent = !r ? '' : r.now ? '▶' : '•';
      name.textContent = !r ? '' : r.unknown ? '？？？' : r.ability.name;
      type.textContent = r && !r.unknown ? ABILITY_TYPES[r.ability.type].label : '';
    });
  }

  function renderStats() {
    const s = state.stats;
    dom.combo.textContent = state.combo;
    dom.speed.textContent = speedOf(s).toFixed(1);
    dom.acc.textContent = s.correct + s.miss ? `${(accOf(s) * 100).toFixed(1)}%` : '-';
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

  // ---------- 記録 ----------

  function recordOf(key) {
    return isObj(records[key]) ? records[key] : {};
  }

  function betterRank(a, b) {
    if (!a) return b;
    if (!b) return a;
    return RANK_ORDER.indexOf(a) <= RANK_ORDER.indexOf(b) ? a : b;
  }

  /** 到達ステージ・クリア記録を更新。新記録なら true */
  function updateRecords({ cleared, stageCleared = cleared }) {
    const key = state.difficulty;
    const rec = { ...recordOf(key) };
    // reached: 到達した (挑戦できる) ステージの番号。最終面撃破時は面数と同じ
    rec.reached = Math.max(rec.reached || 0, state.stage + (stageCleared ? 1 : 0));
    let isNew = false;
    if (cleared) {
      const sum = engine.runSummary();
      const speed = speedOf(state.stats);
      if (!rec.cleared || sum.score > (rec.bestScore || 0)) {
        isNew = true;
        rec.bestScore = sum.score;
        rec.bestRank = betterRank(rec.bestRank, sum.rank);
        rec.bestStages = sum.results.map((r) => r.rank);
      }
      rec.bestRank = betterRank(rec.bestRank, sum.rank);
      rec.bestTime = Math.min(rec.bestTime || Infinity, sum.timeUsed);
      rec.bestSpeed = Math.max(rec.bestSpeed || 0, Math.round(speed * 10) / 10);
      rec.cleared = (rec.cleared || 0) + 1;
    }
    records[key] = rec;
    save(STORE.records, records);
    return isNew;
  }

  // ---------- オーバーレイの部品 ----------

  function statsHtml(s) {
    return `<dl class="stats result">
      <dt>与ダメージ</dt><dd class="num">${s.damage}</dd>
      <dt>最大コンボ</dt><dd class="num">${s.maxCombo}</dd>
      <dt>中断成功</dt><dd class="num">${s.interrupts}</dd>
      <dt>加護で防いだ</dt><dd class="num">${s.warded}</dd>
      <dt>打鍵速度</dt><dd class="num">${speedOf(s).toFixed(2)} 打/秒</dd>
      <dt>正確率</dt><dd class="num">${(accOf(s) * 100).toFixed(1)}%</dd>
    </dl>`;
  }

  function rankHtml(rank, label = '') {
    return `<div class="rank-badge rank-${rank}" aria-label="評価 ${rank}"><span class="rank-label">${label || 'RANK'}</span><span class="rank-letter">${rank}</span></div>`;
  }

  /** 次の敵のタイムライン (予習用) */
  function timelineHtml(def, heading) {
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
    return `<div class="timeline">
      <div class="timeline-head"><span class="mini-sprite" aria-hidden="true">${Sprites.svg(def.id) || escapeHtml(def.sprite)}</span>
      <h3>${escapeHtml(heading || `${def.name} のタイムライン`)}</h3></div>${rows}
      <p class="note">${escapeHtml(def.text)}</p></div>`;
  }

  /** キー操作のヒント付きボタン */
  const actionBtn = (action, label, key, extra = '') =>
    `<button type="button" class="menu-btn ${extra}" data-action="${action}">${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;

  // ---------- オーバーレイ ----------

  function showOverlay(html, cls = '') {
    ui.overlayAt = performance.now();
    dom.overlayContent.className = `overlay-panel ${cls}`;
    dom.overlayContent.innerHTML = html;
    dom.overlay.classList.remove('hidden');
    dom.overlay.setAttribute('aria-hidden', 'false');
    dom.overlayContent.scrollTop = 0;
  }

  function hideOverlay() {
    dom.overlay.classList.add('hidden');
    dom.overlay.setAttribute('aria-hidden', 'true');
  }

  function showTitle() {
    ui.screen = 'title';
    document.body.classList.remove('danger');
    const buttons = DIFFICULTY_ORDER.map((key, i) => {
      const d = DIFFICULTIES[key];
      const g = d.speedGuide;
      const rec = recordOf(key);
      const badge = rec.cleared
        ? `<span class="diff-rec cleared">CLEAR <b class="rank-${escapeHtml(rec.bestRank || 'C')}">${escapeHtml(rec.bestRank || '-')}</b></span>`
        : rec.reached ? `<span class="diff-rec">STAGE ${rec.reached + 1} まで</span>` : '<span class="diff-rec empty">—</span>';
      return `<button type="button" class="diff-btn diff-${key} ${i === ui.selected ? 'selected' : ''}" data-index="${i}" aria-pressed="${i === ui.selected}">
        <span class="diff-name"><span class="diff-key">${i + 1}</span>${d.label}</span>
        <span class="diff-speed num" title="全4面を再挑戦なしで通せる確率 50%〜80% の打鍵速度">${g.p50.toFixed(1)}〜${g.p80.toFixed(1)} 打/秒</span>
        ${badge}</button>`;
    }).join('');
    const selKey = DIFFICULTY_ORDER[ui.selected];
    const sel = DIFFICULTIES[selKey];
    const rec = recordOf(selKey);
    const recLine = rec.cleared
      ? `ベスト ${rec.bestScore || 0} 点 ／ 最速 ${fmtClock(rec.bestTime || 0)} ／ 最高 ${(rec.bestSpeed || 0).toFixed(1)} 打/秒 ／ クリア ${rec.cleared} 回`
      : 'まだクリア記録はありません';
    const firstTime = !Object.keys(records).length;
    const touch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    showOverlay(`
      <div class="title-mark" aria-hidden="true">✦</div>
      <h2 class="title">呪文詠唱タイピングRPG</h2>
      <p class="subtitle">TYPE · CHANT · SURVIVE</p>
      <p class="lead">呪文を<strong>ローマ字で詠唱</strong>し、ボスの技を読んで対応しながら4体の魔物を討伐せよ。</p>
      ${touch ? '<p class="notice">⌨ このゲームは物理キーボードで遊ぶ作品です。PC でのプレイを推奨します。</p>' : ''}
      <div class="diff-select" role="group" aria-label="難易度">${buttons}</div>
      <p class="diff-desc">${escapeHtml(sel.desc)}</p>
      <p class="diff-record num">${escapeHtml(recLine)}</p>
      <p class="diff-note">打/秒＝クリア率50〜80%の目安（正しく打てたキー数/秒。寿司打の「平均キータイプ数」相当）</p>
      <div class="menu-row">
        ${actionBtn('start', '冒険をはじめる', 'Space', 'primary')}
        ${actionBtn('howto', '遊び方', 'H', firstTime ? 'attention' : '')}
        ${actionBtn('settings', '設定', 'S')}
      </div>
      <p class="hint"><kbd>←</kbd><kbd>→</kbd> / <kbd>1</kbd>〜<kbd>4</kbd> 難易度 ・ 入力は<strong>半角英数（IMEオフ）</strong></p>`, 'title-panel');
    dom.overlayContent.querySelectorAll('.diff-btn').forEach((b) => {
      b.addEventListener('click', () => selectDifficulty(Number(b.dataset.index)));
      b.addEventListener('dblclick', () => start());
    });
    bindActions({ start, howto: () => showHowto(0, 'title'), settings: () => showSettings('title') });
    bgm('title');
  }

  function bindActions(map) {
    dom.overlayContent.querySelectorAll('[data-action]').forEach((b) => {
      const fn = map[b.dataset.action];
      if (fn) b.addEventListener('click', (e) => { e.currentTarget.blur(); sfx('confirm'); fn(); });
    });
  }

  function selectDifficulty(i) {
    const next = (i + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length;
    if (next !== ui.selected) sfx('select');
    ui.selected = next;
    engine.setDifficulty(DIFFICULTY_ORDER[ui.selected]);
    save(STORE.difficulty, state.difficulty);
    showTitle();
    renderStatic();
  }

  // ---------- 遊び方 ----------

  const HOWTO = [
    {
      title: '詠唱の基本',
      body: `
        <div class="demo-chant"><span class="demo-name">治癒の光</span><span class="num"><span class="typed">chiyuno</span>hikari</span></div>
        <ul class="rules">
          <li>手札の呪文を<strong>ローマ字で打つ</strong>と詠唱になり、打ち切ると発動します。</li>
          <li>最初の数文字で呪文が決まります。打った文字に合う呪文だけが光って残ります。</li>
          <li><kbd>shi</kbd>/<kbd>si</kbd>、<kbd>chi</kbd>/<kbd>ti</kbd>、<kbd>nn</kbd>/<kbd>n'</kbd> など、よくある綴りの揺れはすべて受け付けます。</li>
          <li>ミス 1 回ごとに威力 -10%。ノーミスで唱え続けると<strong>コンボ</strong>で威力が上がります（最大 +50%）。</li>
          <li>敵の攻撃を受けても、入力中の詠唱は途切れません。<kbd>Backspace</kbd> で詠唱を破棄できます。</li>
        </ul>`,
    },
    {
      title: '攻撃呪文と MP',
      body: `
        <div class="demo-cards">
          <div class="demo-card tier-1"><b>★</b><span>短い・MP を 10 回復</span></div>
          <div class="demo-card tier-2"><b>★★</b><span>中くらい・MP 18</span></div>
          <div class="demo-card tier-3"><b>★★★</b><span>長い・高威力・MP 40</span></div>
        </div>
        <ul class="rules">
          <li>上段の攻撃呪文は<strong>使った枠だけ</strong>入れ替わります。<strong>★で MP を貯めて★★★を撃つ</strong>のが基本の流れ。</li>
          <li>下段の支援呪文 6 枚は常に並びます。MP とリキャスト（再使用までの時間）に注意。</li>
        </ul>`,
    },
    {
      title: 'ボスの技を読む',
      body: `
        <p class="lead">ボスは<strong>詠唱バー</strong>に技名と種類を出してから技を放ちます。種類に合った呪文で対応しましょう。</p>
        <table class="howto-table">
          <tr><td><span class="tl-item type-raidwide">全体攻撃</span></td><td>大ダメージ。事前・事後に<strong>治癒の光</strong>／<strong>再生の祈り</strong>で回復</td></tr>
          <tr><td><span class="tl-item type-buster">タンクバスター</span></td><td>壁なしでは<strong>ほぼ即死</strong>。着弾前に<strong>守りの壁</strong></td></tr>
          <tr><td><span class="tl-item type-interruptible">中断可能</span></td><td>詠唱中に<strong>黙せよ</strong>で止める。先に唱えて「構え」ておくことも可</td></tr>
          <tr><td><span class="tl-item type-dot">継続ダメージ</span></td><td>着弾前の<strong>浄化</strong>で加護を張れば防げる。付いた後の解除も可</td></tr>
          <tr><td><span class="tl-item type-enrage">時間切れ</span></td><td>右上の <b>ENRAGE</b> が 0 になると全滅技。守ってばかりでは勝てない</td></tr>
        </table>
        <p class="note">壁は全体攻撃でも消費されます。バスターの直前に全体攻撃がある場合は張るタイミングに注意。</p>`,
    },
    {
      title: '画面と操作',
      body: `
        <table class="howto-table keys">
          <tr><td>ローマ字キー</td><td>詠唱</td></tr>
          <tr><td><kbd>Backspace</kbd></td><td>詠唱を破棄</td></tr>
          <tr><td><kbd>Space</kbd></td><td>決定（メニュー）</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>一時停止メニュー</td></tr>
        </table>
        <ul class="rules">
          <li>右上の <b>TIMELINE</b> に、詠唱中の技と次の技が並びます（Hard 以上は次の技が伏せられます）。</li>
          <li>撃破するとランク（S〜C）が付きます。残り時間・残り HP・正確率で決まります。</li>
          <li>負けてもその敵から再挑戦できます。結果画面でボスのタイムラインを予習しましょう。</li>
        </ul>`,
    },
  ];

  function showHowto(page, returnTo = ui.returnTo) {
    ui.screen = 'howto';
    ui.returnTo = returnTo;
    ui.howtoPage = Math.max(0, Math.min(HOWTO.length - 1, page));
    const p = HOWTO[ui.howtoPage];
    const dots = HOWTO.map((_, i) => `<span class="dot ${i === ui.howtoPage ? 'on' : ''}"></span>`).join('');
    const last = ui.howtoPage === HOWTO.length - 1;
    showOverlay(`
      <p class="kicker">遊び方 ${ui.howtoPage + 1} / ${HOWTO.length}</p>
      <h2>${p.title}</h2>
      <div class="howto-body">${p.body}</div>
      <div class="pager">${dots}</div>
      <div class="menu-row">
        ${actionBtn('prev', '前へ', '←', ui.howtoPage === 0 ? 'ghost-disabled' : '')}
        ${last ? actionBtn('close', '閉じる', 'Space', 'primary') : actionBtn('next', '次へ', '→', 'primary')}
      </div>
      <p class="hint"><kbd>Esc</kbd> で閉じる</p>`, 'howto-panel');
    bindActions({ prev: () => showHowto(ui.howtoPage - 1), next: () => showHowto(ui.howtoPage + 1), close: closeSub });
  }

  /** 遊び方・設定を閉じて元の画面に戻る */
  function closeSub() {
    if (ui.returnTo === 'pause') showPause(ui.pauseFocus);
    else showTitle();
  }

  // ---------- 設定 ----------

  const SETTING_ITEMS = [
    { key: 'master', label: '全体の音量', type: 'range' },
    { key: 'bgm', label: 'BGM', type: 'range' },
    { key: 'sfx', label: '効果音', type: 'range' },
    { key: 'muted', label: 'ミュート', type: 'toggle' },
    { key: 'shake', label: '画面の揺れ', type: 'toggle' },
    { key: 'reduceMotion', label: '演出を控えめにする', type: 'toggle' },
  ];

  function showSettings(returnTo = ui.returnTo) {
    ui.screen = 'settings';
    ui.returnTo = returnTo;
    const rows = SETTING_ITEMS.map((it, i) => {
      const v = settings[it.key];
      const control = it.type === 'range'
        ? `<input type="range" min="0" max="100" step="5" value="${Math.round(v * 100)}" data-key="${it.key}" aria-label="${it.label}"><span class="num val">${Math.round(v * 100)}</span>`
        : `<button type="button" class="toggle ${v ? 'on' : ''}" data-key="${it.key}" aria-pressed="${!!v}">${v ? 'ON' : 'OFF'}</button>`;
      return `<div class="setting ${i === ui.settingsFocus ? 'focus' : ''}" data-index="${i}"><span class="setting-label">${it.label}</span><span class="setting-ctl">${control}</span></div>`;
    }).join('');
    showOverlay(`
      <h2>設定</h2>
      <div class="settings">${rows}</div>
      <div class="menu-row">
        ${actionBtn('reset', '記録を消去', '', 'danger')}
        ${actionBtn('close', '戻る', 'Esc', 'primary')}
      </div>
      <p class="hint"><kbd>↑</kbd><kbd>↓</kbd> 項目 ・ <kbd>←</kbd><kbd>→</kbd> 調整 ・ <kbd>Space</kbd> 切り替え</p>`, 'settings-panel');
    dom.overlayContent.querySelectorAll('input[type=range]').forEach((input) => {
      input.addEventListener('input', () => {
        settings[input.dataset.key] = Number(input.value) / 100;
        input.nextElementSibling.textContent = input.value;
        applySettings();
      });
      input.addEventListener('change', () => { input.blur(); sfx('select'); });
    });
    dom.overlayContent.querySelectorAll('.toggle').forEach((b) => {
      b.addEventListener('click', () => { b.blur(); toggleSetting(b.dataset.key); });
    });
    bindActions({ close: closeSub, reset: confirmReset });
  }

  function toggleSetting(key) {
    settings[key] = !settings[key];
    applySettings();
    sfx('select');
    showSettings();
  }

  function adjustSetting(delta) {
    const it = SETTING_ITEMS[ui.settingsFocus];
    if (it.type === 'toggle') { toggleSetting(it.key); return; }
    settings[it.key] = Math.round(Math.max(0, Math.min(1, settings[it.key] + delta * 0.1)) * 100) / 100;
    applySettings();
    sfx('select');
    showSettings();
  }

  function confirmReset() {
    if (!window.confirm('クリア記録をすべて消去しますか？')) return;
    for (const k of Object.keys(records)) delete records[k];
    save(STORE.records, records);
    showSettings();
  }

  // ---------- 戦闘の開始と終了 ----------

  function start() {
    engine.setDifficulty(DIFFICULTY_ORDER[ui.selected]);
    save(STORE.difficulty, state.difficulty);
    ui.log = [];
    sfx('confirm');
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
    dom.enemySprite.classList.add('enter');
    // 開始演出の間は時間を止め、入力も受け付けない
    ui.screen = 'intro';
    ui.introMs = settings.reduceMotion ? INTRO_MS * 0.6 : INTRO_MS;
    dom.bannerStage.textContent = state.stage === ENEMIES.length - 1 ? 'FINAL STAGE' : `STAGE ${state.stage + 1}`;
    dom.bannerName.textContent = state.enemy.name;
    dom.bannerCall.textContent = 'READY…';
    dom.banner.className = 'banner show';
    bgm(state.stage === ENEMIES.length - 1 ? 'boss' : 'battle');
  }

  function updateIntro(dt) {
    const before = ui.introMs;
    ui.introMs -= dt;
    const goAt = 550;
    if (before > goAt && ui.introMs <= goAt) {
      dom.bannerCall.textContent = '詠唱開始！';
      dom.banner.classList.add('go');
      sfx('confirm');
    }
    if (ui.introMs <= 0) {
      dom.banner.className = 'banner';
      dom.enemySprite.classList.remove('enter');
      ui.screen = 'battle';
    }
  }

  /** 撃破・敗北の演出を見せたあとで結果画面へ */
  function updateOutro(dt) {
    ui.outroMs -= dt;
    if (ui.outroMs > 0) return;
    document.body.classList.remove('danger');
    if (state.phase === 'stageClear') showStageClear();
    else if (state.phase === 'allClear') showAllClear();
    else if (state.phase === 'gameover') showGameOver();
  }

  function scoreBreakdown(r) {
    const s = r.stats;
    return `<div class="result-grid">
      ${rankHtml(r.rank)}
      <dl class="stats result">
        <dt>スコア</dt><dd class="num score">${r.score}</dd>
        <dt>残り時間</dt><dd class="num">${fmtClock(r.timeLeft)}</dd>
        <dt>残り HP</dt><dd class="num">${Math.ceil(r.hp)}</dd>
        <dt>正確率</dt><dd class="num">${(accOf(s) * 100).toFixed(1)}%</dd>
        <dt>打鍵速度</dt><dd class="num">${speedOf(s).toFixed(2)} 打/秒</dd>
        <dt>最大コンボ</dt><dd class="num">${s.maxCombo}</dd>
      </dl></div>`;
  }

  function showStageClear() {
    ui.screen = 'stageClear';
    const r = state.result;
    const next = ENEMIES[state.stage + 1];
    updateRecords({ cleared: false, stageCleared: true });
    showOverlay(`
      <p class="kicker">STAGE ${state.stage + 1} CLEAR</p>
      <h2>${escapeHtml(state.enemy.name)}を倒した！</h2>
      ${scoreBreakdown(r)}
      ${timelineHtml(next, `次の敵：${next.name}`)}
      <div class="menu-row">${actionBtn('next', '次の戦いへ', 'Space', 'primary')}</div>
      <p class="hint">HP・MP は全快します ・ <kbd>Esc</kbd> タイトルへ</p>`, 'result-panel');
    bindActions({ next: () => { engine.nextStage(); afterStageStart(); } });
  }

  function showAllClear() {
    ui.screen = 'allClear';
    const sum = engine.runSummary();
    const isNew = updateRecords({ cleared: true });
    const rows = sum.results.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(ENEMIES[i].name)}</td>
      <td class="num">${fmtClock(r.timeUsed)}</td><td class="num">${r.score}</td><td><b class="rank-${r.rank}">${r.rank}</b></td></tr>`).join('');
    showOverlay(`
      <p class="kicker">ALL CLEAR — ${DIFFICULTIES[state.difficulty].label}</p>
      <h2 class="title">全ての魔物を討伐した！</h2>
      <div class="result-grid">
        ${rankHtml(sum.rank, 'TOTAL')}
        <div>
          <p class="total-score"><span class="num">${sum.score}</span> 点 ${isNew ? '<span class="new-record">NEW RECORD</span>' : ''}</p>
          <table class="stage-table"><thead><tr><th></th><th>ボス</th><th>時間</th><th>点</th><th>評価</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="note">再挑戦 ${sum.retries} 回${sum.retries ? `（-${sum.retries * 100} 点）` : ''} ・ 合計 ${fmtClock(sum.timeUsed)}</p>
        </div>
      </div>
      ${statsHtml(state.stats)}
      <div class="menu-row">${actionBtn('title', 'タイトルへ', 'Space', 'primary')}</div>`, 'result-panel');
    bindActions({ title: toTitle });
  }

  function defeatTip() {
    const r = state.result;
    const hit = state.lastHit;
    if (r.reason === 'enrage') return '時間切れ。回復や防御に偏りすぎず、★で MP を貯めて★★★で火力を出そう。';
    if (r.reason === 'dot') return '継続ダメージで倒れた。詠唱バーに「継続ダメージ」が出たら、着弾前に「浄化」を唱えれば加護で防げる。';
    if (!hit) return '';
    if (hit.type === 'buster') return `「${hit.name}」はタンクバスター。着弾前に「守りの壁」を。直前の全体攻撃で壁が消費されないよう注意。`;
    if (hit.type === 'interruptible' || state.player.vuln) return '中断可能技は「黙せよ」で止めよう。タイムラインに見えたら先に唱えて構えておける。';
    if (hit.type === 'raidwide') return '全体攻撃の前に HP を戻しておこう。「再生の祈り」は先に置いておくと効率的。';
    return 'HP が減ったら早めに回復しよう。';
  }

  function showGameOver() {
    ui.screen = 'gameover';
    const r = state.result;
    const pct = Math.round((r.enemyHp / state.enemy.maxHp) * 100);
    updateRecords({ cleared: false });
    showOverlay(`
      <h2 class="lose">${r.reason === 'enrage' ? '時間切れ…' : '力尽きた…'}</h2>
      <div class="defeat-hp"><span>${escapeHtml(state.enemy.name)} の残り HP</span>
        <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%"></div></div><strong class="num">${pct}%</strong></div>
      <p class="tip">💡 ${escapeHtml(defeatTip())}</p>
      ${timelineHtml(state.enemy.def)}
      <div class="menu-row">
        ${actionBtn('retry', '再挑戦', 'Space', 'primary')}
        ${actionBtn('title', 'タイトルへ', 'Esc')}
      </div>`, 'result-panel');
    bindActions({ retry: retry, title: toTitle });
  }

  /** 再挑戦。開始演出中の一時停止からのやり直しは、まだ戦っていないので減点しない */
  function retry({ penalty = true } = {}) {
    engine.retryStage({ penalty });
    afterStageStart();
  }

  function retryFromPause() {
    resumeAudio();
    retry({ penalty: ui.pausedFrom !== 'intro' });
  }

  function toTitle() {
    dom.banner.className = 'banner';
    showBackdrop();
    showTitle();
  }

  /** タイトル画面の背後に最初の敵を描いておく (レイアウトを確定させる) */
  function showBackdrop() {
    engine.startStage(0);
    engine.drain();
    state.phase = 'title';
    ui.log = [];
    buildCards();
    renderStatic();
    renderHand();
    renderFrame();
    renderLog();
  }

  // ---------- 一時停止 ----------

  function pause() {
    if (!['battle', 'intro'].includes(ui.screen)) return;
    ui.pausedFrom = ui.screen;
    showPause();
    sfx('pause');
    if (typeof Sfx.suspendBgm === 'function') Sfx.suspendBgm();
  }

  const PAUSE_ITEMS = [
    ['resume', '再開する'],
    ['retry', 'この敵に最初から挑む'],
    ['howto', '遊び方'],
    ['settings', '設定'],
    ['title', 'タイトルへ戻る'],
  ];

  function pauseActions() {
    return {
      resume, retry: retryFromPause, howto: () => showHowto(0, 'pause'),
      settings: () => showSettings('pause'), title: () => { resumeAudio(); toTitle(); },
    };
  }

  /*
   * 一時停止メニューは文字キーのショートカットを持たない
   * (自動で一時停止したあとに詠唱の続きを打っても、勝手にやり直し・タイトルへ戻らないように)
   */
  function showPause(focus = 0) {
    ui.screen = 'pause';
    ui.pauseFocus = focus;
    const items = PAUSE_ITEMS.map(([action, label], i) =>
      actionBtn(action, label, i === focus ? 'Space' : '', i === focus ? 'primary' : '')).join('');
    showOverlay(`
      <h2>一時停止中</h2>
      <p class="kicker">STAGE ${state.stage + 1} ・ ${escapeHtml(state.enemy.name)} ・ ${DIFFICULTIES[state.difficulty].label}</p>
      <div class="menu-col">${items}</div>
      <p class="hint"><kbd>↑</kbd><kbd>↓</kbd> 選択 ・ <kbd>Space</kbd> 決定 ・ <kbd>Esc</kbd> 再開</p>
      ${timelineHtml(state.enemy.def)}`, 'pause-panel');
    bindActions(pauseActions());
  }

  function resumeAudio() {
    if (typeof Sfx.resumeBgm === 'function') Sfx.resumeBgm();
  }

  function resume() {
    ui.screen = ui.pausedFrom || 'battle';
    hideOverlay();
    resumeAudio();
    lastTime = performance.now();
  }

  // ---------- イベント反映 ----------

  const BUFF_SFX = { barrier: 'barrier', cleanse: 'cleanse', regen: 'heal', interrupt: 'buff', buff: 'buff' };

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
          sfx('key', state.combo);
          handDirty = true;
          break;
        case 'miss':
          sfx('miss');
          retrigger(dom.chant, 'miss', 300);
          handDirty = true;
          break;
        case 'enemyHit': {
          const big = ev.tier === 3 || ev.empowered;
          floatText(dom.enemyFx, String(ev.amount), big ? 'dmg big' : 'dmg');
          burst(dom.enemyFx, `tier-${ev.tier}${ev.empowered ? ' empowered' : ''}`);
          retrigger(dom.enemySprite, 'hit');
          if (big) shake('small');
          if (typeof Sfx.complete === 'function') Sfx.complete(ev.tier); else sfx('cast', ev.tier === 3);
          if (state.combo > 0 && state.combo % 5 === 0) {
            floatText(dom.enemyFx, `${state.combo} COMBO!`, 'label combo', 120);
            sfx('combo', state.combo);
          }
          handDirty = true;
          break;
        }
        case 'heal':
          floatText(dom.playerFx, `+${ev.amount}`, 'heal');
          retrigger(dom.playerHpFill, 'glow', 600);
          sfx('heal');
          handDirty = true;
          break;
        case 'buff':
          floatText(dom.playerFx, ev.spell.name, 'buff');
          sfx(BUFF_SFX[ev.spell.role] || 'buff');
          handDirty = true;
          break;
        case 'warded':
          floatText(dom.playerFx, '加護！', 'buff');
          sfx('cleanse');
          break;
        case 'interrupted':
          floatText(dom.enemyFx, '中断！', 'label good');
          burst(dom.enemyFx, 'interrupt');
          if (typeof Sfx.interrupt === 'function') Sfx.interrupt(); else sfx('cast', true);
          handDirty = true;
          break;
        case 'playerHit': {
          const heavy = ev.abilityType !== 'auto' && ev.abilityType !== 'dot';
          floatText(dom.playerFx, `-${ev.amount}${ev.blocked ? ' ◆' : ''}`, heavy ? 'hurt heavy' : 'hurt');
          retrigger(document.body, heavy && !ev.blocked ? 'flash-heavy' : 'flash');
          retrigger(dom.enemySprite, 'lunge');
          if (heavy) shake(ev.blocked ? 'small' : 'big');
          sfx('hurt', heavy);
          handDirty = true;
          break;
        }
        case 'enemyCast':
          if (ev.ability.type !== 'auto') sfx('warn');
          if (ev.ability.type !== 'auto') retrigger(dom.bossCast, 'appear', 500);
          break;
        case 'phase':
          floatText(dom.enemyFx, `〈${ev.name}〉`, 'label phase');
          retrigger(dom.enemyArea, 'phase-shift', 900);
          shake('small');
          sfx('phase');
          break;
        case 'win':
          sfx('win');
          bgm('clear');
          beginOutro(RESULT_DELAY.win);
          break;
        case 'lose':
          sfx('lose');
          bgm('gameover');
          beginOutro(RESULT_DELAY.lose);
          break;
      }
    }
    if (logDirty) renderLog();
    if (handDirty) renderHand();
  }

  function beginOutro(ms) {
    ui.screen = 'outro';
    ui.outroMs = ms;
    renderFrame();
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

  /** 呪文の着弾エフェクト (リングと火花) */
  function burst(layer, cls) {
    if (settings.reduceMotion) return;
    const node = document.createElement('div');
    node.className = `burst ${cls}`;
    node.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>';
    node.addEventListener('animationend', (e) => { if (e.target === node) node.remove(); });
    layer.appendChild(node);
  }

  function shake(size) {
    if (!settings.shake || settings.reduceMotion) return;
    retrigger(dom.app, `shake-${size}`, size === 'big' ? 420 : 260);
  }

  /** CSS アニメーションを毎回再生し直す */
  function retrigger(node, cls, ms = 450) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    clearTimeout(node[`_t_${cls}`]);
    node[`_t_${cls}`] = setTimeout(() => node.classList.remove(cls), ms);
  }

  /** HP が危険域、または時間切れ間近のときの鼓動音 */
  function updateDanger(now) {
    const p = state.player;
    const e = state.enemy;
    const low = p.hp > 0 && p.hp / p.maxHp <= 0.3;
    const late = e.enrageLeft < 10000 && !e.enraged;
    if ((low || late) && now - ui.lastDanger > (low ? 900 : 1000)) {
      ui.lastDanger = now;
      sfx('danger');
    }
  }

  // ---------- ループ ----------

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;
    if (ui.screen === 'intro') {
      updateIntro(dt);
      renderFrame();
    } else if (ui.screen === 'battle') {
      if (state.phase === 'battle') engine.tick(dt);
      flushEvents();
      renderFrame();
      if (state.phase === 'battle') updateDanger(now);
    } else if (ui.screen === 'outro') {
      updateOutro(dt);
    }
    requestAnimationFrame(frame);
  }

  // ---------- 入力 ----------

  const TYPABLE = /^[a-z0-9\-',.!?]$/i;

  function onBattleKey(e) {
    const key = e.key;
    if (key === 'Escape') {
      e.preventDefault();
      if (!e.repeat) pause();
      return;
    }
    if (ui.screen === 'intro') {
      if (key === ' ' || key === 'Backspace' || TYPABLE.test(key)) e.preventDefault();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
    } else if (key === 'Backspace') {
      e.preventDefault();
      engine.cancelCast();
      flushEvents();
      renderHand();
    } else if (TYPABLE.test(key)) {
      e.preventDefault();
      engine.key(key.toLowerCase());
      flushEvents();
      renderStats();
    } else if (key === 'Enter') {
      e.preventDefault();
    }
  }

  function onMenuKey(e) {
    const key = e.key;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const confirm = key === ' ' || key === 'Enter';
    if (confirm || key.startsWith('Arrow')) e.preventDefault();
    // 戦闘中のキーを押し続けた勢いで結果画面を飛ばさないよう少し待つ
    if (e.repeat && !key.startsWith('Arrow')) return;
    if (performance.now() - ui.overlayAt < 450 && ['stageClear', 'allClear', 'gameover'].includes(ui.screen)) return;

    switch (ui.screen) {
      case 'title':
        if (confirm) start();
        else if (key === 'ArrowLeft') selectDifficulty(ui.selected - 1);
        else if (key === 'ArrowRight') selectDifficulty(ui.selected + 1);
        else if (/^[1-4]$/.test(key)) selectDifficulty(Number(key) - 1);
        else if (k === 'h' || key === '?') { sfx('confirm'); showHowto(0, 'title'); }
        else if (k === 's') { sfx('confirm'); showSettings('title'); }
        break;
      case 'howto':
        if (key === 'ArrowLeft' && ui.howtoPage > 0) { sfx('select'); showHowto(ui.howtoPage - 1); }
        else if ((key === 'ArrowRight' || confirm) && ui.howtoPage < HOWTO.length - 1) { sfx('select'); showHowto(ui.howtoPage + 1); }
        else if (confirm || key === 'Escape' || key === 'Backspace') { sfx('confirm'); closeSub(); }
        break;
      case 'settings':
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          ui.settingsFocus = (ui.settingsFocus + (key === 'ArrowUp' ? -1 : 1) + SETTING_ITEMS.length) % SETTING_ITEMS.length;
          sfx('select');
          showSettings();
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
          adjustSetting(key === 'ArrowLeft' ? -1 : 1);
        } else if (confirm) {
          const it = SETTING_ITEMS[ui.settingsFocus];
          if (it.type === 'toggle') toggleSetting(it.key);
        } else if (key === 'Escape' || key === 'Backspace') {
          sfx('confirm');
          closeSub();
        }
        break;
      case 'pause':
        if (key === 'Escape') resume();
        else if (key === 'ArrowUp' || key === 'ArrowDown') {
          sfx('select');
          showPause((ui.pauseFocus + (key === 'ArrowUp' ? -1 : 1) + PAUSE_ITEMS.length) % PAUSE_ITEMS.length);
        } else if (confirm) {
          sfx('confirm');
          pauseActions()[PAUSE_ITEMS[ui.pauseFocus][0]]();
        }
        break;
      case 'stageClear':
        if (confirm) { engine.nextStage(); afterStageStart(); }
        else if (key === 'Escape') toTitle();
        break;
      case 'allClear':
        if (confirm || key === 'Escape') toTitle();
        break;
      case 'gameover':
        if (confirm) retry();
        else if (key === 'Escape') toTitle();
        break;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
      dom.imeWarning.classList.add('show');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    dom.imeWarning.classList.remove('show');
    if (typeof Sfx.unlock === 'function') Sfx.unlock();
    // 設定画面のスライダー操作中はブラウザ標準の操作に任せる
    if (e.target && e.target.tagName === 'INPUT' && e.key.startsWith('Arrow')) return;

    if (ui.screen === 'battle' || ui.screen === 'intro') onBattleKey(e);
    else if (ui.screen === 'outro') { if (e.key === ' ' || e.key === 'Backspace') e.preventDefault(); }
    else onMenuKey(e);
  });

  // 最初のクリックでも音を出せるようにする
  document.addEventListener('pointerdown', () => { if (typeof Sfx.unlock === 'function') Sfx.unlock(); }, { once: true });

  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
      if (typeof Sfx.suspendBgm === 'function') Sfx.suspendBgm();
    } else if (ui.screen !== 'pause') {
      resumeAudio();
    }
  });
  window.addEventListener('resize', fitToScreen);

  dom.sound.addEventListener('click', (e) => {
    e.currentTarget.blur();
    settings.muted = !settings.muted;
    applySettings();
    if (ui.screen === 'settings') showSettings();
  });

  dom.pauseBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (ui.screen === 'pause') resume(); else pause();
  });

  applySettings();
  showBackdrop();
  fitToScreen();
  showTitle();
  requestAnimationFrame(frame);
  // Web フォントの読み込みで高さが変わることがあるので測り直す
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { baseHeight = 0; fitToScreen(); });

  // デバッグ・自動検証用
  window.TypingRPG = {
    engine,
    ui,
    refresh({ clearLog = false } = {}) {
      if (clearLog) ui.log = [];
      flushEvents();
      buildCards(); renderStatic(); renderHand(); renderFrame(); renderLog();
    },
    skipIntro() { ui.introMs = 1; },
  };
})();
