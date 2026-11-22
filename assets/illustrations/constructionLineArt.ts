// Login header backdrop (2026-11-21, client): one construction-site scene in
// white line drawing that fills the whole navy area — tower cranes, buildings
// (one under construction with scaffolding), an excavator, a cement-mixer
// truck and workers in hard hats. Outlines only; shown faintly on the login.

/** A worker in a hard hat standing at (x, y = feet), with an optional tool. */
function worker(x: number, y: number, tool: 'shovel' | 'plan' | 'wave' | 'none' = 'none'): string {
  const head = y - 38;
  let arms = `M${x} ${y - 24} L${x - 9} ${y - 14} M${x} ${y - 24} L${x + 9} ${y - 14}`;
  let extra = '';
  if (tool === 'shovel') {
    arms = `M${x} ${y - 24} L${x - 8} ${y - 15} M${x} ${y - 24} L${x + 9} ${y - 18}`;
    extra = `<path d="M${x - 14} ${y - 30} L${x + 14} ${y - 4} M${x + 11} ${y - 7} L${x + 18} ${y + 1} L${x + 21} ${y - 6} Z"/>`;
  } else if (tool === 'plan') {
    arms = `M${x} ${y - 24} L${x + 10} ${y - 18} M${x} ${y - 24} L${x - 9} ${y - 16}`;
    extra = `<rect x="${x + 10}" y="${y - 24}" width="16" height="11"/><path d="M${x + 13} ${y - 20} H${x + 23} M${x + 13} ${y - 16} H${x + 20}"/>`;
  } else if (tool === 'wave') {
    arms = `M${x} ${y - 24} L${x - 9} ${y - 15} M${x} ${y - 24} L${x + 9} ${y - 36}`;
  }
  return (
    `<circle cx="${x}" cy="${head}" r="6"/>` +
    `<path d="M${x - 8} ${head - 2} Q${x} ${head - 13} ${x + 8} ${head - 2} M${x - 10} ${head - 1} H${x + 10}"/>` +
    `<path d="M${x} ${head + 6} V${y - 12} M${x} ${y - 12} L${x - 6} ${y} M${x} ${y - 12} L${x + 6} ${y} ${arms}"/>` +
    extra
  );
}

/** A window grid inside a building outline. */
function windows(x: number, y: number, w: number, h: number, cols: number, rows: number): string {
  let d = '';
  for (let i = 1; i < cols; i++) d += `M${x + (w * i) / cols} ${y} V${y + h} `;
  for (let j = 1; j < rows; j++) d += `M${x} ${y + (h * j) / rows} H${x + w} `;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><path d="${d}"/>`;
}

/** Lattice mast of a tower crane from the ground (gy) up to top (ty). */
function mast(x: number, gy: number, ty: number): string {
  let zig = `M${x} ${gy}`;
  for (let y = gy, left = true; y > ty; y -= 22, left = !left) zig += ` L${left ? x + 12 : x} ${Math.max(ty, y - 22)}`;
  return `<path d="M${x} ${gy} V${ty} M${x + 12} ${gy} V${ty} ${zig}"/>`;
}

const G = 410; // ground line

export const CONSTRUCTION_LINE_ART_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 414" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <!-- side buildings, so the wide phone header is filled edge to edge -->
  ${windows(2, 250, 44, 160, 2, 8)}
  ${windows(474, 236, 44, 174, 2, 8)}
  <path d="M0 ${G} H520"/>
  <g transform="translate(50 0)">
  <!-- far skyline -->
  ${windows(0, 230, 54, 180, 3, 9)}
  ${windows(352, 210, 68, 200, 4, 10)}
  <path d="M60 300 V410 M60 300 H96 V410"/>

  <!-- tower crane 1 (left) lifting a beam -->
  ${mast(104, G, 52)}
  <path d="M40 52 H262 M40 52 L110 22 L262 52 M110 22 V52 M40 52 V64 H62 V52"/>
  <path d="M206 52 V116 M196 116 H216 M197 116 L206 124 L215 116"/>
  <path d="M178 124 H234 V132 H178 Z M178 124 L206 116 L234 124"/>

  <!-- tower crane 2 (right) -->
  ${mast(316, G, 96)}
  <path d="M270 96 H420 M270 96 L322 70 L420 96 M322 70 V96 M402 96 V108 H420"/>
  <path d="M290 96 V150 M284 150 H296"/>

  <!-- building under construction: open floors, columns, scaffolding -->
  <path d="M140 ${G} V176 M178 ${G} V176 M216 ${G} V176 M254 ${G} V176"/>
  <path d="M132 176 H262 M132 222 H262 M132 268 H262 M132 314 H262 M132 360 H262"/>
  <path d="M262 176 V${G} M280 176 V${G}"/>
  <path d="M262 199 H280 M262 245 H280 M262 291 H280 M262 337 H280 M262 383 H280"/>
  <path d="M262 176 L280 222 M262 222 L280 268 M262 268 L280 314 M262 314 L280 360 M262 360 L280 ${G}"/>

  <!-- worker on the scaffolding + two on the floors -->
  ${worker(271, 314, 'wave')}
  ${worker(160, 268, 'plan')}
  ${worker(236, 222, 'none')}

  <!-- ground -->
  <path d="M0 ${G} H420"/>

  <!-- excavator (left) -->
  <rect x="6" y="392" width="86" height="16" rx="8"/>
  <circle cx="18" cy="400" r="4"/><circle cx="80" cy="400" r="4"/>
  <path d="M20 392 V366 H58 V392 M30 366 V352 H58 V366 M36 358 H52"/>
  <path d="M58 372 L104 336 L130 368 M124 362 L140 382 L124 390 L114 378"/>

  <!-- workers at ground level -->
  ${worker(156, G, 'shovel')}
  ${worker(200, G, 'none')}

  <!-- wheelbarrow + worker -->
  ${worker(238, G, 'none')}
  <path d="M246 392 L262 384 M250 384 H286 L280 398 H256 Z"/>
  <circle cx="276" cy="404" r="5"/>

  <!-- cement mixer truck (right) -->
  <path d="M300 404 V372 H332 V404 M306 378 H326 V390 H306 Z"/>
  <path d="M332 404 H416 V392 H332"/>
  <ellipse cx="374" cy="374" rx="34" ry="17" transform="rotate(-12 374 374)"/>
  <path d="M346 366 L400 384 M352 382 L396 362"/>
  <circle cx="316" cy="406" r="6"/><circle cx="360" cy="406" r="6"/><circle cx="398" cy="406" r="6"/>

  <!-- cones + brick pile -->
  <path d="M122 410 L128 392 L134 410 M119 410 H137 M125 401 H131"/>
  <path d="M290 410 L296 392 L302 410 M287 410 H305"/>
  <path d="M56 410 V398 H90 V410 M56 404 H90 M64 398 V404 M74 404 V410 M82 398 V404"/>
  </g>
</svg>`;
