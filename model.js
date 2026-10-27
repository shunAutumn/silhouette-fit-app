/* シルエット試着 model: MakeHuman（CC0）の人体を寸法に合わせて変形し、体の断面に沿って服を作る */
(function (G) {
  'use strict';
  const C = G.SFCatalog;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  const NA = 96; // 断面の角度の分割数
  const COS = new Float32Array(NA + 1); const SIN = new Float32Array(NA + 1);
  for (let k = 0; k <= NA; k++) { const th = -Math.PI / 2 + (TAU * k) / NA; COS[k] = Math.cos(th); SIN[k] = Math.sin(th); }

  /* ---------- ベクトル ---------- */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dist = (a, b) => len(sub(a, b));

  /* ---------- 読み込み ---------- */
  let D = null;
  async function load(base) {
    if (D) return D;
    base = base || '';
    const [meta, buf] = await Promise.all([
      fetch(`${base}assets/human.json`).then((r) => r.json()),
      fetch(`${base}assets/human.bin`).then((r) => r.arrayBuffer()),
    ]);
    const nv = meta.vertexCount;
    const T = {};
    meta.targets.forEach((t) => { T[t.name] = { idx: new Uint32Array(buf, t.offset, t.count), off: new Int16Array(buf, t.offset + t.count * 4, t.count * 3) }; });
    const idx = new Uint32Array(buf, nv * 12, meta.indexCount);
    const R = meta.indexRanges;
    const part = (name) => idx.subarray(R[name][0], R[name][0] + R[name][1]);
    D = { meta, nv, base: new Float32Array(buf, 0, nv * 3), idx, T, jr: meta.joints, faces: { body: part('body'), eyes: concat(part('helper-l-eye'), part('helper-r-eye')), hair: part('helper-hair') } };
    const used = new Uint8Array(nv); D.faces.body.forEach((i) => { used[i] = 1; });
    D.bodyVerts = []; for (let i = 0; i < nv; i++) if (used[i]) D.bodyVerts.push(i);
    D.label = labelVerts(D.base);
    return D;
  }
  function concat(a, b) { const o = new Uint32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  function joint(P, name) {
    const [a, b] = D.jr[name]; let x = 0; let y = 0; let z = 0;
    for (let i = a; i < b; i++) { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; }
    const n = b - a; return [x / n, y / n, z / n];
  }

  /* ---------- 体の部位分け（初回だけ） ---------- */
  const LB = ['trunk', 'neck', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
  function segDist(p, a, b) {
    const ab = sub(b, a); const t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
    return dist(p, add(a, mul(ab, t)));
  }
  function skeleton(P) {
    const j = (n) => joint(P, n);
    const sides = {};
    ['l', 'r'].forEach((s) => {
      const sh = j(`${s}-shoulder`); const S = sh[0] > 0 ? 'L' : 'R'; // L = +x 側
      const el = j(`${s}-elbow`); const ha = j(`${s}-hand`); const ul = j(`${s}-upper-leg`); const kn = j(`${s}-knee`); const an = j(`${s}-ankle`);
      sides[S] = { sh, el, ha, ul, kn, an, handEnd: add(ha, mul(sub(ha, el), 0.62)) };
    });
    const pel = j('pelvis'); const nk = j('neck'); const hd = j('head');
    return { pel, nk, hd, L: sides.L, R: sides.R };
  }
  function labelVerts(P) {
    const sk = skeleton(P);
    const bones = [['trunk', sk.pel, sk.nk, 13], ['neck', sk.nk, sk.hd, 5.5], ['head', sk.hd, add(sk.hd, [0, 14, 0]), 9]];
    ['L', 'R'].forEach((S) => {
      const s = sk[S];
      bones.push([`uarm${S}`, s.sh, s.el, 5], [`farm${S}`, s.el, s.ha, 4], [`hand${S}`, s.ha, s.handEnd, 3.5],
        [`thigh${S}`, s.ul, s.kn, 8], [`shin${S}`, s.kn, s.an, 5.5], [`foot${S}`, add(s.an, [0, -s.an[1] * 0.55, -5]), add(s.an, [0, -s.an[1] * 0.7, 18]), 4.6]);
    });
    const lab = new Uint8Array(D.nv).fill(255);
    D.bodyVerts.forEach((i) => {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      let best = 0; let bd = Infinity;
      bones.forEach(([n, a, b, r], k) => { const d = segDist(p, a, b) / r; if (d < bd) { bd = d; best = k; } });
      lab[i] = LB.indexOf(bones[best][0]);
    });
    const lists = {};
    LB.forEach((n, k) => { lists[n] = []; });
    D.bodyVerts.forEach((i) => lists[LB[lab[i]]].push(i));
    // 腕を下ろすときの重み（肩の付け根でなめらかに曲げる）
    D.armW = { L: new Float32Array(D.nv), R: new Float32Array(D.nv) };
    ['L', 'R'].forEach((S) => {
      const s = sk[S]; const dir = norm(sub(s.el, s.sh));
      const wOf = (p) => smooth01((dot(sub(p, s.sh), dir) + 4) / 10);
      [`uarm${S}`, `farm${S}`, `hand${S}`].forEach((n) => lists[n].forEach((i) => { D.armW[S][i] = wOf([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); }));
      lists.trunk.forEach((i) => {
        const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        if (Math.sign(p[0]) === Math.sign(s.sh[0]) && Math.abs(p[0]) > Math.abs(s.sh[0]) - 7 && Math.abs(p[1] - s.sh[1]) < 12) D.armW[S][i] = wOf(p) * 0.55;
      });
      const side = s.sh[0] > 0 ? 'l' : 'r';
      [`${side}-elbow`, `${side}-hand`].forEach((j) => { const [a, b] = D.jr[j]; for (let i = a; i < b; i++) D.armW[S][i] = 1; });
      // ひじから先を伸ばすときの重み
      D.foreW = D.foreW || { L: new Float32Array(D.nv), R: new Float32Array(D.nv) };
      const fd = norm(sub(s.ha, s.el));
      const fOf = (p) => smooth01((dot(sub(p, s.el), fd) + 3) / 6);
      [`uarm${S}`, `farm${S}`, `hand${S}`].forEach((n) => lists[n].forEach((i) => { D.foreW[S][i] = fOf([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); }));
      { const [a, b] = D.jr[`${side}-hand`]; for (let i = a; i < b; i++) D.foreW[S][i] = 1; }
    });
    return lists;
  }

  // 腕を体の横に下ろす（腕の付け根を軸に回す）
  function lowerArms(P, deg, clearX) {
    const sk = skeleton(P);
    ['L', 'R'].forEach((S) => {
      const s = sk[S]; const v = sub(s.ha, s.sh);
      const cur = Math.atan2(Math.abs(v[0]), -v[1]);
      // 手が腰・太もも（＋服の厚み）に当たらない角度まで開く
      const reach = dist(s.sh, s.handEnd);
      const need = Math.asin(clamp((clearX - Math.abs(s.sh[0])) / reach, -1, 1));
      const want = Math.max((deg * Math.PI) / 180, need);
      // 今の腕の向き u → 目標の向き t（下・少し外・わずかに前）へ回す
      const t = norm([Math.sin(want) * Math.sign(s.sh[0]), -Math.cos(want), -0.02]);
      rotateTo(P, s.sh, norm(sub(s.el, s.sh)), t, D.armW[S]);
      // ひじから先: 二の腕とほぼ同じ向きに（わずかに前へ曲げる）
      const s2 = skeleton(P)[S];
      rotateTo(P, s2.el, norm(sub(s2.ha, s2.el)), norm(add(t, [0, 0, 0.05])), D.foreW[S]);
      void cur;
    });
  }
  // 点 o を中心に、向き u を向き t へ回す（頂点ごとの重みで角度を弱める）
  function rotateTo(P, o, u, t, w) {
    let ax = cross(u, t); const sinA = len(ax); const ang = Math.atan2(sinA, dot(u, t));
    if (sinA < 1e-6) return;
    ax = mul(ax, 1 / sinA);
    for (let i = 0; i < D.nv; i++) {
      if (!w[i]) continue;
      const a = ang * w[i]; const c = Math.cos(a); const sn = Math.sin(a);
      const v = [P[i * 3] - o[0], P[i * 3 + 1] - o[1], P[i * 3 + 2] - o[2]];
      const kv = cross(ax, v); const kd = dot(ax, v);
      for (let q = 0; q < 3; q++) P[i * 3 + q] = o[q] + v[q] * c + kv[q] * sn + ax[q] * kd * (1 - c);
    }
  }

  /* ---------- 変形 ---------- */
  function applyTarget(P, name, w) {
    const t = D.T[name]; if (!t || !w) return;
    const s = w * 0.01;
    for (let k = 0; k < t.idx.length; k++) {
      const i = t.idx[k] * 3;
      P[i] += t.off[k * 3] * s; P[i + 1] += t.off[k * 3 + 1] * s; P[i + 2] += t.off[k * 3 + 2] * s;
    }
  }

  /* ---------- 断面（凸包）と周長 ---------- */
  function hull(xs, zs) {
    const n = xs.length; if (n < 3) return null;
    const id = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b] || zs[a] - zs[b]);
    const crs = (o, a, b) => (xs[a] - xs[o]) * (zs[b] - zs[o]) - (zs[a] - zs[o]) * (xs[b] - xs[o]);
    const lo = []; const up = [];
    id.forEach((i) => { while (lo.length >= 2 && crs(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); });
    for (let k = id.length - 1; k >= 0; k--) { const i = id[k]; while (up.length >= 2 && crs(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
    up.pop(); lo.pop();
    return lo.concat(up).map((i) => [xs[i], zs[i]]);
  }
  const polyPerim = (h) => { let s = 0; for (let i = 0; i < h.length; i++) { const a = h[i]; const b = h[(i + 1) % h.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };

  // 縦方向に並べた頂点（y で並べ替え済み）から、高さ y の帯の凸包
  function sortByY(P, list) { return list.slice().sort((a, b) => P[a * 3 + 1] - P[b * 3 + 1]); }
  function lowerBound(P, sorted, y) { let lo = 0; let hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (P[sorted[m] * 3 + 1] < y) lo = m + 1; else hi = m; } return lo; }
  function sliceY(P, sorted, y, h, filter) {
    const xs = []; const zs = [];
    for (let k = lowerBound(P, sorted, y - h); k < sorted.length; k++) {
      const i = sorted[k]; if (P[i * 3 + 1] > y + h) break;
      if (filter && !filter(i)) continue;
      xs.push(P[i * 3]); zs.push(P[i * 3 + 2]);
    }
    return hull(xs, zs);
  }

  function measure(P) {
    let top = -Infinity; let bottom = Infinity;
    D.bodyVerts.forEach((i) => { const y = P[i * 3 + 1]; if (y > top) top = y; if (y < bottom) bottom = y; });
    const H = top - bottom;
    const sk = skeleton(P);
    const L = D.label;
    const trunk = sortByY(P, L.trunk.concat(L.thighL, L.thighR));
    let crotch = Infinity;
    trunk.forEach((i) => { const x = P[i * 3]; const y = P[i * 3 + 1]; if (Math.abs(x) < 1.2 && y > bottom + H * 0.3 && y < bottom + H * 0.62 && y < crotch) crotch = y; });
    const per = (y, onlyTrunk) => { const h = sliceY(P, trunk, y, 0.7, onlyTrunk ? null : null); return h ? polyPerim(h) : 0; };
    const scan = (y0, y1, mode) => {
      let by = y0; let bv = mode === 'max' ? -Infinity : Infinity;
      for (let y = y0; y >= y1; y -= 0.6) { const v = per(y); if (!v) continue; if (mode === 'max' ? v > bv : v < bv) { bv = v; by = y; } }
      return [bv, by];
    };
    const shY = (sk.L.sh[1] + sk.R.sh[1]) / 2;
    const [bust, bustY] = scan(shY - H * 0.04, shY - H * 0.16, 'max');
    const [waist, waistY] = scan(bustY - H * 0.05, crotch + H * 0.13, 'min');
    const [hip, hipY] = scan(waistY - H * 0.02, crotch + H * 0.035, 'max');
    const shoulder = dist(sk.L.sh, sk.R.sh) + 4.2 * (H / 170);
    const arm = dist(sk.L.sh, sk.L.el) + dist(sk.L.el, sk.L.ha) + 2.5 * (H / 170);
    return { H, bottom, crotch: crotch - bottom, bust, bustY, waist, waistY, hip, hipY, shoulder, arm, sk };
  }

  /* ---------- 体を作る ---------- */
  const FIT = { bust: ['bust-circ'], waist: ['waist-circ'], hips: ['hips-circ'], shoulder: ['shoulder-dist'], arm: ['upperarm-length', 'lowerarm-length'], leg: ['upperleg-height', 'lowerleg-height'] };
  const WANT = { bust: 'chest', waist: 'waist', hips: 'hip', shoulder: 'shoulder', arm: 'arm', leg: 'inseam' };
  const GOT = (m) => ({ bust: m.bust, waist: m.waist, hips: m.hip, shoulder: m.shoulder, arm: m.arm, leg: m.crotch });

  function body(profile) {
    const P = C.normalizeProfile(profile); const g = P.geo;
    const macro = new Float32Array(D.base);
    const fem = P.sex === 'f' ? 1 : P.sex === 'm' ? 0 : 0.5;
    applyTarget(macro, 'male', 1 - fem); applyTarget(macro, 'female', fem);
    const fat = clamp(((g.chest / P.pred.chest + g.waist / P.pred.waist * 1.4 + g.hip / P.pred.hip) / 3.4 - 1) / 0.22, -1, 1);
    [['male', 1 - fem], ['female', fem]].forEach(([s, w]) => { if (fat > 0) applyTarget(macro, `${s}-max`, w * fat); else applyTarget(macro, `${s}-min`, -w * fat); });
    const W = { bust: 0, waist: 0, hips: 0, shoulder: 0, arm: 0, leg: 0 };
    const pose = (w) => {
      const p = new Float32Array(macro);
      Object.keys(w).forEach((k) => { const v = w[k]; if (!v) return; FIT[k].forEach((t) => applyTarget(p, `${t}-${v > 0 ? 'incr' : 'decr'}`, Math.abs(v))); });
      return p;
    };
    let pos = pose(W); let m = measure(pos);
    const d = {};
    Object.keys(W).forEach((k) => {
      const w = Object.assign({}, W, { [k]: 0.5 }); const mp = GOT(measure(pose(w)))[k];
      const wn = Object.assign({}, W, { [k]: -0.5 }); const mn = GOT(measure(pose(wn)))[k];
      d[k] = (mp - mn) / 1.0;
    });
    for (let it = 0; it < 4; it++) {
      const k0 = m.H / g.height; const got = GOT(m);
      Object.keys(W).forEach((k) => { if (Math.abs(d[k]) > 1e-3) W[k] = clamp(W[k] + (g[WANT[k]] * k0 - got[k]) / d[k], -1.6, 1.6); });
      pos = pose(W); m = measure(pos);
    }
    const s = g.height / m.H; const y0 = m.bottom;
    for (let i = 0; i < pos.length; i += 3) { pos[i] *= s; pos[i + 1] = (pos[i + 1] - y0) * s; pos[i + 2] *= s; }
    const fm = measure(pos);
    let hipHalf = 0;
    D.label.trunk.concat(D.label.thighL, D.label.thighR).forEach((i) => { const y = pos[i * 3 + 1]; if (y > fm.crotch - 12 && y < fm.hipY + 4) hipHalf = Math.max(hipHalf, Math.abs(pos[i * 3])); });
    lowerArms(pos, 9, hipHalf + 13.5 * (g.height / 170));
    const H = g.height; const sk = skeleton(pos);
    const shY = (fm.sk.L.sh[1] + fm.sk.R.sh[1]) / 2;
    const Y = {
      top: H, neck: sk.nk[1] - H * 0.006, sh: shY + H * 0.016, pit: fm.bustY + H * 0.03, chest: fm.bustY,
      waist: fm.waistY, hip: fm.hipY, crotch: fm.crotch, knee: (sk.L.kn[1] + sk.R.kn[1]) / 2, ankle: (sk.L.an[1] + sk.R.an[1]) / 2,
    };
    const M = { P, H, h: H / 170, pos, Y, sk, shHalf: g.shoulder / 2, fit: fm, W };
    M.nrm = normals(pos, D.idx);
    M.regions = regions(M);
    return M;
  }

  function normals(P, idx) {
    const n = new Float32Array(P.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]; const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const f = cross(e1, e2);
      for (const q of [a, b, c]) { n[q] += f[0]; n[q + 1] += f[1]; n[q + 2] += f[2]; }
    }
    for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return n;
  }

  function bodyMeshes(M) {
    const z = (k) => new Float32Array((M.pos.length / 3) * k);
    const mk = (faces) => ({ pos: M.pos, nrm: M.nrm, uv: z(2), aux: z(4), idx: faces });
    return [{ id: 'body', mesh: mk(D.faces.body) }, { id: 'eyes', mesh: mk(D.faces.eyes) }, { id: 'hair', mesh: mk(D.faces.hair) }];
  }

  /* ---------- 断面の帯（体のまわりの輪郭を角度ごとの半径で持つ） ---------- */
  function radialFromHull(h, cx, cz) {
    const r = new Float32Array(NA + 1);
    for (let k = 0; k <= NA; k++) {
      const dx = COS[k]; const dz = SIN[k]; let best = 0;
      for (let e = 0; e < h.length; e++) {
        const p = h[e]; const q = h[(e + 1) % h.length];
        const ex = q[0] - p[0]; const ez = q[1] - p[1]; const px = p[0] - cx; const pz = p[1] - cz;
        const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const t = (px * ez - pz * ex) / den; const u = (px * dz - pz * dx) / den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t > best) best = t;
      }
      r[k] = best;
    }
    return r;
  }
  function smoothBands(bands, passes) {
    for (let p = 0; p < (passes || 2); p++) {
      const prev = bands.map((b) => b.r.slice());
      for (let i = 0; i < bands.length; i++) {
        const a = prev[Math.max(0, i - 1)]; const b = prev[i]; const c = prev[Math.min(bands.length - 1, i + 1)];
        for (let k = 0; k <= NA; k++) bands[i].r[k] = (a[k] + 2 * b[k] + c[k]) / 4;
      }
      bands.forEach((b) => { const r = b.r.slice(); for (let k = 0; k < NA; k++) { const km = (k - 1 + NA) % NA; const kp = (k + 1) % NA; b.r[k] = (r[km] + 2 * r[k] + r[kp]) / 4; } b.r[NA] = b.r[0]; });
    }
  }
  // 縦の帯（胴・首・腰から下）
  function verticalBands(M, list, yTop, yBot, step, h, passes) {
    const P = M.pos; const sorted = sortByY(P, list); const out = [];
    for (let y = yTop; y >= yBot; y -= step) {
      const xs = []; const zs = [];
      for (let k = lowerBound(P, sorted, y - h); k < sorted.length; k++) { const i = sorted[k]; if (P[i * 3 + 1] > y + h) break; xs.push(P[i * 3]); zs.push(P[i * 3 + 2]); }
      const hl = hull(xs, zs); if (!hl) continue;
      let zmin = Infinity; let zmax = -Infinity; hl.forEach((p) => { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); });
      out.push({ hl, cz: (zmin + zmax) / 2, y });
    }
    // 断面の中心を上下でならしてから半径を取る（中心のずれは波打ちになる）
    for (let p = 0; p < 8; p++) { const cz = out.map((b) => b.cz); for (let i = 1; i < out.length - 1; i++) out[i].cz = (cz[i - 1] + 2 * cz[i] + cz[i + 1]) / 4; }
    out.forEach((b) => Object.assign(b, { c: [0, b.y, b.cz], N: [1, 0, 0], B: [0, 0, 1], T: [0, -1, 0], s: yTop - b.y, r: radialFromHull(b.hl, 0, b.cz) }));
    smoothBands(out, passes || 2);
    return out;
  }
  // 骨に沿った帯（腕・脚・足）
  function boneBands(M, list, pts, step, ref) {
    const P = M.pos; const segs = []; let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = dist(pts[i], pts[i + 1]); segs.push({ a: pts[i], b: pts[i + 1], l, s0: total }); total += l; }
    const proj = list.map((i) => {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; let best = null; let bd = Infinity;
      segs.forEach((sg) => {
        const ab = sub(sg.b, sg.a); const t = clamp(dot(sub(p, sg.a), ab) / (sg.l * sg.l), 0, 1);
        const d = dist(p, add(sg.a, mul(ab, t))); if (d < bd) { bd = d; best = sg.s0 + t * sg.l; }
      });
      return { p, s: best };
    }).sort((a, b) => a.s - b.s);
    const at = (s) => {
      const sg = segs.find((x) => s <= x.s0 + x.l) || segs[segs.length - 1];
      const t = clamp((s - sg.s0) / sg.l, 0, 1);
      const sg2 = segs[Math.min(segs.length - 1, segs.indexOf(sg) + 1)];
      const T = norm(add(mul(norm(sub(sg.b, sg.a)), 1 - t * 0.5), mul(norm(sub(sg2.b, sg2.a)), t * 0.5)));
      return { c: add(sg.a, mul(sub(sg.b, sg.a), t)), T };
    };
    const out = [];
    for (let s = 0; s <= total; s += step) {
      const { c, T } = at(s); const N = norm(cross(ref, T)); const B = cross(T, N);
      const xs = []; const zs = [];
      proj.forEach((q) => { if (Math.abs(q.s - s) < 1.1) { const v = sub(q.p, c); xs.push(dot(v, N)); zs.push(dot(v, B)); } });
      const hl = hull(xs, zs); if (!hl) continue;
      out.push({ c, N, B, T, y: c[1], s, r: radialFromHull(hl, 0, 0) });
    }
    smoothBands(out, 4);
    return out;
  }

  function regions(M) {
    const L = D.label; const Y = M.Y; const sk = M.sk;
    const R = {};
    // 肩先（腕の付け根より上）も胴の服で覆う
    const capL = L.uarmL.filter((i) => M.pos[i * 3 + 1] > sk.L.sh[1] - 0.5);
    const capR = L.uarmR.filter((i) => M.pos[i * 3 + 1] > sk.R.sh[1] - 0.5);
    R.torso = verticalBands(M, L.trunk.concat(L.thighL, L.thighR, capL, capR), Y.neck + 3, Y.crotch - 0.5, 0.8, 1.1, 5);
    R.neck = verticalBands(M, L.neck, Y.neck + M.H * 0.055, Y.neck - 2, 0.8, 0.7);
    R.lower = verticalBands(M, L.thighL.concat(L.shinL, L.thighR, L.shinR, L.footL, L.footR), Y.crotch + 3.5, 0.6, 1.2, 1.1, 5);
    ['L', 'R'].forEach((S) => {
      const s = sk[S];
      const up = norm(sub(s.sh, s.el));
      R[`arm${S}`] = boneBands(M, L[`uarm${S}`].concat(L[`farm${S}`], L[`hand${S}`]), [add(s.sh, mul(up, 7)), s.sh, s.el, s.ha, s.handEnd], 0.9, [0, 0, 1]);
      const lup = norm(sub(s.ul, s.kn));
      const sg = Math.sign(s.ul[0]);
      const groin = L.trunk.filter((i) => M.pos[i * 3 + 1] < Y.crotch + 2.5 && M.pos[i * 3] * sg >= -0.8);
      R[`leg${S}`] = boneBands(M, L[`thigh${S}`].concat(L[`shin${S}`], groin), [add(s.ul, mul(lup, 8)), s.ul, s.kn, s.an], 1.0, [0, 0, 1]);
      const fv = L[`foot${S}`]; const P = M.pos;
      let zmin = Infinity; let zmax = -Infinity; let fx = 0;
      fv.forEach((i) => { zmin = Math.min(zmin, P[i * 3 + 2]); zmax = Math.max(zmax, P[i * 3 + 2]); fx += P[i * 3]; });
      fx /= fv.length || 1;
      const fy = M.H * 0.022;
      R[`foot${S}`] = boneBands(M, fv, [[fx, fy, zmin - 0.3], [fx, fy, zmax + 0.3]], 0.8, [0, 1, 0]);
      R[`foot${S}`].forEach((b) => {
        // 足の断面の中心を床寄りに置き直す（甲の高さまで含める）
        let lo = Infinity; let hi = -Infinity;
        for (let k = 0; k < NA; k++) { const yv = b.r[k] * SIN[k]; lo = Math.min(lo, yv); hi = Math.max(hi, yv); }
        b.lo = lo; b.hi = hi;
      });
    });
    return R;
  }

  /* ---------- 断面の操作 ---------- */
  const rPerim = (r) => { let s = 0; for (let k = 0; k < NA; k++) { const ax = r[k] * COS[k]; const az = r[k] * SIN[k]; const bx = r[k + 1] * COS[k + 1]; const bz = r[k + 1] * SIN[k + 1]; s += Math.hypot(bx - ax, bz - az); } return s; };
  const rAdd = (r, t) => r.map((v) => v + t);
  const rScale = (r, s) => r.map((v) => v * s);
  const rMax = (a, b) => a.map((v, k) => Math.max(v, b[k]));
  const rCirc = (r, C) => { const p = rPerim(r); return p > 0 && C > p ? rScale(r, C / p) : r; };
  function rFolds(r, y, amp, seed) {
    if (amp <= 0.01) return r;
    return r.map((v, k) => {
      const th = (TAU * k) / NA;
      // 上から垂れた布の縦じわ（高さによる揺れは小さく）
      return v + amp * (0.55 * Math.sin(6 * th + 0.006 * y + seed) + 0.3 * Math.sin(11 * th - 0.004 * y + seed * 2.3) + 0.15 * Math.sin(17 * th + 0.01 * y + seed * 0.7));
    });
  }

  /* ---------- 三角形にする ---------- */
  function loftRings(rings, opt) {
    opt = opt || {};
    const pos = []; const uv = []; const aux = []; const idx = []; const row = NA + 1;
    const push = (g, rr, shift) => {
      const per = rPerim(rr);
      for (let k = 0; k <= NA; k++) {
        const x = rr[k] * COS[k]; const z = rr[k] * SIN[k];
        const c = shift ? add(g.c, mul(g.T, shift)) : g.c;
        pos.push(c[0] + g.N[0] * x + g.B[0] * z, c[1] + g.N[1] * x + g.B[1] * z, c[2] + g.N[2] * x + g.B[2] * z);
        uv.push((k / NA) * per, g.s); aux.push(g.trim || 0, g.ease == null ? 999 : g.ease, -Math.PI / 2 + (TAU * k) / NA, 0);
      }
    };
    const list = [];
    if (opt.rim0) list.push({ g: rings[0], r: rAdd(rings[0].r, -0.45), shift: 0.35 });
    rings.forEach((g) => list.push({ g, r: g.r }));
    if (opt.rim1) { const g = rings[rings.length - 1]; list.push({ g, r: rAdd(g.r, -0.45), shift: -0.35 }); }
    list.forEach((x) => push(x.g, x.r, x.shift));
    for (let r = 0; r < list.length - 1; r++) for (let k = 0; k < NA; k++) { const a = r * row + k; const b = a + row; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const fan = (r, flip) => {
      const g = list[r].g; const ci = pos.length / 3;
      pos.push(g.c[0], g.c[1], g.c[2]); uv.push(0, g.s); aux.push(g.trim || 0, g.ease == null ? 999 : g.ease, 0, 1);
      for (let k = 0; k < NA; k++) { const a = r * row + k; if (flip) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
    };
    if (opt.close0) fan(0, false);
    if (opt.close1) fan(list.length - 1, true);
    const P = new Float32Array(pos); const I = new Uint32Array(idx);
    const n = normals(P, I);
    for (let r = 0; r < list.length; r++) { const a = r * row * 3; const b = (r * row + NA) * 3; for (let q = 0; q < 3; q++) { const s = n[a + q] + n[b + q]; n[a + q] = s; n[b + q] = s; } }
    // 法線が外向きになるようにそろえる（正面の判定や写真の貼り付けに使う）
    let out = 0; const mid = Math.min(list.length - 1, Math.max(0, list.length >> 1));
    for (let k = 0; k < NA; k += 4) {
      const g = list[mid].g; const q = (mid * row + k) * 3;
      const rd = add(mul(g.N, COS[k]), mul(g.B, SIN[k]));
      out += n[q] * rd[0] + n[q + 1] * rd[1] + n[q + 2] * rd[2];
    }
    const flip = out < 0 ? -1 : 1;
    for (let i = 0; i < n.length; i += 3) { const l = (Math.hypot(n[i], n[i + 1], n[i + 2]) || 1) * flip; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    if (flip < 0) for (let t = 0; t < I.length; t += 3) { const a = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = a; }
    return { pos: P, nrm: n, uv: new Float32Array(uv), aux: new Float32Array(aux), idx: I };
  }

  /* ---------- 服の寸法（体の値との差で決める） ---------- */
  function garmentSpec(M, cat, styleId, m) {
    const st = C.styleOf(cat, styleId); const fit = M.P.fit; const geo = M.P.geo; const Y = M.Y; const H = M.H;
    const grp = (C.CATS[cat] || C.CATS.tee).group;
    const has = (k) => m && m[k] != null && isFinite(m[k]);
    const delta = (k, bk) => (has(k) ? geo[bk] + (m[k] - fit[bk]) : null);
    if (grp === 'top') {
      const chest = delta('chest', 'chest') != null ? delta('chest', 'chest') : geo.chest + st.ease;
      const shoulder = delta('shoulder', 'shoulder') != null ? delta('shoulder', 'shoulder') : geo.shoulder + st.sh;
      const drop = Math.max(0, shoulder / 2 - M.shHalf);
      const hemAt = { waist: Y.waist, hip: Y.hip - H * 0.005, hipLow: Y.crotch + H * 0.012, crotch: Y.crotch - H * 0.01, crotchLow: Y.crotch - H * 0.04, knee: Y.knee + H * 0.02 };
      const length = has('length') ? m.length : Y.neck - (hemAt[st.hem] || hemAt.hipLow);
      const sleeve = has('sleeve') ? m.sleeve * (geo.arm / fit.arm) : Math.max(0, st.sleeve * geo.arm - (st.sleeve > 0 ? drop : 0));
      return { grp, st, chest, shoulder, drop, length, sleeve: st.sleeve === 0 && !has('sleeve') ? 0 : sleeve, waist: delta('waist', 'waist'), hip: delta('hip', 'hip'), neck: st.neck || 'crew', vDepth: st.vDepth || 10 };
    }
    if (grp === 'shoes') return { grp, st };
    const legC = (k) => geo.hip * k;
    const thighEase = has('thigh') ? m.thigh - fit.hip * 0.6 : (st.thigh != null ? st.thigh : 6);
    const thigh = legC(0.6) + thighEase;
    const knee = legC(0.38) + Math.max(1.5, thighEase * 0.72);
    let hem;
    if (has('hem')) hem = m.hem;
    else if (st.hem === 'knee') hem = knee;
    else if (st.hem === 'wide') hem = thigh * 0.86;
    else if (typeof st.hem === 'number') hem = legC(0.235) * st.hem;
    else hem = Math.max(legC(0.235) * 1.6, thigh * 0.62);
    let inseam;
    if (has('inseam')) inseam = m.inseam + (geo.inseam - fit.inseam);
    else if (has('length') && grp !== 'skirt') inseam = m.length - (has('rise') ? m.rise : 26) + (geo.inseam - fit.inseam);
    else inseam = st.inseam != null ? st.inseam : geo.inseam + 1;
    const riseFrac = { low: 0.58, mid: 0.78, high: 0.98 }[st.rise || 'mid'];
    const waistY = has('rise') ? Math.min(Y.crotch + m.rise * 0.86, Y.waist + 3) : Y.crotch + (Y.waist - Y.crotch) * riseFrac;
    const waist = delta('waist', 'waist') != null ? delta('waist', 'waist') : (st.waist != null ? geo.waist + st.waist + (waistY < Y.waist - 2 ? (Y.waist - waistY) * 0.6 : 0) : null);
    const hip = delta('hip', 'hip') != null ? delta('hip', 'hip') : (st.hip != null ? geo.hip + st.hip : null);
    let length = null;
    if (grp === 'skirt') length = has('length') ? m.length : waistY - (st.length === 'long' ? Y.ankle + H * 0.06 : Y.knee + H * 0.02);
    return { grp, st, waist, hip, thigh, knee, hem, inseam, waistY, length, flare: st.flare || 1.3 };
  }

  /* ---------- 服を着せる ---------- */
  const FABRIC_ID = { skin: 0, jersey: 1, denim: 2, rib: 3, leather: 4, canvas: 5, nylon: 6, knit: 7, sole: 8, guide: 9, woven: 10, twill: 11, wool: 12, linen: 13, mesh: 14, eye: 15, hair: 16 };
  function hexRGB(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const v = m ? parseInt(m[1], 16) : 0x999999;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  // 区間 [a, b]（帯の番号）を服で覆い、外側の面（env）を更新する
  function makeRings(bands, env, i0, i1, fn) {
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const b = bands[i]; const e = env[i];
      const res = fn(b, e, i, out.length ? out[out.length - 1] : null);
      if (!res) continue;
      out.push(Object.assign({ c: b.c, N: b.N, B: b.B, T: b.T, s: b.s, y: b.y, e0: e }, res));
      env[i] = rMax(e, res.r);
    }
    return out;
  }
  const idxRange = (bands, test) => { let a = -1; let b = -1; bands.forEach((x, i) => { if (test(x)) { if (a < 0) a = i; b = i; } }); return [a, b]; };

  function dress(M, outfit) {
    const R = M.regions; const Y = M.Y; const H = M.H;
    const env = {}; Object.keys(R).forEach((k) => { env[k] = R[k].map((b) => b.r.slice()); });
    const parts = []; let lift = 0;
    // 靴は先に作る（履き口がズボンの内側に入るように）
    const order = (outfit || []).map((it, li) => ({ it, li })).sort((a, b) => (a.it.cat === 'shoes' ? -1 : 0) - (b.it.cat === 'shoes' ? -1 : 0) || a.li - b.li);
    order.forEach(({ it, li }) => {
      const cat = C.CATS[it.cat] ? it.cat : 'tee';
      const sp = garmentSpec(M, cat, it.style, it.m);
      const t = C.CATS[cat].thick + li * 0.05;
      const fabric = it.fabric || C.CATS[cat].fabric;
      const push = (rings, extra, opt) => {
        if (!rings || rings.length < 2) return;
        // 布の輪を上下方向にならす（段差やしまを消す）
        for (let p = 0; p < 4; p++) {
          const prev = rings.map((g) => g.r);
          for (let i = 1; i < rings.length - 1; i++) rings[i] = Object.assign({}, rings[i], { r: prev[i].map((v, k) => (prev[i - 1][k] + 2 * v + prev[i + 1][k]) / 4) });
        }
        // ならした後も、内側の面（体や下に着た服）より外に保つ
        rings.forEach((g, i) => { if (g.e0) rings[i] = Object.assign({}, g, { r: g.r.map((v, k) => Math.max(v, g.e0[k] + 0.18)) }); });
        parts.push(Object.assign({ uid: it.uid, mesh: loftRings(rings, opt), fabric, color: it.color, fit: !!it.fit, print: null }, extra || {}));
      };
      const seed = (it.uid || 'x').charCodeAt(0) * 0.37;
      if (sp.grp === 'top') {
        const gSh = sp.shoulder / 2; const drop = sp.drop;
        const keys = [
          [Y.sh + H * 0.01, null], [Y.pit, sp.chest * 0.98], [Y.chest, sp.chest],
          [Y.waist, sp.waist || sp.chest * 0.99], [Y.hip, sp.hip || sp.chest * 1.02], [Y.hip - 40, (sp.hip || sp.chest) * 1.08],
        ];
        const target = (y, base) => {
          if (y >= keys[0][0]) return null;
          for (let k = 0; k < keys.length - 1; k++) {
            const [ya, ca] = keys[k]; const [yb, cb] = keys[k + 1];
            if (y <= ya && y >= yb) { const tt = (ya - y) / (ya - yb); return lerp(ca == null ? rPerim(base) : ca, cb, ca == null ? smooth01(tt) : tt); }
          }
          return keys[keys.length - 1][1];
        };
        const hemY = Y.neck - sp.length;
        const loose = sp.chest - M.P.geo.chest;
        const ribbed = fabric === 'knit' || cat === 'hoodie';
        const fold = (y, gr, base) => (y < Y.chest ? clamp((rPerim(gr) - rPerim(base)) / TAU * 0.22, 0, 1.1) * smooth01((Y.chest - y) / 12) : 0);
        const topY = Y.neck;
        const [a, b] = idxRange(R.torso, (x) => x.y <= topY && x.y >= hemY - 0.5);
        const shape = (bd, e, i, prev) => {
          const base = rAdd(e, t); let gr = base;
          const Ct = target(bd.y, base); if (Ct != null) gr = rCirc(base, Ct);
          if (prev && bd.y < Y.chest && loose > 4) gr = rMax(gr, rScale(prev.raw, 0.997));
          const raw = gr;
          gr = rFolds(gr, bd.y, fold(bd.y, gr, base), seed);
          const tr = (sp.neck === 'crew' || sp.neck === 'hood') && topY - bd.y < 1.8 ? 1 : (ribbed && bd.y - hemY < 5 ? 1 : 0);
          return { r: gr, raw, ease: Ct != null ? Ct - rPerim(e) : null, trim: tr };
        };
        const rings = makeRings(R.torso, env.torso, a, b, shape);
        let cut = null;
        if (sp.neck === 'v') cut = [1, Y.neck + 0.5, sp.vDepth * M.h, 5.5 * M.h, 0, 0, 0, 0];
        if (sp.neck === 'tank') cut = [2, Y.neck + 0.5, 13 * M.h, 0, 6 * M.h, M.shHalf * 0.62, Y.pit + 2, 6 * M.h];
        const chestR = rings.find((r) => r.y <= Y.chest) || rings[0];
        const printRect = chestR ? [-chestR.r[NA / 4] * 1.0, chestR.r[NA / 4] * 1.0, topY, hemY] : null;
        const below = hemY < R.torso[R.torso.length - 1].y;
        push(rings, { cut, placket: sp.neck === 'collar' ? 1 : 0, print: it.print ? { img: it.print, rect: printRect } : null }, { rim1: !below });
        if (below && rings.length) {
          const last = rings[rings.length - 1];
          const [la, lb] = idxRange(R.lower, (x) => x.y >= hemY);
          const low = makeRings(R.lower, env.lower, la, lb, (bd, e, i, prev) => {
            let gr = rMax(rAdd(e, t), rScale((prev || last).raw, prev ? 0.999 : 1));
            const raw = gr;
            gr = rFolds(gr, bd.y, clamp((rPerim(gr) - rPerim(e)) / TAU * 0.2, 0, 1.2), seed);
            return { r: gr, raw, ease: rPerim(raw) - rPerim(e), trim: ribbed && bd.y - hemY < 5 ? 1 : 0 };
          });
          push(low, { placket: sp.neck === 'collar' ? 1 : 0, print: it.print ? { img: it.print, rect: printRect } : null }, { rim1: true });
        }
        if (sp.sleeve > 0) {
          const easeTop = clamp((sp.chest - M.P.geo.chest) * 0.4 + 3 + drop * 0.6, 2.5, 24);
          ['L', 'R'].forEach((S) => {
            const bands = R[`arm${S}`]; const acr = 5; const sEnd = acr + drop + sp.sleeve;
            const long = sp.sleeve > M.P.geo.arm * 0.75; const easeEnd = long ? (ribbed ? 3 : 5) : easeTop * 0.85;
            const [sa, sb] = idxRange(bands, (x) => x.s >= 1.5 && x.s <= sEnd);
            const sl = makeRings(bands, env[`arm${S}`], sa, sb, (bd, e) => {
              const ez = lerp(easeTop, easeEnd, clamp((bd.s - acr) / Math.max(1, sEnd - acr), 0, 1)) * smooth01((bd.s - 1.5) / (acr + 2));
              const base = rAdd(e, t);
              let gr = rAdd(base, ez / TAU);
              gr = rFolds(gr, bd.s * 1.7, clamp(ez / TAU * 0.25, 0, 0.5), seed + 3);
              return { r: gr, raw: gr, ease: ez, trim: ribbed && long && sEnd - bd.s < 5 ? 1 : 0 };
            });
            push(sl, {}, { rim1: true });
          });
        }
        if (sp.neck === 'collar' || sp.neck === 'hood') {
          const hood = sp.neck === 'hood';
          const [na, nb] = idxRange(R.neck, (x) => x.y <= Y.neck + (hood ? 5 : cat === 'outer' ? 5 : 3.5) * M.h);
          const col = makeRings(R.neck, env.neck, na, nb, (bd, e) => {
            let gr = rAdd(e, t + (hood ? 1.6 : 0.5));
            if (hood) gr = gr.map((v, k) => v + (SIN[k] < 0 ? -SIN[k] * 3.5 : 0));
            return { r: gr, raw: gr, ease: null, trim: hood ? 0 : 1 };
          });
          push(col, {}, { rim0: true });
        }
      } else if (sp.grp === 'bottom' || sp.grp === 'skirt') {
        const wY = sp.waistY; const skirt = sp.grp === 'skirt';
        const band = cat === 'jeans' ? 3.8 : cat === 'underBottom' ? 3 : 2.5;
        const Cw = sp.waist; const Ch = sp.hip;
        const tC = (y, base) => {
          if (y >= Y.hip) { const tt = clamp((wY - y) / Math.max(1, wY - Y.hip), 0, 1); return lerp(Cw || rPerim(base), Ch || rPerim(base), tt); }
          return Ch ? Ch * lerp(1, 0.9, clamp((Y.hip - y) / Math.max(1, Y.hip - Y.crotch), 0, 1)) : null;
        };
        const [a, b] = idxRange(R.torso, (x) => x.y <= wY);
        const tor = makeRings(R.torso, env.torso, a, b, (bd, e) => {
          const base = rAdd(e, t); const Ct = tC(bd.y, base); const gr = Ct != null ? rCirc(base, Ct) : base;
          return { r: gr, raw: gr, ease: Ct != null ? Ct - rPerim(e) : null, trim: wY - bd.y < band ? 1 : 0 };
        });
        const hipR = tor.length ? tor[tor.length - 1] : null;
        const prt = it.print ? { img: it.print, rect: [-(hipR ? hipR.r[NA / 4] : 20), hipR ? hipR.r[NA / 4] : 20, wY, skirt ? wY - sp.length : Y.crotch - sp.inseam] } : null;
        push(tor, { print: prt }, { rim0: true, close1: !skirt });
        if (skirt) {
          const hemY = Math.max(1, wY - sp.length);
          const top = hipR || { raw: rAdd(env.lower[0], t) };
          const Chem = sp.hem && it.m && it.m.hem != null ? sp.hem : rPerim(top.raw) * sp.flare;
          const y0 = R.lower[0].y;
          const [la, lb] = idxRange(R.lower, (x) => x.y >= hemY);
          const sk = makeRings(R.lower, env.lower, la, lb, (bd, e) => {
            const tt = clamp((y0 - bd.y) / Math.max(1, y0 - hemY), 0, 1);
            let gr = rMax(rAdd(e, t), rCirc(top.raw.slice(), lerp(rPerim(top.raw), Chem, tt)));
            const raw = gr;
            gr = rFolds(gr, bd.y, clamp((rPerim(gr) - rPerim(e)) / TAU * 0.25 * tt, 0, 1.5), seed);
            return { r: gr, raw, ease: rPerim(raw) - rPerim(e), trim: 0 };
          });
          push(sk, { print: prt }, { rim1: true });
          return;
        }
        const hemY0 = Y.crotch - sp.inseam; const hemY = Math.max(1, hemY0); const stack = hemY0 < 1;
        const loose = sp.thigh - M.P.geo.hip * 0.6;
        ['L', 'R'].forEach((S) => {
          const bands = R[`leg${S}`];
          const [la, lb] = idxRange(bands, (x) => x.y >= hemY && x.y <= Y.crotch + 4);
          const kneeS = bands.reduce((best, x) => (Math.abs(x.y - Y.knee) < Math.abs(best.y - Y.knee) ? x : best), bands[0]).s;
          const crS = bands.reduce((best, x) => (Math.abs(x.y - Y.crotch) < Math.abs(best.y - Y.crotch) ? x : best), bands[0]).s;
          const endS = la >= 0 && lb >= 0 ? bands[lb].s : kneeS;
          const lg = makeRings(bands, env[`leg${S}`], la, lb, (bd, e, i, prev) => {
            const base = rAdd(e, t); let Ct;
            if (bd.s <= crS) Ct = sp.thigh * (1 + 0.14 * smooth01((bd.y - Y.crotch + 2) / 7));
            else if (bd.s <= kneeS || endS <= kneeS) Ct = lerp(sp.thigh, endS <= kneeS ? sp.hem : sp.knee, clamp((bd.s - crS) / Math.max(1, Math.min(kneeS, endS) - crS), 0, 1));
            else Ct = lerp(sp.knee, sp.hem, clamp((bd.s - kneeS) / Math.max(1, endS - kneeS), 0, 1));
            let gr = rCirc(base, Ct);
            // 付け根の外側を腰まわりの幅につなげる（段差を作らない）
            if (hipR && bd.y > Y.crotch - 9) {
              const outK = bd.c[0] >= 0 ? NA / 4 : (3 * NA) / 4;
              const need = (bd.c[0] >= 0 ? hipR.r[NA / 4] : hipR.r[(3 * NA) / 4]) - Math.abs(bd.c[0]) + 0.1;
              const bl = smooth01((bd.y - (Y.crotch - 9)) / 9);
              if (need > gr[outK]) gr = gr.map((v, k) => { const c = Math.cos(((k - outK) / NA) * TAU); return v + (c > 0 ? (need - gr[outK]) * c * c * bl : 0); });
            }
            if (prev && bd.s > kneeS && loose > 8) gr = rMax(gr, rScale(prev.raw, 0.996));
            if (stack && bd.y < 8) gr = rScale(gr, 1.06);
            const raw = gr;
            gr = rFolds(gr, bd.y, clamp((rPerim(gr) - rPerim(base)) / TAU * 0.18, 0, 0.8) + (stack && bd.y < 9 ? 0.35 : 0), seed + (S === 'L' ? 0 : 1.7));
            return { r: gr, raw, ease: Ct - rPerim(e), trim: 0 };
          });
          push(lg, { print: prt }, { rim1: true });
        });
      } else if (sp.grp === 'shoes') {
        const s = sp.st; const boots = s.collar > 8; const soleH = s.sole;
        lift = Math.max(lift, soleH - 0.5);
        ['L', 'R'].forEach((S) => {
          const bands = R[`foot${S}`]; const n = bands.length;
          // 靴の断面: 足の幅と高さに合わせた丸い四角（指の凹凸は拾わない）
          const ext = bands.map((bd, i) => {
            const e = env[`foot${S}`][i]; let w = 0; let up = 0; let dn = 0;
            for (let k = 0; k < NA; k++) { w = Math.max(w, Math.abs(e[k] * COS[k])); const v = e[k] * SIN[k]; up = Math.max(up, v); dn = Math.max(dn, -v); }
            return [w, up, dn];
          });
          for (let p = 0; p < 4; p++) for (let i = 1; i < n - 1; i++) for (let q = 0; q < 3; q++) ext[i][q] = (ext[i - 1][q] + 2 * ext[i][q] + ext[i + 1][q]) / 4;
          const toeLen = 1.8 * M.h;
          const shoeBands = bands.map((bd, i) => Object.assign({}, bd, { idx: i }));
          const last = bands[n - 1];
          [0.5, 1].forEach((f) => shoeBands.push(Object.assign({}, last, { c: add(last.c, mul(last.T, toeLen * f)), s: last.s + toeLen * f, idx: n - 1, tip: f })));
          const shoe = shoeBands.map((bd, j) => {
            const [w0, up0, dn0] = ext[bd.idx];
            const fr = j / (shoeBands.length - 1);
            const tipK = bd.tip ? Math.sqrt(Math.max(0.05, 1 - bd.tip * bd.tip * 0.92)) : 1;
            const heelK = j === 0 ? 0.75 : 1;
            const w = (w0 + 0.6 + (fr > 0.55 ? 0.35 * M.h : 0)) * tipK * heelK; const up = (Math.max(up0, 2.2 * M.h) + 0.5) * (bd.tip ? tipK * 0.85 : 1); const dn = dn0 + 0.2;
            const r = new Float32Array(NA + 1);
            for (let k = 0; k <= NA; k++) { const c = Math.abs(COS[k]); const sn = SIN[k]; const hh = sn > 0 ? up : dn; r[k] = 1 / Math.pow(Math.pow(c / w, 3) + Math.pow(Math.abs(sn) / hh, 3), 1 / 3); }
            if (!bd.tip) env[`foot${S}`][bd.idx] = rMax(env[`foot${S}`][bd.idx], r);
            return { c: bd.c, N: bd.N, B: bd.B, T: bd.T, s: bd.s, r, ease: null, trim: 0, w };
          });
          push(shoe, {}, { close0: true, close1: true });
          if (s.collar > 0) {
            const lb2 = R[`leg${S}`];
            const [ca, cb] = idxRange(lb2, (x) => x.y <= Y.ankle + s.collar * M.h);
            const cl = makeRings(lb2, env[`leg${S}`], ca, cb, (bd, e, i) => {
              const gr = rAdd(e, boots ? 0.9 : 0.55);
              return { r: gr, raw: gr, ease: null, trim: i - ca < 2 ? 1 : 0 };
            });
            push(cl, {}, { rim0: true, close1: true });
          }
          const sole = shoe.map((bd) => {
            const w = bd.w + 0.3; const hh = soleH / 2;
            const r = new Float32Array(NA + 1);
            for (let k = 0; k <= NA; k++) { const c = Math.abs(COS[k]); const sn = Math.abs(SIN[k]); r[k] = 1 / Math.pow(Math.pow(c / w, 6) + Math.pow(sn / hh, 6), 1 / 6); }
            return { c: [bd.c[0], -hh + 0.5, bd.c[2]], N: [1, 0, 0], B: [0, 1, 0], T: [0, 0, 1], s: bd.s, r, ease: null, trim: 0 };
          });
          push(sole, { fabric: 'sole', color: s.sole2 }, { close0: true, close1: true });
        });
      }
    });
    return { parts, lift };
  }

  /* ---------- 採寸ガイド ---------- */
  function guides(M) {
    const Y = M.Y; const H = M.H; const R = M.regions; const out = [];
    const tube = (pts, rad) => {
      const rings = []; let s = 0;
      pts.forEach((c, i) => {
        if (i) s += dist(c, pts[i - 1]);
        const T = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
        const ref = Math.abs(T[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
        const N = norm(cross(ref, T)); const B = cross(T, N);
        rings.push({ c, N, B, T, s, r: new Float32Array(NA + 1).fill(rad), ease: null, trim: 0 });
      });
      return loftRings(rings, { close0: true, close1: true });
    };
    const near = (bands, y) => bands.reduce((b, x) => (Math.abs(x.y - y) < Math.abs(b.y - y) ? x : b), bands[0]);
    const band = (key, y) => {
      const b = near(R.torso, y); const r = rAdd(b.r, 0.35);
      const rings = [0.8, -0.8].map((dy) => ({ c: add(b.c, [0, dy, 0]), N: b.N, B: b.B, T: b.T, s: dy, r, ease: null, trim: 0 }));
      out.push({ key, mesh: loftRings(rings, {}) });
    };
    const x = -(M.shHalf + 16 * M.h);
    out.push({ key: 'height', mesh: tube([[x, 0, 0], [x, H * 0.5, 0], [x, H, 0]], 0.45) });
    out.push({ key: 'height', mesh: tube([[x, H, 0], [x * 0.5, H, 0], [-1, H, 0]], 0.3) });
    const sb = near(R.torso, Y.sh - 1.5); const back = sb.r[0] + 0.8;
    const arc = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; arc.push([M.shHalf * Math.cos(a), Y.sh + H * 0.008 * Math.sin(a), sb.c[2] - back * Math.sin(a)]); }
    out.push({ key: 'shoulder', mesh: tube(arc, 0.45) });
    band('chest', Y.chest); band('waist', Y.waist); band('hip', Y.hip);
    const arm = R.armL.filter((b, i) => b.s >= 5 && i % 2 === 0 && b.s <= 5 + M.P.geo.arm).map((b) => add(b.c, mul(b.N, b.r[NA / 2] + 0.7)));
    out.push({ key: 'arm', mesh: tube(arm, 0.45) });
    const leg = R.legL.filter((b, i) => b.y <= Y.crotch - 1 && i % 2 === 0).map((b) => add(b.c, mul(b.N, -(b.r[0 + NA / 2 * 0] ? b.r[(NA * 3) / 4] : 0) - 0.7)));
    leg.push([M.sk.L.an[0] - 3.5 * M.h, 0.4, M.sk.L.an[2]]);
    out.push({ key: 'inseam', mesh: tube(leg, 0.45) });
    return out;
  }

  G.SFModel = { _data: () => D, load, body, bodyMeshes, dress, guides, garmentSpec, hexRGB, FABRIC_ID };
})(typeof globalThis !== 'undefined' ? globalThis : window);
