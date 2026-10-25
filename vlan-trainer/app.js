(() => {
'use strict';
const HEADLESS = typeof document === 'undefined';

// ---------- helpers ----------
const $ = s => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(a, r = Math.random) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('vst:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vst:' + k, JSON.stringify(v)); } catch {} },
};

// ---------- constants ----------
const SW_IDS = ['S1', 'S2', 'S3'];
const SW_NAME = { S1: 'Switch1', S2: 'Switch2', S3: 'Switch3' };
const TRUNK_PORTS = ['Fa0/23', 'Fa0/24'];
const ALL_PORTS = [...Array.from({ length: 24 }, (_, i) => 'Fa0/' + (i + 1)), 'Gig0/1', 'Gig0/2'];
const ZONE = { BLUE: '#55d6f2', GREEN: '#63ef8c', RED: '#ff8080', YELLOW: '#ffe169', ORANGE: '#ffb25e', PURPLE: '#c4a3ff', PINK: '#ffa3dc', BROWN: '#d0a77f' };
const NET = '192.168.100.';
const LOOKUP_MS = 6000;
const SUFFIX = { user: '>', priv: '#', conf: '(config)#', vlan: '(config-vlan)#', if: '(config-if)#', range: '(config-if-range)#', svi: '(config-if)#', line: '(config-line)#' };
const CONF_MODES = new Set(['conf', 'vlan', 'if', 'range', 'svi', 'line']);
const SUB_MODES = new Set(['vlan', 'if', 'range', 'svi', 'line']);
const longName = p => p === 'Fa0' ? 'FastEthernet0' : p.startsWith('Fa') ? 'FastEthernet' + p.slice(2) : 'GigabitEthernet' + p.slice(3);
const pad4 = n => String(n).padStart(4, '0');
const isDefaultVlan = id => id === 1 || (id >= 1002 && id <= 1005);

// ---------- scenarios ----------
const PRESETS = {
  exam20: {
    title: '20 PC Exam', seed: 20,
    colors: [['BLUE', 100], ['GREEN', 200], ['RED', 300], ['YELLOW', 400], ['ORANGE', 500]],
    assign: { S1: { BLUE: [13, 14, 15], GREEN: [22, 6, 17], RED: [1, 9, 10], YELLOW: [3, 4, 20] }, S2: { ORANGE: [1, 2], RED: [5], BLUE: [8] }, S3: { GREEN: [3], YELLOW: [4], ORANGE: [5, 6] } },
    servers: [['BLUE', '192.168.100.2'], ['GREEN', '192.168.100.3']],
  },
  quiz: {
    title: 'Original quiz', seed: 6,
    colors: [['BLUE', 100], ['GREEN', 200]],
    assign: { S1: { BLUE: [13, 14, 15], GREEN: [22, 6, 17] }, S2: {}, S3: {} },
    servers: [['BLUE', '192.168.100.2']],
  },
};

function presetScenario(key) {
  const def = PRESETS[key];
  const assign = {};
  for (const s of SW_IDS) {
    assign[s] = {};
    for (const [c, ps] of Object.entries(def.assign[s] || {})) assign[s][c] = ps.map(n => 'Fa0/' + n);
  }
  return {
    key, title: def.title, seed: def.seed, assign,
    colors: def.colors.map(([name, vlan]) => ({ name, vlan })),
    servers: def.servers.map(([color, ip]) => ({ color, ip, name: color + ' ENROLLMENT' })),
  };
}

// Easy: 2 colors on Switch1 in neat port blocks. Normal: 4 colors spread over the switches. Hard: 6 colors, odd VLAN IDs, 3 servers.
const LEVELS = {
  easy: { title: 'Easy', colors: 2, per: 3, s1: 1, servers: 1, blocks: true, simpleIds: true },
  normal: { title: 'Normal', colors: 4, per: 3, s1: 0.7, servers: 2 },
  hard: { title: 'Hard', colors: 6, per: 4, s1: 0.5, servers: 3, oddIds: true },
};
function levelScenario(level) {
  const L = LEVELS[level];
  return { ...randomScenario(L.colors, L.per, L), key: level, title: L.title + ' exam' };
}

function randomScenario(nColors, perColor, o = {}) {
  const r = Math.random;
  const names = ['BLUE', 'GREEN', ...shuffle(['RED', 'YELLOW', 'ORANGE', 'PURPLE', 'PINK', 'BROWN'])].slice(0, nColors);
  const schemes = [i => (i + 1) * 100, i => (i + 1) * 10, i => (i + 1) * 11, i => 100 + (i + 1) * 5, i => (i + 2) * 20];
  const scheme = schemes[Math.floor(r() * schemes.length)];
  const oddIds = shuffle(Array.from({ length: 998 }, (_, i) => i + 2)).slice(0, nColors);
  const colors = names.map((name, i) => ({ name, vlan: o.oddIds ? oddIds[i] : o.simpleIds ? (i + 1) * 100 : scheme(i) }));
  const range = Array.from({ length: 22 }, (_, i) => i + 1);
  const pools = { S1: shuffle(range), S2: shuffle(range), S3: shuffle(range) };
  if (o.blocks) {
    const start = 1 + Math.floor(r() * (23 - nColors * perColor));
    pools.S1 = Array.from({ length: nColors * perColor }, (_, i) => start + i).reverse();
  }
  const s1 = o.s1 == null ? 0.7 : o.s1;
  const assign = { S1: {}, S2: {}, S3: {} };
  for (const c of colors) {
    for (let j = 0; j < perColor; j++) {
      let sw = r() < s1 ? 'S1' : (r() < 0.5 ? 'S2' : 'S3');
      if (pools[sw].length <= (sw === 'S3' ? 4 : 0)) sw = SW_IDS.find(s => pools[s].length > (s === 'S3' ? 4 : 0));
      (assign[sw][c.name] = assign[sw][c.name] || []).push('Fa0/' + pools[sw].pop());
    }
  }
  const nServers = Math.min(nColors, o.servers || (nColors >= 2 && r() < 0.65 ? 2 : 1));
  const servers = colors.slice(0, nServers).map((c, i) => ({ color: c.name, ip: NET + (2 + i), name: c.name + ' ENROLLMENT' }));
  return { key: `random-${nColors}x${perColor}`, title: `Random, ${nColors} colors`, seed: Math.floor(r() * 1e9), colors, assign, servers };
}

function makeDevices(sc, presetIps) {
  const r = rng(sc.seed);
  const devs = [];
  let n = 0;
  for (const s of SW_IDS) {
    const list = [];
    for (const [c, ps] of Object.entries(sc.assign[s])) for (let i = 0; i < ps.length; i++) list.push({ color: c, home: s });
    for (const d of shuffle(list, r)) devs.push({ ...d, type: 'pc', id: 'pc' + n, name: 'PC' + n++ });
  }
  sc.servers.forEach((sv, i) => devs.push({ id: 'srv' + i, name: sv.name, type: 'server', color: sv.color, home: 'S3', fixedIp: sv.ip }));
  devs.forEach((d, i) => {
    const ip = d.type === 'server' ? d.fixedIp : NET + (10 + i);
    Object.assign(d, { ip: presetIps ? ip : '', mask: presetIps ? '255.255.255.0' : '', gw: '', arp: new Set(), x: 0, y: 0, cmd: ['Cisco Packet Tracer PC Command Line 1.0'], cmdBusy: false, app: null, url: 'http://' });
  });
  return devs;
}

// ---------- state ----------
let S = null;
const PREFS = Object.assign({ live: true, paste: true, labels: true, ips: false, mode: 'exam20', nColors: 4, perColor: 3 }, store.get('prefs2', {}));
const savePrefs = () => store.set('prefs2', PREFS);

// Everything "write memory" saves and "reload" restores (VLANs and VTP live in vlan.dat instead)
function defaultConfig() {
  const ports = {};
  for (const p of ALL_PORTS) ports[p] = { mode: 'dynamic auto', access: 1, shut: false, allowed: null, native: 1, portfast: false };
  return { hostname: 'Switch', ports, lookup: true, svis: new Map([[1, { ip: '', mask: '', shut: true }]]), gw: '', secret: '', enpass: '', lines: {}, banner: '', pfDefault: false, spe: false };
}
const CONFIG_KEYS = Object.keys(defaultConfig());
const snapshot = sw => structuredClone(Object.fromEntries(CONFIG_KEYS.map(k => [k, sw[k]])));

const defaultVlans = () => new Map([[1, 'default'], [1002, 'fddi-default'], [1003, 'token-ring-default'], [1004, 'fddinet-default'], [1005, 'trnet-default']]);
const BOOT_LINES = ['Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)', 'Technical Support: http://www.cisco.com/techsupport', 'Copyright (c) 1986-2013 by Cisco Systems, Inc.', 'Compiled Wed 26-Jun-13 02:49 by mnguyen', '', '', 'Press RETURN to get started!', ''];
function newSwitch(id) {
  return {
    ...defaultConfig(), id, name: SW_NAME[id], x: 0, y: 0,
    vtp: { mode: 'server', domain: '', rev: 0 }, startup: null, dirty: false, vlanDatDeleted: false,
    vlans: defaultVlans(),
    cli: {
      buf: [...BOOT_LINES],
      mode: 'boot', ctx: null, hist: [], hi: 0, busy: null, ask: null, plen: 0, view: null, modeSet: false, queue: null, termLen: 24, more: null,
    },
  };
}

function startRun(sc, presetIps) {
  S = { sc, presetIps, started: Date.now(), switches: {}, devices: makeDevices(sc, presetIps), links: [], linkSeq: 0, tool: 'select', sticky: false, pending: null, pduSrc: null, events: [], t0: null, tEnd: null, reveal: null, mouse: null, vbW: 1400 };
  for (const id of SW_IDS) S.switches[id] = newSwitch(id);
  layout();
  addLink({ dev: 'S1', port: 'Fa0/24' }, { dev: 'S2', port: 'Fa0/23' }, true);
  addLink({ dev: 'S2', port: 'Fa0/24' }, { dev: 'S3', port: 'Fa0/23' }, true);
}

function layout() {
  let cursor = 70;
  for (const s of SW_IDS) {
    const pcs = S.devices.filter(d => d.type === 'pc' && d.home === s);
    const n = pcs.length;
    const rowsPerSide = n > 14 ? 2 : 1;
    const perRow = Math.max(2, Math.ceil(n / (2 * rowsPerSide)));
    const w = perRow * 92;
    const cx = cursor + w / 2;
    Object.assign(S.switches[s], { x: cx, y: 380 });
    const rowsY = [200, 560, 90, 670];
    pcs.forEach((d, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const cnt = Math.min(perRow, n - row * perRow);
      d.x = cx + (col - (cnt - 1) / 2) * 92;
      d.y = rowsY[row];
    });
    cursor += w + 70;
  }
  const srv = S.devices.filter(d => d.type === 'server');
  srv.forEach((d, i) => { d.x = cursor + 30; d.y = 380 + (i - (srv.length - 1) / 2) * 170; });
  S.vbW = cursor + 130;
}

// ---------- topology ----------
const devById = id => S.devices.find(d => d.id === id);
const nodeById = id => S.switches[id] || devById(id);
const linkAt = (dev, port) => S.links.find(l => (l.a.dev === dev && l.a.port === port) || (l.b.dev === dev && l.b.port === port));
const otherEnd = (l, dev, port) => (l.a.dev === dev && l.a.port === port) ? l.b : l.a;
function attach(d) {
  const l = linkAt(d.id, 'Fa0');
  if (!l) return null;
  const o = otherEnd(l, d.id, 'Fa0');
  return S.switches[o.dev] ? { sw: o.dev, port: o.port } : null;
}

function addLink(a, b, fixed = false) {
  const l = { id: 'L' + (++S.linkSeq), a, b, t: fixed ? 0 : Date.now() };
  S.links.push(l);
  vtpSync();
  for (const e of [a, b]) {
    const sw = S.switches[e.dev];
    if (sw && !sw.ports[e.port].shut) linkMsg(sw, e.port, 'up');
  }
  if (!fixed && !HEADLESS) setTimeout(onChange, STP_MS + 100);
  onChange();
  return l;
}
// A new PC cable stays orange (STP listening/learning) and passes no traffic until it turns green or you press Fast Forward Time
const STP_MS = 30000;
function linkWaiting(l) {
  if (HEADLESS || !l || !(l.t > 0) || Date.now() - l.t >= STP_MS) return false;
  // PortFast skips the wait on the switch side
  return ![l.a, l.b].some(e => { const sw = S.switches[e.dev]; if (!sw) return false; const pt = sw.ports[e.port]; return pt.portfast || (sw.pfDefault && pt.mode === 'access'); });
}
function fastForward() {
  touch();
  S.links.forEach(l => { l.t = 0; });
  onChange();
}
function removeLink(l) {
  S.links = S.links.filter(x => x !== l);
  for (const e of [l.a, l.b]) {
    const sw = S.switches[e.dev];
    if (sw && !sw.ports[e.port].shut) linkMsg(sw, e.port, 'down');
  }
  onChange();
}

// ---------- network model ----------
function trunkUp(swA, pA, swB, pB) {
  const a = S.switches[swA].ports[pA], b = S.switches[swB].ports[pB];
  if (a.shut || b.shut) return false;
  if (a.mode === 'access' || b.mode === 'access') return false;
  if (a.mode === 'trunk' || b.mode === 'trunk') return true;
  return a.mode === 'dynamic desirable' || b.mode === 'dynamic desirable'; // auto + auto never trunks
}
function portOper(swId, p) {
  const pt = S.switches[swId].ports[p];
  const l = linkAt(swId, p);
  if (pt.shut || !l) return 'down';
  const o = otherEnd(l, swId, p);
  if (S.switches[o.dev]) return trunkUp(swId, p, o.dev, o.port) ? 'trunk' : 'access';
  return pt.mode === 'trunk' ? 'trunk' : 'access';
}
function hostSegment(d) {
  const at = attach(d);
  if (!at || linkWaiting(linkAt(d.id, 'Fa0'))) return null;
  const sw = S.switches[at.sw], pt = sw.ports[at.port];
  if (pt.shut) return null;
  const v = pt.mode === 'trunk' ? 1 : pt.access;
  return sw.vlans.has(v) ? { sw: at.sw, vlan: v } : null;
}
const allows = (pt, v) => !pt.allowed || pt.allowed.has(v);
function vlanReach(sw0, v) {
  const seen = new Set([sw0]), q = [sw0];
  while (q.length) {
    const s = q.shift();
    for (const l of S.links) {
      let me, o;
      if (l.a.dev === s) { me = l.a; o = l.b; } else if (l.b.dev === s) { me = l.b; o = l.a; } else continue;
      if (!S.switches[o.dev] || seen.has(o.dev)) continue;
      const pm = S.switches[s].ports[me.port], po = S.switches[o.dev].ports[o.port];
      if (pm.shut || po.shut || !S.switches[o.dev].vlans.has(v)) continue;
      const ok = (trunkUp(s, me.port, o.dev, o.port) && allows(pm, v) && allows(po, v)) || (pm.mode !== 'trunk' && po.mode !== 'trunk' && pm.access === v && po.access === v);
      if (ok) { seen.add(o.dev); q.push(o.dev); }
    }
  }
  return seen;
}
function ipOk(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s || '');
  return !!m && m.slice(1).every(x => +x <= 255);
}
const ip2n = s => s.split('.').reduce((a, x) => a * 256 + +x, 0);
function maskOk(s) {
  if (!ipOk(s)) return false;
  return /^1*0*$/.test(ip2n(s).toString(2).padStart(32, '0'));
}
const sameNet = (a, b, m) => ((ip2n(a) & ip2n(m)) >>> 0) === ((ip2n(b) & ip2n(m)) >>> 0);
function canReach(src, dst) {
  if (src === dst) return ipOk(src.ip);
  if (!ipOk(src.ip) || !ipOk(dst.ip) || !maskOk(src.mask) || !maskOk(dst.mask)) return false;
  if (S.devices.filter(d => d.ip === dst.ip).length > 1 || S.devices.filter(d => d.ip === src.ip).length > 1) return false;
  if (!sameNet(src.ip, dst.ip, src.mask) || !sameNet(src.ip, dst.ip, dst.mask)) return false;
  const a = hostSegment(src), b = hostSegment(dst);
  if (!a || !b || a.vlan !== b.vlan) return false;
  return vlanReach(a.sw, a.vlan).has(b.sw);
}

