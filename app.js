'use strict';

/* ============================================================
   SUBNETIFY — deterministic CIDR / subnetting engine
   No external IP math libraries. All arithmetic uses explicit
   spatial bit weights: 128, 64, 32, 16, 8, 4, 2, 1
   ============================================================ */

const WEIGHTS = [128, 64, 32, 16, 8, 4, 2, 1];

/* Renders the 128/64/32/16/8/4/2/1 header row for a single octet's worth of
   bits (8 values). Each weight number is "lit" when its corresponding bit
   is 1, and "muted" when the bit is 0 — reinforcing how the active weights
   sum to the decimal value. variantClass controls sizing (see CSS).
   kindsSlice (optional) is an array of 8 strings — 'locked' | 'borrowed' |
   'host' — so a lit weight picks up the SAME semantic color as its bit
   (blue / amber / green) instead of a single flat "active" color. This
   keeps host-side weights in Panel 5 visually distinct from subnet-side
   weights in Panel 4, matching the bit coloring itself. */
function buildWeightRowHtml(bitsSlice, variantClass, kindsSlice, weightsArr) {
  const weights = weightsArr || WEIGHTS;
  const n = bitsSlice.length;
  let html = '<div class="weight-row ' + variantClass + '">';
  for (let k = 0; k < n; k++) {
    const lit = bitsSlice[k] === 1;
    let cls = 'weight-num';
    if (lit) {
      const kind = kindsSlice ? kindsSlice[k] : null;
      cls += ' weight-lit' + (kind ? ' weight-lit-' + kind : '');
    } else {
      cls += ' weight-muted';
    }
    html += '<span class="' + cls + '">' + weights[k] + '</span>';
  }
  html += '</div>';
  return html;
}

/* Renders the decimal total that the octet's active weights sum to (the
   same value bitsToOctet would compute). Sits above the weight row so the
   summation reads top-down: "here's the answer" -> "here's the math" ->
   "here's the binary". Deliberately styled with NO locked/borrowed/host
   coloring — in decimal form (e.g. 192.168.1.0) there is no visual cue for
   which bits were network vs. host, and the total should reflect that same
   truth rather than borrowing the bit-level color language. appendDot, when
   true, suffixes a "." so that reading only the total badges left-to-right
   across an octet's siblings reconstructs the ordinary dotted-decimal IP
   notation that the rest of the visualization deliberately breaks apart. */
function buildOctetTotalHtml(bitsSlice, variantClass, appendDot) {
  const total = bitsToOctet(bitsSlice);
  const dot = appendDot ? '<span class="octet-total-dot">.</span>' : '';
  return '<div class="octet-total ' + variantClass + '">' + total + dot + '</div>';
}

/* ---------------- Global State (single source of truth) ---------------- */
const state = {
  octets: [192, 168, 1, 0],
  borrowedBits: 3,
  activeSubnetIndex: 0,
  subnetsExpanded: false,
  hostsExpanded: false,
  presenterMode: false,
  subnetFormulaVisible: false,
  hostFormulaVisible: false,
};

/* ---------------- Bit-level helpers ---------------- */
function toBinary8(n) {
  const v = Math.max(0, Math.min(255, Number(n) || 0));
  return v.toString(2).padStart(8, '0').split('').map(Number);
}

function bitsToOctet(bitsArr) {
  if (!bitsArr.length) return 0;
  return parseInt(bitsArr.join(''), 2);
}

function octetsToBits(octets) {
  return octets.flatMap(toBinary8);
}

function bitsToOctets(bits) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(bitsToOctet(bits.slice(i * 8, i * 8 + 8)));
  }
  return out;
}

