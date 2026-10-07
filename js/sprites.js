/*
 * ボスのベクターイラスト (インライン SVG 文字列)
 * ブラウザでは window.Sprites、Node では module.exports。
 * Sprites.svg(id) -> '<svg ...>' / 未知の id は ''。
 * アニメーションは sprites.css の spr-* クラスで付与する。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sprites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 左右反転 (x -> 200 - x) */
  const mir = (s) => `<g transform="matrix(-1 0 0 1 200 0)">${s}</g>`;
  /** 左右対称パーツ: 元 + 反転 */
  const sym = (s) => s + mir(s);
  const lin = (id, x1, y1, x2, y2, stops) =>
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
  const rad = (id, cx, cy, r, stops, extra = '') =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${extra}>${stops}</radialGradient>`;
  const st = (...pairs) => pairs.map(([o, c, a]) =>
    `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');
  const glow = (id, sd) =>
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const shadow = (rx, op = 0.5) =>
    `<ellipse cx="100" cy="186" rx="${rx}" ry="${rx / 7}" fill="#000" opacity="${op}"/>`;
  const aura = (id) => `<circle class="spr-aura" cx="100" cy="104" r="92" fill="url(#${id})"/>`;

  /* ---------------- アクアスライム ---------------- */
  function slime() {
    const p = 'slime';
    const defs =
      rad(`${p}-body`, '0.38', '0.32', '0.75', st([0, '#d8fbff'], [0.18, '#6fe0f7'], [0.5, '#2a9fe0'], [0.85, '#14509e'], [1, '#0c2f6a'])) +
      rad(`${p}-core`, '0.5', '0.5', '0.5', st([0, '#a9f6ff', 0.55], [1, '#a9f6ff', 0])) +
      rad(`${p}-aura`, '0.5', '0.55', '0.5', st([0, '#3fc8ff', 0.35], [1, '#3fc8ff', 0])) +
      rad(`${p}-eye`, '0.45', '0.35', '0.7', st([0, '#ffffff'], [1, '#cfeeff'])) +
      rad(`${p}-iris`, '0.4', '0.3', '0.7', st([0, '#3a6bd8'], [0.6, '#132a6e'], [1, '#070f2c'])) +
      glow(`${p}-glow`, 2);
    const eye = (x) => `
      <ellipse cx="${x}" cy="114" rx="14" ry="17" fill="url(#${p}-eye)" stroke="#0b2c66" stroke-width="2"/>
      <ellipse cx="${x + 2}" cy="117" rx="8.5" ry="11" fill="url(#${p}-iris)"/>
      <circle cx="${x + 5}" cy="111" r="3.6" fill="#fff"/><circle cx="${x - 1}" cy="122" r="1.6" fill="#fff" opacity=".8"/>`;
    const bubbles = [[64, 150, 4, 0], [134, 140, 3, 1.2], [118, 160, 5, 2.1], [84, 92, 2.5, 0.6], [146, 112, 2.5, 2.8]]
      .map(([x, y, r, d]) => `<circle class="spr-bubble" style="animation-delay:-${d}s" cx="${x}" cy="${y}" r="${r}" fill="#c8fbff" fill-opacity=".25" stroke="#e6fdff" stroke-opacity=".7" stroke-width="1"/>`).join('');
    const drops = [[30, 120, 0], [172, 96, 1.4], [44, 70, 2.4]]
      .map(([x, y, d]) => `<path class="spr-drop" style="animation-delay:-${d}s" d="M${x} ${y - 7}C${x + 4} ${y - 1} ${x + 5} ${y + 2} ${x + 5} ${y + 4}a5 5 0 0 1-10 0c0-2 1-5 5-11z" fill="url(#${p}-body)" stroke="#bff6ff" stroke-width=".8" opacity=".85"/>`).join('');
    return `<defs>${defs}</defs>${aura(`${p}-aura`)}${shadow(66)}
    <g class="spr-slime-body">
      <path d="M100 30C104 42 114 50 128 66C150 88 176 122 174 156C173 176 152 182 100 182C48 182 27 176 26 156C24 122 50 88 72 66C86 52 92 44 96 36C97 33 99 30 100 30Z" fill="url(#${p}-body)"/>
      <path d="M100 30C104 42 114 50 128 66C150 88 176 122 174 156C173 176 152 182 100 182C48 182 27 176 26 156C24 122 50 88 72 66C86 52 92 44 96 36C97 33 99 30 100 30Z" fill="none" stroke="#9ff3ff" stroke-opacity=".75" stroke-width="2"/>
      <ellipse cx="100" cy="160" rx="54" ry="14" fill="url(#${p}-core)"/>
      <path d="M150 104C164 122 170 142 166 162" fill="none" stroke="#e8feff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
      ${bubbles}
      <ellipse cx="68" cy="84" rx="9" ry="20" transform="rotate(32 68 84)" fill="#fff" opacity=".7"/>
      <circle cx="56" cy="110" r="4.5" fill="#fff" opacity=".6"/>
      <path d="M98 36C100 44 104 48 108 52" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M68 92L90 100M132 92L110 100" stroke="#0b2c66" stroke-width="4.5" stroke-linecap="round"/>
      <g class="spr-eye">${eye(80)}${eye(120)}</g>
      <path d="M80 140Q100 160 120 140Q100 148 80 140Z" fill="#0a1f4d"/>
      <path d="M88 143L91 150L94 145Z M106 145L109 150L112 143Z" fill="#fff"/>
      <ellipse cx="62" cy="134" rx="8" ry="4" fill="#ff7fb0" opacity=".28"/><ellipse cx="138" cy="134" rx="8" ry="4" fill="#ff7fb0" opacity=".28"/>
    </g>${drops}`;
  }

  /* ---------------- サラマンダー ---------------- */
  // 炎: 原点が根元、上へ約 46
  const FLAME = 'M0 0C-13-2-17-15-10-27C-8-21-4-21-4-27C-4-35 1-41 4-48C6-39 14-33 14-21C14-17 13-15 13-15C16-17 17-20 17-23C21-12 14-1 0 0Z';
  const flame = (p, x, y, s, cls, d = 0) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="${cls}" style="animation-delay:-${d}s">
      <path d="${FLAME}" fill="url(#${p}-fl1)"/>
      <path d="${FLAME}" transform="translate(1 -2) scale(.66)" fill="#ffb53a"/>
      <path d="${FLAME}" transform="translate(1.5 -3) scale(.36)" fill="#fff6c4"/></g></g>`;

  function salamander() {
    const p = 'salamander';
    const defs =
      lin(`${p}-skin`, '0', '0', '0', '1', st([0, '#ff9a4a'], [0.45, '#e2471f'], [1, '#7a1710'])) +
      rad(`${p}-head`, '0.5', '0.3', '0.75', st([0, '#ffb066'], [0.5, '#ea5a24'], [1, '#8a1d10'])) +
      lin(`${p}-belly`, '0', '0', '0', '1', st([0, '#ffe39a'], [1, '#f08a2e'])) +
      lin(`${p}-tail`, '0', '1', '1', '0', st([0, '#a8261a'], [0.6, '#e8522a'], [1, '#ffb04a'])) +
      lin(`${p}-fl1`, '0', '1', '0', '0', st([0, '#ff3d12'], [1, '#ff8a1f'])) +
      rad(`${p}-eye`, '0.4', '0.35', '0.7', st([0, '#fffbd0'], [0.45, '#ffd43a'], [1, '#e57a10'])) +
      rad(`${p}-aura`, '0.5', '0.6', '0.5', st([0, '#ff6a2a', 0.38], [1, '#ff6a2a', 0])) +
      lin(`${p}-spike`, '0', '1', '0', '0', st([0, '#b9301a'], [1, '#ffcf6a'])) +
      glow(`${p}-glow`, 2.2);
    const arm = `<path d="M84 106C68 110 54 126 54 146C54 158 58 166 60 172L74 172C71 160 70 150 72 140C74 130 80 122 90 118Z" fill="url(#${p}-skin)" stroke="#5a0f0a" stroke-width="1.5"/>
      <path d="M58 150C58 134 64 122 76 112" fill="none" stroke="#ffc07a" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="66" cy="174" rx="13" ry="7" fill="url(#${p}-skin)" stroke="#5a0f0a" stroke-width="1.5"/>
      <path d="M54 177l-3 6 6-3ZM63 180l-1 6 4-5ZM72 180l2 6 1-6Z" fill="#fff3c8" stroke="#5a0f0a" stroke-width=".6"/>`;
    const thigh = `<ellipse cx="72" cy="168" rx="18" ry="14" fill="url(#${p}-skin)" stroke="#5a0f0a" stroke-width="1.5"/>`;
    const eye = (x) => `
      <circle cx="${x}" cy="62" r="15" fill="url(#${p}-head)" stroke="#6a140c" stroke-width="1.5"/>
      <g class="spr-eye spr-glow"><circle cx="${x}" cy="63" r="10.5" fill="url(#${p}-eye)" filter="url(#${p}-glow)"/>
      <ellipse cx="${x}" cy="63" rx="2.6" ry="8.5" fill="#2a0804"/><circle cx="${x - 3.5}" cy="59" r="2.4" fill="#fff"/></g>`;
    const embers = [[160, 60, 0], [176, 76, 0.9], [150, 44, 1.7], [34, 110, 0.5], [46, 84, 2.2]]
      .map(([x, y, d]) => `<circle class="spr-ember" style="animation-delay:-${d}s" cx="${x}" cy="${y}" r="2" fill="#ffd25a" filter="url(#${p}-glow)"/>`).join('');
    return `<defs>${defs}</defs>${aura(`${p}-aura`)}${shadow(64)}
    <path d="M124 172C160 176 190 152 186 116C184 96 176 82 166 72C172 92 174 110 168 128C162 146 148 156 124 154Z" fill="url(#${p}-tail)" stroke="#5a0f0a" stroke-width="1.5"/>
    <path d="M176 108l8-4-5 9M178 128l9 0-7 7M168 148l8 3-9 4" fill="#ffb04a" stroke="#6a140c" stroke-width="1"/>
    ${flame(p, 167, 76, 0.9, 'spr-flame')}
    ${sym(thigh)}
    <path d="M68 178C58 156 62 122 78 100L122 100C138 122 142 156 132 178Z" fill="url(#${p}-skin)" stroke="#5a0f0a" stroke-width="1.5"/>
    <path d="M84 118Q100 108 116 118L118 172Q100 178 82 172Z" fill="url(#${p}-belly)"/>
    <path d="M86 128Q100 122 114 128M84 140Q100 134 116 140M84 152Q100 146 116 152M84 164Q100 158 116 164" fill="none" stroke="#c8611e" stroke-width="1.6" stroke-opacity=".7"/>
    <circle cx="74" cy="140" r="3.5" fill="#7a1710" opacity=".7"/><circle cx="128" cy="134" r="4.5" fill="#7a1710" opacity=".7"/><circle cx="125" cy="152" r="2.5" fill="#7a1710" opacity=".7"/>
    ${sym(arm)}
    <path d="M100 42C130 42 152 56 154 76C156 94 136 106 100 106C64 106 44 94 46 76C48 56 70 42 100 42Z" fill="url(#${p}-head)" stroke="#5a0f0a" stroke-width="1.5"/>
    <path d="M86 44L92 28L98 42Z M102 42L108 22L114 44Z M74 50L76 36L84 46Z M116 46L124 36L126 50Z" fill="url(#${p}-spike)" stroke="#6a140c" stroke-width="1"/>
    ${flame(p, 108, 36, 0.42, 'spr-flame spr-flame-sm', 0.4)}
    <path d="M60 50Q100 40 140 50" fill="none" stroke="#ffd08a" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>
    ${eye(76)}${eye(124)}
    <path d="M60 48L92 58L90 52L64 42Z M140 48L108 58L110 52L136 42Z" fill="#6a140c"/>
    <path d="M90 82q2 3 4 0M106 82q2 3 4 0" stroke="#4a0a06" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M58 88Q100 104 142 88Q100 98 58 88Z" fill="#3a0604"/>
    <path d="M76 93L80 101L84 95Z M116 95L120 101L124 93Z" fill="#fff6dc"/>
    <path d="M70 92Q100 100 130 92" fill="none" stroke="#ff8a3a" stroke-opacity=".7" stroke-width="1.2"/>
    ${embers}`;
  }

  /* ---------------- サンダーバード ---------------- */
  function thunderbird() {
    const p = 'thunderbird';
    const defs =
      lin(`${p}-wing`, '1', '1', '0', '0', st([0, '#7d52e0'], [0.55, '#4a26a8'], [1, '#1f0e5a'])) +
      rad(`${p}-body`, '0.5', '0.35', '0.7', st([0, '#a985ff'], [0.55, '#5b2fc4'], [1, '#26106a'])) +
      lin(`${p}-bolt`, '0', '0', '0', '1', st([0, '#fffbe0'], [0.5, '#ffe34d'], [1, '#ffaa1a'])) +
      lin(`${p}-beak`, '0', '0', '0', '1', st([0, '#ffe680'], [1, '#e08a10'])) +
      rad(`${p}-aura`, '0.5', '0.5', '0.5', st([0, '#b48cff', 0.4], [0.6, '#ffe34d', 0.08], [1, '#ffe34d', 0])) +
      glow(`${p}-glow`, 2.4);
    const wing = `<path d="M86 96C66 70 40 46 6 22C14 40 16 48 14 56L28 54C22 64 20 70 16 78L32 76C28 86 26 92 24 100L42 96C40 106 40 112 42 120L60 112C62 120 66 126 72 130L88 120Z" fill="url(#${p}-wing)" stroke="#170840" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M14 56l7-2M16 78l7-2M24 100l7-2M42 120l6-4M72 130l5-4" stroke="#ffe34d" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M86 98C70 80 54 68 36 56C44 68 46 74 44 82L58 80C56 90 56 96 58 104L72 100C72 108 76 114 82 118L88 116Z" fill="#8f6af0" fill-opacity=".55" stroke="#170840" stroke-opacity=".6" stroke-width="1"/>
      <path d="M86 96C66 70 40 46 6 22" fill="none" stroke="url(#${p}-bolt)" stroke-width="3" stroke-linecap="round"/>`;
    const sparks = [['M30 128l6-8-2 6 6-7', 0], ['M168 130l-6-8 2 6-6-7', 0.7], ['M150 30l4 8-4-2 3 8', 1.3], ['M46 26l-4 8 4-2-3 8', 1.9]]
      .map(([d, dl]) => `<path class="spr-spark" style="animation-delay:-${dl}s" d="${d}" fill="none" stroke="#ffe34d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter="url(#${p}-glow)"/>`).join('');
    const tail = `<path d="M92 156L78 192L88 184L92 194L98 160Z" fill="url(#${p}-wing)" stroke="#170840" stroke-width="1.2"/><path d="M78 192l10-8" stroke="#ffe34d" stroke-width="2"/>`;
    return `<defs>${defs}</defs>${aura(`${p}-aura`)}${shadow(46, 0.45)}
    <g class="spr-wing-l">${wing}</g><g class="spr-wing-r">${mir(wing)}</g>
    ${sym(tail)}<path d="M96 158L100 198L104 158Z" fill="#3a1a8a" stroke="#170840" stroke-width="1.2"/>
    <path d="M100 66C124 66 134 90 134 118C134 146 120 166 100 166C80 166 66 146 66 118C66 90 76 66 100 66Z" fill="url(#${p}-body)" stroke="#170840" stroke-width="1.5"/>
    <ellipse cx="100" cy="128" rx="20" ry="32" fill="#c9b2ff" opacity=".25"/><path d="M78 104Q89 112 100 104Q111 112 122 104M76 120Q88 128 100 120Q112 128 124 120M78 136Q89 144 100 136Q111 144 122 136M82 151Q91 158 100 151Q109 158 118 151" fill="none" stroke="#c4aaff" stroke-opacity=".45" stroke-width="1.6"/>
    <g class="spr-bolt spr-glow"><path d="M104 104L90 128L100 128L94 150L112 120L102 120L108 104Z" fill="url(#${p}-bolt)" stroke="#a8600a" stroke-width="1" filter="url(#${p}-glow)"/></g>
    <path d="M88 166l-3 8M94 167l0 9M106 167l0 9M112 166l3 8" stroke="#ffcc33" stroke-width="3" stroke-linecap="round"/>
    <path d="M86 48C76 40 68 28 64 16C76 24 84 32 92 42ZM114 48C124 40 132 28 136 16C124 24 116 32 108 42Z" fill="#6a3fd0" stroke="#170840" stroke-width="1"/><path d="M94 46L86 24L95 27L90 2L112 30L103 27L108 46Z" fill="url(#${p}-bolt)" stroke="#a8600a" stroke-width="1" stroke-linejoin="round" filter="url(#${p}-glow)"/>
    <circle cx="100" cy="62" r="24" fill="url(#${p}-body)" stroke="#170840" stroke-width="1.5"/>
    <path d="M78 52Q100 40 122 52" fill="none" stroke="#c9b2ff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
    <path d="M76 56L96 64L94 70L80 66Z M124 56L104 64L106 70L120 66Z" fill="#170840"/>
    <g class="spr-eye spr-glow"><path d="M80 60L95 66L93 69L82 66Z M120 60L105 66L107 69L118 66Z" fill="#fff8b0" filter="url(#${p}-glow)"/></g>
    <path d="M90 72L110 72L100 94Z" fill="url(#${p}-beak)" stroke="#8a4a08" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M90 72L110 72L100 78Z" fill="#fff2b0" opacity=".7"/>
    ${sparks}`;
  }

  /* ---------------- 氷の魔竜 ---------------- */
  function dragon() {
    const p = 'dragon';
    const defs =
      lin(`${p}-mem`, '0', '0', '1', '1', st([0, '#3a8fc4', 0.85], [0.6, '#1b4f7e', 0.92], [1, '#0d2a4c', 0.95])) +
      rad(`${p}-skin`, '0.5', '0.25', '0.8', st([0, '#f2fdff'], [0.3, '#a6e6f7'], [0.65, '#3d8fbf'], [1, '#143a62'])) +
      lin(`${p}-arm`, '0', '0', '0', '1', st([0, '#8fd0ea'], [1, '#1d4a72'])) +
      lin(`${p}-chest`, '0', '0', '0', '1', st([0, '#dff8ff'], [1, '#6cb8d8'])) +
      lin(`${p}-horn`, '0', '1', '1', '0', st([0, '#7fc4e0'], [0.6, '#e8fbff'], [1, '#ffffff'])) +
      lin(`${p}-ice`, '0', '1', '0', '0', st([0, '#4fb8e6', 0.85], [1, '#effdff', 0.95])) +
      rad(`${p}-maw`, '0.5', '0.3', '0.8', st([0, '#eaffff'], [0.4, '#6ff0ff'], [1, '#0b3a5c'])) +
      rad(`${p}-aura`, '0.5', '0.5', '0.5', st([0, '#8fe9ff', 0.42], [0.7, '#4aa8ff', 0.1], [1, '#4aa8ff', 0])) +
      glow(`${p}-glow`, 2.6);
    const wing = `<path d="M70 102L30 20L6 58Q18 66 16 80L2 106Q20 106 24 120L12 144Q38 134 62 140Z" fill="url(#${p}-mem)" stroke="#0a1f3a" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M30 20L8 58M30 20L4 104M30 20L14 142" stroke="#bfefff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
      <path d="M70 104L30 20" stroke="url(#${p}-horn)" stroke-width="6" stroke-linecap="round"/>
      <path d="M30 20L22 8L34 14Z" fill="#ffffff"/>`;
    const horn = `<path d="M74 52C60 40 46 22 28 0C36 26 48 44 62 62Z" fill="url(#${p}-horn)" stroke="#2a5a80" stroke-width="1.2"/>
      <path d="M70 54C58 42 46 28 34 10" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>
      <path d="M58 80L30 84L48 92L28 100L60 94Z" fill="url(#${p}-horn)" stroke="#2a5a80" stroke-width="1"/>`;
    const crystal = `<path d="M58 132L50 104L64 124L66 98L74 126Z" fill="url(#${p}-ice)" stroke="#9fe6ff" stroke-width=".8"/>`;
    const eye = `<path d="M66 70L94 80L90 88L70 80Z" fill="#06142a"/>
      <g class="spr-glow"><path d="M70 74L91 81L88 86L72 80Z" fill="#8ffaff" filter="url(#${p}-glow)"/></g>
      <path d="M81 77L83 78L82 84L80 83Z" fill="#06142a"/>
      <path d="M60 64L96 76L96 70L64 58Z" fill="#1d4a72"/>`;
    const frost = [[86, 132, 0], [112, 136, 0.8], [98, 140, 1.6], [76, 140, 2.3], [124, 128, 1.2], [104, 128, 2.8]]
      .map(([x, y, d]) => `<path class="spr-frost" style="animation-delay:-${d}s" d="M${x} ${y - 4}L${x + 1} ${y - 1}L${x + 4} ${y}L${x + 1} ${y + 1}L${x} ${y + 4}L${x - 1} ${y + 1}L${x - 4} ${y}L${x - 1} ${y - 1}Z" fill="#effdff" filter="url(#${p}-glow)"/>`).join('');
    return `<defs>${defs}</defs>${aura(`${p}-aura`)}${shadow(78, 0.55)}
    <g class="spr-dwing-l">${wing}</g><g class="spr-dwing-r">${mir(wing)}</g>
    <g class="spr-dragon-body">
    <path d="M54 192C52 150 66 118 82 104L118 104C134 118 148 150 146 192Z" fill="url(#${p}-skin)" stroke="#0a1f3a" stroke-width="1.5"/>
    <path d="M80 124Q100 116 120 124L126 190L74 190Z" fill="url(#${p}-chest)" opacity=".9"/>
    <path d="M80 136Q100 128 120 136M78 150Q100 142 122 150M77 164Q100 156 123 164M76 178Q100 170 124 178" fill="none" stroke="#3d8fbf" stroke-width="1.8" stroke-opacity=".8"/>
    <path d="M56 190C54 158 64 128 80 108L84 112C72 132 66 160 70 190ZM144 190C146 158 136 128 120 108L116 112C128 132 134 160 130 190Z" fill="#0d2a4c" opacity=".45"/>
    ${sym(crystal)}
    ${sym(`<path d="M50 192L56 176C60 168 76 168 80 176L84 192Z" fill="url(#${p}-arm)" stroke="#0a1f3a" stroke-width="1.5"/><path d="M62 178l-2 12M72 178l1 12" stroke="#0a1f3a" stroke-opacity=".5" stroke-width="1.2"/><path d="M50 191C46 192 44 196 44 199C48 197 52 195 56 194ZM64 192C61 194 60 197 61 200C64 198 67 196 69 194ZM78 192C78 195 80 198 83 199C83 196 83 193 84 191Z" fill="#effdff" stroke="#0a1f3a" stroke-width=".6"/>`)}
    ${sym(horn)}
    <path d="M100 40C118 40 134 46 140 58L146 74C146 84 138 90 132 96L124 112C118 122 110 128 100 128C90 128 82 122 76 112L68 96C62 90 54 84 54 74L60 58C66 46 82 40 100 40Z" fill="url(#${p}-skin)" stroke="#0a1f3a" stroke-width="1.5"/>
    <path d="M70 50Q100 38 130 50" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>
    <g class="spr-glow"><path d="M100 44L107 56L100 70L93 56Z" fill="url(#${p}-ice)" stroke="#eaffff" stroke-width="1" filter="url(#${p}-glow)"/></g>
    ${sym(eye)}
    <path d="M90 100l4 6M110 100l-4 6" stroke="#0a1f3a" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M80 110Q100 104 120 110L114 122Q100 128 86 122Z" fill="url(#${p}-maw)" class="spr-maw"/>
    <path d="M82 110L86 120L89 111Z M118 110L114 120L111 111Z M92 109L94 115L96 108Z M108 109L106 115L104 108Z" fill="#fff"/>
    <path d="M86 123L89 117L92 124Z M114 123L111 117L108 124Z" fill="#fff"/>
    </g>
    ${frost}`;
  }

  const BUILDERS = { slime, salamander, thunderbird, dragon };
  const cache = {};

  function svg(id) {
    const build = BUILDERS[id];
    if (!build) return '';
    if (!cache[id]) {
      cache[id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" class="boss-svg spr-${id}" aria-hidden="true" focusable="false">${build().replace(/\n\s*/g, '')}</svg>`;
    }
    return cache[id];
  }

  return { svg, ids: Object.keys(BUILDERS) };
});