// ---------- CLI output ----------
function out(sw, ...lines) {
  const c = sw.cli;
  for (const t of lines) {
    c.buf.push(t);
    if (c.view) c.view.pre.append(t + '\n');
  }
  if (c.buf.length > 3000) { c.buf.splice(0, 800); if (c.view) c.view.pre.textContent = c.buf.join('\n') + '\n'; }
  if (c.view) c.view.term.scrollTop = c.view.term.scrollHeight;
}
function promptText(sw) {
  const c = sw.cli;
  if (c.busy) return '';
  if (c.more) return ' --More-- ';
  if (c.ask) return c.ask.q;
  if (c.mode === 'boot') return '';
  return sw.hostname + SUFFIX[c.mode];
}
function refreshPrompt(sw) {
  const v = sw.cli.view;
  if (!v) return;
  v.pr.textContent = promptText(sw);
  v.inp.type = sw.cli.ask && sw.cli.ask.hidden ? 'password' : 'text';
  v.term.scrollTop = v.term.scrollHeight;
}
function linkMsg(sw, p, state) {
  const n = longName(p);
  out(sw, '', `%LINK-5-CHANGED: Interface ${n}, changed state to ${state}`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to ${state === 'up' ? 'up' : 'down'}`, '');
}
const protoMsg = (sw, p, state) => out(sw, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${longName(p)}, changed state to ${state}`, '');
const caret = (sw, pos) => out(sw, ' '.repeat(sw.cli.plen + pos) + '^', "% Invalid input detected at '^' marker.", '');
// IOS pauses long output at the terminal length (24 by default): Space = next page, Enter = next line, any other key stops
function page(sw, lines) {
  const c = sw.cli, n = c.termLen - 1;
  if (c.termLen === 0 || lines.length <= n) return out(sw, ...lines);
  out(sw, ...lines.slice(0, n));
  c.more = lines.slice(n);
}
function moreKey(sw, key) {
  const c = sw.cli;
  if (key === ' ') out(sw, ...c.more.splice(0, c.termLen - 1));
  else if (key === 'Enter') out(sw, c.more.shift());
  else c.more = [];
  if (!c.more.length) c.more = null;
  refreshPrompt(sw);
}

// ---------- command handlers ----------
const noop = () => {};
function setMode(sw, m, ctx = null) { sw.cli.mode = m; sw.cli.ctx = ctx; sw.cli.modeSet = true; }
function ask(sw, q, fn, hidden = false) { sw.cli.ask = { q, fn, hidden }; }
const confirmed = a => !a.trim() || /^y/i.test(a.trim());
function logout(sw) { setMode(sw, 'boot'); out(sw, '', `${sw.hostname} con0 is now available`, '', '', '', '', '', 'Press RETURN to get started.', ''); }
const configured = sw => out(sw, '%SYS-5-CONFIG_I: Configured from console by console');
// Asks for a password up to 3 times, like IOS
function askPassword(sw, ok, check, failMsg, onFail = noop) {
  let tries = 0;
  const again = () => ask(sw, 'Password: ', a => {
    if (check(a)) return ok();
    if (++tries < 3) again(); else { out(sw, failMsg, ''); onFail(); }
  }, true);
  again();
}
function enable(sw) {
  const pw = sw.secret || sw.enpass;
  if (!pw) return setMode(sw, 'priv');
  askPassword(sw, () => setMode(sw, 'priv'), a => a === pw, '% Bad secrets');
}
// Pressing RETURN at the console: MOTD banner, then the console password if "login" is set
function startSession(sw) {
  out(sw, '');
  if (sw.banner) out(sw, ...sw.banner.split('\n'), '');
  const con = sw.lines.con;
  if (con && con.login && con.password) {
    out(sw, 'User Access Verification', '');
    setMode(sw, 'boot');
    askPassword(sw, () => setMode(sw, 'user'), a => a === con.password, '% Bad passwords');
  } else setMode(sw, 'user');
}
function enterConf(sw) { out(sw, 'Enter configuration commands, one per line.  End with CNTL/Z.'); setMode(sw, 'conf'); }
function confAsk(sw) {
  ask(sw, 'Configuring from terminal, memory, or network [terminal]? ', a => {
    const x = a.trim().toLowerCase();
    if (!x || 'terminal'.startsWith(x)) enterConf(sw); else out(sw, '?Must be "terminal", "memory" or "network"', '');
  });
}
function endConf(sw) { setMode(sw, 'priv'); configured(sw); }
function exitMode(sw) {
  const m = sw.cli.mode;
  if (SUB_MODES.has(m)) setMode(sw, 'conf');
  else if (m === 'conf') { setMode(sw, 'priv'); configured(sw); }
  else logout(sw);
}

// VLANs and VTP
function vtpDenied(sw) {
  if (sw.vtp.mode !== 'client') return false;
  out(sw, 'VTP VLAN configuration not allowed when device is in CLIENT mode.');
  return true;
}
const vlanChanged = sw => { if (sw.vtp.mode === 'server') sw.vtp.rev++; };
function enterVlan(sw, id) {
  if (vtpDenied(sw)) return;
  if (!sw.vlans.has(id)) { sw.vlans.set(id, 'VLAN' + pad4(id)); vlanChanged(sw); }
  setMode(sw, 'vlan', id);
}
function setVlanName(sw, name) {
  const id = sw.cli.ctx;
  if (isDefaultVlan(id)) return out(sw, `%Default VLAN ${id} may not have its name changed.`);
  if (vtpDenied(sw)) return;
  sw.vlans.set(id, name);
  vlanChanged(sw);
}
function noVlan(sw, id) {
  if (isDefaultVlan(id)) return out(sw, `%Default VLAN ${id} may not be deleted.`);
  if (vtpDenied(sw)) return;
  if (sw.vlans.delete(id)) vlanChanged(sw);
}
function setVtpMode(sw, m) {
  const M = m.toUpperCase();
  if (sw.vtp.mode === m) return out(sw, `Device mode already VTP ${M}.`);
  sw.vtp.mode = m;
  if (m === 'transparent') sw.vtp.rev = 0;
  out(sw, `Setting device to VTP ${M} mode.`);
}
function setVtpDomain(sw, d) {
  if (sw.vtp.domain === d) return out(sw, `Domain name already set to ${d}.`);
  out(sw, `Changing VTP domain name from ${sw.vtp.domain || 'NULL'} to ${d}`);
  sw.vtp.domain = d;
  sw.vtp.rev = 0;
}
// A switch with no domain learns one over a trunk; servers and clients in the same domain then copy the highest revision
function vtpSync() {
  for (let guard = 0, changed = true; changed && guard < 10; guard++) {
    changed = false;
    for (const l of S.links) {
      const a = S.switches[l.a.dev], b = S.switches[l.b.dev];
      if (!a || !b || !trunkUp(a.id, l.a.port, b.id, l.b.port)) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.vtp.mode === 'transparent' || y.vtp.mode === 'transparent' || !x.vtp.domain) continue;
        if (!y.vtp.domain) { y.vtp.domain = x.vtp.domain; changed = true; }
        if (x.vtp.domain === y.vtp.domain && x.vtp.rev > y.vtp.rev) { y.vlans = new Map(x.vlans); y.vtp.rev = x.vtp.rev; changed = true; }
      }
    }
  }
}

// Interfaces
const IF_TYPES = [['fastethernet', 'Fa', 24], ['gigabitethernet', 'Gig', 2], ['port-channel', null], ['vlan', null]];
function parseIfs(str, multi) {
  if (!multi) {
    const tl = /^\s*[a-zA-Z-]*/.exec(str)[0].length, k = str.slice(tl).search(/[-,]/);
    if (k >= 0) return { err: tl + k };
  }
  const res = [];
  let off = 0;
  for (const part of str.split(',')) {
    const at = off + (part.length - part.trimStart().length);
    off += part.length + 1;
    const p = part.trim(), tm = /^[a-zA-Z-]*/.exec(p)[0], ty = tm.toLowerCase();
    const T = ty && IF_TYPES.find(([full]) => full.startsWith(ty));
    if (!T) return { err: at + Math.max(0, ...IF_TYPES.map(([full]) => { let i = 0; while (i < ty.length && full[i] === ty[i]) i++; return i; })) };
    if (T[0] === 'vlan') {
      const m = /^\s*(\d+)$/.exec(p.slice(tm.length));
      return m && +m[1] >= 1 && +m[1] <= 4094 ? { svi: +m[1] } : { err: at + tm.length };
    }
    if (!T[1]) return { stub: true };
    const numPart = p.slice(tm.length), sp = numPart.length - numPart.trimStart().length;
    const m = /^(\d+)\/(\d+)(?:\s*-\s*(\d+))?$/.exec(numPart.trim());
    if (!m || m[1] !== '0') return { err: at + tm.length + sp };
    const a = +m[2], b = m[3] ? +m[3] : a;
    if (a < 1 || a > T[2] || b > T[2] || b < a) return { err: at + p.indexOf('/') + 1 };
    for (let n = a; n <= b; n++) res.push(`${T[1]}0/${n}`);
  }
  return { ports: [...new Set(res)] };
}
function enterIf(sw, rest, multi, at) {
  const r = parseIfs(rest.trimEnd(), multi);
  if (r.err != null) return caret(sw, at + r.err);
  if (r.svi != null && !multi) {
    if (!sw.svis.has(r.svi)) sw.svis.set(r.svi, { ip: '', mask: '', shut: false });
    return setMode(sw, 'svi', r.svi);
  }
  if (r.stub || r.svi != null) return stubMsg(sw, `interface ${multi ? 'range ' : ''}${rest.trim()}`);
  setMode(sw, multi ? 'range' : 'if', r.ports);
}
function noInterface(sw, a, rest, at) {
  const r = parseIfs(rest.trimEnd(), false);
  if (r.err != null) return caret(sw, at + r.err);
  if (r.svi > 1) sw.svis.delete(r.svi);
}
const eachPort = (sw, fn) => { for (const p of sw.cli.ctx) fn(sw.ports[p], p); };
function setPortMode(sw, mode) {
  const before = sw.cli.ctx.map(p => portOper(sw.id, p));
  eachPort(sw, pt => { pt.mode = mode; });
  sw.cli.ctx.forEach((p, i) => {
    const l = linkAt(sw.id, p);
    if (!l || portOper(sw.id, p) === before[i]) return;
    const o = otherEnd(l, sw.id, p);
    for (const [s, q] of [[sw, p], [S.switches[o.dev], o.port]]) if (s) { protoMsg(s, q, 'down'); protoMsg(s, q, 'up'); }
  });
}
function setAccess(sw, v) {
  if (!sw.vlans.has(v) && !vtpDenied(sw)) { out(sw, `% Access VLAN does not exist. Creating vlan ${v}`); sw.vlans.set(v, 'VLAN' + pad4(v)); vlanChanged(sw); }
  eachPort(sw, pt => { pt.access = v; });
}
function setShut(sw, val) {
  eachPort(sw, (pt, p) => {
    if (pt.shut === val) return;
    pt.shut = val;
    if (linkAt(sw.id, p)) linkMsg(sw, p, val ? 'administratively down' : 'up');
  });
}
function parseVlanList(s) {
  const out = [];
  for (const part of s.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > 4094 || b < a) return null;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return out;
}
function listStr(vs) {
  const n = [...vs].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < n.length;) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    parts.push(i === j ? String(n[i]) : `${n[i]}-${n[j]}`);
    i = j + 1;
  }
  return parts.join(',') || 'none';
}
const allVlans = () => new Set(Array.from({ length: 4094 }, (_, i) => i + 1));
function setAllowed(sw, op, list) {
  const L = list ? parseVlanList(list) : [];
  eachPort(sw, pt => {
    let nx;
    if (op === 'all') nx = null;
    else if (op === 'none') nx = new Set();
    else if (op === 'set') nx = new Set(L);
    else if (op === 'except') { nx = allVlans(); L.forEach(v => nx.delete(v)); }
    else { nx = pt.allowed ? new Set(pt.allowed) : allVlans(); L.forEach(v => (op === 'add' ? nx.add(v) : nx.delete(v))); }
    pt.allowed = nx && nx.size === 4094 ? null : nx;
  });
}
function setNative(sw, v) {
  eachPort(sw, (pt, p) => {
    pt.native = v;
    const l = linkAt(sw.id, p);
    if (!l || portOper(sw.id, p) !== 'trunk') return;
    const o = otherEnd(l, sw.id, p), osw = S.switches[o.dev];
    if (!osw || osw.ports[o.port].native === v) return;
    out(sw, `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${longName(p)} (${v}), with ${osw.hostname} ${longName(o.port)} (${osw.ports[o.port].native}).`, '');
    out(osw, `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${longName(o.port)} (${osw.ports[o.port].native}), with ${sw.hostname} ${longName(p)} (${v}).`, '');
  });
}
function portfastOn(sw) {
  out(sw, '%Warning: portfast should only be enabled on ports connected to a single', ' host. Connecting hubs, concentrators, switches, bridges, etc... to this', ' interface  when portfast is enabled, can cause temporary bridging loops.', ' Use with CAUTION', '');
  eachPort(sw, (pt, p) => {
    pt.portfast = true;
    if (pt.mode !== 'access') out(sw, `%Portfast has been configured on ${longName(p)} but will only`, ' have effect when the interface is in a non-trunking mode.', '');
  });
}
function pfDefaultOn(sw) {
  sw.pfDefault = true;
  out(sw, '%Warning: this command enables portfast by default on all interfaces. You', ' should now disable portfast explicitly on switched ports leading to hubs,', ' switches and bridges as they may create temporary bridging loops.', '');
}