/* ---------------- Class detection ---------------- */
function detectClass(o1) {
  if (o1 >= 1 && o1 <= 126) {
    return { label: 'A', networkBits: 8, warning: null };
  }
  if (o1 === 127) {
    return {
      label: 'Loopback',
      networkBits: 8,
      warning: 'Loopback range (127.0.0.0/8): reserved for a host to talk to itself. Not used for subnetting exercises — bit-borrowing is disabled.',
    };
  }
  if (o1 >= 128 && o1 <= 191) {
    return { label: 'B', networkBits: 16, warning: null };
  }
  if (o1 >= 192 && o1 <= 223) {
    return { label: 'C', networkBits: 24, warning: null };
  }
  if (o1 >= 224 && o1 <= 239) {
    return {
      label: 'D (Multicast)',
      networkBits: 32,
      warning: 'Multicast range (224.0.0.0 – 239.255.255.255): addresses identify a group of receivers, not a single host. There is no host/network split to subnet — bit-borrowing is disabled.',
    };
  }
  return {
    label: 'E (Experimental)',
    networkBits: 32,
    warning: 'Experimental / reserved range (240.0.0.0+): reserved for future use and not routable. Bit-borrowing is disabled.',
  };
}

/* ---------------- Derived state ---------------- */
function computeDerived() {
  const classInfo = detectClass(state.octets[0]);
  const networkBits = classInfo.networkBits;
  const maxBorrow = classInfo.warning ? 0 : Math.max(0, 30 - networkBits);
  const borrowedBits = classInfo.warning ? 0 : Math.min(state.borrowedBits, maxBorrow);
  const hostBits = 32 - networkBits - borrowedBits;
  const inputBits = octetsToBits(state.octets);
  const totalSubnets = Math.pow(2, borrowedBits);
  const totalHosts = Math.pow(2, hostBits);

  // The octet index (0-3) that contains the CIDR curtain (last borrowed bit
  // or, if none borrowed, the boundary right after the locked network bits).
  const curtainBitPos = networkBits + borrowedBits; // first host bit index
  const curtainOctet = Math.min(3, Math.floor(Math.max(curtainBitPos - 1, networkBits) / 8));

  return { classInfo, networkBits, maxBorrow, borrowedBits, hostBits, inputBits, totalSubnets, totalHosts, curtainBitPos, curtainOctet };
}

/* ---------------- DOM references ---------------- */
const el = {
  octetInputs: [0, 1, 2, 3].map((i) => document.getElementById('octet' + i)),
  classBadge: document.getElementById('classBadge'),
  cidrBadge: document.getElementById('cidrBadge'),
  borrowBadge: document.getElementById('borrowBadge'),
  warningBanner: document.getElementById('warningBanner'),
  bitGrid: document.getElementById('bitGrid'),
  classfulMaskBinary: document.getElementById('classfulMaskBinary'),
  classfulMaskDecimal: document.getElementById('classfulMaskDecimal'),
  classlessMaskBinary: document.getElementById('classlessMaskBinary'),
  classlessMaskDecimal: document.getElementById('classlessMaskDecimal'),
  positionalMath: document.getElementById('positionalMath'),
  maskDotDecimal: document.getElementById('maskDotDecimal'),
  maskCidr: document.getElementById('maskCidr'),
  subnetCountMeta: document.getElementById('subnetCountMeta'),
  subnetFormulaToggle: document.getElementById('subnetFormulaToggle'),
  subnetFormulaBox: document.getElementById('subnetFormulaBox'),
  subnetTableBody: document.getElementById('subnetTableBody'),
  activeSubnetMeta: document.getElementById('activeSubnetMeta'),
  hostFormulaToggle: document.getElementById('hostFormulaToggle'),
  hostFormulaBox: document.getElementById('hostFormulaBox'),
  hostTableBody: document.getElementById('hostTableBody'),
  presenterToggle: document.getElementById('presenterToggle'),
  resetBorrowBtn: document.getElementById('resetBorrowBtn'),
};

/* ---------------- Renderers ---------------- */

function renderPanel1(d) {
  el.classBadge.textContent = 'Class ' + d.classInfo.label;
  el.cidrBadge.textContent = '/' + d.networkBits;
  el.borrowBadge.textContent = d.borrowedBits + ' bit' + (d.borrowedBits === 1 ? '' : 's') + ' borrowed';

  if (d.classInfo.warning) {
    el.warningBanner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + d.classInfo.warning;
    el.warningBanner.classList.remove('hidden');
  } else {
    el.warningBanner.classList.add('hidden');
  }
}

