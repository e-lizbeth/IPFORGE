/**
 * IPFORGE — IPv4 Subnetting Calculator & Network Planning Tool
 * script.js  —  All calculations, validation, and UI logic
 *
 * Author  : IPFORGE Project
 * Purpose : Perform correct IPv4 subnetting mathematics and render results
 */

/* ──────────────────────────────────────────────────────────
   UTILITY FUNCTIONS
   ────────────────────────────────────────────────────────── */

/**
 * Convert a 32-bit integer to a dotted-decimal IPv4 string.
 * e.g. 3232235776 → "192.168.1.0"
 */
function intToIp(n) {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8)  & 0xff,
    n          & 0xff
  ].join('.');
}

/**
 * Convert a dotted-decimal IPv4 string to a 32-bit integer.
 * e.g. "192.168.1.0" → 3232235776
 */
function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Build a subnet-mask integer from a CIDR prefix length.
 * e.g. prefix=24 → 0xFFFFFF00
 */
function prefixToMask(prefix) {
  if (prefix === 0) return 0;
  return (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

/**
 * Convert a mask integer back to dotted-decimal notation.
 */
function maskToString(maskInt) {
  return intToIp(maskInt);
}

/* ──────────────────────────────────────────────────────────
   INPUT VALIDATION
   ────────────────────────────────────────────────────────── */

/**
 * Validate an IPv4 address string.
 * Returns { valid: true } or { valid: false, message: "..." }
 */
function validateIp(ip) {
  const trimmed = ip.trim();
  if (!trimmed) return { valid: false, message: 'IPv4 address cannot be empty.' };

  const parts = trimmed.split('.');
  if (parts.length !== 4) {
    return { valid: false, message: 'IPv4 address must have exactly 4 octets (e.g. 192.168.1.0).' };
  }

  for (let i = 0; i < 4; i++) {
    const raw = parts[i];
    // Must not be empty or contain non-digit characters
    if (!/^\d+$/.test(raw)) {
      return { valid: false, message: `Octet ${i + 1} ("${raw}") contains non-numeric characters.` };
    }
    const num = parseInt(raw, 10);
    if (num < 0 || num > 255) {
      return { valid: false, message: `Octet ${i + 1} value (${num}) is out of range 0–255.` };
    }
  }
  return { valid: true };
}

/**
 * Validate a CIDR prefix (/0 – /32).
 * Accepts input with or without the leading slash.
 */
function validatePrefix(raw) {
  const trimmed = raw.trim().replace(/^\//, ''); // strip leading slash if present
  if (trimmed === '') return { valid: false, message: 'CIDR prefix cannot be empty.' };
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, message: 'CIDR prefix must be a whole number (e.g. 24 or /24).' };
  }
  const num = parseInt(trimmed, 10);
  if (num < 0 || num > 32) {
    return { valid: false, message: `CIDR prefix ${num} is out of range /0 – /32.` };
  }
  return { valid: true, value: num };
}

/**
 * Validate the requested number of subnets.
 * Must be a positive integer power of 2 (1, 2, 4, 8, 16, …).
 * The value is also checked against how many subnets the network can actually hold.
 */
function validateSubnetCount(raw, maxSubnets) {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: false, message: 'Number of subnets cannot be empty.' };
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, message: 'Number of subnets must be a whole number.' };
  }
  const num = parseInt(trimmed, 10);
  if (num < 1) {
    return { valid: false, message: 'Number of subnets must be at least 1.' };
  }
  // Must be a power of 2
  if ((num & (num - 1)) !== 0) {
    return {
      valid: false,
      message: `${num} is not a power of 2. Valid counts for subnetting are 1, 2, 4, 8, 16, 32, 64, 128, ...`
    };
  }
  if (num > maxSubnets) {
    return {
      valid: false,
      message: `Cannot create ${num} subnets from this network. Maximum possible is ${maxSubnets}.`
    };
  }
  return { valid: true, value: num };
}

/* ──────────────────────────────────────────────────────────
   CORE SUBNETTING MATHEMATICS
   ────────────────────────────────────────────────────────── */

/**
 * Calculate the number of bits needed to represent `count` subnets.
 * e.g. count=4  → 2 bits  (2^2 = 4)
 */
function bitsNeeded(count) {
  return Math.ceil(Math.log2(count === 1 ? 2 : count));
}

/**
 * Given a base network (ip + prefix), split it into `numSubnets` equal subnets.
 *
 * Returns an array of subnet descriptor objects, each containing:
 *   { index, networkAddr, newPrefix, maskStr,
 *     firstHost, lastHost, broadcastAddr,
 *     totalAddresses, usableHosts }
 */
