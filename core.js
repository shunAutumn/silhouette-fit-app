/* シルエット試着 core: サイズ表の読み取り・フィット判定・アバター描画 */
(function (G) {
  'use strict';

  const KEY_DEFS = [
    ['yuki', /裄丈|ゆき丈|ユキ丈/],
    ['sleeve', /袖丈|袖の長さ|sleeve/i],
    ['shoulder', /肩幅|肩巾|shoulder/i],
    ['chest', /身幅|身巾|バスト|胸囲|胸回り|胸まわり|chest|bust|pit\s*to\s*pit/i],
    ['waist', /ウエスト|ウェスト|胴囲|胴回り|waist/i],
    ['hip', /ヒップ|腰囲|腰回り|\bhips?\b/i],
    ['rise', /股上|\brise\b/i],
    ['inseam', /股下|inseam|inside\s*leg/i],
    ['thigh', /わたり|渡り|ワタリ|もも幅|もも周り|太もも|thigh/i],
    ['hem', /裾幅|裾周り|裾回り|すそ幅|\bhem\b|leg\s*opening/i],
    ['height', /身長|height/i],
    ['length', /着丈|総丈|スカート丈|ワンピース丈|丈|length/i],
  ];
  const LABELS = {
    chest: '胸まわり', waist: 'ウエスト', hip: 'ヒップ', shoulder: '肩幅', sleeve: '袖丈',
    length: '着丈', inseam: '股下', thigh: 'わたり', rise: '股上', height: '身長', hem: '裾', yuki: '裄丈',
  };
  const CIRC = ['chest', 'waist', 'hip', 'thigh', 'hem'];
  const FLAT_THRESH = { chest: 70, waist: 50, hip: 62, thigh: 40, hem: 30 };
  const FLAT_HINT = /身幅|身巾|幅|巾|わたり|渡り|ワタリ|pit|width|1\/2|half|flat/i;

  const toHalf = (s) => String(s)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');

  const cleanCell = (s) => toHalf(s)
    .replace(/[（(]\s*(cm|㎝|センチ|inch|in|インチ)\s*[)）]/gi, '')
    .replace(/\s+/g, ' ').trim();

  function matchKey(s) {
    s = cleanCell(s || '');
    if (!s || s.length > 24 || isNumCell(s)) return null;
    for (const [k, re] of KEY_DEFS) if (re.test(s)) return k;
    return null;
  }

  function isNumCell(s) {
    return /^\s*\d[\d.\s\-~〜～−–]*\s*(cm|㎝|in|"|インチ)?\s*$/i.test(toHalf(s || ''));
  }

  function num(s) {
    if (s == null) return null;
    const t = toHalf(s).replace(/,/g, '');
    const m = t.match(/(\d+(?:\.\d+)?)(?:\s*[-~〜～−–]\s*(\d+(?:\.\d+)?))?/);
    if (!m) return null;
    const a = +m[1];
    return m[2] != null ? (a + +m[2]) / 2 : a;
  }

  /* ---------- テキスト → 表 ---------- */
  const UNIT_ONLY = /^(cm|㎝|単位.*|inch|in|インチ)$/i;

  function lines(text) {
    return toHalf(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  function textToGrid(text) {
    const ls = lines(text);
    const hasTab = ls.some((l) => l.includes('\t'));
    return ls.map((l) => {
      const parts = hasTab ? l.split('\t') : cleanCell(l).split(/\s*\|\s*|\s*,\s*|\s+/);
      return parts.map(cleanCell).filter((c) => c !== '' && !UNIT_ONLY.test(c));
    }).filter((r) => r.length);
  }

  function parseGrid(g) {
    g = (g || []).map((r) => r.map(cleanCell).filter((c) => c !== '' && !UNIT_ONLY.test(c))).filter((r) => r.length);
    if (g.length < 2 || g.every((r) => r.length < 2)) return [];
    const rowKeys = [];
    g.forEach((r, i) => { if (matchKey(r[0]) && r.slice(1).some(isNumCell)) rowKeys.push(i); });
    let best = { i: -1, c: 0 };
    g.forEach((r, i) => {
      const c = r.filter((x) => matchKey(x)).length;
      if (c > best.c) best = { i, c };
    });
    const out = [];
    const get = (name) => {
      let s = out.find((o) => o.name === name);
      if (!s) { s = { name, raw: [] }; out.push(s); }
      return s;
    };

    if (rowKeys.length && rowKeys.length >= best.c) {
      const first = rowKeys[0];
      const names = first > 0 ? g[first - 1] : null;
      rowKeys.forEach((i) => {
        const r = g[i];
        const key = matchKey(r[0]);
        const vals = r.slice(1);
        vals.forEach((v, j) => {
          let name = names ? names[names.length - vals.length + j] : null;
          if (!name || matchKey(name)) name = `#${j + 1}`;
          get(name).raw.push({ key, label: r[0], value: num(v) });
        });
      });
    } else if (best.c >= 1) {
      const header = g[best.i];
      const keys = header.map(matchKey);
      let n = 0;
      for (let i = best.i + 1; i < g.length; i++) {
        const r = g[i];
        const off = r.length - header.length;
        if (off < 0 || off > 1) continue;
        n++;
        const nameFromCell = !(keys[0] && off === 0);
        const name = nameFromCell ? r[0] : `#${n}`;
        const s = get(name);
        keys.forEach((k, j) => {
          if (!k) return;
          const v = r[j + off];
          if (isNumCell(v)) s.raw.push({ key: k, label: header[j], value: num(v) });
        });
      }
    }
    return out.filter((s) => s.raw.some((r) => r.value != null));
  }

  function parseVertical(text) {
    const t = lines(text).map(cleanCell).filter((s) => s && !UNIT_ONLY.test(s));
    const k = [];
    t.forEach((s, i) => { if (matchKey(s)) k.push(i); });
    if (!k.length) return [];
    // A: 項目名のあとに数値が n 個ずつ並ぶ
    const counts = k.map((ki, a) => {
      const end = a + 1 < k.length ? k[a + 1] : t.length;
      let c = 0;
      for (let i = ki + 1; i < end && isNumCell(t[i]); i++) c++;
      return c;
    });
    const freq = {};
    counts.forEach((c) => { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
    const n = +Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || 0;
    if (n > 0 && counts.filter((c) => c === n).length >= Math.max(1, k.length - 1)) {
      const pre = t.slice(0, k[0]).filter((s) => !/^(サイズ|size|寸法)$/i.test(s));
      const names = pre.slice(-n);
      const grid = [['', ...names]];
      k.forEach((ki, a) => { if (counts[a] === n) grid.push([t[ki], ...t.slice(ki + 1, ki + 1 + n)]); });
      return parseGrid(grid);
    }
    // B: 項目名が続けて並び、そのあとサイズごとの値
    let run = 1;
    while (run < k.length && k[run] === k[0] + run) run++;
    const header = ['サイズ', ...t.slice(k[0], k[0] + run)];
    const rest = t.slice(k[0] + run);
    const grid = [header];
    for (let i = 0; i + run + 1 <= rest.length; i += run + 1) {
      grid.push(rest.slice(i, i + run + 1));
    }
    return parseGrid(grid);
  }

  function parseInline(text) {
    const out = [];
    lines(text).forEach((l) => {
      const re = /([^\d\s:：=／/|,、]+)\s*[:：=]?\s*(\d+(?:\.\d+)?(?:\s*[-~〜～]\s*\d+(?:\.\d+)?)?)/g;
      const raw = [];
      let m;
      while ((m = re.exec(l))) {
        const key = matchKey(m[1]);
        if (key) raw.push({ key, label: m[1], value: num(m[2]) });
      }
      if (raw.length) {
        const nm = (l.match(/^\s*(?:サイズ\s*[:：]?\s*)?(\d?X{0,3}[SML]|F|FREE|フリー|\d{2,3})(?=[\s:：]|$)/i) || [])[1];
        out.push({ name: nm || `#${out.length + 1}`, raw });
      }
    });
    return out;
  }

  const countVals = (sizes) => sizes.reduce((a, s) => a + s.raw.filter((r) => r.value != null).length, 0);

  function parseText(text) {
    if (!text || !text.trim()) return [];
    const cands = [parseGrid(textToGrid(text)), parseVertical(text), parseInline(text)];
    cands.sort((a, b) => countVals(b) - countVals(a));
    return cands[0] || [];
  }

  function detectOptions(text, sizes) {
    const t = toHalf(text || '');
    let inch = /inch|インチ|\(in\)|\bin\.?\b|"/i.test(t) && !/cm|㎝|センチ/i.test(t);
    if (!inch && !/cm|㎝|センチ/i.test(t)) {
      const longVals = [];
      (sizes || []).forEach((s) => s.raw.forEach((r) => { if ((r.key === 'length' || r.key === 'inseam') && r.value != null) longVals.push(r.value); }));
      if (longVals.length && longVals.every((v) => v > 15 && v < 36)) inch = true;
    }
    const hasHeight = (sizes || []).some((s) => s.raw.some((r) => r.key === 'height'));
    const nude = hasHeight || /ヌード|適応|対応|目安|身体|からだ|体の寸法|body/i.test(t);
    return { inch, nude };
  }

  function finalize(sizes, opts) {
    opts = opts || {};
    return sizes.map((s) => {
      const m = {}; const src = {};
      s.raw.forEach((r) => {
        if (r.value == null || m[r.key] != null) return;
        let v = r.value * (opts.inch ? 2.54 : 1);
        if (CIRC.includes(r.key) && (FLAT_HINT.test(r.label) || v < FLAT_THRESH[r.key])) v *= 2;
        m[r.key] = Math.round(v * 10) / 10;
        src[r.key] = r;
      });
      if (m.yuki != null && m.sleeve == null) m.sleeve = Math.round((m.yuki - (m.shoulder != null ? m.shoulder / 2 : 20)) * 10) / 10;
      return { name: s.name, m, src };
    }).filter((s) => Object.keys(s.m).length);
  }

  /* ---------- 判定 ---------- */
  const DEFAULT_BODY = { height: 165, shoulder: 40, chest: 86, waist: 70, hip: 92, arm: 54, inseam: 74 };

  function category(m) {
    if (m.chest != null || m.shoulder != null || m.sleeve != null) return 'top';
    if (m.inseam != null || m.rise != null || m.thigh != null) return 'pants';
    if ((m.waist != null || m.hip != null) && m.length != null) return 'skirt';
    if (m.waist != null || m.hip != null) return 'pants';
    return 'top';
  }

  const RULES = {
    chest: [[0, 'tight', 'きつい'], [4, 'snug', 'ぴったり'], [16, 'good', 'ちょうどいい'], [28, 'loose', 'ゆったり'], [1e9, 'big', 'オーバーサイズ']],
    waistBottom: [[-1, 'tight', 'きつい'], [2, 'snug', 'ぴったり'], [6, 'good', 'ちょうどいい'], [10, 'loose', 'ゆるめ・ベルト推奨'], [1e9, 'big', 'ブカブカ']],
    waistTop: [[0, 'tight', 'きつい'], [4, 'snug', 'ぴったり'], [22, 'good', 'ちょうどいい'], [1e9, 'loose', 'ゆったり']],
    hip: [[0, 'tight', 'きつい'], [4, 'snug', 'ぴったり'], [12, 'good', 'ちょうどいい'], [22, 'loose', 'ゆったり'], [1e9, 'big', 'かなりゆったり']],
    thigh: [[0, 'tight', 'きつい'], [3, 'snug', 'ぴったり'], [10, 'good', 'ちょうどいい'], [18, 'loose', 'ゆったり'], [1e9, 'big', 'ワイド']],
    shoulder: [[-3, 'tight', '肩が窮屈'], [-1, 'snug', 'やや狭め'], [3, 'good', 'ジャスト'], [8, 'loose', 'ややドロップ'], [1e9, 'big', 'ドロップショルダー']],
    sleeve: [[-6, 'short', '七分丈くらい'], [-2, 'snug', 'やや短め'], [3, 'good', 'ちょうどいい'], [7, 'loose', 'やや長め'], [1e9, 'big', '長め・手が隠れる']],
    inseam: [[-10, 'info', 'クロップド丈'], [-3, 'info', 'くるぶし丈'], [3, 'good', 'ちょうどいい'], [8, 'loose', '裾がたまる'], [1e9, 'big', '長い・裾上げ推奨']],
    nude: [[-4, 'tight', 'きつめ'], [-2, 'snug', 'やや小さめ'], [2.01, 'good', 'ぴったり合う'], [6, 'loose', 'やや大きめ'], [1e9, 'big', '大きい']],
  };
  const PENALTY = { tight: 10, snug: 2, good: 0, loose: 2, big: 6, short: 3, info: 0 };
  const WEIGHT = { chest: 1, waist: 1, hip: 1, shoulder: 1, thigh: 0.8, sleeve: 0.5, inseam: 0.5, height: 0.6 };

  const classify = (v, rule) => rule.find((r) => v < r[0]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = (v) => Math.round(v * 10) / 10;

  function geom(b) {
    const H = b.height; const sh = b.shoulder / 2;
    const g = { H, sh };
    g.chin = H * 0.13; g.neckY = H * 0.135; g.nh = H * 0.034;
    g.shY = H * 0.19;
    g.chestY = H * 0.275; g.ch = b.chest * 0.16;
    g.waistY = H * 0.39; g.wh = b.waist * 0.155;
    g.hipY = H * 0.49; g.hh = b.hip * 0.17;
    g.crotchY = clamp(H - b.inseam, g.hipY + 4, H * 0.6);
    g.ankleY = H * 0.955; g.kneeY = (g.crotchY + g.ankleY) / 2 - 1;
    g.legX = g.hh * 0.5; g.kneeHalf = H * 0.03; g.ankleHalf = H * 0.019;
    g.arm = b.arm;
    g.armPts = [
      [-(sh - H * 0.012), g.shY + H * 0.015],
      [-(Math.max(g.ch, sh * 0.9) + H * 0.022), g.shY + b.arm * 0.47],
      [-(Math.max(g.hh, g.ch) + H * 0.025), g.shY + b.arm * 0.97],
    ];
    g.armW = [H * 0.028, H * 0.022, H * 0.016];
    g.hpsY = g.shY - H * 0.012;
    return g;
  }

  function lengthWhere(g, y) {
    const kneeTop = g.kneeY - 4;
    if (y < g.waistY - 3) return 'お腹が見える短め丈';
    if (y < g.hipY - 4) return 'ウエストあたりまでの短め丈';
    if (y < g.crotchY - 2) return '腰骨〜お尻にかかる丈';
    if (y < g.crotchY + (kneeTop - g.crotchY) * 0.35) return 'お尻が隠れる丈';
    if (y < kneeTop) return '太もも丈';
    if (y < g.kneeY + 6) return 'ひざ丈';
    if (y < g.ankleY - 12) return 'ミモレ丈';
    return 'ロング丈';
  }

  function evaluate(body, m, opts) {
    body = Object.assign({}, DEFAULT_BODY, body || {});
    const cat = category(m);
    const g = geom(body);
    const items = [];
    const push = (key, garment, bodyVal, diff, rule, extra) => {
      const c = classify(diff, rule);
      items.push(Object.assign({ key, label: LABELS[key], garment: r1(garment), body: bodyVal == null ? null : r1(bodyVal), diff: r1(diff), status: c[1], text: c[2] }, extra || {}));
    };

    if (opts && opts.nude) {
      const map = { height: 'height', chest: 'chest', waist: 'waist', hip: 'hip', shoulder: 'shoulder', inseam: 'inseam' };
      Object.keys(map).forEach((k) => {
        if (m[k] == null) return;
        const tol = k === 'height' ? 1.5 : 1;
        // 表の体より自分が大きい → 服がきつい
        push(k, m[k], body[map[k]], (m[k] - body[map[k]]) / tol, RULES.nude, { diffShown: r1(m[k] - body[map[k]]) });
      });
    } else {
      const effShoulder = m.shoulder != null ? m.shoulder : body.shoulder;
      if (m.shoulder != null) push('shoulder', m.shoulder, body.shoulder, m.shoulder - body.shoulder, RULES.shoulder);
      if (m.chest != null) push('chest', m.chest, body.chest, m.chest - body.chest, RULES.chest);
      if (m.waist != null) push('waist', m.waist, body.waist, m.waist - body.waist, cat === 'top' ? RULES.waistTop : RULES.waistBottom);
      if (m.hip != null) push('hip', m.hip, body.hip, m.hip - body.hip, RULES.hip);
      if (m.thigh != null) push('thigh', m.thigh, body.hip * 0.6, m.thigh - body.hip * 0.6, RULES.thigh, { bodyNote: '推定' });
      if (m.sleeve != null) {
        const eff = m.sleeve + (effShoulder - body.shoulder) / 2;
        if (eff < body.arm * 0.75) {
          items.push({ key: 'sleeve', label: LABELS.sleeve, garment: m.sleeve, body: body.arm, diff: r1(eff - body.arm), status: 'info', text: eff < body.arm * 0.5 ? '半袖' : '五分〜七分袖' });
        } else push('sleeve', m.sleeve, body.arm, eff - body.arm, RULES.sleeve);
      }
      if (cat === 'top' && m.length != null) {
        items.push({ key: 'length', label: LABELS.length, garment: m.length, body: null, diff: null, status: 'info', text: lengthWhere(g, g.hpsY + m.length) });
      }
      if (cat === 'skirt' && m.length != null) {
        items.push({ key: 'length', label: 'スカート丈', garment: m.length, body: null, diff: null, status: 'info', text: lengthWhere(g, skirtWaistY(g, m) + m.length) });
      }
      if (cat === 'pants') {
        const ins = m.inseam != null ? m.inseam : (m.length != null ? m.length - (m.rise != null ? m.rise : 26) : null);
        if (ins != null) push('inseam', ins, body.inseam, ins - body.inseam, RULES.inseam);
        if (m.rise != null) {
          const ratio = m.rise / body.height;
          items.push({ key: 'rise', label: LABELS.rise, garment: m.rise, body: null, diff: null, status: 'info', text: ratio < 0.14 ? '浅め（ローライズ）' : ratio > 0.18 ? '深め（ハイウエスト）' : 'ふつう' });
        }
      }
    }
    const score = items.reduce((a, it) => a + (PENALTY[it.status] || 0) * (WEIGHT[it.key] || 0.5) + (it.status === 'tight' ? Math.abs(it.diff) * 0.5 : 0), 0);
    const worst = items.some((i) => i.status === 'tight') ? 'tight'
      : items.some((i) => i.status === 'big') ? 'big'
        : items.some((i) => i.status === 'snug' || i.status === 'short') ? 'snug'
          : items.some((i) => i.status === 'loose') ? 'loose' : 'good';
    return { cat, items, score, worst };
  }

  function recommend(body, sizes, opts) {
    if (!sizes.length) return -1;
    let bi = 0; let bs = Infinity;
    sizes.forEach((s, i) => {
      const e = evaluate(body, s.m, opts);
      if (e.items.length && e.score < bs - 0.01) { bs = e.score; bi = i; }
    });
    return bi;
  }

  /* ---------- SVG ---------- */
  const f = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  function smooth(pts) {
    const n = pts.length; let d = `M${f(pts[0])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]; const p1 = pts[i]; const p2 = pts[(i + 1) % n]; const p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f(c1)} ${f(c2)} ${f(p2)}`;
    }
    return d + 'Z';
  }
  const poly = (pts) => `M${pts.map(f).join('L')}Z`;
  const mirror = (pts) => pts.slice().reverse().map(([x, y]) => [-x, y]);

  function bodyPaths(g) {
    const H = g.H;
    const L = [
      [-g.nh, g.chin + 1], [-g.nh, g.neckY + H * 0.012], [-(g.sh * 0.6), g.shY - H * 0.004],
      [-(g.sh - H * 0.004), g.shY + H * 0.012], [-(g.ch + 0.5), g.shY + (g.chestY - g.shY) * 0.55],
      [-g.ch, g.chestY], [-g.wh, g.waistY], [-g.hh, g.hipY], [-(g.hh * 0.97), g.crotchY],
      [-(g.legX + g.kneeHalf), g.kneeY], [-(g.legX + g.ankleHalf), g.ankleY], [-(g.legX + g.ankleHalf + 1.5), H],
      [-(g.legX - g.ankleHalf + 0.3), H], [-(g.legX - g.ankleHalf), g.ankleY], [-(g.legX - g.kneeHalf), g.kneeY],
      [-0.6, g.crotchY + 0.5],
    ];
    const torso = smooth(L.concat(mirror(L)));
    const arm = (side) => {
      const o = g.armPts.map((p, i) => [p[0] - g.armW[i], p[1]]);
      const inn = g.armPts.map((p, i) => [p[0] + g.armW[i], p[1]]).reverse();
      let pts = o.concat(inn);
      if (side > 0) pts = pts.map(([x, y]) => [-x, y]);
      return smooth(pts);
    };
    const w = g.armPts[2];
    const head = `<ellipse cx="0" cy="${(g.chin / 2 + 0.3).toFixed(2)}" rx="${(H * 0.046).toFixed(2)}" ry="${(g.chin / 2).toFixed(2)}"/>`;
    const hand = (s) => `<ellipse cx="${(s * -w[0]).toFixed(2)}" cy="${(w[1] + H * 0.045).toFixed(2)}" rx="${(H * 0.021).toFixed(2)}" ry="${(H * 0.048).toFixed(2)}"/>`;
    return { torso, armL: arm(-1), armR: arm(1), head, hands: hand(1) + hand(-1) };
  }

  function armAt(g, frac) {
    const pts = g.armPts; const segFrac = 0.47 / 0.97;
    const t = clamp(frac, 0, 1.2);
    let p; let w;
    if (t <= segFrac) {
      const u = t / segFrac;
      p = [pts[0][0] + (pts[1][0] - pts[0][0]) * u, pts[0][1] + (pts[1][1] - pts[0][1]) * u];
      w = g.armW[0] + (g.armW[1] - g.armW[0]) * u;
    } else {
      const u = (t - segFrac) / (1 - segFrac);
      p = [pts[1][0] + (pts[2][0] - pts[1][0]) * u, pts[1][1] + (pts[2][1] - pts[1][1]) * u];
      w = g.armW[1] + (g.armW[2] - g.armW[1]) * u;
    }
    return { p, w };
  }

  function skirtWaistY(g, m) {
    return m.rise != null ? clamp(g.crotchY - m.rise + 1, g.waistY - 4, g.hipY - 2) : g.waistY;
  }

  function garmentPaths(g, body, m, cat) {
    const parts = [];
    if (cat === 'top') {
      const gSh = (m.shoulder != null ? m.shoulder : body.shoulder) / 2;
      const drop = Math.max(0, gSh - g.sh);
      const gch = m.chest != null ? m.chest * 0.16 : g.ch + 3;
      const len = m.length != null ? m.length : g.H * 0.4;
      const hemY = g.hpsY + len;
      let hemH = gch;
      if (hemY > g.hipY) hemH = m.hip != null ? m.hip * 0.17 : Math.max(gch, hemY > g.crotchY ? g.hh + 3 + (hemY - g.crotchY) * 0.12 : gch);
      const seam = [-gSh, g.shY + 0.6 + drop * 0.55];
      const pitY = Math.max(seam[1] + 6, g.shY + (g.chestY - g.shY) * 0.6 + drop * 0.35);
      const L = [[-(g.nh + 1.6), g.hpsY], seam, [-gch, pitY], [-gch, g.chestY + 1]];
      if (m.waist != null && hemY > g.waistY + 2) L.push([-m.waist * 0.155, g.waistY]);
      if (hemY > g.hipY + 2 && m.hip != null) L.push([-m.hip * 0.17, g.hipY]);
      L.push([-hemH, hemY]);
      const R = mirror(L);
      const neck = [[(g.nh + 1.6) * 0.5, g.hpsY + g.H * 0.03], [0, g.hpsY + g.H * 0.036], [-(g.nh + 1.6) * 0.5, g.hpsY + g.H * 0.03]];
      parts.push({ cls: 'sf-cloth', d: poly(L.concat(R).concat(neck)) });
      if (m.sleeve != null) {
        const startF = Math.max(0, drop / g.arm - 0.02);
        const endF = clamp((m.sleeve + (gSh - g.sh)) / g.arm, startF + 0.05, 1.12);
        const fr = [startF];
        if (startF < 0.47 / 0.97 && endF > 0.47 / 0.97) fr.push(0.47 / 0.97);
        fr.push(endF);
        const sleeve = (s) => {
          const c = fr.map((x, i) => {
            const a = armAt(g, x);
            const ease = i === 0 ? 2.6 : i === fr.length - 1 ? 1.4 : 2;
            return { p: a.p, w: a.w + ease };
          });
          const o = c.map((x) => [x.p[0] - x.w, x.p[1]]);
          const inn = c.map((x) => [x.p[0] + x.w, x.p[1]]).reverse();
          o[0] = [seam[0] - 0.5, seam[1]];
          inn[inn.length - 1] = [Math.min(inn[inn.length - 1][0], -gch + 0.5), pitY];
          let pts = o.concat(inn);
          if (s > 0) pts = pts.map(([x, y]) => [-x, y]);
          return poly(pts);
        };
        parts.push({ cls: 'sf-cloth', d: sleeve(-1), sleeve: true }, { cls: 'sf-cloth', d: sleeve(1), sleeve: true });
      }
      return { parts, marks: { shoulder: [gSh, seam[1]], chest: [gch, g.chestY], waist: m.waist != null ? [m.waist * 0.155, g.waistY] : null, hip: m.hip != null && hemY > g.hipY ? [m.hip * 0.17, g.hipY] : null } };
    }
    const wY = skirtWaistY(g, m);
    const bodyWaistAt = g.wh + (g.hh - g.wh) * clamp((wY - g.waistY) / (g.hipY - g.waistY), 0, 1);
    const wh = m.waist != null ? m.waist * 0.155 * (bodyWaistAt / g.wh) : bodyWaistAt + 0.5;
    const hh = m.hip != null ? m.hip * 0.17 : Math.max(wh, g.hh + 2);
    if (cat === 'skirt') {
      const hemY = wY + m.length;
      const hemH = m.hem != null ? m.hem * 0.16 : hh + Math.max(0, hemY - g.hipY) * 0.14;
      const L = [[-wh, wY], [-hh, Math.max(g.hipY, wY + 6)], [-hemH, hemY]];
      parts.push({ cls: 'sf-cloth', d: poly(L.concat(mirror(L))) });
      return { parts, marks: { waist: [wh, wY], hip: [hh, Math.max(g.hipY, wY + 6)] } };
    }
    const rise = m.rise != null ? m.rise : g.crotchY - wY;
    const cY = wY + rise;
    const ins = m.inseam != null ? m.inseam : (m.length != null ? m.length - rise : g.H - g.crotchY);
    const hemY = Math.min(cY + ins, g.H + 2.5);
    const th = m.thigh != null ? m.thigh * 0.16 : g.hh * 0.52 + 2.5;
    const hemH = m.hem != null ? m.hem * 0.16 : Math.max(g.ankleHalf + 3, th * 0.62);
    const t = clamp((hemY - g.kneeY) / (g.ankleY - g.kneeY), -1, 1.2);
    const lx = g.legX + (t < 0 ? 0 : 0);
    const L = [
      [-wh, wY], [-hh, Math.max(g.hipY, wY + 5)], [-Math.max(2 * th, hh * 0.97), cY],
      [-(lx + hemH), hemY], [-Math.max(0.4, lx - hemH), hemY], [-0.4, cY + 1],
    ];
    parts.push({ cls: 'sf-cloth', d: poly(L.concat(mirror(L))) });
    return { parts, marks: { waist: [wh, wY], hip: [hh, Math.max(g.hipY, wY + 5)], thigh: [Math.max(2 * th, hh * 0.97), cY] } };
  }

  const STATUS_CLASS = (s) => `sf-st-${s}`;
  const SHORT = { chest: '胸', waist: 'ウエスト', hip: 'ヒップ', shoulder: '肩', thigh: 'わたり', height: '身長' };
  const fmtDiff = (d) => (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(Math.round(d));

  function renderSVG(body, size, opts) {
    body = Object.assign({}, DEFAULT_BODY, body || {});
    const g = geom(body);
    const ev = evaluate(body, size ? size.m : {}, opts);
    const H = g.H;
    const ghostExtra = opts && opts.nude && size && size.m.height != null ? Math.max(0, size.m.height - H) : 0;
    const top = -5 - ghostExtra - (ghostExtra ? 3 : 0); const VH = H + 5 - top;
    const out = [];
    out.push(`<svg class="sf-svg" viewBox="-50 ${top} 100 ${VH}" role="img" aria-label="体型アバターに服を重ねた図">`);
    // 方眼（パターン紙）
    out.push('<g class="sf-grid">');
    for (let x = -50; x <= 50; x += 5) out.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + VH}" ${x % 10 === 0 ? 'class="sf-grid-major"' : ''}/>`);
    for (let y = 0; y <= H + 5; y += 5) out.push(`<line x1="-50" y1="${H - y}" x2="50" y2="${H - y}" ${y % 10 === 0 ? 'class="sf-grid-major"' : ''}/>`);
    out.push('</g>');
    // メジャー（左端）
    out.push(`<rect class="sf-tape" x="-50" y="${top}" width="6" height="${VH}"/>`);
    for (let y = 0; y <= H + 5; y += 1) {
      const len = y % 10 === 0 ? 3.2 : y % 5 === 0 ? 2.2 : 1.2;
      out.push(`<line class="sf-tape-tick" x1="-44" y1="${(H - y).toFixed(1)}" x2="${(-44 - len).toFixed(1)}" y2="${(H - y).toFixed(1)}"/>`);
      if (y % 20 === 0 && y > 0) out.push(`<text class="sf-tape-num" x="-48.6" y="${(H - y + 1).toFixed(1)}">${y}</text>`);
    }
    out.push(`<line class="sf-floor" x1="-44" y1="${H}" x2="50" y2="${H}"/>`);

    const bp = bodyPaths(g);
    out.push(`<g class="sf-body"><path d="${bp.torso}"/>${bp.head}</g>`);

    const marks = [];
    if (opts && opts.nude && size) {
      const gb = Object.assign({}, body);
      ['chest', 'waist', 'hip', 'shoulder', 'inseam', 'height'].forEach((k) => { if (size.m[k] != null) gb[k] = size.m[k]; });
      const gg = geom(gb);
      const gp = bodyPaths(gg);
      const dy = H - gg.H;
      out.push(`<g class="sf-body"><path d="${bp.armL}"/><path d="${bp.armR}"/>${bp.hands}</g>`);
      out.push(`<g class="sf-ghost" transform="translate(0 ${dy.toFixed(2)})"><path d="${gp.torso}"/><path d="${gp.armL}"/><path d="${gp.armR}"/>${gp.head}</g>`);
      const yOf = { chest: gg.chestY + dy, waist: gg.waistY + dy, hip: gg.hipY + dy, shoulder: gg.shY + dy, height: dy + 0.5 };
      const xOf = { chest: gg.ch, waist: gg.wh, hip: gg.hh, shoulder: gg.sh, height: 4 };
      ev.items.forEach((it) => { if (yOf[it.key] != null) marks.push({ key: it.key, x: xOf[it.key], y: yOf[it.key], it }); });
    } else if (size) {
      const gp = garmentPaths(g, body, size.m, ev.cat);
      gp.parts.filter((p) => !p.sleeve).forEach((p) => out.push(`<path class="${p.cls}" d="${p.d}"/>`));
      out.push(`<g class="sf-body"><path d="${bp.armL}"/><path d="${bp.armR}"/>${bp.hands}</g>`);
      gp.parts.filter((p) => p.sleeve).forEach((p) => out.push(`<path class="${p.cls}" d="${p.d}"/>`));
      out.push(`<path class="sf-body-line" d="${bp.torso}"/>`);
      ev.items.forEach((it) => {
        const mk = gp.marks[it.key];
        if (mk) marks.push({ key: it.key, x: mk[0], y: mk[1], it });
      });
    } else {
      out.push(`<g class="sf-body"><path d="${bp.armL}"/><path d="${bp.armR}"/>${bp.hands}</g>`);
    }
    // 判定ラベル（右側）
    marks.sort((a, b) => a.y - b.y);
    let lastY = -100;
    marks.forEach((mk) => {
      const ly = Math.max(mk.y, lastY + 6.2); lastY = ly;
      const d = mk.it.diffShown != null ? mk.it.diffShown : mk.it.diff;
      out.push(`<g class="sf-mark ${STATUS_CLASS(mk.it.status)}">`
        + `<circle cx="${mk.x.toFixed(2)}" cy="${mk.y.toFixed(2)}" r="1.3"/>`
        + `<path class="sf-lead" d="M${mk.x.toFixed(2)},${mk.y.toFixed(2)} L29,${ly.toFixed(2)} L31,${ly.toFixed(2)}"/>`
        + `<text x="32" y="${(ly + 1.2).toFixed(2)}">${SHORT[mk.key] || ''} ${fmtDiff(d)}</text></g>`);
    });
    out.push('</svg>');
    return { svg: out.join(''), ev };
  }

  G.SizeFit = {
    parseText, parseGrid, finalize, detectOptions, evaluate, recommend, renderSVG,
    matchKey, category, LABELS, DEFAULT_BODY,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