function renderPanel2(d) {
  el.bitGrid.innerHTML = '';
  const totalBorrowEnd = d.networkBits + d.borrowedBits;

  for (let g = 0; g < 4; g++) {
    const octetBlock = document.createElement('div');
    octetBlock.className = 'octet-block';

    const bitsSlice = d.inputBits.slice(g * 8, g * 8 + 8);
    const kindsSlice = bitsSlice.map((_, k) => {
      const globalIndex = g * 8 + k;
      if (globalIndex < d.networkBits) return 'locked';
      if (globalIndex < totalBorrowEnd) return 'borrowed';
      return 'host';
    });
    octetBlock.innerHTML =
      buildOctetTotalHtml(bitsSlice, 'octet-total-main', g < 3) +
      buildWeightRowHtml(bitsSlice, 'weight-row-main', kindsSlice);

    const group = document.createElement('div');
    group.className = 'bit-octet-group';

    for (let b = 0; b < 8; b++) {
      const globalIndex = g * 8 + b;
      const cell = document.createElement('div');
      cell.dataset.index = String(globalIndex);
      const bitVal = d.inputBits[globalIndex];

      if (globalIndex < d.networkBits) {
        cell.className = 'bit-cell locked';
        cell.innerHTML = '<span class="lock-icon"><i class="fa-solid fa-lock"></i></span><span class="bit-value">' + bitVal + '</span>';
      } else if (globalIndex < totalBorrowEnd) {
        cell.className = 'bit-cell borrowed';
        cell.innerHTML = '<span class="bit-value">' + bitVal + '</span>';
        cell.title = 'Click to set subnet boundary here';
      } else {
        cell.className = 'bit-cell host';
        cell.innerHTML = '<span class="bit-value">' + bitVal + '</span>';
        cell.title = 'Click to set subnet boundary here';
      }

      cell.addEventListener('click', () => onBitClick(globalIndex));
      group.appendChild(cell);
    }

    octetBlock.appendChild(group);

    const label = document.createElement('div');
    label.className = 'octet-viz-label';
    label.textContent = 'Octet ' + (g + 1);
    octetBlock.appendChild(label);

    el.bitGrid.appendChild(octetBlock);

    if (g < 3) {
      const sep = document.createElement('div');
      sep.className = 'octet-dot-separator';
      sep.textContent = '.';
      el.bitGrid.appendChild(sep);
    }
  }
}