function calculateSubnets(ipStr, prefix, numSubnets) {
  const networkInt  = ipToInt(ipStr) & prefixToMask(prefix); // enforce network address
  const subnetBits  = bitsNeeded(numSubnets);                // extra bits borrowed
  const newPrefix   = prefix + subnetBits;                   // new prefix length

  // Guard: newPrefix must not exceed 32
  if (newPrefix > 32) {
    return { error: `Cannot create ${numSubnets} subnets — the new prefix /${newPrefix} exceeds /32.` };
  }

  const newMaskInt      = prefixToMask(newPrefix);
  const totalAddresses  = Math.pow(2, 32 - newPrefix);       // addresses per subnet
  const subnets         = [];

  for (let i = 0; i < numSubnets; i++) {
    const netAddr  = (networkInt + i * totalAddresses) >>> 0;
    const bcast    = (netAddr + totalAddresses - 1) >>> 0;

    let firstHost, lastHost, usableHosts;

    if (newPrefix === 32) {
      // /32 — single host, no separate host range
      firstHost  = intToIp(netAddr);
      lastHost   = intToIp(netAddr);
      usableHosts = 1;
    } else if (newPrefix === 31) {
      // /31 — point-to-point link (RFC 3021); both addresses usable
      firstHost   = intToIp(netAddr);
      lastHost    = intToIp(bcast);
      usableHosts = 2;
    } else {
      firstHost   = intToIp((netAddr + 1) >>> 0);
      lastHost    = intToIp((bcast - 1) >>> 0);
      usableHosts = totalAddresses - 2;
    }

    subnets.push({
      index          : i + 1,
      networkAddr    : intToIp(netAddr),
      newPrefix,
      maskStr        : maskToString(newMaskInt),
      firstHost,
      lastHost,
      broadcastAddr  : intToIp(bcast),
      totalAddresses,
      usableHosts,
      isSpecial      : newPrefix >= 31   // flag for /31 and /32 note
    });
  }

  return { subnets, newPrefix, newMaskInt, totalAddresses };
}

/* ──────────────────────────────────────────────────────────
   DOM HELPERS — Show / Hide UI Sections
   ────────────────────────────────────────────────────────── */

function showError(message) {
  const box = document.getElementById('error-box');
  box.textContent = message;
  box.classList.remove('hidden');
  document.getElementById('results-section').classList.add('hidden');
}

function clearError() {
  const box = document.getElementById('error-box');
  box.textContent = '';
  box.classList.add('hidden');
}

function showResults() {
  document.getElementById('results-section').classList.remove('hidden');
}

/* ──────────────────────────────────────────────────────────
   RESULTS RENDERING
   ────────────────────────────────────────────────────────── */

/**
 * Render the four summary cards at the top of the results section.
 */
function renderSummaryCards(ipStr, prefix, result) {
  document.getElementById('card-network').textContent  = `${ipStr}/${prefix}`;
  document.getElementById('card-mask').textContent     = result.subnets[0].maskStr;
  document.getElementById('card-total-subnets').textContent = result.subnets.length;
  document.getElementById('card-hosts').textContent    = result.subnets[0].usableHosts;
}

/**
 * Render the subnet details table.
 */