// SVI (interface vlan N) and lines
const svi = sw => sw.svis.get(sw.cli.ctx);
const vlanUp = (sw, v) => sw.vlans.has(v) && ALL_PORTS.some(p => { const o = portOper(sw.id, p); return o === 'trunk' || (o === 'access' && sw.ports[p].access === v); });
function setSviShut(sw, val) {
  const s = svi(sw), n = 'Vlan' + sw.cli.ctx;
  if (s.shut === val) return;
  s.shut = val;
  if (val) out(sw, '', `%LINK-5-CHANGED: Interface ${n}, changed state to administratively down`, '', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to down`, '');
  else {
    out(sw, '', `%LINK-5-CHANGED: Interface ${n}, changed state to up`, '');
    if (vlanUp(sw, sw.cli.ctx)) out(sw, `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to up`, '');
  }
}
function setSviIp(sw, a) {
  if (!maskOk(a[3])) return out(sw, `Bad mask 0x${(ip2n(a[3]) >>> 0).toString(16).toUpperCase()} for address ${a[2]}`, '');
  Object.assign(svi(sw), { ip: a[2], mask: a[3] });
}
const enterLine = type => sw => { sw.lines[type] = sw.lines[type] || {}; setMode(sw, 'line', type); };
const lineObj = sw => sw.lines[sw.cli.ctx];
function lineLogin(sw) {
  const ln = lineObj(sw);
  ln.login = true;
  if (!ln.password) out(sw, `% Login disabled on line ${sw.cli.ctx === 'con' ? 0 : 1}, until 'password' is set`, '');
}
// banner motd #text#  (or the delimiter alone, then lines until the delimiter comes back)
function bannerCmd(sw, a, rest) {
  const d = rest.trim()[0], body = rest.trim().slice(1), end = body.indexOf(d);
  if (end >= 0) { sw.banner = body.slice(0, end); return; }
  out(sw, `Enter TEXT message.  End with the character '${d}'.`);
  const parts = body ? [body] : [];
  const more = () => ask(sw, '', line => {
    const i = line.indexOf(d);
    if (i < 0) { parts.push(line); return more(); }
    parts.push(line.slice(0, i));
    sw.banner = parts.join('\n');
  });
  more();
}

// Saving, erasing, reloading
function writeMem(sw) {
  out(sw, 'Building configuration...', '[OK]');
  sw.startup = snapshot(sw);
  sw.dirty = false;
}
const copyRun = sw => ask(sw, 'Destination filename [startup-config]? ', () => writeMem(sw));
const eraseNvram = sw => ask(sw, 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', a => {
  if (!confirmed(a)) return out(sw, '');
  sw.startup = null;
  out(sw, '[OK]', 'Erase of nvram: complete', '%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram', '');
});
function deleteFile(sw, a, rest) {
  const f = rest.trim().replace(/^flash:\/?/i, '');
  ask(sw, `Delete filename [${f}]?`, () => ask(sw, `Delete flash:/${f}? [confirm]`, ans => {
    if (!confirmed(ans)) return out(sw, '');
    const hasVlanDat = sw.vlans.size > 5 || sw.vtp.domain || sw.vtp.mode !== 'server';
    if (f.toLowerCase() === 'vlan.dat' && hasVlanDat && !sw.vlanDatDeleted) sw.vlanDatDeleted = true;
    else out(sw, `%Error deleting flash:/${f} (No such file or directory)`, '');
  }));
}
function reload(sw) {
  const proceed = () => ask(sw, 'Proceed with reload? [confirm]', a => { if (confirmed(a)) doReload(sw); else out(sw, ''); });
  if (!sw.dirty) return proceed();
  ask(sw, 'System configuration has been modified. Save? [yes/no]:', a => {
    const x = a.trim().toLowerCase();
    if (x.startsWith('y')) { writeMem(sw); proceed(); } else if (x.startsWith('n')) proceed(); else out(sw, "% Please answer 'yes' or 'no'.", '');
  });
}
function doReload(sw) {
  Object.assign(sw, sw.startup ? structuredClone(sw.startup) : defaultConfig());
  if (sw.vlanDatDeleted) { sw.vlans = defaultVlans(); sw.vtp = { mode: 'server', domain: '', rev: 0 }; sw.vlanDatDeleted = false; }
  sw.dirty = false;
  setMode(sw, 'boot');
  out(sw, '', 'C2960 Boot Loader (C2960-HBOOT-M) Version 12.2(25r)FX, RELEASE SOFTWARE (fc4)', 'Cisco WS-C2960-24TT (RC32300) processor (revision C0) with 21039K bytes of memory.', '2960-24TT starting...',
    'Loading "flash:/c2960-lanbasek9-mz.150-2.SE4.bin"...', '########################################################################## [OK]', '', ...BOOT_LINES);
  for (const l of S.links) for (const e of [l.a, l.b]) {
    if (e.dev !== sw.id) continue;
    if (!sw.ports[e.port].shut) linkMsg(sw, e.port, 'up');
    if (!S.switches[otherEnd(l, e.dev, e.port).dev]) l.t = Date.now();
  }
}
// "do" keeps you in the sub-mode you typed it from
const doCmd = (sw, args, rest, at) => { dispatch(sw, rest, at, PRIV); sw.cli.modeSet = true; };
const stubMsg = (sw, text) => out(sw, `% [Trainer] "${text}" is a real command, but this trainer doesn't simulate it.`, '');
const stubRun = (sw, args, rest) => stubMsg(sw, [...args, rest || ''].join(' ').trim());

// ---------- show commands ----------
function showVlan(sw) {
  const L = ['', 'VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
  for (const id of [...sw.vlans.keys()].sort((a, b) => a - b)) {
    const ports = ALL_PORTS.filter(p => { const pt = sw.ports[p]; return pt.access === id && pt.mode !== 'trunk' && portOper(sw.id, p) !== 'trunk'; });
    const chunks = [];
    for (let i = 0; i < ports.length; i += 4) chunks.push(ports.slice(i, i + 4).join(', '));
    L.push(`${String(id).padEnd(4)} ${sw.vlans.get(id).padEnd(32)} ${'active'.padEnd(9)} ${chunks[0] || ''}`.trimEnd());
    for (const ch of chunks.slice(1)) L.push(' '.repeat(48) + ch);
  }
  page(sw, [...L, '']);
}
function showTrunk(sw) {
  const tr = ALL_PORTS.filter(p => portOper(sw.id, p) === 'trunk');
  if (!tr.length) return out(sw, '');
  const c = (s, w) => s.padEnd(w);
  const mode = p => ({ trunk: 'on', 'dynamic desirable': 'desirable', 'dynamic auto': 'auto' }[sw.ports[p].mode] || 'on');
  const allowed = p => sw.ports[p].allowed ? listStr(sw.ports[p].allowed) : '1-1005';
  const active = p => listStr([...sw.vlans.keys()].filter(v => v < 1002 && allows(sw.ports[p], v)));
  page(sw, [c('Port', 12) + c('Mode', 13) + c('Encapsulation', 15) + c('Status', 14) + 'Native vlan',
    ...tr.map(p => c(p, 12) + c(mode(p), 13) + c('802.1q', 15) + c('trunking', 14) + sw.ports[p].native),
    '', c('Port', 12) + 'Vlans allowed on trunk', ...tr.map(p => c(p, 12) + allowed(p)),
    '', c('Port', 12) + 'Vlans allowed and active in management domain', ...tr.map(p => c(p, 12) + active(p)),
    '', c('Port', 12) + 'Vlans in spanning tree forwarding state and not pruned', ...tr.map(p => c(p, 12) + active(p)), '']);
}
const hashStr = s => { let h = 5381; for (const ch of s) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
const type7 = s => '7 ' + [...s].map(ch => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
// Running config lines for the switch, or for a saved snapshot of it
function runLines(sw, cfg = sw) {
  const pw = p => (cfg.spe ? type7(p) : p);
  const L = ['!', 'version 15.0', 'no service timestamps log datetime msec', 'no service timestamps debug datetime msec', cfg.spe ? 'service password-encryption' : 'no service password-encryption', '!', `hostname ${cfg.hostname}`, '!'];
  if (cfg.secret) L.push(`enable secret 5 $1$mERr$${hashStr(cfg.secret)}`);
  if (cfg.enpass) L.push(`enable password ${pw(cfg.enpass)}`);
  L.push('!', '!', '!');
  if (!cfg.lookup) L.push('no ip domain-lookup', '!');
  if (sw.vtp.mode === 'transparent') for (const [id, n] of [...sw.vlans].sort((a, b) => a[0] - b[0])) if (!isDefaultVlan(id)) L.push(`vlan ${id}`, ` name ${n}`, '!');
  L.push('!', 'spanning-tree mode pvst');
  if (cfg.pfDefault) L.push('spanning-tree portfast default');
  L.push('spanning-tree extend system-id', '!');
  for (const p of ALL_PORTS) {
    const pt = cfg.ports[p];
    L.push(`interface ${longName(p)}`);
    if (pt.native !== 1) L.push(` switchport trunk native vlan ${pt.native}`);
    if (pt.allowed) L.push(` switchport trunk allowed vlan ${listStr(pt.allowed)}`);
    if (pt.access !== 1) L.push(` switchport access vlan ${pt.access}`);
    if (pt.mode === 'access') L.push(' switchport mode access');
    if (pt.mode === 'trunk') L.push(' switchport mode trunk');
    if (pt.mode === 'dynamic desirable') L.push(' switchport mode dynamic desirable');
    if (pt.portfast) L.push(' spanning-tree portfast');
    if (pt.shut) L.push(' shutdown');
    L.push('!');
  }
  for (const [id, s] of [...cfg.svis].sort((a, b) => a[0] - b[0])) {
    L.push(`interface Vlan${id}`, s.ip ? ` ip address ${s.ip} ${s.mask}` : ' no ip address');
    if (s.shut) L.push(' shutdown');
    L.push('!');
  }
  if (cfg.gw) L.push(`ip default-gateway ${cfg.gw}`, '!');
  if (cfg.banner) L.push(`banner motd ^C${cfg.banner}^C`, '!');
  const line = (head, ln = {}, dflt) => {
    L.push(head);
    if (ln.timeout) L.push(` exec-timeout ${ln.timeout}`);
    if (ln.password) L.push(` password ${pw(ln.password)}`);
    if (ln.sync) L.push(' logging synchronous');
    if (ln.login != null ? ln.login : dflt) L.push(' login');
  };
  L.push('!');
  line('line con 0', cfg.lines.con, false);
  L.push('!');
  line('line vty 0 4', cfg.lines.vty, true);
  line('line vty 5 15', cfg.lines.vty, true);
  L.push('!', '!', '!', '!', 'end');
  return L;
}
function showRun(sw) {
  const L = runLines(sw);
  page(sw, ['Building configuration...', '', `Current configuration : ${L.join('\n').length + 1} bytes`, ...L, '']);
}
function showStartup(sw) {
  if (!sw.startup) return out(sw, 'startup-config is not present', '');
  const L = runLines(sw, sw.startup);
  page(sw, [`Using ${L.join('\n').length + 1} bytes`, ...L, '']);
}
function ifState(sw, p) {
  if (sw.ports[p].shut) return ['administratively down', 'down'];
  return linkAt(sw.id, p) ? ['up', 'up'] : ['down', 'down'];
}
function showIpBrief(sw) {
  const row = (n, ip, st, pr) => n.padEnd(23) + ip.padEnd(16) + 'YES manual ' + st.padEnd(22) + pr;
  const L = ['Interface              IP-Address      OK? Method Status                Protocol '];
  for (const p of ALL_PORTS) L.push(row(longName(p), 'unassigned', ...ifState(sw, p)));
  for (const [id, s] of [...sw.svis].sort((a, b) => a[0] - b[0])) {
    L.push(row('Vlan' + id, s.ip || 'unassigned', s.shut ? 'administratively down' : 'up', !s.shut && vlanUp(sw, id) ? 'up' : 'down'));
  }
  page(sw, [...L, '']);
}
function showIfStatus(sw) {
  const L = ['', 'Port      Name               Status       Vlan       Duplex  Speed Type'];
  for (const p of ALL_PORTS) {
    const pt = sw.ports[p];
    const st = pt.shut ? 'disabled' : linkAt(sw.id, p) ? 'connected' : 'notconnect';
    const v = pt.mode === 'trunk' || portOper(sw.id, p) === 'trunk' ? 'trunk' : String(pt.access);
    L.push(p.padEnd(10) + ''.padEnd(19) + st.padEnd(13) + v.padEnd(11) + 'auto'.padEnd(8) + 'auto'.padEnd(6) + (p.startsWith('Gig') ? '10/100/1000BaseTX' : '10/100BaseTX'));
  }
  page(sw, [...L, '']);
}
function showVersion(sw) {
  const mins = S.started ? Math.floor((Date.now() - S.started) / 60000) : 0;
  page(sw, [...BOOT_LINES.slice(0, 4), '', 'ROM: C2960 Boot Loader (C2960-HBOOT-M) Version 12.2(25r)FX, RELEASE SOFTWARE (fc4)', '',
    `${sw.hostname} uptime is 0 days, ${Math.floor(mins / 60)} hours, ${mins % 60} minutes`, 'System returned to ROM by power-on', 'System image file is "flash:c2960-lanbasek9-mz.150-2.SE4.bin"', '',
    'cisco WS-C2960-24TT-L (PowerPC405) processor (revision B0) with 65536K bytes of memory.', 'Processor board ID FOC1010X104', 'Last reset from power-on', '1 Virtual Ethernet interface',
    '24 FastEthernet interfaces', '2 Gigabit Ethernet interfaces', 'The password-recovery mechanism is enabled.', '', '64K bytes of flash-simulated non-volatile configuration memory.',
    'Model number                    : WS-C2960-24TT-L', 'System serial number            : FOC1010X104', '', 'Switch Ports Model              SW Version            SW Image',
    '------ ----- -----              ----------            ----------', '*    1 26    WS-C2960-24TT-L    15.0(2)SE4            C2960-LANBASEK9-M', '', 'Configuration register is 0xF', '']);
}
const showHistory = sw => out(sw, ...sw.cli.hist.slice(-10).map(h => '  ' + h), '');
function showVtp(sw) {
  const r = (k, v) => k.padEnd(32) + ': ' + v;
  out(sw, r('VTP Version capable', '1 to 2'), r('VTP version running', '1'), r('VTP Domain Name', sw.vtp.domain), r('VTP Pruning Mode', 'Disabled'), r('VTP Traps Generation', 'Disabled'),
    r('Device ID', '0001.4' + hashStr(sw.id).slice(0, 3) + '.2a01'), 'Configuration last modified by 0.0.0.0 at 3-1-93 00:00:00', 'Local updater ID is 0.0.0.0 (no valid interface found)', '',
    'Feature VLAN :', '--------------', r('VTP Operating Mode', sw.vtp.mode[0].toUpperCase() + sw.vtp.mode.slice(1)), r('Maximum VLANs supported locally', '255'),
    r('Number of existing VLANs', sw.vlans.size), r('Configuration Revision', sw.vtp.rev), r('MD5 digest', '0x' + hashStr(listStr(sw.vlans.keys()) + sw.vtp.rev).toUpperCase()), '');
}

// ---------- command trees ----------
// Keyword lists follow Packet Tracer's 2960 so short forms clash (or not) the same way.
// Config commands outside the exam are accepted silently like IOS; EXEC/show commands that aren't simulated print a note.
const num = (lo, hi) => s => /^\d+$/.test(s) && +s >= lo && +s <= hi;
const WORD = s => s.length > 0 && s.length <= 32;
const IF_HELP = [['FastEthernet', 'FastEthernet IEEE 802.3'], ['GigabitEthernet', 'GigabitEthernet IEEE 802.3z'], ['Port-channel', 'Ethernet Channel of interfaces'], ['Vlan', 'Catalyst Vlans']];
const stub = (k, h = '') => ({ k, h, run: stubRun, kids: [{ rest: true, a: 'LINE', h: '', run: stubRun }] });
const stubs = list => list.map(([k, h]) => stub(k, h));
const silent = (k, h = '') => ({ k, h, run: noop, kids: [{ rest: true, a: 'LINE', h: '', run: noop }] });
const silents = list => list.map(([k, h]) => silent(k, h));
const ipArg = (h, run, kids) => ({ a: 'A.B.C.D', h, t: ipOk, run, kids });
const exitNode = { k: 'exit', h: 'Exit from the EXEC', run: exitMode };
const logoutNode = { k: 'logout', h: 'Exit from the EXEC', run: logout };
const enableNode = run => ({ k: 'enable', h: 'Turn on privileged commands', run, kids: [{ a: '<0-15>', h: 'Enable level', t: num(0, 15), num: true, run }, stub('view', 'Set into the existing view')] });
const termNode = { k: 'terminal', h: 'Set terminal line parameters', kids: [
  { k: 'length', h: 'Set number of lines on a screen', kids: [{ a: '<0-512>', h: 'Number of lines on screen (0 for no pausing)', t: num(0, 512), num: true, run: (sw, a) => { sw.cli.termLen = +a[2]; } }] },
  ...stubs([['history', 'Enable and control the command history function'], ['monitor', 'Copy debug output to the current terminal line'], ['no', 'Negate a command or set its defaults'], ['width', 'Set width of the display terminal']]),
] };
const showVlanNode = { k: 'vlan', h: 'VTP VLAN status', run: showVlan, kids: [
  { k: 'brief', h: 'VTP all VLAN status in brief', run: showVlan },
  ...stubs([['id', 'VTP VLAN status by VLAN id'], ['name', 'VTP VLAN status by VLAN name'], ['summary', 'VLAN summary information']]),
] };
const showIfNode = { k: 'interfaces', h: 'Interface status and configuration', run: stubRun, kids: [
  { k: 'trunk', h: 'Show interface trunk information', run: showTrunk },
  { k: 'status', h: 'Show interface line status', run: showIfStatus },
  stub('switchport', 'Show interface switchport information'),
  { rest: true, ifspec: true, run: (sw, a, rest, at) => { const r = parseIfs(rest.trimEnd(), false); if (r.err != null) return caret(sw, at + r.err); stubMsg(sw, 'show interfaces ' + rest.trim()); } },
] };
const showIpNode = { k: 'ip', h: 'IP information', kids: [
  { k: 'interface', h: 'IP interface status and configuration', run: stubRun, kids: [{ k: 'brief', h: 'Brief summary of IP status and configuration', run: showIpBrief }, { rest: true, ifspec: true, run: stubRun }] },
  ...stubs([['arp', 'IP ARP table'], ['dhcp', 'Show items in the DHCP database'], ['http', 'HTTP information'], ['ssh', 'Information on SSH']]),
] };
const SHOW_BASE = [['arp', 'Arp table'], ['cdp', 'CDP information'], ['clock', 'Display the system clock'], ['crypto', 'Encryption Module'], ['dtp', 'DTP information'], ['etherchannel', 'EtherChannel information'],
  ['flash:', 'display information about flash: file system'], ['mac-address-table', 'MAC forwarding table'], ['mls', 'Show MultiLayer Switching information'], ['privilege', 'Show current privilege level'],
  ['sessions', 'Information about Telnet connections'], ['ssh', 'Status of SSH server connections'], ['tcp', 'Status of TCP connections'], ['terminal', 'Display terminal configuration parameters'],
  ['users', 'Display information about terminal lines']];
const SHOW_COMMON = [showIfNode, showVlanNode, showIpNode, { k: 'history', h: 'Display the session command history', run: showHistory }, { k: 'version', h: 'System hardware and software status', run: showVersion }];
const SHOW_USER = { k: 'show', h: 'Show running system information', kids: [...stubs(SHOW_BASE), ...SHOW_COMMON] };
const SHOW = { k: 'show', h: 'Show running system information', kids: [
  ...stubs([...SHOW_BASE, ['aaa', 'Show AAA values'], ['access-lists', 'List access lists'], ['boot', 'show boot attributes'], ['dhcp', 'Dynamic Host Configuration Protocol status'],
    ['hosts', 'IP domain-name, lookup style, nameservers, and host table'], ['ipv6', 'IPv6 information'], ['lldp', 'LLDP information'], ['logging', 'Show the contents of logging buffers'],
    ['mac', 'MAC configuration'], ['monitor', 'Monitoring different system events'], ['ntp', 'Network time protocol'], ['port-security', 'Show secure port information'],
    ['processes', 'Active process statistics'], ['sdm', 'Switch Database Management'], ['snmp', 'snmp statistics'], ['spanning-tree', 'Spanning tree topology'],
    ['storm-control', 'Show storm control configuration'], ['tech-support', 'Show system information for Tech-Support']]),
  ...SHOW_COMMON,
  { k: 'running-config', h: 'Current operating configuration', run: showRun },
  { k: 'startup-config', h: 'Contents of startup configuration', run: showStartup },
  { k: 'vtp', h: 'VTP information', kids: [{ k: 'status', h: 'VTP domain status', run: showVtp }, ...stubs([['counters', 'VTP statistics'], ['password', 'VTP password']])] },
] };
const EXEC_STUBS = [['connect', 'Open a terminal connection'], ['disconnect', 'Disconnect an existing network connection'], ['ping', 'Send echo messages'], ['resume', 'Resume an active network connection'],
  ['ssh', 'Open a secure shell client connection'], ['telnet', 'Open a telnet connection'], ['traceroute', 'Trace route to destination']];
const USER = [
  ...stubs(EXEC_STUBS),
  { k: 'disable', h: 'Turn off privileged commands', run: noop },
  enableNode(enable), exitNode, logoutNode, SHOW_USER, termNode,
];
const PRIV = [
  ...stubs([...EXEC_STUBS, ['clear', 'Reset functions'], ['clock', 'Manage the system clock'], ['debug', "Debugging functions (see also 'undebug')"], ['dir', 'List files on a filesystem'],
    ['more', 'Display the contents of a file'], ['no', 'Disable debugging informations'], ['setup', 'Run the SETUP command facility'], ['undebug', "Disable debugging functions (see also 'debug')"]]),
  enableNode(noop),
  { k: 'disable', h: 'Turn off privileged commands', run: sw => setMode(sw, 'user') },
  { k: 'configure', h: 'Enter configuration mode', run: confAsk, kids: [{ k: 'terminal', h: 'Configure from the terminal', run: enterConf }, ...stubs([['memory', 'Configure from NV memory'], ['network', 'Configure from a TFTP network host']])] },
  { k: 'copy', h: 'Copy from one file to another', kids: [
    { k: 'running-config', h: 'Copy from current system configuration', kids: [{ k: 'startup-config', h: 'Copy to startup configuration', run: copyRun }, ...stubs([['flash:', 'Copy to flash: file system'], ['tftp:', 'Copy to tftp: file system']])] },
    ...stubs([['flash:', 'Copy from flash: file system'], ['startup-config', 'Copy from startup configuration'], ['tftp:', 'Copy from tftp: file system']]),
  ] },
  { k: 'delete', h: 'Delete a file', kids: [{ rest: true, a: '<filename>', h: 'Delete a file', run: deleteFile }] },
  { k: 'erase', h: 'Erase a filesystem', kids: [{ k: 'startup-config', h: 'Erase contents of configuration memory', run: eraseNvram }, ...stubs([['flash:', 'Erase flash: file system'], ['nvram:', 'Erase nvram: file system']])] },
  { k: 'reload', h: 'Halt and perform a cold restart', run: reload },
  { k: 'write', h: 'Write running configuration to memory, NVRAM, network, or terminal', run: writeMem, kids: [{ k: 'erase', h: 'Erase NV memory', run: eraseNvram }, { k: 'memory', h: 'Write to NV memory', run: writeMem }, stub('terminal', 'Write to terminal')] },
  { k: 'vlan', h: 'Configure VLAN parameters', kids: [stub('database', 'Configure VLAN database')] },
  SHOW, exitNode, logoutNode, termNode,
];
const doNode = { k: 'do', h: 'To run exec commands in config mode', kids: [{ rest: true, a: 'LINE', h: 'Exec Command', run: doCmd }] };
const lookupOff = sw => { sw.lookup = false; };
const lookupOn = sw => { sw.lookup = true; };
const vlanArg = run => ({ a: '<1-4094>', h: 'ISL VLAN IDs 1-1005', t: num(1, 4094), num: true, run });
const CONF_SILENT = [['aaa', 'Authentication, Authorization and Accounting.'], ['access-list', 'Add an access list entry'], ['boot', 'Boot Commands'],
  ['cdp', 'Global CDP configuration subcommands'], ['class-map', 'Configure Class Map'], ['clock', 'Configure time-of-day clock'], ['crypto', 'Encryption module'], ['errdisable', 'Error disable'],
  ['ipv6', 'Global IPv6 configuration commands'], ['lldp', 'Global LLDP configuration subcommands'], ['logging', 'Modify message logging facilities'],
  ['mac', 'MAC configuration'], ['mac-address-table', 'Configure the MAC address table'], ['mls', 'mls global commands'], ['monitor', 'Monitoring different system events'], ['ntp', 'Configure NTP'],
  ['parser', 'Configure parser'], ['policy-map', 'Configure QoS Policy Map'], ['port-channel', 'EtherChannel configuration'], ['privilege', 'Command privilege parameters'],
  ['radius-server', 'Modify Radius query parameters'], ['sdm', 'Switch Database Management'], ['secure', 'Secure image and configuration archival commands'],
  ['snmp-server', 'Modify SNMP engine parameters'], ['system', 'system config command'], ['tacacs-server', 'Modify TACACS query parameters'], ['username', 'Establish User Name Authentication']];
const IP_SILENT = [['domain-name', 'Define the default domain name'], ['http', 'HTTP server configuration'], ['ssh', 'Configure ssh options']];
const STP_SILENT = [['extend', 'Spanning Tree 802.1t extensions'], ['mode', 'Spanning tree operating mode'], ['vlan', 'VLAN Switch Spanning Tree']];
const SERVICE_SILENT = [['dhcp', 'Enable DHCP server and relay agent'], ['timestamps', 'Timestamp debug/log messages']];
const ifArg = run => ({ rest: true, ifspec: true, run });
const CONF = [
  ...silents(CONF_SILENT),
  { k: 'vlan', h: 'Vlan commands', kids: [vlanArg((sw, a) => enterVlan(sw, +a[1]))] },
  { k: 'interface', h: 'Select an interface to configure', kids: [
    { k: 'range', h: 'interface range command', kids: [ifArg((sw, a, rest, at) => enterIf(sw, rest, true, at))] },
    ifArg((sw, a, rest, at) => enterIf(sw, rest, false, at)),
  ] },
  { k: 'hostname', h: "Set system's network name", kids: [{ a: 'WORD', h: "This system's network name", t: WORD, run: (sw, a) => { sw.hostname = a[1]; } }] },
  { k: 'ip', h: 'Global IP configuration subcommands', kids: [
    { k: 'default-gateway', h: 'Specify default gateway (if not routing IP)', kids: [ipArg('IP address of default gateway', (sw, a) => { sw.gw = a[2]; })] },
    { k: 'domain-lookup', h: 'Enable IP Domain Name System hostname translation', run: lookupOn },
    { k: 'domain', h: 'IP DNS Resolver', kids: [{ k: 'lookup', h: 'Enable IP Domain Name System hostname translation', run: lookupOn }, silent('name', 'Define the default domain name')] },
    ...silents(IP_SILENT),
  ] },
  { k: 'vtp', h: 'Configure global VTP state', kids: [
    { k: 'domain', h: 'Set the name of the VTP administrative domain.', kids: [{ a: 'WORD', h: 'The ascii name for the VTP administrative domain.', t: WORD, run: (sw, a) => setVtpDomain(sw, a[2]) }] },
    { k: 'mode', h: 'Configure VTP device mode', kids: ['client', 'server', 'transparent'].map(m => ({ k: m, h: `Set the device to ${m} mode.`, run: sw => setVtpMode(sw, m) })) },
    ...silents([['password', 'Set the password for the VTP administrative domain'], ['version', 'Set the adminstrative domain to VTP version']]),
  ] },
  { k: 'line', h: 'Configure a terminal line', kids: [
    { k: 'console', h: 'Primary terminal line', kids: [{ a: '<0-0>', h: 'First Line number', t: num(0, 0), num: true, run: enterLine('con') }] },
    { k: 'vty', h: 'Virtual terminal', kids: [{ a: '<0-15>', h: 'First Line number', t: num(0, 15), num: true, run: enterLine('vty'), kids: [{ a: '<1-15>', h: 'Last Line number', t: num(1, 15), num: true, run: enterLine('vty') }] }] },
  ] },
  { k: 'banner', h: 'Define a login banner', kids: [
    { k: 'motd', h: 'Set Message of the Day banner', kids: [{ rest: true, a: 'LINE', h: "c banner-text c, where 'c' is a delimiting character", run: bannerCmd }] },
    ...silents([['exec', 'Set EXEC process creation banner'], ['login', 'Set login banner']]),
  ] },
  { k: 'service', h: 'Modify use of network based services', kids: [{ k: 'password-encryption', h: 'Encrypt system passwords', run: sw => { sw.spe = true; } }, ...silents(SERVICE_SILENT)] },
  { k: 'spanning-tree', h: 'Spanning Tree Subsystem', kids: [
    { k: 'portfast', h: 'Spanning tree portfast options', kids: [{ k: 'default', h: 'Enable portfast by default on all access ports', run: pfDefaultOn }, silent('bpduguard', 'Enable portfast bpdu guard by default')] },
    ...silents(STP_SILENT),
  ] },
  { k: 'no', h: 'Negate a command or set its defaults', kids: [
    ...silents([...CONF_SILENT, ['line', 'Configure a terminal line'], ['vtp', 'Configure global VTP state']]),
    { k: 'vlan', h: 'Vlan commands', kids: [vlanArg((sw, a) => noVlan(sw, +a[2]))] },
    { k: 'interface', h: 'Select an interface to configure', kids: [ifArg(noInterface)] },
    { k: 'ip', h: 'Global IP configuration subcommands', kids: [
      { k: 'default-gateway', h: 'Specify default gateway (if not routing IP)', run: sw => { sw.gw = ''; } },
      { k: 'domain-lookup', h: 'Enable IP Domain Name System hostname translation', run: lookupOff },
      { k: 'domain', h: 'IP DNS Resolver', kids: [{ k: 'lookup', h: 'Enable IP Domain Name System hostname translation', run: lookupOff }, silent('name', 'Define the default domain name')] },
      ...silents(IP_SILENT),
    ] },
    { k: 'hostname', h: "Set system's network name", run: sw => { sw.hostname = 'Switch'; } },
    { k: 'enable', h: 'Modify enable password parameters', kids: [{ k: 'password', h: 'Assign the privileged level password', run: sw => { sw.enpass = ''; } }, { k: 'secret', h: 'Assign the privileged level secret', run: sw => { sw.secret = ''; } }] },
    { k: 'banner', h: 'Define a login banner', kids: [{ k: 'motd', h: 'Set Message of the Day banner', run: sw => { sw.banner = ''; } }, ...silents([['exec', 'Set EXEC process creation banner'], ['login', 'Set login banner']])] },
    { k: 'service', h: 'Modify use of network based services', kids: [{ k: 'password-encryption', h: 'Encrypt system passwords', run: sw => { sw.spe = false; } }, ...silents(SERVICE_SILENT)] },
    { k: 'spanning-tree', h: 'Spanning Tree Subsystem', kids: [{ k: 'portfast', h: 'Spanning tree portfast options', kids: [{ k: 'default', h: 'Enable portfast by default on all access ports', run: sw => { sw.pfDefault = false; } }, silent('bpduguard', '')] }, ...silents(STP_SILENT)] },
  ] },
  { k: 'enable', h: 'Modify enable password parameters', kids: [
    { k: 'password', h: 'Assign the privileged level password', kids: [{ a: 'WORD', h: 'The UNENCRYPTED (cleartext) password', t: WORD, run: (sw, a) => { sw.enpass = a[2]; } }] },
    { k: 'secret', h: 'Assign the privileged level secret', kids: [{ a: 'WORD', h: 'The UNENCRYPTED (cleartext) secret', t: WORD, run: (sw, a) => { sw.secret = a[2]; } }] },
  ] },
  { k: 'end', h: 'Exit from configure mode', run: endConf },
  { k: 'exit', h: 'Exit from configure mode', run: exitMode },
  doNode,
];
// Sub-modes list only their own commands, like PT's "?"; end, do and global commands fall back to CONF in dispatch()
const VLANM = [
  { k: 'name', h: 'Ascii name of the VLAN', kids: [{ a: 'WORD', h: 'The ascii name for the VLAN', t: WORD, run: (sw, a) => setVlanName(sw, a[1]) }] },
  { k: 'no', h: 'Negate a command or set its defaults', kids: [{ k: 'name', h: 'Ascii name of the VLAN', run: sw => { if (!isDefaultVlan(sw.cli.ctx)) sw.vlans.set(sw.cli.ctx, 'VLAN' + pad4(sw.cli.ctx)); } }] },
  { k: 'exit', h: 'Apply changes, bump revision number, and exit mode', run: exitMode },
];
const modeKids = [
  { k: 'access', h: 'Set trunking mode to ACCESS unconditionally', run: sw => setPortMode(sw, 'access') },
  { k: 'dynamic', h: 'Set trunking mode to dynamically negotiate access or trunk mode', kids: [
    { k: 'auto', h: 'Set trunking mode dynamic negotiation parameter to AUTO', run: sw => setPortMode(sw, 'dynamic auto') },
    { k: 'desirable', h: 'Set trunking mode dynamic negotiation parameter to DESIRABLE', run: sw => setPortMode(sw, 'dynamic desirable') },
  ] },
  { k: 'trunk', h: 'Set trunking mode to TRUNK unconditionally', run: sw => setPortMode(sw, 'trunk') },
];
const vlanList = run => ({ a: 'WORD', h: 'VLAN IDs of the allowed VLANs when this port is in trunking mode', t: s => !!parseVlanList(s), run });
const SWP_SILENT = [['nonegotiate', 'Device will not engage in negotiation protocol on this interface'], ['port-security', 'Security related command'], ['priority', 'Set appliance 802.1p priority'],
  ['protected', 'Configure an interface to be a protected port'], ['voice', 'Voice appliance attributes']];
const IF_SILENT = [['arp', 'Set arp type (arpa, probe, snap) or timeout'], ['bandwidth', 'Set bandwidth informational parameter'], ['cdp', 'CDP interface subcommands'],
  ['channel-group', 'Etherchannel/port bundling configuration'], ['channel-protocol', 'Select the channel protocol (LACP, PAgP)'], ['duplex', 'Configure duplex operation.'],
  ['ipv6', 'IPv6 interface subcommands'], ['lldp', 'LLDP interface subcommands'], ['mdix', 'Set Media-dependent interface crossover'], ['mls', 'mls interface commands'],
  ['speed', 'Configure speed operation.'], ['storm-control', 'storm configuration'], ['tx-ring-limit', 'Configure PA level transmit ring limit']];
const IF_STP_SILENT = [['bpduguard', "Don't accept BPDUs on this interface"], ['cost', "Change an interface's spanning tree port path cost"], ['guard', "Change an interface's spanning tree guard mode"],
  ['link-type', 'Specify a link type for spanning tree protocol use'], ['port-priority', "Change an interface's spanning tree port priority"], ['vlan', 'VLAN Switch Spanning Tree']];
const IF_IP_SILENT = [['access-group', 'Specify access control for packets'], ['dhcp', 'Configure DHCP parameters for this interface']];
const descNode = { k: 'description', h: 'Interface specific description', kids: [{ rest: true, a: 'LINE', h: 'Up to 240 characters describing this interface', run: noop }] };
const IFM = [
  ...silents(IF_SILENT),
  { k: 'ip', h: 'Interface Internet Protocol config commands', kids: silents(IF_IP_SILENT) },
  { k: 'spanning-tree', h: 'Spanning Tree Subsystem', kids: [
    { k: 'portfast', h: 'Portfast options for the interface', run: portfastOn, kids: [{ k: 'disable', h: 'Disable portfast for this interface', run: sw => eachPort(sw, pt => { pt.portfast = false; }) }, silent('trunk', 'Enable portfast on the interface even in trunk mode')] },
    ...silents(IF_STP_SILENT),
  ] },
  { k: 'switchport', h: 'Set switching mode characteristics', kids: [
    { k: 'access', h: 'Set access mode characteristics of the interface', kids: [{ k: 'vlan', h: 'Set VLAN when interface is in access mode', kids: [{ ...vlanArg((sw, a) => setAccess(sw, +a[3])), h: 'VLAN ID of the VLAN when this port is in access mode' }] }] },
    { k: 'mode', h: 'Set trunking mode of the interface', kids: modeKids },
    { k: 'trunk', h: 'Set trunking characteristics of the interface', kids: [
      { k: 'allowed', h: 'Set allowed VLAN characteristics when interface is in trunking mode', kids: [{ k: 'vlan', h: 'Set allowed VLANs when interface is in trunking mode', kids: [
        { k: 'add', h: 'add VLANs to the current list', kids: [vlanList((sw, a) => setAllowed(sw, 'add', a[5]))] },
        { k: 'all', h: 'all VLANs', run: sw => setAllowed(sw, 'all') },
        { k: 'except', h: 'all VLANs except the following', kids: [vlanList((sw, a) => setAllowed(sw, 'except', a[5]))] },
        { k: 'none', h: 'no VLANs', run: sw => setAllowed(sw, 'none') },
        { k: 'remove', h: 'remove VLANs from the current list', kids: [vlanList((sw, a) => setAllowed(sw, 'remove', a[5]))] },
        vlanList((sw, a) => setAllowed(sw, 'set', a[4])),
      ] }] },
      { k: 'native', h: 'Set trunking native characteristics when interface is in trunking mode', kids: [{ k: 'vlan', h: 'Set native VLAN when interface is in trunking mode', kids: [vlanArg((sw, a) => setNative(sw, +a[4]))] }] },
      silent('pruning', 'Set pruning VLAN characteristics when interface is in trunking mode'),
    ] },
    ...silents(SWP_SILENT),
  ] },
  { k: 'shutdown', h: 'Shutdown the selected interface', run: sw => setShut(sw, true) },
  descNode,
  { k: 'no', h: 'Negate a command or set its defaults', kids: [
    ...silents(IF_SILENT),
    { k: 'ip', h: 'Interface Internet Protocol config commands', kids: silents(IF_IP_SILENT) },
    { k: 'shutdown', h: 'Shutdown the selected interface', run: sw => setShut(sw, false) },
    { k: 'spanning-tree', h: 'Spanning Tree Subsystem', kids: [{ k: 'portfast', h: 'Portfast options for the interface', run: sw => eachPort(sw, pt => { pt.portfast = false; }) }, ...silents(IF_STP_SILENT)] },
    { k: 'switchport', h: 'Set switching mode characteristics', kids: [
      { k: 'access', h: 'Set access mode characteristics of the interface', kids: [{ k: 'vlan', h: 'Set VLAN when interface is in access mode', run: sw => eachPort(sw, pt => { pt.access = 1; }) }] },
      { k: 'mode', h: 'Set trunking mode of the interface', run: sw => setPortMode(sw, 'dynamic auto') },
      { k: 'trunk', h: 'Set trunking characteristics of the interface', kids: [
        { k: 'allowed', h: 'Set allowed VLAN characteristics when interface is in trunking mode', kids: [{ k: 'vlan', h: 'Set allowed VLANs when interface is in trunking mode', run: sw => setAllowed(sw, 'all') }] },
        { k: 'native', h: 'Set trunking native characteristics when interface is in trunking mode', kids: [{ k: 'vlan', h: 'Set native VLAN when interface is in trunking mode', run: sw => setNative(sw, 1) }] },
        silent('pruning', ''),
      ] },
      ...silents(SWP_SILENT),
    ] },
    { k: 'description', h: 'Interface specific description', run: noop },
  ] },
  { k: 'exit', h: 'Exit from interface configuration mode', run: exitMode },
];
const SVIM = [
  ...silents([['arp', 'Set arp type (arpa, probe, snap) or timeout'], ['bandwidth', 'Set bandwidth informational parameter'], ['ipv6', 'IPv6 interface subcommands'], ['mac-address', 'Manually set interface MAC address'], ['mtu', 'Set the interface Maximum Transmission Unit (MTU)']]),
  { k: 'ip', h: 'Interface Internet Protocol config commands', kids: [
    { k: 'address', h: 'Set the IP address of an interface', kids: [ipArg('IP address', null, [ipArg('IP subnet mask', setSviIp)]), silent('dhcp', 'IP Address negotiated via DHCP')] },
    ...silents([['access-group', 'Specify access control for packets'], ['helper-address', 'Specify a destination address for UDP broadcasts']]),
  ] },
  { k: 'shutdown', h: 'Shutdown the selected interface', run: sw => setSviShut(sw, true) },
  descNode,
  { k: 'no', h: 'Negate a command or set its defaults', kids: [
    { k: 'ip', h: 'Interface Internet Protocol config commands', kids: [{ k: 'address', h: 'Set the IP address of an interface', run: sw => Object.assign(svi(sw), { ip: '', mask: '' }) }, ...silents([['access-group', ''], ['helper-address', '']])] },
    { k: 'shutdown', h: 'Shutdown the selected interface', run: sw => setSviShut(sw, false) },
    { k: 'description', h: 'Interface specific description', run: noop },
  ] },
  { k: 'exit', h: 'Exit from interface configuration mode', run: exitMode },
];
const LINEM = [
  ...silents([['access-class', 'Filter connections based on an IP access list'], ['history', 'Enable and control the command history function'], ['privilege', 'Change privilege level for line'], ['transport', 'Define transport protocols for line']]),
  { k: 'exec-timeout', h: 'Set the EXEC timeout', kids: [{ a: '<0-35791>', h: 'Timeout in minutes', t: num(0, 35791), num: true, run: (sw, a) => { lineObj(sw).timeout = a.slice(1).join(' '); }, kids: [{ a: '<0-2147483>', h: 'Timeout in seconds', t: num(0, 2147483), num: true, run: (sw, a) => { lineObj(sw).timeout = a.slice(1).join(' '); } }] }] },
  { k: 'logging', h: 'Modify message logging facilities', kids: [{ k: 'synchronous', h: 'Synchronized message output', run: sw => { lineObj(sw).sync = true; } }] },
  { k: 'login', h: 'Enable password checking', run: lineLogin, kids: [silent('local', 'Local password checking')] },
  { k: 'password', h: 'Set a password', kids: [{ a: 'LINE', h: 'The UNENCRYPTED (cleartext) line password', t: WORD, run: (sw, a) => { lineObj(sw).password = a[1]; } }] },
  { k: 'no', h: 'Negate a command or set its defaults', kids: [
    { k: 'exec-timeout', h: 'Set the EXEC timeout', run: sw => { delete lineObj(sw).timeout; } },
    { k: 'logging', h: 'Modify message logging facilities', kids: [{ k: 'synchronous', h: 'Synchronized message output', run: sw => { lineObj(sw).sync = false; } }] },
    { k: 'login', h: 'Enable password checking', run: sw => { lineObj(sw).login = false; } },
    { k: 'password', h: 'Set a password', run: sw => { delete lineObj(sw).password; } },
  ] },
  { k: 'exit', h: 'Exit from line configuration mode', run: exitMode },
];
const TREES = { user: USER, priv: PRIV, conf: CONF, vlan: VLANM, if: IFM, range: IFM, svi: SVIM, line: LINEM };

// ---------- parser ----------
function tokenize(line) {
  const r = [], re = /\S+/g;
  let m;
  while ((m = re.exec(line))) r.push({ s: m[0], pos: m.index });
  return r;
}
function matchKw(opts, s) {
  const low = s.toLowerCase();
  const ex = opts.filter(n => n.k === low);
  return ex.length ? ex : opts.filter(n => n.k && n.k.startsWith(low));
}
// IOS puts the caret on the first character no command at this level could accept
function prefixLen(opts, s) {
  const low = s.toLowerCase();
  let best = 0;
  for (const n of opts) {
    let i = 0;
    if (n.k) while (i < low.length && i < n.k.length && n.k[i] === low[i]) i++;
    else if (n.num) { const d = /^\d*/.exec(s)[0].length; i = d === s.length ? 0 : d; }
    best = Math.max(best, i);
  }
  return best;
}
function parse(tree, line) {
  const toks = tokenize(line);
  let opts = tree, node = null;
  const args = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const kws = matchKw(opts, t.s);
    if (kws.length > 1) return { err: 'ambig', pos: t.pos, tok: i };
    if (kws.length === 1) { node = kws[0]; args.push(node.k); opts = node.kids || []; continue; }
    const an = opts.find(n => n.t && n.t(t.s));
    if (an) { node = an; args.push(t.s); opts = an.kids || []; continue; }
    const rn = opts.find(n => n.rest);
    if (rn) return { node: rn, args, rest: line.slice(t.pos), restPos: t.pos };
    return { err: 'invalid', pos: t.pos + prefixLen(opts, t.s), tok: i };
  }
  if (!node) return { err: 'empty' };
  if (!node.run) return { err: 'incomplete' };
  return { node, args };
}
function walk(tree, toks) {
  let opts = tree, node = null;
  for (const t of toks) {
    const kws = matchKw(opts, t.s);
    if (kws.length > 1) return null;
    if (kws.length === 1) { node = kws[0]; opts = node.kids || []; continue; }
    const an = opts.find(n => n.t && n.t(t.s));
    if (an) { node = an; opts = an.kids || []; continue; }
    const rn = opts.find(n => n.rest);
    if (rn) return { opts: [], node: rn, inRest: true };
    return null;
  }
  return { opts, node };
}
function run(sw, r, offset) { sw.cli.modeSet = false; r.node.run(sw, r.args, r.rest, (r.restPos || 0) + offset); }
function dispatch(sw, line, offset = 0, forced = null) {
  const mode = sw.cli.mode;
  let r = parse(forced || TREES[mode], line);
  if (r.err === 'empty') return;
  if (r.err && !forced && SUB_MODES.has(mode)) {
    // IOS falls back to global config commands from a sub-mode
    const r2 = parse(CONF, line);
    if (!r2.err) { run(sw, r2, offset); if (!sw.cli.modeSet) setMode(sw, 'conf'); return; }
    if (r.err === 'invalid' && (r2.err !== 'invalid' ? r.tok === 0 : r2.pos > r.pos)) r = r2;
  }
  if (r.err) {
    // An unknown first word in EXEC mode is treated as a host name to telnet to
    if (!forced && (mode === 'user' || mode === 'priv') && r.err === 'invalid' && r.tok === 0) return lookup(sw, tokenize(line)[0].s);
    if (r.err === 'ambig') return out(sw, `% Ambiguous command: "${line.trim()}"`, '');
    if (r.err === 'incomplete') return out(sw, '% Incomplete command.', '');
    return caret(sw, offset + r.pos);
  }
  run(sw, r, offset);
}
function lookup(sw, word) {
  if (!sw.lookup) return out(sw, `Translating "${word}"`, '% Unknown command or computer name, or unable to find computer address', '');
  out(sw, `Translating "${word}"...domain server (255.255.255.255)`);
  sw.cli.busy = setTimeout(() => {
    sw.cli.busy = null;
    out(sw, '% Unknown command or computer name, or unable to find computer address', '');
    refreshPrompt(sw);
  }, LOOKUP_MS);
}
function abortLookup(sw) {
  if (!sw.cli.busy) return;
  clearTimeout(sw.cli.busy);
  sw.cli.busy = null;
  out(sw, '');
  refreshPrompt(sw);
}
function submit(sw, v) {
  const c = sw.cli;
  if (c.busy) return;
  c.more = null;
  if (c.ask) { const a = c.ask; out(sw, a.q + (a.hidden ? '' : v)); c.ask = null; a.fn(v); return finishCmd(sw); }
  if (c.mode === 'boot') { startSession(sw); return finishCmd(sw); }
  const p = promptText(sw);
  c.plen = p.length;
  out(sw, p + v);
  if (v.trim()) c.hist.push(v);
  c.hi = c.hist.length;
  const wasConf = CONF_MODES.has(c.mode);
  if (!v.trim().startsWith('!')) dispatch(sw, v, 0);
  if (wasConf && v.trim()) sw.dirty = true;
  finishCmd(sw);
}
function finishCmd(sw) {
  vtpSync();
  refreshPrompt(sw);
  onChange();
}
function treesFor(sw) { return SUB_MODES.has(sw.cli.mode) ? [TREES[sw.cli.mode], CONF] : [TREES[sw.cli.mode]]; }
function complete(sw, text) {
  if (!text || /\s$/.test(text) || !TREES[sw.cli.mode]) return null;
  const toks = tokenize(text), last = toks.pop();
  for (const tree of treesFor(sw)) {
    const w = walk(tree, toks);
    if (!w || w.inRest) continue;
    const c = matchKw(w.opts, last.s);
    if (c.length === 1) return text.slice(0, last.pos) + c[0].k + ' ';
    if (c.length > 1) return null;
    if (w.opts.some(n => n.ifspec) && /^[a-z-]+$/i.test(last.s)) {
      const t = IF_HELP.find(([n]) => n.toLowerCase().startsWith(last.s.toLowerCase()));
      if (t) return text.slice(0, last.pos) + t[0];
    }
  }
  return null;
}
function help(sw, text) {
  if (!TREES[sw.cli.mode]) return;
  out(sw, promptText(sw) + text + '?');
  const toks = tokenize(text);
  const partial = !/\s$/.test(text) && toks.length ? toks.pop() : null;
  for (const tree of treesFor(sw)) {
    const w = walk(tree, toks);
    if (!w) continue;
    if (partial) {
      const c = w.inRest ? [] : matchKw(w.opts, partial.s);
      if (!c.length) continue;
      out(sw, c.map(n => n.k).sort().join('  '), '');
      return;
    }
    const args = [], kws = [];
    for (const n of w.opts) {
      if (n.ifspec) kws.push(...IF_HELP);
      else if (n.k) kws.push([n.k, n.h || '']);
      else args.push([n.a || 'LINE', n.h || '']);
    }
    kws.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
    const rows = [...args, ...kws];
    const wd = Math.max(0, ...rows.map(r => r[0].length)) + 2;
    const L = rows.map(([a, b]) => '  ' + a.padEnd(wd) + b);
    if (w.node && w.node.run) L.push('  <cr>');
    page(sw, [...L, '']);
    return;
  }
  out(sw, '% Unrecognized command', '');
}

// ---------- checks ----------
function runChecks() {
  const sc = S.sc, G = [];
  const group = name => { const g = { name, items: [] }; G.push(g); return g; };
  const ok = g => g.items.push({ ok: true });
  const bad = (g, msg) => g.items.push({ ok: false, msg });
  const vlanOf = Object.fromEntries(sc.colors.map(c => [c.name, c.vlan]));
  const s3Assigned = new Set(Object.values(sc.assign.S3).flat());

  const g1 = group('VLANs created and named');
  for (const s of SW_IDS) for (const c of sc.colors) {
    const n = S.switches[s].vlans.get(c.vlan);
    if (n === c.name) ok(g1);
    else bad(g1, n == null ? `${SW_NAME[s]}: VLAN ${c.vlan} ${c.name} is missing` : `${SW_NAME[s]}: VLAN ${c.vlan} is named ${n}, should be ${c.name}`);
  }

  const g2 = group('Ports in the right VLAN');
  const portCheck = (s, p, v, label) => {
    const pt = S.switches[s].ports[p];
    if (pt.mode !== 'access') bad(g2, `${SW_NAME[s]} ${p}${label}: mode is ${pt.mode}, needs switchport mode access`);
    else if (pt.access !== v) bad(g2, `${SW_NAME[s]} ${p}${label}: in VLAN ${pt.access}, needs VLAN ${v}`);
    else ok(g2);
  };
  for (const s of SW_IDS) for (const [cn, ports] of Object.entries(sc.assign[s])) for (const p of ports) portCheck(s, p, vlanOf[cn], '');
  for (const d of S.devices.filter(x => x.type === 'server')) {
    const at = attach(d);
    if (!at || at.sw !== 'S3' || TRUNK_PORTS.includes(at.port)) bad(g2, `${d.name}: cable it to a free Switch3 port, then put that port in VLAN ${vlanOf[d.color]}`);
    else portCheck('S3', at.port, vlanOf[d.color], ` (${d.name})`);
  }

  const g3 = group('Trunk ports');
  for (const s of SW_IDS) for (const p of TRUNK_PORTS) {
    const m = S.switches[s].ports[p].mode;
    if (m === 'trunk') ok(g3); else bad(g3, `${SW_NAME[s]} ${p}: mode is ${m}, needs switchport mode trunk`);
  }

  const g4 = group('Cables');
  for (const [a, b] of [['S1', 'S2'], ['S2', 'S3']]) {
    const l = S.links.find(x => (x.a.dev === a && x.b.dev === b) || (x.a.dev === b && x.b.dev === a));
    if (!l) bad(g4, `${SW_NAME[a]} ↔ ${SW_NAME[b]} cable is missing`);
    else if (![l.a, l.b].every(e => TRUNK_PORTS.includes(e.port))) bad(g4, `${SW_NAME[a]} ↔ ${SW_NAME[b]} cable must use Fa0/23 or Fa0/24 on both switches`);
    else ok(g4);
  }
  for (const d of S.devices) {
    const at = attach(d);
    if (!at) { bad(g4, `${d.name} (${d.color}) is not connected to a switch`); continue; }
    if (d.type === 'pc') {
      if ((sc.assign[at.sw][d.color] || []).includes(at.port)) ok(g4);
      else bad(g4, `${d.name} (${d.color}) is on ${SW_NAME[at.sw]} ${at.port}, which is not a ${d.color} port`);
    } else if (at.sw === 'S3' && !TRUNK_PORTS.includes(at.port) && !s3Assigned.has(at.port)) ok(g4);
    else bad(g4, `${d.name} must use a free Switch3 port (not a trunk or PC port)`);
  }

  if (!S.presetIps) {
    const g5 = group('IP addresses');
    const count = {};
    for (const d of S.devices) if (d.ip) count[d.ip] = (count[d.ip] || 0) + 1;
    for (const d of S.devices) {
      if (!d.ip) bad(g5, `${d.name}: no IP address`);
      else if (!ipOk(d.ip)) bad(g5, `${d.name}: ${d.ip} is not a valid IP`);
      else if (d.mask !== '255.255.255.0') bad(g5, `${d.name}: subnet mask should be 255.255.255.0`);
      else if (count[d.ip] > 1) bad(g5, `${d.name}: ${d.ip} is used by another device`);
      else if (d.type === 'server' && d.ip !== d.fixedIp) bad(g5, `${d.name}: should be ${d.fixedIp}`);
      else if (d.type === 'pc' && !(d.ip.startsWith(NET) && +d.ip.split('.')[3] >= 10 && +d.ip.split('.')[3] <= 100)) bad(g5, `${d.name}: ${d.ip} is outside ${NET}10 – ${NET}100`);
      else ok(g5);
    }
  }

  const g6 = group('Connectivity');
  const D = S.devices;
  let leak = null;
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
    const a = D[i], b = D[j];
    if (a.color === b.color) {
      if (canReach(a, b)) ok(g6); else bad(g6, `${a.name} → ${b.name} (${a.color}) should reply but times out`);
    } else if (!leak && canReach(a, b)) leak = [a, b];
  }
  if (leak) bad(g6, `${leak[0].name} (${leak[0].color}) can reach ${leak[1].name} (${leak[1].color}). Colors must stay apart.`);
  else ok(g6);
  return G;
}

// ---------- answer key ----------
function compressPorts(list) {
  const nums = list.map(p => +p.split('/')[1]).sort((a, b) => a - b), parts = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `f0/${nums[i]}` : `f0/${nums[i]}-${nums[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
function answerFor(s) {
  const sc = S.sc;
  const L = ['en', 'conf t', 'no ip domain-l'];
  for (const c of sc.colors) L.push(`vlan ${c.vlan}`, `name ${c.name}`);
  L.push('int ra f0/23-24', 'sw mo tr');
  const block = (ports, v) => L.push(ports.length === 1 ? `int ${ports[0].replace('Fa', 'f')}` : `int ra ${compressPorts(ports)}`, 'sw mo acc', `sw acc vl ${v}`);
  for (const c of sc.colors) { const ports = sc.assign[s][c.name]; if (ports && ports.length) block(ports, c.vlan); }
  if (s === 'S3') {
    const used = new Set(Object.values(sc.assign.S3).flat());
    let n = 1;
    for (const sv of sc.servers) {
      while (used.has('Fa0/' + n)) n++;
      used.add('Fa0/' + n);
      L.push(`! ${sv.name} on Fa0/${n}`);
      block(['Fa0/' + n], sc.colors.find(c => c.name === sv.color).vlan);
    }
  }
  L.push('end', 'wr');
  return L.join('\n');
}

// ---------- change loop ----------
let pending = false;
function onChange() {
  if (HEADLESS || pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const G = runChecks();
    renderChecks(G);
    renderWs();
    const all = G.every(g => g.items.every(i => i.ok));
    if (all && S.t0 && !S.tEnd) finish();
  });
}

// ---------- timer ----------
const fmt = ms => { const t = Math.floor(ms / 100); const m = Math.floor(t / 600), s = Math.floor(t / 10) % 60, d = t % 10; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`; };
const elapsed = () => S.t0 ? (S.tEnd || performance.now()) - S.t0 : 0;
function touch() { if (S && !S.t0 && !S.tEnd) { S.t0 = performance.now(); renderStatus(); } }
function finish() {
  S.tEnd = performance.now();
  const ms = S.tEnd - S.t0, key = 'best:' + S.sc.key;
  const best = store.get(key, []);
  best.push(ms); best.sort((a, b) => a - b);
  store.set(key, best.slice(0, 5));
  $('#doneTime').textContent = fmt(ms);
  $('#doneBest').textContent = best[0] === ms ? (best.length > 1 ? 'New best time!' : 'First finished run. Beat it next time.') : `Your best: ${fmt(best[0])}`;
  $('#done').hidden = false;
  renderStatus();
}

// ---------- UI rendering ----------
function renderStatus() {
  const st = $('#status');
  st.className = 'chip' + (S.tEnd ? ' is-done' : S.t0 ? ' is-run' : '');
  st.textContent = S.tEnd ? 'Finished' : S.t0 ? 'Running' : 'Ready';
}
function renderTimer() { if (S) $('#timer').textContent = fmt(elapsed()); }

function renderSheet() {
  const sc = S.sc;
  const title = c => c[0] + c.slice(1).toLowerCase();
  const box = (...lines) => `<div class="ex">${lines.filter(l => l != null).join('<br>')}</div>`;
  const one = sc.servers.length === 1;
  const srvName = v => one ? 'the Enrollment System' : `the ${title(v.color)} Enrollment System`;
  const pcSwitches = SW_IDS.filter(s => Object.values(sc.assign[s]).some(p => p.length));
  const swNo = s => s.slice(1);
  const swBlock = s => {
    const rows = Object.entries(sc.assign[s]).filter(([, p]) => p.length).map(([c, p]) => `${c} = ${p.join(', ')}`);
    if (s === 'S3') rows.push(`Choose any available port on Switch 3 for ${one ? 'the Enrollment System' : 'each Enrollment System'} and assign the port to the corresponding VLAN.`);
    return rows.length ? box(`SWITCH ${swNo(s)}`, ...rows) : '';
  };
  $('#steps').innerHTML = [
    box('OBJECTIVES', 'Connect computers assigned to the same VLAN.', 'Test connectivity between devices within the same VLAN and between different VLANs.',
      ...sc.servers.map(v => `Verify that devices in the ${title(v.color)} VLAN can communicate with ${srvName(v)}.`)),
    box('STEP 1: CREATE VLANs', 'Create the following VLANs on the switch:', ...sc.colors.map(c => `VLAN ${c.vlan} = ${c.name}`)),
    box('STEP 2: ASSIGN PORTS TO VLANs', 'Assign the appropriate switch ports to their respective VLANs.'),
    SW_IDS.map(swBlock).join(''),
    box('STEP 3: CONFIGURE TRUNK PORTS', 'On Switch 1, Switch 2, and Switch 3, configure Fa0/23 and Fa0/24 as Trunk ports.'),
    box('STEP 4: PHYSICALLY CONNECT COMPUTERS', pcSwitches.length === 1
      ? `Connect each computer to Switch ${swNo(pcSwitches[0])} using the appropriate port assigned to its corresponding VLAN.`
      : 'Connect each computer to the switch next to it using the appropriate port assigned to its corresponding VLAN.'),
    box('STEP 5: ASSIGN IP ADDRESSES TO THE DEVICES', 'Manually assign an IP address to each device.', 'Network Information:', `Network Address: ${NET}0/24`, 'Subnet Mask: 255.255.255.0',
      `Device IP Range: ${NET}10 - ${NET}100`, 'Use any available IP address within the specified range.', '',
      ...sc.servers.map(v => `${one ? 'Enrollment System' : title(v.color) + ' Enrollment System'} IP: ${v.ip}`),
      S.presetIps ? '<i>(This run: IPs are already assigned.)</i>' : null),
    box('STEP 6: TEST CONNECTIVITY', 'Test the connection between computers within the same VLAN.', 'Test the connection between computers in different VLANs.', 'Use the ping command to check connectivity between devices.',
      ...sc.servers.map(v => `Open ${srvName(v)} from a computer in the ${title(v.color)} VLAN and verify that it is accessible.`)),
  ].join('');
  $('#keyBody').innerHTML = SW_IDS.map(s => `<h4>${SW_NAME[s]}</h4><pre>${esc(answerFor(s))}</pre>`).join('');
  $('#keyBox').open = false;
}

function renderChecks(G) {
  const total = G.reduce((a, g) => a + g.items.length, 0);
  const pass = G.reduce((a, g) => a + g.items.filter(i => i.ok).length, 0);
  const box = $('#checks');
  $('#checkNow').hidden = PREFS.live;
  if (!PREFS.live) {
    $('#progTxt').textContent = 'Checklist hidden';
    $('#progBar').style.width = '0';
    if (!S.reveal) { box.innerHTML = '<li class="ck-msg">Hidden for exam practice. Press Check my work to see where you are.</li>'; return; }
    G = S.reveal;
  } else {
    $('#progTxt').textContent = `${pass} / ${total} checks`;
    $('#progBar').style.width = (total ? pass / total * 100 : 0) + '%';
  }
  box.innerHTML = G.map(g => {
    const n = g.items.length, p = g.items.filter(i => i.ok).length;
    const fails = g.items.filter(i => !i.ok).map(i => i.msg);
    const cls = p === n ? 'pass' : p === 0 ? 'fail' : 'part';
    const list = fails.slice(0, 4).map(m => `<div class="ck-msg bad">${esc(m)}</div>`).join('') + (fails.length > 4 ? `<div class="ck-msg">and ${fails.length - 4} more</div>` : '');
    return `<li class="${cls}"><div class="ck-head"><span class="ck-dot"></span>${g.name}<span class="n">${p}/${n}</span></div>${list}</li>`;
  }).join('');
}

const PC_ICON = '<rect class="sel-ring" x="-28" y="-28" width="56" height="54" rx="8"/><rect class="body" x="-18" y="-19" width="36" height="26" rx="2.5"/><rect class="scr" x="-14" y="-15.5" width="28" height="19" rx="1"/><rect class="body" x="-4" y="7" width="8" height="5"/><rect class="body" x="-12" y="12" width="24" height="4" rx="1.5"/>';
const SRV_ICON = '<rect class="sel-ring" x="-24" y="-30" width="48" height="58" rx="8"/><rect class="body" x="-13" y="-22" width="26" height="42" rx="2.5"/><path class="ln" d="M-8 -14h16M-8 -8h16M-8 -2h16"/><circle class="scr" cx="0" cy="12" r="2.4"/>';
const SW_ICON = '<rect class="sel-ring" x="-46" y="-26" width="92" height="44" rx="8"/><path class="body" d="M-34 -6 L-24 -16 L40 -16 L30 -6 Z"/><rect class="body" x="-34" y="-6" width="64" height="16"/><path class="body" d="M30 -6 L40 -16 L40 0 L30 10 Z"/><path class="ln" d="M-16 -11h14M2 -11h14M-14 -13l-3 2 3 2M14 -13l3 2-3 2"/>';

function tip(d) {
  const at = attach(d);
  return `${d.name}\n${d.color}\nIP: ${d.ip || 'not set'}\n${at ? `Cable: ${SW_NAME[at.sw]} ${at.port}` : 'Not connected'}`;
}
function ledColor(l, end) {
  const other = end === l.a ? l.b : l.a;
  for (const e of [end, other]) { const sw = S.switches[e.dev]; if (sw && sw.ports[e.port].shut) return 'var(--led-down)'; }
  if (S.switches[end.dev] && !S.switches[other.dev] && linkWaiting(l)) return 'var(--led-wait)';
  return 'var(--led-ok)';
}
function linkSvg(l) {
  const A = nodeById(l.a.dev), B = nodeById(l.b.dev);
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const pt = (P, dist) => [P.x + ux * dist, P.y + uy * dist];
  const [la, lb] = [pt(A, 34), pt(B, -34)];
  let s = `<g class="link" data-link="${l.id}"><line class="cable-hit" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/><line class="cable" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
  s += `<circle cx="${la[0]}" cy="${la[1]}" r="4.5" fill="${ledColor(l, l.a)}"/><circle cx="${lb[0]}" cy="${lb[1]}" r="4.5" fill="${ledColor(l, l.b)}"/>`;
  if (PREFS.labels) {
    // On PC cables the switch-port label sits further out, where neighbouring cables have spread apart
    const swA = !!S.switches[l.a.dev], swB = !!S.switches[l.b.dev], near = Math.min(44, len / 2 - 10), far = Math.min(len * 0.42, len - 60);
    const da = swA && !swB ? far : swA ? Math.min(64, len / 2 - 10) : near;
    const db = swB && !swA ? far : swB ? Math.min(64, len / 2 - 10) : near;
    const [ta, tb] = [pt(A, da), pt(B, -db)], ox = -uy * 11, oy = ux * 11;
    s += `<text class="plabel" x="${ta[0] + ox}" y="${ta[1] + oy}">${l.a.port}</text><text class="plabel" x="${tb[0] + ox}" y="${tb[1] + oy}">${l.b.port}</text>`;
  }
  return s + '</g>';
}
function renderWs() {
  if (HEADLESS) return;
  const svg = $('#ws'), W = S.vbW, H = 760;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.minWidth = Math.round(W * 0.7) + 'px';
  svg.setAttribute('class', 't-' + S.tool);
  let s = `<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" class="grid-l"/></pattern></defs><rect class="ws-bg" width="${W}" height="${H}"/><rect width="${W}" height="${H}" fill="url(#grid)"/>`;
  for (const d of S.devices) s += `<circle class="zone" cx="${d.x}" cy="${d.y}" r="46" fill="${ZONE[d.color]}"/>`;
  for (const l of S.links) s += linkSvg(l);
  if (S.pending && S.mouse) { const a = nodeById(S.pending.dev); s += `<line class="rubber" x1="${a.x}" y1="${a.y}" x2="${S.mouse.x}" y2="${S.mouse.y}"/>`; }
  const selected = id => (S.pending && S.pending.dev === id) || S.pduSrc === id;
  for (const id of SW_IDS) {
    const sw = S.switches[id];
    s += `<g class="dev${selected(id) ? ' sel' : ''}" data-dev="${id}" transform="translate(${sw.x} ${sw.y})" tabindex="0" role="button" aria-label="${sw.name}"><title>${sw.name} (2960-24TT)</title>${SW_ICON}<text class="dtype" y="30">2960-24TT</text><text class="dname" y="45">${sw.name}</text></g>`;
  }
  for (const d of S.devices) {
    s += `<g class="dev${selected(d.id) ? ' sel' : ''}" data-dev="${d.id}" transform="translate(${d.x} ${d.y})" tabindex="0" role="button" aria-label="${esc(d.name)}"><title>${esc(tip(d))}</title>${d.type === 'pc' ? PC_ICON : SRV_ICON}<text class="dtype" y="${d.type === 'pc' ? 32 : 34}">${d.type === 'pc' ? 'PC-PT' : 'Server-PT'}</text><text class="dname" y="${d.type === 'pc' ? 46 : 48}">${esc(d.name)}</text></g>`;
  }
  svg.innerHTML = s;
}
function renderEvents() {
  const b = $('#evBody');
  if (!S.events.length) { b.innerHTML = '<tr class="empty"><td colspan="5">Use Add Simple PDU: click a PC, then another device.</td></tr>'; return; }
  b.innerHTML = S.events.map(e => `<tr><td class="${e.ok ? 'ok' : 'bad'}">${e.ok ? 'Successful' : 'Failed'}</td><td>${esc(e.src)}</td><td>${esc(e.dst)}</td><td>ICMP</td><td>${e.n}</td></tr>`).join('');
}
function hint() {
  const t = {
    select: 'Click a device to open it. Drag to move it.',
    cable: S.pending ? `From ${nodeById(S.pending.dev).name} ${S.pending.port}: now click the other device.` : 'Click the first device, pick its port, then click the second device.',
    delete: 'Click a cable to remove it.',
    pdu: S.pduSrc ? `From ${nodeById(S.pduSrc).name}: click the destination.` : 'Click the source PC, then the destination.',
  }[S.tool];
  $('#hint').textContent = t;
}
function setTool(t, sticky = false) {
  S.tool = t; S.sticky = t === 'cable' && sticky; S.pending = null; S.pduSrc = null;
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('#stk').hidden = !S.sticky;
  closePicker(); hint(); renderWs();
}
let toastT = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- workspace interaction ----------
function closePicker() { const p = $('#picker'); p.hidden = true; p.replaceChildren(); }
function showPicker(id, x, y) {
  if (S.pending && S.pending.dev === id) return toast('Pick a different device for the other end.');
  const isSw = !!S.switches[id];
  const ports = isSw ? ALL_PORTS : ['Fa0'];
  const p = $('#picker');
  p.replaceChildren(...ports.map(port => h('button', { type: 'button', role: 'menuitem', disabled: !!linkAt(id, port), onclick: () => { closePicker(); portChosen(id, port); } }, longName(port))));
  p.hidden = false;
  const r = p.getBoundingClientRect();
  p.style.left = clamp(x + 6, 8, innerWidth - r.width - 8) + 'px';
  p.style.top = clamp(y - 10, 8, innerHeight - r.height - 8) + 'px';
  const first = p.querySelector('button:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}
function portChosen(id, port) {
  touch();
  if (!S.pending) { S.pending = { dev: id, port }; hint(); renderWs(); return; }
  const a = S.pending, b = { dev: id, port };
  S.pending = null;
  if (!S.switches[a.dev] && !S.switches[b.dev]) { toast('Connect PCs and servers to a switch port.'); hint(); renderWs(); return; }
  addLink(a, b);
  if (!S.sticky) setTool('select'); else { hint(); renderWs(); }
}
function devClick(id, x, y) {
  if (S.tool === 'select') return openWin(id);
  if (S.tool === 'cable') return showPicker(id, x, y);
  if (S.tool === 'delete') {
    const ls = S.links.filter(l => l.a.dev === id || l.b.dev === id);
    if (!ls.length) return toast(`${nodeById(id).name} has no cables.`);
    if (S.switches[id]) return toast('Click the cable itself to remove a switch cable.');
    ls.forEach(removeLink);
    return toast(`Removed the cable from ${nodeById(id).name}.`);
  }
  if (S.tool === 'pdu') {
    if (S.switches[id]) return toast('Pick a PC or server.');
    if (!S.pduSrc) { S.pduSrc = id; hint(); renderWs(); return; }
    if (S.pduSrc === id) return;
    touch();
    const a = devById(S.pduSrc), b = devById(id);
    S.events.unshift({ ok: canReach(a, b), src: a.name, dst: b.name, n: S.events.length });
    S.events = S.events.slice(0, 40);
    S.pduSrc = null;
    hint(); renderEvents(); renderWs();
  }
}
function toSvg(e) {
  const svg = $('#ws'), p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
let drag = null, raf = 0;
function bindWorkspace() {
  const svg = $('#ws');
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-dev]'), lk = e.target.closest('[data-link]');
    if (g) { drag = { id: g.dataset.dev, x0: e.clientX, y0: e.clientY, moved: false }; svg.setPointerCapture(e.pointerId); return; }
    if (lk && S.tool === 'delete') { const l = S.links.find(x => x.id === lk.dataset.link); if (l) { touch(); removeLink(l); } return; }
    if (S.pending || S.pduSrc) { S.pending = null; S.pduSrc = null; hint(); renderWs(); }
    closePicker();
  });
  svg.addEventListener('pointermove', e => {
    const p = toSvg(e);
    if (drag) {
      if (!drag.moved && S.tool === 'select' && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
      if (drag.moved) {
        const o = nodeById(drag.id);
        o.x = clamp(p.x, 40, S.vbW - 40); o.y = clamp(p.y, 40, 720);
        cancelAnimationFrame(raf); raf = requestAnimationFrame(renderWs);
      }
      return;
    }
    if (S.pending) {
      S.mouse = { x: p.x, y: p.y };
      const r = svg.querySelector('.rubber');
      if (r) { r.setAttribute('x2', p.x); r.setAttribute('y2', p.y); } else renderWs();
    }
  });
  svg.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) devClick(d.id, e.clientX, e.clientY);
  });
  svg.addEventListener('keydown', e => {
    const g = e.target.closest('[data-dev]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const r = g.getBoundingClientRect(); devClick(g.dataset.dev, r.right, r.top); }
  });
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.addEventListener('click', e => setTool(b.dataset.tool, e.ctrlKey || e.metaKey)));
  $('#ffwd').addEventListener('click', () => { fastForward(); toast('Time moved forward. All links are green.'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePicker(); if (S.tool !== 'select' || S.pending || S.pduSrc) setTool('select'); }
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#picker') && !e.target.closest('#ws')) closePicker(); });
}

// ---------- device windows ----------
const WINS = new Map();
let zTop = 100, cascade = 0;
function front(el) { el.style.zIndex = ++zTop; }
function closeWin(id) { const w = WINS.get(id); if (!w) return; w.close(); w.el.remove(); WINS.delete(id); }
function closeAll() { for (const id of [...WINS.keys()]) closeWin(id); }
function openWin(id) {
  const ex = WINS.get(id);
  if (ex) { front(ex.el); ex.focus(); return; }
  const isSw = !!S.switches[id], dev = nodeById(id);
  const el = h('div', { class: 'win' + (isSw ? '' : ' pcw'), role: 'dialog', 'aria-label': dev.name });
  const bar = h('div', { class: 'win-bar' }, h('span', { class: 'win-title' }, dev.name), h('button', { class: 'win-x', type: 'button', 'aria-label': 'Close ' + dev.name, onclick: () => closeWin(id) }, '×'));
  const body = h('div', { class: 'win-body' });
  el.append(bar, body);
  const api = isSw ? buildCli(dev, body) : buildDesktop(dev, body);
  WINS.set(id, { el, ...api });
  $('#layer').append(el);
  const w = el.offsetWidth;
  el.style.left = clamp(140 + (cascade % 6) * 36, 8, Math.max(8, innerWidth - w - 8)) + 'px';
  el.style.top = clamp(70 + (cascade % 6) * 30, 8, Math.max(8, innerHeight - el.offsetHeight - 8)) + 'px';
  cascade++;
  el.addEventListener('pointerdown', () => front(el));
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const mv = ev => { el.style.left = clamp(ev.clientX - ox, -r.width + 80, innerWidth - 80) + 'px'; el.style.top = clamp(ev.clientY - oy, 0, innerHeight - 40) + 'px'; };
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
  });
  front(el);
  api.focus();
}

// Like Packet Tracer: a device opens on Physical the first time, then on whichever tab you used last
function tabbed(body, names, panes, onShow, node) {
  let cur = 0;
  const btns = names.map((n, i) => h('button', { type: 'button', role: 'tab', class: 'wtab', onclick: () => show(i) }, n));
  body.append(h('div', { class: 'win-tabs', role: 'tablist' }, ...btns), ...panes);
  function show(i) {
    cur = node.tab = i;
    btns.forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-selected', String(i === j)); });
    panes.forEach((p, j) => { p.hidden = i !== j; });
    onShow(i);
  }
  show(node.tab || 0);
  return { current: () => cur, focus: () => btns[cur].focus() };
}
function infoPane(text) { return h('div', { class: 'pane' }, h('p', { class: 'pane-note' }, text)); }
function configPane(node) {
  const isSw = !!S.switches[node.id];
  const row = (k, v) => h('div', { class: 'r' }, h('span', { class: 'muted' }, k), h('span', {}, v));
  return h('div', { class: 'pane' }, h('div', { class: 'ipform' },
    row('Display Name', node.name),
    isSw ? row('Hostname', node.hostname) : row('Interface', 'FastEthernet0'),
    h('p', { class: 'pane-note' }, isSw ? 'Configure this switch from the CLI tab.' : 'Set the IP in Desktop > IP Configuration.')));
}
function physicalPane(node, el) {
  if (S.switches[node.id]) {
    const port = p => h('span', { class: 'pport' + (linkAt(node.id, p) ? ' up' : ''), title: longName(p) }, p.split('/')[1]);
    const odd = [], even = [];
    for (let n = 1; n <= 24; n++) (n % 2 ? odd : even).push(port('Fa0/' + n));
    el.replaceChildren(h('p', { class: 'pane-note' }, 'Cisco Catalyst 2960-24TT. Green ports have a cable.'),
      h('div', { class: 'chassis' }, h('div', { class: 'pgrid' }, ...odd, ...even), h('div', { class: 'pgig' }, port('Gig0/1'), port('Gig0/2'))));
  } else {
    const at = attach(node);
    el.replaceChildren(h('p', { class: 'pane-note' }, node.type === 'server' ? 'Server-PT' : 'PC-PT'),
      h('div', { class: 'chassis pc' }, h('span', { class: 'pport' + (at ? ' up' : '') }, 'Fa0'), h('span', {}, at ? `Connected to ${SW_NAME[at.sw]} ${at.port}` : 'No cable')));
  }
}

function buildCli(sw, body) {
  const pre = h('pre', { class: 'term-out' });
  const pr = h('span', { class: 'term-prompt' });
  const inp = h('input', { class: 'term-in', id: 'cli-' + sw.id, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Command line for ' + sw.name });
  const term = h('div', { class: 'term' }, pre, h('div', { class: 'term-row' }, pr, inp));
  const cliPane = h('div', {}, h('div', { class: 'win-sub' }, 'IOS Command Line Interface'), term);
  const phys = h('div', { class: 'pane' });
  const tabs = tabbed(body, ['Physical', 'Config', 'CLI', 'Attributes'],
    [phys, configPane(sw), cliPane, infoPane('Attributes are not used in this exam.')],
    i => { if (i === 0) physicalPane(sw, phys); if (i === 2) { inp.focus(); term.scrollTop = term.scrollHeight; } }, sw);
  pre.textContent = sw.cli.buf.join('\n') + '\n';
  sw.cli.view = { pre, pr, inp, term };
  refreshPrompt(sw);
  term.addEventListener('mouseup', () => { if (!String(getSelection())) inp.focus(); });
  inp.addEventListener('keydown', e => cliKey(sw, e));
  inp.addEventListener('paste', e => cliPaste(sw, e));
  return { focus: () => { if (tabs.current() === 2) inp.focus(); else tabs.focus(); }, close: () => { sw.cli.view = null; } };
}
function cliKey(sw, e) {
  const c = sw.cli, inp = e.target;
  touch();
  if (e.ctrlKey && e.shiftKey && (e.code === 'Digit6' || e.key === '^' || e.key === '6' || e.key === '&')) { e.preventDefault(); abortLookup(sw); return; }
  if (e.ctrlKey && e.key === 'F6') { e.preventDefault(); inp.blur(); return; }
  if (c.busy || c.queue) { if (e.key.length === 1 || e.key === 'Enter') e.preventDefault(); return; }
  if (c.more) { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) { e.preventDefault(); moreKey(sw, e.key); } return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase(), v = inp.value, at = inp.selectionStart;
    if (k === 'c' && inp.selectionStart === inp.selectionEnd && c.mode !== 'boot' && !c.ask) {
      e.preventDefault();
      out(sw, promptText(sw) + v + '^C'); inp.value = '';
      if (CONF_MODES.has(c.mode)) endConf(sw);
      refreshPrompt(sw); onChange(); return;
    }
    if (k === 'a') { e.preventDefault(); inp.setSelectionRange(0, 0); return; }
    if (k === 'e') { e.preventDefault(); inp.setSelectionRange(v.length, v.length); return; }
    if (k === 'u') { e.preventDefault(); inp.value = v.slice(at); inp.setSelectionRange(0, 0); return; }
  }
  if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; inp.value = ''; submit(sw, v); return; }
  if (e.key === 'Tab') { e.preventDefault(); const r = complete(sw, inp.value); if (r != null) inp.value = r; return; }
  if (e.key === '?' && c.mode !== 'boot' && !c.ask) { e.preventDefault(); help(sw, inp.value); refreshPrompt(sw); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); if (c.hist.length) { c.hi = Math.max(0, c.hi - 1); inp.value = c.hist[c.hi]; } return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); c.hi = Math.min(c.hist.length, c.hi + 1); inp.value = c.hist[c.hi] || ''; return; }
  if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (CONF_MODES.has(c.mode)) { out(sw, promptText(sw) + inp.value + '^Z'); inp.value = ''; endConf(sw); refreshPrompt(sw); onChange(); }
  }
}
function cliPaste(sw, e) {
  e.preventDefault();
  if (!PREFS.paste) return toast('Paste is off. Turn on "Allow paste" in Options.');
  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  const inp = e.target;
  const all = inp.value.slice(0, inp.selectionStart) + text + inp.value.slice(inp.selectionEnd);
  const lines = all.split(/\r?\n/), last = lines.pop();
  if (!lines.length) { inp.value = all; return; }
  inp.value = '';
  sw.cli.queue = lines;
  const step = () => {
    if (sw.cli.busy) return setTimeout(step, 120);
    const l = sw.cli.queue.shift();
    if (l === undefined) { sw.cli.queue = null; inp.value = last; return; }
    submit(sw, l);
    setTimeout(step, 25);
  };
  step();
}