function renderPanel3(d) {
  const classfulBits = new Array(32).fill(0).map((_, i) => (i < d.networkBits ? 1 : 0));
  const classlessBits = new Array(32).fill(0).map((_, i) => (i < d.networkBits + d.borrowedBits ? 1 : 0));

  const renderMaskBinary = (bits, container, borrowedStart, borrowedEnd) => {
    container.innerHTML = '';
    for (let g = 0; g < 4; g++) {
      const block = document.createElement('div');
      block.className = 'mask-octet-block';

      const bitsSlice = bits.slice(g * 8, g * 8 + 8);
      const kindsSlice = bitsSlice.map((_, k) => {
        const i = g * 8 + k;
        return (i >= borrowedStart && i < borrowedEnd) ? 'borrowed' : 'locked';
      });
      block.innerHTML =
        buildOctetTotalHtml(bitsSlice, 'octet-total-mask', g < 3) +
        buildWeightRowHtml(bitsSlice, 'weight-row-mask', kindsSlice);

      const bitRow = document.createElement('div');
      bitRow.className = 'mask-bit-row';
      for (let k = 0; k < 8; k++) {
        const i = g * 8 + k;
        const span = document.createElement('span');
        const isBorrowed = i >= borrowedStart && i < borrowedEnd;
        span.className = 'mask-bit bit-' + bits[i] + ' ' + (bits[i] === 1 ? (isBorrowed ? 'borrowed-bit' : 'locked-bit') : '');
        span.textContent = bits[i];
        bitRow.appendChild(span);
      }
      block.appendChild(bitRow);

      const label = document.createElement('div');
      label.className = 'octet-viz-label';
      label.textContent = 'Octet ' + (g + 1);
      block.appendChild(label);

      container.appendChild(block);

      if (g < 3) {
        const sep = document.createElement('div');
        sep.className = 'mask-dot-separator';
        sep.textContent = '.';
        container.appendChild(sep);
      }
    }
  };

  renderMaskBinary(classfulBits, el.classfulMaskBinary, d.networkBits, d.networkBits);
  renderMaskBinary(classlessBits, el.classlessMaskBinary, d.networkBits, d.networkBits + d.borrowedBits);

  const classfulOctets = bitsToOctets(classfulBits.concat());
  const classlessOctets = bitsToOctets(classlessBits.concat());
  el.classfulMaskDecimal.textContent = classfulOctets.join('.') + '  (/' + d.networkBits + ')';
  el.classlessMaskDecimal.textContent = classlessOctets.join('.') + '  (/' + (d.networkBits + d.borrowedBits) + ')';

  // Positional math callout for the octet containing the CIDR curtain
  const octetStart = d.curtainOctet * 8;
  const terms = [];
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const globalIndex = octetStart + k;
    const isBorrowedHere = globalIndex >= d.networkBits && globalIndex < d.networkBits + d.borrowedBits;
    const contributes = isBorrowedHere;
    const value = contributes ? WEIGHTS[k] : 0;
    sum += value;
    terms.push({ value, active: contributes });
  }

  const termsHtml = terms
    .map((t, idx) => {
      const cls = t.active ? 'weight-term active' : 'weight-term';
      const sep = idx < terms.length - 1 ? ' + ' : '';
      return '<span class="' + cls + '">' + t.value + '</span>' + sep;
    })
    .join('');

  el.positionalMath.innerHTML =
    'Octet ' + (d.curtainOctet + 1) + ' (borrowed contribution): ' +
    termsHtml + ' = <span class="equals-result">' + sum + '</span>';

  el.maskDotDecimal.textContent = classlessOctets.join('.');
  el.maskCidr.textContent = '/' + (d.networkBits + d.borrowedBits);
}

/* Renders the borrowed-bits pattern (Panel 4) using the same top-to-bottom
   octet visualization language: total -> weight row -> bits -> label. The
   key difference from a real octet is that the weight row is NOT always
   128-1 — it's scaled to however many bits were borrowed. 3 borrowed bits
   means the pattern can only ever represent 0-7, so the place values are
   4-2-1, not 128-64-32. All bits here are inherently "borrowed" bits, so
   lit weights consistently use the borrowed (amber) color — there's no
   locked/host ambiguity to represent, unlike a full octet. */
function buildBorrowedPatternViz(borrowedPattern) {
  const n = borrowedPattern.length;
  const weights = [];
  for (let k = 0; k < n; k++) weights.push(Math.pow(2, n - 1 - k));
  const kindsSlice = borrowedPattern.map(() => 'borrowed');

  let cellsHtml = '';
  for (let k = 0; k < n; k++) {
    cellsHtml += '<span class="u-bit borrowed-bit">' + borrowedPattern[k] + '</span>';
  }

  // Explicit width (bits * 20px u-bit + 2px border) is required here: with
  // container-type:inline-size set on .octet-bits-group (below, via CSS),
  // container-SIZE containment strips the element's ability to size itself
  // from its own inline-flex content, so an auto/shrink-to-fit width
  // collapses toward 0. That both starves the 30cqi font calc (font stays
  // pinned to its minimum forever) AND makes adjacent .octet-bits-group
  // siblings overlap in normal flow, since the box reports ~0 width while
  // still painting its full content. A definite pixel width sidesteps
  // containment entirely and gives cqi a real basis to scale against.
  const groupWidthPx = n * 20 + 2;

  return '<div class="octet-bits-group" style="width:' + groupWidthPx + 'px">' +
    buildOctetTotalHtml(borrowedPattern, 'octet-total-compact') +
    (n > 0 ? buildWeightRowHtml(borrowedPattern, 'weight-row-compact', kindsSlice, weights) : '') +
    '<span class="unified-octet-cell">' + cellsHtml + '</span>' +
    '<span class="octet-viz-label">Subnet</span>' +
    '</div>';
}