function renderTable(subnets) {
  const tbody = document.getElementById('subnet-tbody');
  tbody.innerHTML = ''; // clear previous results

  subnets.forEach(s => {
    const tr = document.createElement('tr');

    // Build host range text
    let hostRange;
    if (s.newPrefix === 32) {
      hostRange = `${s.firstHost} (host only)`;
    } else if (s.newPrefix === 31) {
      hostRange = `${s.firstHost} – ${s.lastHost} (P2P)`;
    } else {
      hostRange = `${s.firstHost} – ${s.lastHost}`;
    }

    tr.innerHTML = `
      <td class="td-index">${s.index}</td>
      <td><span class="addr-badge">${s.networkAddr}/${s.newPrefix}</span></td>
      <td>${s.maskStr}</td>
      <td class="host-range">${hostRange}</td>
      <td><span class="addr-badge bcast">${s.broadcastAddr}</span></td>
      <td class="num-cell">${s.totalAddresses}</td>
      <td class="num-cell">${s.usableHosts}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Render a special note if any subnets are /31 or /32.
 */
function renderSpecialNote(subnets) {
  const noteEl = document.getElementById('special-note');
  const hasSpecial = subnets.some(s => s.isSpecial);

  if (hasSpecial) {
    const prefix = subnets[0].newPrefix;
    let msg = '';
    if (prefix === 32) {
      msg = '⚠️ /32 subnets contain exactly one address. They are used for host routes or loopback interfaces — there is no separate network/broadcast address.';
    } else {
      msg = '⚠️ /31 subnets are point-to-point links (RFC 3021). Both addresses are usable host addresses; there is no traditional broadcast address.';
    }
    noteEl.textContent = msg;
    noteEl.classList.remove('hidden');
  } else {
    noteEl.classList.add('hidden');
  }
}

/* ──────────────────────────────────────────────────────────
   COPY RESULTS
   ────────────────────────────────────────────────────────── */

/**
 * Build a plain-text representation of the results and copy it to clipboard.
 */
function copyResults() {
  const rows  = document.querySelectorAll('#subnet-tbody tr');
  if (!rows.length) return;

  const lines = [
    'IPFORGE — Subnet Calculation Results',
    '======================================',
    `Network   : ${document.getElementById('card-network').textContent}`,
    `Mask      : ${document.getElementById('card-mask').textContent}`,
    `Subnets   : ${document.getElementById('card-total-subnets').textContent}`,
    `Hosts/Sub : ${document.getElementById('card-hosts').textContent}`,
    '',
    '#  | Network/CIDR          | Mask              | Host Range                          | Broadcast       | Total | Usable',
    '---+-----------------------+-------------------+-------------------------------------+-----------------+-------+-------'
  ];

  rows.forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    // cells: [idx, network/cidr, mask, hostRange, broadcast, total, usable]
    lines.push(
      `${cells[0].padEnd(2)} | ${cells[1].padEnd(21)} | ${cells[2].padEnd(17)} | ${cells[3].padEnd(35)} | ${cells[4].padEnd(15)} | ${cells[5].padEnd(5)} | ${cells[6]}`
    );
  });

  lines.push('');
  lines.push('Generated by IPFORGE — IPv4 Subnetting Calculator & Network Planning Tool');

  const text = lines.join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flashCopyBtn('✔ Copied!')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  flashCopyBtn('✔ Copied!');
}

function flashCopyBtn(label) {
  const btn = document.getElementById('copy-btn');
  const original = btn.textContent;
  btn.textContent = label;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 2000);
}

/* ──────────────────────────────────────────────────────────
   MAIN — Calculate Button Handler
   ────────────────────────────────────────────────────────── */

function calculate() {
  clearError();

  // ── Grab raw inputs ──────────────────────────────────────
  const ipRaw      = document.getElementById('ip-input').value;
  const prefixRaw  = document.getElementById('prefix-input').value;
  const countRaw   = document.getElementById('subnet-count').value;

  // ── Validate IPv4 ────────────────────────────────────────
  const ipCheck = validateIp(ipRaw);
  if (!ipCheck.valid) { showError(ipCheck.message); return; }

  // ── Validate CIDR prefix ─────────────────────────────────
  const prefixCheck = validatePrefix(prefixRaw);
  if (!prefixCheck.valid) { showError(prefixCheck.message); return; }
  const prefix = prefixCheck.value;

  // Prefix /31 and /32 cannot be further subnetted
  if (prefix > 30) {
    showError(`A /${prefix} network cannot be subnetted further. It has no host bits available for subnet borrowing.`);
    return;
  }

  // ── Compute max possible subnets ─────────────────────────
  const hostBits   = 32 - prefix;
  // We can borrow up to (hostBits - 1) bits for subnets to keep at least 1 host bit
  const maxBorrow  = hostBits - 1;
  const maxSubnets = Math.pow(2, maxBorrow);

  // ── Validate subnet count ────────────────────────────────
  const countCheck = validateSubnetCount(countRaw, maxSubnets);
  if (!countCheck.valid) { showError(countCheck.message); return; }
  const numSubnets = countCheck.value;

  // ── Enforce network address (zero host bits) ─────────────
  const maskInt   = prefixToMask(prefix);
  const ipInt     = ipToInt(ipRaw.trim());
  const netInt    = (ipInt & maskInt) >>> 0;
  const ipStr     = intToIp(netInt);  // canonical network address

  // ── Run calculations ─────────────────────────────────────
  const result = calculateSubnets(ipStr, prefix, numSubnets);

  if (result.error) {
    showError(result.error);
    return;
  }

  // ── Render results ───────────────────────────────────────
  renderSummaryCards(ipStr, prefix, result);
  renderTable(result.subnets);
  renderSpecialNote(result.subnets);
  showResults();

  // Scroll to results
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ──────────────────────────────────────────────────────────
   RESET Button Handler
   ────────────────────────────────────────────────────────── */

function resetForm() {
  document.getElementById('ip-input').value      = '';
  document.getElementById('prefix-input').value  = '';
  document.getElementById('subnet-count').value  = '';
  clearError();
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('special-note').classList.add('hidden');
  document.getElementById('ip-input').focus();
}

/* ──────────────────────────────────────────────────────────
   KEYBOARD SUPPORT — Enter triggers Calculate
   ────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  ['ip-input', 'prefix-input', 'subnet-count'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calculate();
    });
  });

  // Populate the subnet count dropdown options dynamically
  populateSubnetDropdown();
});

/**
 * Fill the subnet count dropdown with powers of 2 from 1 to 128.
 */
function populateSubnetDropdown() {
  const select = document.getElementById('subnet-count');
  // Clear existing options except the placeholder
  while (select.options.length > 1) select.remove(1);

  const values = [1, 2, 4, 8, 16, 32, 64, 128];
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v === 1 ? '1 subnet (no split)' : `${v} subnets`;
    select.appendChild(opt);
  });
}