function pcOut(d, ...lines) {
  for (const t of lines) { d.cmd.push(t); if (d.cmdView) d.cmdView.pre.append(t + '\n'); }
  if (d.cmd.length > 1500) d.cmd.splice(0, 500);
  if (d.cmdView) d.cmdView.term.scrollTop = d.cmdView.term.scrollHeight;
}
function buildDesktop(d, body) {
  const view = h('div', { class: 'desk' });
  const phys = h('div', { class: 'pane' });
  const tabs = tabbed(body, ['Physical', 'Config', 'Desktop', d.type === 'server' ? 'Services' : 'Programming', 'Attributes'],
    [phys, configPane(d), view, infoPane('Not used in this exam.'), infoPane('Attributes are not used in this exam.')],
    i => { if (i === 0) physicalPane(d, phys); if (i === 2) { const f = view.querySelector('input') || view.querySelector('button'); if (f) f.focus(); } }, d);
  const appBar = (title, back) => h('div', { class: 'app-bar' }, h('span', {}, title), h('button', { class: 'app-x', type: 'button', 'aria-label': 'Close ' + title, onclick: back }, '×'));
  const ICONS = {
    ip: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="3" y="6" width="28" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><text x="17" y="19" font-size="9" text-anchor="middle" fill="currentColor" font-family="monospace">IP</text><path d="M12 29h10M17 24v5" stroke="currentColor" stroke-width="2"/></svg>',
    cmd: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="3" y="5" width="28" height="24" rx="2" fill="currentColor" opacity=".9"/><path d="M8 12l5 4-5 4M15 21h8" stroke="var(--panel)" stroke-width="2" fill="none"/></svg>',
    web: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 17h24M17 5c-5 6-5 18 0 24M17 5c5 6 5 18 0 24" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const tile = (label, icon, fn) => { const b = h('button', { class: 'tile', type: 'button', onclick: fn }); b.innerHTML = icon; b.append(label); return b; };
  function tiles() { d.app = null; d.cmdView = null; view.replaceChildren(h('div', { class: 'tiles' }, tile('IP Configuration', ICONS.ip, ipApp), tile('Command Prompt', ICONS.cmd, cmdApp), tile('Web Browser', ICONS.web, webApp))); }
  function ipApp() {
    d.app = 'ip'; d.cmdView = null;
    const field = (label, key) => {
      const inp = h('input', { id: `${key}-${d.id}`, value: d[key], inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' });
      const mark = () => inp.setAttribute('aria-invalid', String(!!inp.value && !ipOk(inp.value)));
      inp.addEventListener('input', () => { d[key] = inp.value.trim(); d.arp.clear(); mark(); touch(); onChange(); });
      mark();
      return { inp, row: h('label', { class: 'r', for: inp.id }, h('span', {}, label), inp) };
    };
    const ip = field('IPv4 Address', 'ip'), mask = field('Subnet Mask', 'mask'), gw = field('Default Gateway', 'gw');
    const autoMask = () => {
      if (mask.inp.value || !ipOk(ip.inp.value)) return;
      const o = +ip.inp.value.split('.')[0];
      mask.inp.value = d.mask = o < 128 ? '255.0.0.0' : o < 192 ? '255.255.0.0' : '255.255.255.0';
      onChange();
    };
    ip.inp.addEventListener('blur', autoMask);
    mask.inp.addEventListener('focus', autoMask);
    view.replaceChildren(appBar('IP Configuration', tiles), h('div', { class: 'ipform' },
      h('div', { class: 'r' }, h('span', { class: 'muted' }, 'Interface'), h('span', {}, 'FastEthernet0')),
      h('div', { class: 'r' }, h('span', { class: 'muted' }, 'IP Configuration'), h('span', {}, 'Static')),
      ip.row, mask.row, gw.row));
  }
  function cmdApp() {
    d.app = 'cmd';
    const pre = h('pre', { class: 'term-out' });
    const inp = h('input', { class: 'term-in', id: 'cmd-' + d.id, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Command Prompt for ' + d.name });
    const term = h('div', { class: 'term' }, pre, h('div', { class: 'term-row' }, h('span', { class: 'term-prompt' }, 'C:\\>'), inp));
    pre.textContent = d.cmd.join('\n') + '\n';
    d.cmdView = { pre, term };
    term.addEventListener('mouseup', () => { if (!String(getSelection())) inp.focus(); });
    inp.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'F6') { e.preventDefault(); inp.blur(); return; }
      if (e.key !== 'Enter' || d.cmdBusy) return;
      const v = inp.value; inp.value = '';
      pcOut(d, 'C:\\>' + v);
      pcExec(d, v);
    });
    view.replaceChildren(appBar('Command Prompt', tiles), term);
    inp.focus();
    term.scrollTop = term.scrollHeight;
  }
  function webApp() {
    d.app = 'web'; d.cmdView = null;
    const url = h('input', { id: 'url-' + d.id, value: d.url, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'URL' });
    const page = h('div', { class: 'web-page' }, h('p', { class: 'err' }, 'Type the server IP and press Go.'));
    const go = () => { d.url = url.value; browse(d, url.value, page); };
    url.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    view.replaceChildren(appBar('Web Browser', tiles), h('div', { class: 'web-bar' }, url, h('button', { class: 'btn', type: 'button', onclick: go }, 'Go')), page);
    url.focus();
    url.setSelectionRange(url.value.length, url.value.length);
  }
  ({ ip: ipApp, cmd: cmdApp, web: webApp }[d.app] || tiles)();
  return { focus: () => { if (tabs.current() !== 2) return tabs.focus(); const f = view.querySelector('input') || view.querySelector('button'); if (f) f.focus(); }, close: () => { d.cmdView = null; } };
}
function pcExec(d, line) {
  const t = line.trim();
  if (!t) return;
  const [cmd, ...rest] = t.split(/\s+/);
  const c = cmd.toLowerCase();
  touch();
  if (c === 'ping') {
    const target = rest.filter(x => !x.startsWith('-')).pop();
    if (!target) return pcOut(d, 'Cisco Packet Tracer PC Ping', '', 'Usage: ping [-n count | -v TOS | -t] target', '');
    return ping(d, target);
  }
  if (c === 'ipconfig') return pcOut(d, '', 'FastEthernet0 Connection:(default port)', '', '   Connection-specific DNS Suffix..: ', `   IPv4 Address....................: ${d.ip || '0.0.0.0'}`, `   Subnet Mask.....................: ${d.mask || '0.0.0.0'}`, `   Default Gateway.................: ${d.gw || '0.0.0.0'}`, '');
  if (c === 'cls') { d.cmd = []; if (d.cmdView) d.cmdView.pre.textContent = ''; return; }
  if (c === 'help' || c === '?') return pcOut(d, 'Available Commands:', '  ipconfig   Display network configuration', '  ping       Send echo messages', '  cls        Clear screen', '');
  pcOut(d, 'Invalid Command.', '');
}
function ping(d, target) {
  if (!ipOk(target)) return pcOut(d, `Ping request could not find host ${target}. Please check the name and try again.`, '');
  const dsts = S.devices.filter(x => x.ip === target);
  const reach = dsts.length === 1 && canReach(d, dsts[0]);
  const lines = [];
  let recv = 0;
  for (let i = 0; i < 4; i++) {
    const arpMiss = i === 0 && reach && dsts[0] !== d && !d.arp.has(dsts[0].id);
    if (reach && !arpMiss) { lines.push([`Reply from ${target}: bytes=32 time<1ms TTL=128`, 160]); recv++; } else lines.push(['Request timed out.', 700]);
  }
  if (reach) d.arp.add(dsts[0].id);
  const stats = ['', `Ping statistics for ${target}:`, `    Packets: Sent = 4, Received = ${recv}, Lost = ${4 - recv} (${(4 - recv) * 25}% loss),`];
  if (recv) stats.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms');
  stats.push('');
  d.cmdBusy = true;
  pcOut(d, '', `Pinging ${target} with 32 bytes of data:`, '');
  let i = 0;
  const next = () => {
    if (i < lines.length) { const [txt, ms] = lines[i++]; setTimeout(() => { pcOut(d, txt); next(); }, ms); return; }
    pcOut(d, ...stats);
    d.cmdBusy = false;
  };
  next();
}
function browse(d, url, page) {
  touch();
  const host = url.replace(/^\s*https?:\/\//i, '').split(/[/:?#]/)[0].trim();
  page.replaceChildren(h('p', { class: 'err' }, 'Connecting…'));
  setTimeout(() => {
    const dsts = S.devices.filter(x => x.ip === host);
    if (!ipOk(host)) return page.replaceChildren(h('p', { class: 'err' }, 'Host Name Unresolved'));
    if (dsts.length === 1 && dsts[0].type === 'server' && canReach(d, dsts[0])) {
      const sv = dsts[0];
      page.replaceChildren(h('h2', {}, 'Enrollment System'), h('p', {}, `You reached ${sv.name} at ${sv.ip}.`), h('p', {}, `Only ${sv.color} devices should be able to see this page.`));
    } else page.replaceChildren(h('p', { class: 'err' }, 'Request Timeout'));
  }, 450);
}

// ---------- boot ----------
function newRun() {
  closeAll(); closePicker();
  $('#done').hidden = true;
  const m = PREFS.mode;
  const sc = m === 'random' ? randomScenario(PREFS.nColors, PREFS.perColor) : LEVELS[m] ? levelScenario(m) : presetScenario(m);
  startRun(sc, PREFS.ips);
  setTool('select');
  renderSheet(); renderEvents(); renderStatus(); renderTimer();
  onChange();
}
function init() {
  const sel = (id, from, to, v) => { const s = $(id); for (let i = from; i <= to; i++) s.append(h('option', { value: String(i) }, String(i))); s.value = String(v); return s; };
  const nC = sel('#nColors', 2, 6, PREFS.nColors), pC = sel('#perColor', 2, 5, PREFS.perColor);
  const mode = $('#mode');
  mode.value = PREFS.mode;
  $('#randOpts').hidden = PREFS.mode !== 'random';
  mode.addEventListener('change', () => { PREFS.mode = mode.value; savePrefs(); $('#randOpts').hidden = mode.value !== 'random'; newRun(); });
  nC.addEventListener('change', () => { PREFS.nColors = +nC.value; savePrefs(); newRun(); });
  pC.addEventListener('change', () => { PREFS.perColor = +pC.value; savePrefs(); newRun(); });
  $('#newRun').addEventListener('click', newRun);
  $('#doneNew').addEventListener('click', newRun);
  $('#doneClose').addEventListener('click', () => { $('#done').hidden = true; });
  const opt = (id, key, after) => { const c = $(id); c.checked = PREFS[key]; c.addEventListener('change', () => { PREFS[key] = c.checked; savePrefs(); if (after) after(); }); };
  opt('#optLive', 'live', () => { S.reveal = null; onChange(); });
  opt('#optPaste', 'paste');
  opt('#optLabels', 'labels', renderWs);
  opt('#optIps', 'ips');
  $('#checkNow').addEventListener('click', () => { S.reveal = runChecks(); onChange(); });
  bindWorkspace();
  setInterval(renderTimer, 100);
  newRun();
}

if (HEADLESS) globalThis.VST = { get S() { return S; }, startRun, presetScenario, randomScenario, levelScenario, submit, addLink, removeLink, runChecks, canReach, answerFor, attach, parseIfs };
else init();
})();