/* Panel 4 formula box: how the borrowed bits determine the subnet count.
   2^n, where n is the number of borrowed bits. */
function buildSubnetFormulaHtml(d) {
  const n = d.borrowedBits;
  return (
    '<span class="formula-line">' +
      '<span class="formula-term">Total Subnets</span> = 2<sup>borrowed bits</sup> = 2<sup>' + n + '</sup> = ' +
      '<span class="formula-highlight-subnet">' + d.totalSubnets + '</span>' +
    '</span>' +
    '<span class="formula-note">Each borrowed bit doubles the number of possible subnets. With ' +
      n + ' bit' + (n === 1 ? '' : 's') + ' borrowed, the classful network splits into 2<sup>' + n + '</sup> = ' +
      d.totalSubnets + ' equal-sized subnet' + (d.totalSubnets === 1 ? '' : 's') + '.</span>'
  );
}

/* Panel 5 formula box: how the remaining host bits determine both the total
   address count (2^h) and the usable host count (2^h - 2, reserving the
   all-zeros Network ID and all-ones Broadcast Address). */
function buildHostFormulaHtml(d) {
  const h = d.hostBits;
  const usable = Math.max(0, d.totalHosts - 2);
  return (
    '<span class="formula-line">' +
      '<span class="formula-term">Total Addresses</span> = 2<sup>host bits</sup> = 2<sup>' + h + '</sup> = ' +
      '<span class="formula-highlight-host">' + d.totalHosts + '</span>' +
    '</span>' +
    '<span class="formula-line">' +
      '<span class="formula-term">Usable Hosts</span> = 2<sup>host bits</sup> &minus; 2 = ' + d.totalHosts + ' &minus; 2 = ' +
      '<span class="formula-highlight-host">' + usable + '</span>' +
    '</span>' +
    '<span class="formula-note">The two reserved addresses are the all-zeros Network ID and the all-ones Broadcast Address — every other host-bit pattern is assignable to a device.</span>'
  );
}

function buildSubnetRows(d) {
  const rows = [];
  const netPrefixBits = d.inputBits.slice(0, d.networkBits);
  for (let n = 0; n < d.totalSubnets; n++) {
    const borrowedPattern = n.toString(2).padStart(d.borrowedBits, '0').split('').map(Number);
    const fullBits = netPrefixBits.concat(borrowedPattern).concat(new Array(d.hostBits).fill(0));
    const octets = bitsToOctets(fullBits);
    rows.push({ index: n, binaryIndex: borrowedPattern.join(''), borrowedBitsArr: borrowedPattern, octets, fullBits });
  }
  return rows;
}

function renderPanel4(d) {
  const rows = buildSubnetRows(d);
  el.subnetCountMeta.textContent = d.totalSubnets + ' total subnet' + (d.totalSubnets === 1 ? '' : 's');

  el.subnetFormulaBox.innerHTML = buildSubnetFormulaHtml(d);
  el.subnetFormulaBox.classList.toggle('hidden', !state.subnetFormulaVisible);
  el.subnetFormulaToggle.classList.toggle('active', state.subnetFormulaVisible);
  el.subnetFormulaToggle.setAttribute('aria-expanded', String(state.subnetFormulaVisible));
  el.subnetFormulaToggle.innerHTML = state.subnetFormulaVisible
    ? '<i class="fa-solid fa-square-root-variable"></i> Hide Formula'
    : '<i class="fa-solid fa-square-root-variable"></i> Show Formula';

  // clamp active index if borrowed bits changed
  if (state.activeSubnetIndex >= d.totalSubnets) state.activeSubnetIndex = 0;

  el.subnetTableBody.innerHTML = '';

  const renderRow = (row) => {
    const tr = document.createElement('tr');
    if (row.index === state.activeSubnetIndex) tr.classList.add('active-row');
    const isActive = row.index === state.activeSubnetIndex;
    const octetBitsCell = buildOctetBitsDisplay(row.fullBits, d);
    tr.innerHTML =
      '<td>' + (row.index + 1) + '</td>' +
      '<td class="nowrap-cell">' + buildBorrowedPatternViz(row.borrowedBitsArr) + '</td>' +
      '<td>' + row.index + '</td>' +
      '<td class="nowrap-cell">' + octetBitsCell + '</td>' +
      '<td>' + row.octets.join('.') + '</td>' +
      '<td><button class="inspect-btn' + (isActive ? ' is-active' : '') + '" data-idx="' + row.index + '" title="' +
      (isActive ? 'Active subnet' : 'Inspect this subnet') + '" aria-label="' +
      (isActive ? 'Active subnet' : 'Inspect this subnet') + '">' +
      (isActive ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-magnifying-glass"></i>') + '</button></td>';
    tr.querySelector('.inspect-btn').addEventListener('click', () => {
      state.activeSubnetIndex = row.index;
      render();
    });
    el.subnetTableBody.appendChild(tr);
  };

  if (d.totalSubnets <= 8) {
    rows.forEach(renderRow);
  } else if (!state.subnetsExpanded) {
    rows.slice(0, 5).forEach(renderRow);
    const hiddenCount = d.totalSubnets - 8;
    const trExp = document.createElement('tr');
    trExp.className = 'expansion-row';
    trExp.innerHTML =
      '<td colspan="6"><button class="expansion-btn" id="subnetExpandBtn"><i class="fa-solid fa-eye"></i> Show ' + hiddenCount + ' Hidden Subnets</button></td>';
    el.subnetTableBody.appendChild(trExp);
    document.getElementById('subnetExpandBtn').addEventListener('click', () => {
      state.subnetsExpanded = true;
      render();
    });
    rows.slice(-3).forEach(renderRow);
  } else {
    rows.forEach(renderRow);
    const trCollapse = document.createElement('tr');
    trCollapse.className = 'expansion-row';
    trCollapse.innerHTML = '<td colspan="6"><button class="expansion-btn" id="subnetCollapseBtn"><i class="fa-solid fa-chevron-up"></i> Collapse</button></td>';
    el.subnetTableBody.appendChild(trCollapse);
    document.getElementById('subnetCollapseBtn').addEventListener('click', () => {
      state.subnetsExpanded = false;
      render();
    });
  }

  return rows;
}

function roleForHostIndex(h, total) {
  if (h === 0) return { label: '<i class="fa-solid fa-ban"></i> Network ID', cls: 'role-network' };
  if (h === 1) return { label: '<i class="fa-solid fa-circle-check"></i> First Usable Host', cls: 'role-first' };
  if (h === total - 2) return { label: '<i class="fa-solid fa-circle-check"></i> Last Usable Host', cls: 'role-last' };
  if (h === total - 1) return { label: '<i class="fa-solid fa-bullhorn"></i> Broadcast Address', cls: 'role-broadcast' };
  return { label: 'Usable Host', cls: 'role-usable' };
}

function buildSingleOctetBits(fullBits, d, octetIndex) {
  const octetStart = octetIndex * 8;
  const bitsSlice = fullBits.slice(octetStart, octetStart + 8);
  const kindsSlice = [];
  let cellsHtml = '';
  for (let k = 0; k < 8; k++) {
    const globalIndex = octetStart + k;
    let kind = 'host';
    if (globalIndex < d.networkBits) kind = 'locked';
    else if (globalIndex < d.networkBits + d.borrowedBits) kind = 'borrowed';
    kindsSlice.push(kind);
    const isCurtainBit = globalIndex === d.networkBits + d.borrowedBits - 1 && d.borrowedBits > 0 && globalIndex < octetStart + 7;
    cellsHtml += '<span class="u-bit ' + kind + '-bit' + (isCurtainBit ? ' curtain-before' : '') + '">' + fullBits[globalIndex] + '</span>';
  }
  // See buildBorrowedPatternViz for why this explicit width is required
  // (container-size containment from container-type:inline-size otherwise
  // collapses this box to ~0 width, causing the multi-octet overlap seen
  // on Class A/B rows and starving the 30cqi total font-size calc).
  const groupWidthPx = 8 * 20 + 2;
  return '<div class="octet-bits-group" style="width:' + groupWidthPx + 'px">' +
    buildOctetTotalHtml(bitsSlice, 'octet-total-compact', octetIndex < 3) +
    buildWeightRowHtml(bitsSlice, 'weight-row-compact', kindsSlice) +
    '<span class="unified-octet-cell">' + cellsHtml + '</span>' +
    '<span class="octet-viz-label">Octet ' + (octetIndex + 1) + '</span>' +
    '</div>';
}

// Renders bit-level detail for every octet that isn't 100% locked network
// bits — i.e. every octet touched by borrowed or host bits. For Class C this
// is just the last octet; for Class B it's the last two; for Class A it's
// the last three. This keeps the visualization accurate across all classes
// instead of assuming only one (the last) octet ever varies.
function buildOctetBitsDisplay(fullBits, d) {
  if (d.networkBits >= 32) return '<span class="secondary-copy">—</span>';
  const startOctet = Math.min(3, Math.floor(d.networkBits / 8));
  let out = '<div class="octet-bits-row">';
  for (let o = startOctet; o < 4; o++) {
    out += buildSingleOctetBits(fullBits, d, o);
  }
  out += '</div>';
  return out;
}

function renderPanel5(d, subnetRows) {
  const activeSubnet = subnetRows[state.activeSubnetIndex] || subnetRows[0];
  el.activeSubnetMeta.textContent =
    'Subnet ' + (activeSubnet ? activeSubnet.index : 0) + ' — ' + (activeSubnet ? activeSubnet.octets.join('.') : '') +
    ' (' + d.totalHosts + ' addresses)';

  el.hostFormulaBox.innerHTML = buildHostFormulaHtml(d);
  el.hostFormulaBox.classList.toggle('hidden', !state.hostFormulaVisible);
  el.hostFormulaToggle.classList.toggle('active', state.hostFormulaVisible);
  el.hostFormulaToggle.setAttribute('aria-expanded', String(state.hostFormulaVisible));
  el.hostFormulaToggle.innerHTML = state.hostFormulaVisible
    ? '<i class="fa-solid fa-square-root-variable"></i> Hide Formula'
    : '<i class="fa-solid fa-square-root-variable"></i> Show Formula';

  el.hostTableBody.innerHTML = '';
  if (!activeSubnet) return;

  const baseBits = activeSubnet.fullBits.slice(0, d.networkBits + d.borrowedBits);

  const renderHostRow = (h) => {
    const hostBitsArr = h.toString(2).padStart(d.hostBits, '0').split('').map(Number);
    const fullBits = baseBits.concat(hostBitsArr);
    const octets = bitsToOctets(fullBits);
    const role = roleForHostIndex(h, d.totalHosts);

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (h + 1) + '</td>' +
      '<td>' + octets.join('.') + '</td>' +
      '<td class="nowrap-cell">' + buildOctetBitsDisplay(fullBits, d) + '</td>' +
      '<td><span class="badge-role ' + role.cls + '">' + role.label + '</span></td>';
    el.hostTableBody.appendChild(tr);
  };

  if (d.totalHosts <= 8) {
    for (let h = 0; h < d.totalHosts; h++) renderHostRow(h);
  } else if (!state.hostsExpanded) {
    for (let h = 0; h < 5; h++) renderHostRow(h);
    const hiddenCount = d.totalHosts - 8;
    const trExp = document.createElement('tr');
    trExp.className = 'expansion-row';
    trExp.innerHTML = '<td colspan="4"><button class="expansion-btn" id="hostExpandBtn"><i class="fa-solid fa-eye"></i> Show ' + hiddenCount + ' Hidden Hosts</button></td>';
    el.hostTableBody.appendChild(trExp);
    document.getElementById('hostExpandBtn').addEventListener('click', () => {
      state.hostsExpanded = true;
      render();
    });
    for (let h = d.totalHosts - 3; h < d.totalHosts; h++) renderHostRow(h);
  } else {
    const cap = Math.min(d.totalHosts, 4096);
    for (let h = 0; h < cap; h++) renderHostRow(h);
    const trCollapse = document.createElement('tr');
    trCollapse.className = 'expansion-row';
    trCollapse.innerHTML = '<td colspan="4"><button class="expansion-btn" id="hostCollapseBtn"><i class="fa-solid fa-chevron-up"></i> Collapse</button></td>';
    el.hostTableBody.appendChild(trCollapse);
    document.getElementById('hostCollapseBtn').addEventListener('click', () => {
      state.hostsExpanded = false;
      render();
    });
  }
}

/* ---------------- Master render ---------------- */
function render() {
  const d = computeDerived();
  // keep state.borrowedBits clamped so UI/state stay in sync
  state.borrowedBits = d.borrowedBits;

  renderPanel1(d);
  renderPanel2(d);
  renderPanel3(d);
  const subnetRows = renderPanel4(d);
  renderPanel5(d, subnetRows);
}

/* ---------------- Event handlers ---------------- */
function onBitClick(globalIndex) {
  const d = computeDerived();
  if (d.classInfo.warning) return; // borrowing disabled
  if (globalIndex < d.networkBits) return; // locked network bit

  let newBorrowed = globalIndex - d.networkBits + 1;
  newBorrowed = Math.max(0, Math.min(newBorrowed, d.maxBorrow));

  state.borrowedBits = newBorrowed;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function onOctetInput() {
  state.octets = el.octetInputs.map((inp) => {
    const v = parseInt(inp.value, 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
  });
  // Reset subnetting context on IP change (class may have changed)
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  if (state.borrowedBits === undefined) state.borrowedBits = 3;
  else state.borrowedBits = 3; // default per spec when class re-evaluated
  render();
}

function applyPreset(name) {
  const presets = {
    A: [10, 0, 0, 0],
    B: [172, 16, 0, 0],
    C: [192, 168, 1, 0],
  };
  state.octets = presets[name];
  el.octetInputs.forEach((inp, i) => (inp.value = state.octets[i]));
  state.borrowedBits = 3;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function resetToClassful() {
  const d = computeDerived();
  if (d.classInfo.warning) return; // nothing to reset when borrowing is already disabled
  state.borrowedBits = 0;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function togglePresenterMode() {
  state.presenterMode = !state.presenterMode;
  document.body.classList.toggle('presenter-mode', state.presenterMode);
  el.presenterToggle.classList.toggle('active', state.presenterMode);
  el.presenterToggle.innerHTML = state.presenterMode
    ? '<i class="fa-solid fa-tv"></i> Presenter Mode: On'
    : '<i class="fa-solid fa-tv"></i> Presenter Mode';
}

/* ---------------- Init ---------------- */
function init() {
  el.octetInputs.forEach((inp) => inp.addEventListener('input', onOctetInput));
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  el.presenterToggle.addEventListener('click', togglePresenterMode);
  el.resetBorrowBtn.addEventListener('click', resetToClassful);
  el.subnetFormulaToggle.addEventListener('click', () => {
    state.subnetFormulaVisible = !state.subnetFormulaVisible;
    render();
  });
  el.hostFormulaToggle.addEventListener('click', () => {
    state.hostFormulaVisible = !state.hostFormulaVisible;
    render();
  });
  render();
}

document.addEventListener('DOMContentLoaded', init);
