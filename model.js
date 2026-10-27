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
    const pose = {};
    (meta.pose || []).forEach((p) => { pose[p.name] = { idx: new Uint32Array(buf, p.offset, p.count), w: new Float32Array(buf, p.offset + p.count * 4, p.count) }; });
    const idx = new Uint32Array(buf, nv * 12, meta.indexCount);
    const R = meta.indexRanges;
    const part = (name) => idx.subarray(R[name][0], R[name][0] + R[name][1]);
    D = { meta, nv, base: new Float32Array(buf, 0, nv * 3), idx, T, jr: meta.joints, pose, pivots: meta.pivots, faces: { body: part('body'), eyes: concat(part('helper-l-eye'), part('helper-r-eye')), hair: part('helper-hair') } };
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
    return lists;
  }

  /* ---------- 姿勢（MakeHuman の骨組みの重みで、腕を下ろし脚をそろえる） ---------- */
  function pivot(P, name) {
    const ids = D.pivots[name]; let x = 0; let y = 0; let z = 0;
    ids.forEach((i) => { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; });
    return [x / ids.length, y / ids.length, z / ids.length];
  }
  // 骨にどれだけついていくか（重み w）で、点 o を中心に向き u → t へ回す（線形ブレンドスキニング）
  function rotateGroup(P, o, u, t, g) {
    let ax = cross(u, t); const sinA = len(ax); const ang = Math.atan2(sinA, dot(u, t));
    if (sinA < 1e-6 || !g) return;
    ax = mul(ax, 1 / sinA);
    const c = Math.cos(ang); const sn = Math.sin(ang);
    for (let k = 0; k < g.idx.length; k++) {
      const i = g.idx[k] * 3; const w = g.w[k];
      const v = [P[i] - o[0], P[i + 1] - o[1], P[i + 2] - o[2]];
      const kv = cross(ax, v); const kd = dot(ax, v);
      for (let q = 0; q < 3; q++) { const r = v[q] * c + kv[q] * sn + ax[q] * kd * (1 - c); P[i + q] += (r - v[q]) * w; }
    }
  }
  function standPose(P, clearX) {
    ['L', 'R'].forEach((m) => {
      const G2 = D.pose;
      // 脚: 足首が股関節の少し内側に来るようにそろえ、足は床と平行に戻す
      const hip = pivot(P, `upperleg01.${m}____head`); const ank = pivot(P, `foot.${m}____head`);
      const u = norm(sub(ank, hip));
      const t = norm([hip[0] * 0.55 - hip[0], ank[1] - hip[1], ank[2] - hip[2]]);
      rotateGroup(P, hip, u, t, G2[`leg${m}`]);
      const ank2 = pivot(P, `foot.${m}____head`);
      rotateGroup(P, ank2, t, u, G2[`foot${m}`]);
      // 腕: 二の腕を体の横に下ろし（手が腰・太ももに当たらない角度）、ひじから先はわずかに前へ
      const sh = pivot(P, `upperarm01.${m}____head`); const el = pivot(P, `lowerarm01.${m}____head`);
      const sg = Math.sign(sh[0]);
      const reach = dist(sh, pivot(P, `wrist.${m}____head`)) + 8;
      const need = Math.asin(clamp((clearX - Math.abs(sh[0])) / reach, -1, 1));
      const want = Math.max((6 * Math.PI) / 180, need);
      const ta = norm([Math.sin(want) * sg, -Math.cos(want), -0.02]);
      rotateGroup(P, sh, norm(sub(el, sh)), ta, G2[`arm${m}`]);
      const el2 = pivot(P, `lowerarm01.${m}____head`); const wr2 = pivot(P, `wrist.${m}____head`);
      rotateGroup(P, el2, norm(sub(wr2, el2)), norm(add(ta, [0, 0, 0.04])), G2[`fore${m}`]);
    });
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

  function body(profile, opts) {
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
    const clearX = Math.max(hipHalf + 9 * (g.height / 170), (opts && opts.clear) || 0);
    standPose(pos, clearX);
    // 脚をそろえると足の高さが少し変わるので、床に合わせ直す
    let floor = Infinity; D.bodyVerts.forEach((i) => { floor = Math.min(floor, pos[i * 3 + 1]); });
    for (let i = 1; i < pos.length; i += 3) pos[i] -= floor;
    const H = g.height; const sk = skeleton(pos);
    const shY = (fm.sk.L.sh[1] + fm.sk.R.sh[1]) / 2 - floor;
    const Y = {
      top: H, neck: sk.nk[1] - H * 0.006, sh: shY + H * 0.016, pit: fm.bustY - floor + H * 0.03, chest: fm.bustY - floor,
      waist: fm.waistY - floor, hip: fm.hipY - floor, crotch: fm.crotch - floor, knee: (sk.L.kn[1] + sk.R.kn[1]) / 2, ankle: (sk.L.an[1] + sk.R.an[1]) / 2,
    };
    const M = { P, H, h: H / 170, pos, Y, sk, shHalf: g.shoulder / 2, fit: fm, W, clear: clearX };
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
    const raw = bands.map((b) => b.r.slice());
    smoothOnly(bands, passes);
    // なめらかにしても、元の輪郭（体のふくらみ）より内側には入れない（服から肌が透けないように）
    bands.forEach((b, i) => { for (let k = 0; k <= NA; k++) b.r[k] = Math.max(b.r[k], raw[i][k]); });
  }
  function smoothOnly(bands, passes) {
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
    M.coverLists = { torso: L.trunk.concat(L.thighL, L.thighR, capL, capR), lower: L.thighL.concat(L.shinL, L.thighR, L.shinR), neck: L.neck };
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
      M.coverLists[`leg${S}`] = L[`thigh${S}`].concat(L[`shin${S}`], groin);
      M.coverLists[`arm${S}`] = L[`uarm${S}`].concat(L[`farm${S}`]);
      M.coverLists[`foot${S}`] = L[`foot${S}`];
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
  // 服のゆとり: 前後の厚みはほぼ体のまま、余りを横幅に回す（型紙の前身頃・後身頃が平らなのと同じ）
  function rDrape(r, C, zk) {
    const p = rPerim(r); if (!(p > 0) || C <= p) return r;
    const shape = (sx) => {
      const sz = 1 + (sx - 1) * (zk == null ? 0.22 : zk);
      const h = hull(Array.from({ length: NA }, (_, k) => r[k] * COS[k] * sx), Array.from({ length: NA }, (_, k) => r[k] * SIN[k] * sz));
      return radialFromHull(h, 0, 0);
    };
    let lo = 1; let hi = 3.5; let best = r;
    for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; const s = shape(m); if (rPerim(s) < C) lo = m; else { hi = m; best = s; } }
    return best;
  }
  // 横幅（中心から左右の端まで）を maxX までに抑え、足りない周長は前後の厚みで補う（肩が棚のように張り出さないように）
  function rCapX(r, maxX) {
    let w = 0; for (let k = 0; k < NA; k++) w = Math.max(w, Math.abs(r[k] * COS[k]));
    if (w <= maxX) return r;
    const C = rPerim(r); const sx = maxX / w;
    const shape = (sz) => radialFromHull(hull(Array.from({ length: NA }, (_, k) => r[k] * COS[k] * sx), Array.from({ length: NA }, (_, k) => r[k] * SIN[k] * sz)), 0, 0);
    let lo = 1; let hi = 3; let best = shape(1);
    for (let it = 0; it < 16; it++) { const m = (lo + hi) / 2; const s = shape(m); if (rPerim(s) < C) lo = m; else { hi = m; best = s; } }
    return best;
  }
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

  /* ---------- 布の計算（cloth.js）とのつなぎ ---------- */
  const SIM_COLS = 48;
  // 体（と下に着た服）に当たったら外へ押し出す。keys の部位の帯と、その外側の面 env を使う
  function makeCollider(M, envPrev, keys, gap) {
    const R = M.regions;
    const regs = keys.filter((k) => R[k] && R[k].length > 1).map((k) => {
      const bands = R[k]; const vertical = k === 'torso' || k === 'lower' || k === 'neck';
      return { bands, env: envPrev[k], vertical, y0: bands[0].y, step: bands[0].y - bands[1].y };
    });
    const radiusAt = (r, a, b) => {
      let f = ((Math.atan2(b, a) + Math.PI / 2) / TAU) * NA; f = ((f % NA) + NA) % NA;
      const k = Math.floor(f); const u = f - k; return r[k] * (1 - u) + r[k + 1] * u;
    };
    const push = (p, c, N, B, r, r2, u) => {
      const v0 = p[0] - c[0]; const v1 = p[1] - c[1]; const v2 = p[2] - c[2];
      const a = v0 * N[0] + v1 * N[1] + v2 * N[2]; const b = v0 * B[0] + v1 * B[1] + v2 * B[2];
      const d = Math.hypot(a, b); const want = (r2 ? radiusAt(r, a, b) * (1 - u) + radiusAt(r2, a, b) * u : radiusAt(r, a, b)) + gap;
      if (d >= want || d < 1e-6) return;
      const s = (want - d) / d;
      for (let q = 0; q < 3; q++) p[q] += (N[q] * a + B[q] * b) * s;
    };
    return (p, i, cache) => {
      regs.forEach((g, gi) => {
        const bands = g.bands;
        if (g.vertical) {
          const f = (g.y0 - p[1]) / g.step; if (f < 0 || f > bands.length - 1) return;
          const k = Math.min(bands.length - 2, Math.floor(f)); const u = f - k;
          const ba = bands[k]; const bb = bands[k + 1];
          push(p, [0, p[1], ba.c[2] * (1 - u) + bb.c[2] * u], ba.N, ba.B, g.env[k], g.env[k + 1], u);
          return;
        }
        // 骨に沿った帯: いちばん近い帯を探す（前回の結果の近くから）
        const slot = i * 8 + gi; let k = cache.length > slot ? cache[slot] : -1;
        const axial = (j) => { const b = bands[j]; return (p[0] - b.c[0]) * b.T[0] + (p[1] - b.c[1]) * b.T[1] + (p[2] - b.c[2]) * b.T[2]; };
        if (k < 0) { let bd = Infinity; for (let j = 0; j < bands.length; j++) { const d = Math.abs(axial(j)); if (d < bd) { bd = d; k = j; } } } else {
          let bd = Math.abs(axial(k));
          for (let j = Math.max(0, k - 3); j <= Math.min(bands.length - 1, k + 3); j++) { const d = Math.abs(axial(j)); if (d < bd) { bd = d; k = j; } }
        }
        if (cache.length > slot) cache[slot] = k;
        const ax = axial(k); const stepB = Math.abs(bands[Math.min(k + 1, bands.length - 1)].s - bands[Math.max(k - 1, 0)].s) || 1;
        if ((k === 0 || k === bands.length - 1) && Math.abs(ax) > stepB) return;
        push(p, bands[k].c, bands[k].N, bands[k].B, g.env[k]);
      });
    };
  }

  // 輪（ring: c, N, B, r）→ 格子の点
  const ringPts = (g, cols) => {
    const out = new Float32Array(cols * 3); const st = NA / cols;
    for (let k = 0; k < cols; k++) {
      const q = k * st; const x = g.r[q] * COS[q]; const z = g.r[q] * SIN[q];
      for (let d = 0; d < 3; d++) out[k * 3 + d] = g.c[d] + g.N[d] * x + g.B[d] * z;
    }
    return out;
  };
  const cr1 = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  // 布の格子 → 細かい三角形（角度・縦ともになめらかに補間）
  function gridMesh(rows, meta, opt) {
    opt = opt || {};
    const R = rows.length; const Cn = rows[0].length / 3; const up = 2; const cols = Cn * up;
    const P = (j, k, d) => rows[Math.max(0, Math.min(R - 1, j))][(((k % Cn) + Cn) % Cn) * 3 + d];
    const dense = [];
    for (let j = 0; j < R; j++) {
      const ring = new Float32Array((cols + 1) * 3);
      for (let k = 0; k <= cols; k++) {
        const k0 = Math.floor(k / up); const t = (k % up) / up;
        for (let d = 0; d < 3; d++) ring[k * 3 + d] = cr1(P(j, k0 - 1, d), P(j, k0, d), P(j, k0 + 1, d), P(j, k0 + 2, d), t);
      }
      dense.push(ring);
    }
    // 縦方向も、元の輪の数に戻す（meta の行の数）
    const fine = []; const per = (meta.length - 1) / Math.max(1, R - 1);
    for (let m = 0; m < meta.length; m++) {
      const f = m / per; const j = Math.min(R - 2, Math.floor(f)); const t = R > 1 ? f - j : 0;
      const ring = new Float32Array((cols + 1) * 3);
      for (let q = 0; q < ring.length; q++) {
        const g = (jj) => dense[Math.max(0, Math.min(R - 1, jj))][q];
        ring[q] = R > 1 ? cr1(g(j - 1), g(j), g(j + 1), g(j + 2), t) : g(0);
      }
      fine.push(ring);
    }
    const centroid = (ring) => { const c = [0, 0, 0]; for (let k = 0; k < cols; k++) for (let d = 0; d < 3; d++) c[d] += ring[k * 3 + d] / cols; return c; };
    const list = fine.map((ring, m) => ({ ring, m }));
    const rim = (src, m, dir) => {
      const c = centroid(src); const c2 = centroid(fine[Math.max(0, Math.min(fine.length - 1, m + dir))]);
      const ax = norm(sub(c2, c)); const ring = new Float32Array(src.length);
      for (let k = 0; k <= cols; k++) {
        const p = [src[k * 3], src[k * 3 + 1], src[k * 3 + 2]]; const toC = norm(sub(c, p));
        for (let d = 0; d < 3; d++) ring[k * 3 + d] = p[d] + toC[d] * 0.45 + ax[d] * 0.35;
      }
      return { ring, m };
    };
    if (opt.rim0) list.unshift(rim(fine[0], 0, 1));
    if (opt.rim1) list.push(rim(fine[fine.length - 1], fine.length - 1, -1));
    const pos = []; const uv = []; const aux = []; const idx = []; const row = cols + 1;
    list.forEach(({ ring, m }) => {
      const mt = meta[m]; let per2 = 0; const acc = [0];
      for (let k = 1; k <= cols; k++) { per2 += Math.hypot(ring[k * 3] - ring[k * 3 - 3], ring[k * 3 + 1] - ring[k * 3 - 2], ring[k * 3 + 2] - ring[k * 3 - 1]); acc.push(per2); }
      for (let k = 0; k <= cols; k++) {
        pos.push(ring[k * 3], ring[k * 3 + 1], ring[k * 3 + 2]);
        uv.push(acc[k], mt.s); aux.push(mt.trim || 0, mt.ease == null ? 999 : mt.ease, -Math.PI / 2 + (TAU * k) / cols, 0);
      }
    });
    for (let r = 0; r < list.length - 1; r++) for (let k = 0; k < cols; k++) { const a = r * row + k; const b = a + row; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const fan = (r, flip) => {
      const c = centroid(list[r].ring); const mt = meta[list[r].m]; const ci = pos.length / 3;
      pos.push(c[0], c[1], c[2]); uv.push(0, mt.s); aux.push(mt.trim || 0, mt.ease == null ? 999 : mt.ease, 0, 1);
      for (let k = 0; k < cols; k++) { const a = r * row + k; if (flip) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
    };
    if (opt.close0) fan(0, false);
    if (opt.close1) fan(list.length - 1, true);
    const Pf = new Float32Array(pos); const I = new Uint32Array(idx);
    const n = normals(Pf, I);
    for (let r = 0; r < list.length; r++) { const a = r * row * 3; const b = (r * row + cols) * 3; for (let q = 0; q < 3; q++) { const s = n[a + q] + n[b + q]; n[a + q] = s; n[b + q] = s; } }
    // 法線を外向きにそろえる
    const mid = list.length >> 1; const c = centroid(list[mid].ring); let out = 0;
    for (let k = 0; k < cols; k += 3) { const q = (mid * row + k) * 3; out += n[q] * (Pf[q] - c[0]) + n[q + 1] * (Pf[q + 1] - c[1]) + n[q + 2] * (Pf[q + 2] - c[2]); }
    const flip = out < 0 ? -1 : 1;
    for (let i = 0; i < n.length; i += 3) { const l = (Math.hypot(n[i], n[i + 1], n[i + 2]) || 1) * flip; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    if (flip < 0) for (let t = 0; t < I.length; t += 3) { const a = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = a; }
    return { mesh: { pos: Pf, nrm: n, uv: new Float32Array(uv), aux: new Float32Array(aux), idx: I }, fine };
  }

  /* ---------- 服を着せる ---------- */
  const FABRIC_ID = { skin: 0, jersey: 1, denim: 2, rib: 3, leather: 4, canvas: 5, nylon: 6, knit: 7, sole: 8, guide: 9, woven: 10, twill: 11, wool: 12, linen: 13, mesh: 14, eye: 15, hair: 16, fleece: 17 };
  function hexRGB(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const v = m ? parseInt(m[1], 16) : 0x999999;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  // 区間 [a, b]（帯の番号）を服で覆い、外側の面（env）を更新する
  function makeRings(bands, env, i0, i1, fn) {
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const b = bands[i]; const e = env[i];
      if (i < 0 || !b) continue;
      const res = fn(b, e, i, out.length ? out[out.length - 1] : null);
      if (!res) continue;
      out.push(Object.assign({ c: b.c, N: b.N, B: b.B, T: b.T, s: b.s, y: b.y, e0: e, bi: i }, res));
      env[i] = rMax(e, res.r);
    }
    return out;
  }
  const idxRange = (bands, test) => { let a = -1; let b = -1; bands.forEach((x, i) => { if (test(x)) { if (a < 0) a = i; b = i; } }); return [a, b]; };
  const geomKey = (outfit) => JSON.stringify((outfit || []).map((it) => [it.cat, it.style, it.m || null, it.fabric || null, !!it.print, it.uid]));

  function dress(M, outfit) {
    // 色・写真・フィット表示だけの変更なら、前回の形をそのまま使う（布の計算は重いため）
    const key = geomKey(outfit);
    const byUid = {}; (outfit || []).forEach((it) => { byUid[it.uid] = it; });
    const restyle = (res) => ({
      lift: res.lift,
      parts: res.parts.map((p) => {
        const it = byUid[p.uid] || {};
        return Object.assign({}, p, { color: p.fixedColor || it.color, fit: !!it.fit, print: p.printRect && it.print ? { img: it.print, rect: p.printRect } : null });
      }),
    });
    if (M._dress && M._dress.key === key) return restyle(M._dress.res);

    const R = M.regions; const Y = M.Y; const H = M.H;
    const env = {}; Object.keys(R).forEach((k) => { env[k] = R[k].map((b) => b.r.slice()); });
    const snap = () => { const o = {}; Object.keys(env).forEach((k) => { o[k] = env[k].map((r) => r.slice()); }); return o; };
    const parts = []; let lift = 0;
    // 靴は先に作る（履き口がズボンの内側に入るように）
    const order = (outfit || []).map((it, li) => ({ it, li })).sort((a, b) => (a.it.cat === 'shoes' ? -1 : 0) - (b.it.cat === 'shoes' ? -1 : 0) || a.li - b.li);
    order.forEach(({ it, li }) => {
      const cat = C.CATS[it.cat] ? it.cat : 'tee';
      const sp = garmentSpec(M, cat, it.style, it.m);
      const t = C.CATS[cat].thick + li * 0.05;
      const fabric = it.fabric || C.CATS[cat].fabric;
      const envPrev = snap();
      // rings を布として垂らしてから三角形にする（sim: { region, colliders, pin(ring, x, y, z), floor }）
      const push = (rings, extra, opt, sim) => {
        if (!rings || rings.length < 2) return;
        extra = extra || {};
        let mesh; let ends;
        if (sim) {
          const every = 2; const pick = [];
          for (let i = 0; i < rings.length; i += every) pick.push(i);
          if (pick[pick.length - 1] !== rings.length - 1) pick.push(rings.length - 1);
          const rowsIn = pick.map((i) => ({ pts: ringPts(rings[i], SIM_COLS) }));
          const out = SFCloth.simulate(rowsIn, {
            cols: SIM_COLS, steps: 45, iters: 5, jitter: 0.12, seed: 7 + parts.length,
            pin: (j, k, x, y, z) => sim.pin(rings[pick[j]], x, y, z),
            collide: makeCollider(M, envPrev, sim.colliders, t * 0.6 + 0.3),
            floor: sim.floor,
          });
          // 角度・縦を補間して、元の輪の数に戻す
          const meta = rings.map((g) => ({ s: g.s, trim: g.trim, ease: g.ease }));
          const gm = gridMesh(out.map((r) => r.pts), meta, opt);
          mesh = gm.mesh; ends = [gm.fine[0], gm.fine[gm.fine.length - 1]];
          // 次に着る服のため、外側の面を布の最終形で更新する
          gm.fine.forEach((ring, m) => {
            const g = rings[m]; if (!sim.region || g.bi == null) return;
            const xs = []; const zs = []; const cols = ring.length / 3 - 1;
            for (let k = 0; k < cols; k++) { const v = [ring[k * 3] - g.c[0], ring[k * 3 + 1] - g.c[1], ring[k * 3 + 2] - g.c[2]]; xs.push(dot(v, g.N)); zs.push(dot(v, g.B)); }
            const h = hull(xs, zs); if (h) env[sim.region][g.bi] = rMax(envPrev[sim.region][g.bi], radialFromHull(h, 0, 0));
          });
          if (extra.printRectFrom) {
            let mx = 0;
            gm.fine.forEach((ring, m) => { const y = rings[m].y; if (y > Y.pit || y < Y.waist - 10) return; for (let k = 0; k < ring.length / 3; k++) mx = Math.max(mx, Math.abs(ring[k * 3])); });
            if (mx > 0) extra.printRect = [-mx, mx, extra.printRectFrom[0], extra.printRectFrom[1]];
          }
        } else {
          // 布の計算をしない部分（肌着・襟など体に沿うもの）: 輪を上下にならしてから三角形にする
          for (let p = 0; p < 4; p++) {
            const prev = rings.map((g) => g.r);
            for (let i = 1; i < rings.length - 1; i++) rings[i] = Object.assign({}, rings[i], { r: prev[i].map((v, k) => (prev[i - 1][k] + 2 * v + prev[i + 1][k]) / 4) });
          }
          rings.forEach((g, i) => { if (g.e0) rings[i] = Object.assign({}, g, { r: g.r.map((v, k) => Math.max(v, g.e0[k] + 0.18)) }); });
          mesh = loftRings(rings, opt); ends = [ringPts(rings[0], SIM_COLS), ringPts(rings[rings.length - 1], SIM_COLS)];
          if (extra.printRectFrom) { const g = rings.find((r) => r.y <= Y.chest) || rings[0]; extra.printRect = [-g.r[NA / 4], g.r[NA / 4], extra.printRectFrom[0], extra.printRectFrom[1]]; }
        }
        const region = extra.region || (sim && sim.region);
        let cover = null;
        if (region && M.coverLists[region] && !extra.noCover) {
          // 端の輪の高さで決める（裾が波打っていても、裾より上の体だけを消す）
          const yr = (pts) => { let a = Infinity; let b = -Infinity; for (let i = 1; i < pts.length; i += 3) { a = Math.min(a, pts[i]); b = Math.max(b, pts[i]); } return [a, b]; };
          const r0 = yr(ends[0]); const r1 = yr(ends[1]);
          const top = r0[0] > r1[0] ? r0 : r1; const bot = top === r0 ? r1 : r0;
          cover = { list: M.coverLists[region], yMin: bot[1] + (opt && opt.rim1 ? 6 : 1.5), yMax: Math.min(top[0] - 1.5, extra.coverTop == null ? Infinity : extra.coverTop) };
        }
        const part = { uid: it.uid, cover, zone: extra.zone || null, mesh, fabric: extra.fabric || fabric, fixedColor: extra.color || null, color: extra.color || it.color, fit: !!it.fit,
          cut: extra.cut || null, placket: extra.placket || 0, printRect: extra.printRect || null };
        part.print = part.printRect && it.print ? { img: it.print, rect: part.printRect } : null;
        parts.push(part);
      };
      const fitted = cat === 'underTop' || cat === 'underBottom';
      if (sp.grp === 'top') {
        const drop = sp.drop;
        const keys = [
          [Y.sh + H * 0.01, null], [Y.pit, sp.chest * 0.98], [Y.chest, sp.chest],
          [Y.waist, sp.waist || sp.chest * 0.99], [Y.hip, sp.hip || sp.chest * 1.02], [Y.hip - 40, (sp.hip || sp.chest) * 1.04],
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
        const topY = Y.neck;
        const [a, b] = idxRange(R.torso, (x) => x.y <= topY && x.y >= hemY - 0.5);
        const shape = (bd, e, i, prev) => {
          const base = rAdd(e, t); let gr = base;
          const Ct = target(bd.y, base); if (Ct != null) gr = rDrape(base, Ct);
          // 肩まわりは、服の肩幅より外へ広げない（脇の下から下で徐々にゆるめる）
          if (bd.y > Y.chest - 8) {
            const cap = sp.shoulder / 2 + 1 + Math.max(0, (Y.pit - bd.y)) * 1.2;
            let w0 = 0; for (let k = 0; k < NA; k++) w0 = Math.max(w0, Math.abs(base[k] * COS[k]));
            gr = rCapX(gr, Math.max(cap, w0));
          }
          if (prev && bd.y < Y.chest && loose > 4) gr = rMax(gr, rScale(prev.r, 0.997));
          const tr = (sp.neck === 'crew' || sp.neck === 'hood') && topY - bd.y < 1.8 ? 1 : (ribbed && bd.y - hemY < 5 ? 1 : 0);
          return { r: gr, ease: Ct != null ? Ct - rPerim(e) : null, trim: tr };
        };
        const rings = makeRings(R.torso, env.torso, a, b, shape);
        let cut = null;
        if (sp.neck === 'v') cut = [1, Y.neck + 0.5, sp.vDepth * M.h, 5.5 * M.h, 0, 0, 0, 0];
        if (sp.neck === 'tank') cut = [2, Y.neck + 0.5, 13 * M.h, 0, 6 * M.h, M.shHalf * 0.62, Y.pit + 2, 6 * M.h];
        const below = hemY < R.torso[R.torso.length - 1].y;
        const placket = sp.neck === 'collar' && !it.print ? 1 : 0;
        // 肩（体の肩幅の内側）だけで支え、ほかは重力で垂らす。腕にも当てる
        const torsoSim = fitted ? null : {
          region: 'torso', colliders: ['torso', 'armL', 'armR'],
          pin: (g, x) => g.y >= Y.sh - 1.5 && Math.abs(x) <= M.shHalf + 1,
        };
        push(rings, { cut, placket, printRectFrom: [topY, hemY], region: 'torso', coverTop: sp.neck === 'v' ? Y.neck - sp.vDepth * M.h - 2 : sp.neck === 'tank' ? Y.pit - 2 : Y.neck - 3 }, { rim1: !below }, torsoSim);
        if (below && rings.length) {
          const last = rings[rings.length - 1];
          const [la, lb] = idxRange(R.lower, (x) => x.y >= hemY);
          const low = makeRings(R.lower, env.lower, la, lb, (bd, e, i, prev) => {
            const gr = rMax(rAdd(e, t), rScale((prev || last).r, prev ? 0.999 : 1));
            return { r: gr, ease: rPerim(gr) - rPerim(e), trim: ribbed && bd.y - hemY < 5 ? 1 : 0 };
          });
          push(low, { placket, printRectFrom: [topY, hemY] }, { rim1: true }, {
            region: 'lower', colliders: ['lower', 'armL', 'armR'], pin: (g) => g.y >= R.lower[la].y - 1.2,
          });
        }
        if (sp.sleeve > 0) {
          const easeTop = clamp((sp.chest - M.P.geo.chest) * 0.4 + 3 + drop * 0.6, 2.5, 24);
          ['L', 'R'].forEach((S) => {
            const bands = R[`arm${S}`]; const acr = 5; const sEnd = acr + drop + sp.sleeve;
            const long = sp.sleeve > M.P.geo.arm * 0.75; const easeEnd = long ? (ribbed || cat === 'outer' ? 3 : 5) : easeTop * 0.85;
            const [sa, sb] = idxRange(bands, (x) => x.s >= 1.5 && x.s <= sEnd);
            const sl = makeRings(bands, env[`arm${S}`], sa, sb, (bd, e) => {
              const ez = lerp(easeTop, easeEnd, clamp((bd.s - acr) / Math.max(1, sEnd - acr), 0, 1)) * smooth01((bd.s - 1.5) / (acr + 2));
              const gr = rDrape(rAdd(e, t), rPerim(rAdd(e, t)) + ez, 0.55);
              return { r: gr, ease: ez, trim: ribbed && long && sEnd - bd.s < 5 ? 1 : 0 };
            });
            push(sl, { zone: 'arm', region: `arm${S}` }, { rim1: true }, fitted || easeTop < 4 ? null : {
              region: `arm${S}`, colliders: [`arm${S}`, 'torso'], pin: (g) => g.s <= acr + 1.5,
            });
          });
        }
        if (sp.neck === 'collar' || sp.neck === 'hood') {
          const hood = sp.neck === 'hood';
          const [na, nb] = idxRange(R.neck, (x) => x.y <= Y.neck + (hood ? 5 : cat === 'outer' ? 5 : 3.5) * M.h);
          const col = makeRings(R.neck, env.neck, na, nb, (bd, e) => {
            let gr = rAdd(e, t + (hood ? 1.6 : 0.5));
            if (hood) gr = gr.map((v, k) => v + (SIN[k] < 0 ? -SIN[k] * 3.5 : 0));
            return { r: gr, ease: null, trim: hood ? 0 : 1 };
          });
          push(col, { noCover: true }, { rim0: true });
        }
      } else if (sp.grp === 'bottom' || sp.grp === 'skirt') {
        const wY = sp.waistY; const skirt = sp.grp === 'skirt';
        const band = cat === 'jeans' ? 3.8 : cat === 'underBottom' ? 3 : 2.5;
        const Cw = sp.waist; const Ch = sp.hip;
        const tC = (y, base) => {
          if (y >= Y.hip) { const tt = clamp((wY - y) / Math.max(1, wY - Y.hip), 0, 1); return lerp(Cw || rPerim(base), Ch || rPerim(base), tt); }
          // 股に近づくほど体に沿わせる（脚の筒が外側を覆い、腰と脚の境目に段差を作らない）
          return Ch ? lerp(Ch, rPerim(base), smooth01((Y.hip - y) / Math.max(1, Y.hip - Y.crotch))) : null;
        };
        const [a, b] = idxRange(R.torso, (x) => x.y <= wY);
        const tor = makeRings(R.torso, env.torso, a, b, (bd, e) => {
          const base = rAdd(e, t); const Ct = tC(bd.y, base); const gr = Ct != null ? rDrape(base, Ct, 1.0) : base;
          return { r: gr, ease: Ct != null ? Ct - rPerim(e) : null, trim: wY - bd.y < band ? 1 : 0 };
        });
        const hipR = tor.length ? tor[tor.length - 1] : null;
        const hemPrint = skirt ? wY - sp.length : Y.crotch - sp.inseam;
        push(tor, { printRectFrom: [wY, hemPrint], region: 'torso', coverTop: wY - 1.5 }, { rim0: true, close1: !skirt });
        if (skirt) {
          const hemY = Math.max(1, wY - sp.length);
          const top = hipR || { r: rAdd(env.lower[0], t) };
          const Chem = sp.hem && it.m && it.m.hem != null ? sp.hem : rPerim(top.r) * sp.flare;
          const y0 = R.lower[0].y;
          const [la, lb] = idxRange(R.lower, (x) => x.y >= hemY);
          const sk = makeRings(R.lower, env.lower, la, lb, (bd, e) => {
            const tt = clamp((y0 - bd.y) / Math.max(1, y0 - hemY), 0, 1);
            const gr = rMax(rAdd(e, t), rDrape(top.r.slice(), lerp(rPerim(top.r), Chem, tt), 0.8));
            return { r: gr, ease: rPerim(gr) - rPerim(e), trim: 0 };
          });
          push(sk, { printRectFrom: [wY, hemY] }, { rim1: true }, { region: 'lower', colliders: ['lower'], pin: (g) => g.y >= R.lower[la].y - 1.2, floor: 0.3 });
          return;
        }
        const hemY0 = Y.crotch - sp.inseam; const stack = hemY0 < 1;
        // 裾が床より下に来る長さは、床でたまる分として布の計算に任せる
        const hemY = Math.max(stack ? 0.6 : 1, hemY0);
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
            let gr = rDrape(base, Ct, 0.9);
            // 付け根の外側を腰まわりの幅につなげる（段差を作らない）
            if (hipR && bd.y > Y.crotch - 9) {
              const outK = bd.c[0] >= 0 ? NA / 4 : (3 * NA) / 4;
              const need = (bd.c[0] >= 0 ? hipR.r[NA / 4] : hipR.r[(3 * NA) / 4]) - Math.abs(bd.c[0]) + 0.1;
              const bl = smooth01((bd.y - (Y.crotch - 9)) / 9);
              if (need > gr[outK]) gr = gr.map((v, k) => { const c = Math.cos(((k - outK) / NA) * TAU); return v + (c > 0 ? (need - gr[outK]) * c * c * bl : 0); });
            }
            if (prev && bd.s > kneeS && loose > 8) gr = rMax(gr, rScale(prev.r, 0.996));
            return { r: gr, ease: Ct - rPerim(e), trim: 0 };
          });
          // 長すぎる裾は床でたまる（布の計算で床に当てる）
          if (stack && lg.length) {
            const last = lg[lg.length - 1]; const extra = Math.min(8, 1 - hemY0);
            for (let q = 1; q <= Math.ceil(extra); q++) lg.push(Object.assign({}, last, { c: add(last.c, mul(last.T, q * 0.9)), s: last.s + q * 0.9, bi: null }));
          }
          push(lg, { printRectFrom: [wY, hemPrint], region: `leg${S}` }, { rim0: true, rim1: true }, fitted ? null : {
            region: `leg${S}`, colliders: [`leg${S}`], pin: (g) => g.y >= Y.crotch - 1, floor: 0.35,
          });
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
          push(shoe, { region: `foot${S}` }, { close0: true, close1: true });
          if (s.collar > 0) {
            const lb2 = R[`leg${S}`];
            const [ca, cb] = idxRange(lb2, (x) => x.y <= Y.ankle + s.collar * M.h);
            const cl = makeRings(lb2, env[`leg${S}`], ca, cb, (bd, e, i) => {
              const gr = rAdd(e, boots ? 0.9 : 0.55);
              return { r: gr, ease: null, trim: i - ca < 2 ? 1 : 0 };
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
    const res = { parts, lift };
    M._dress = { key, res };
    return restyle(res);
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

  // 服で完全に覆われた部分の体は描かない（体が服から透けないように。3D の試着で一般的なやり方）
  function maskedBody(M, dr) {
    const covers = (dr && dr.parts || []).map((p) => p.cover).filter(Boolean);
    const f = D.faces.body;
    if (!covers.length) return f;
    const P = M.pos; const hide = new Uint8Array(D.nv);
    covers.forEach((c) => c.list.forEach((i) => { const y = P[i * 3 + 1]; if (y > c.yMin && y < c.yMax) hide[i] = 1; }));
    const out = [];
    for (let t = 0; t < f.length; t += 3) if (!(hide[f[t]] && hide[f[t + 1]] && hide[f[t + 2]])) out.push(f[t], f[t + 1], f[t + 2]);
    return new Uint32Array(out);
  }

  // 手が服（袖以外）にめり込まないために必要な、手の中心の横位置
  function handClearance(M, dr) {
    const Y = M.Y; let mx = 0;
    dr.parts.forEach((p) => {
      if (p.zone === 'arm' || p.fabric === 'sole') return;
      const P = p.mesh.pos;
      for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; if (y > Y.crotch - 20 && y < Y.crotch + 14) mx = Math.max(mx, Math.abs(P[i])); }
    });
    return mx ? mx + 3.2 * M.h : 0;
  }

  G.SFModel = { _data: () => D, handClearance, maskedBody, load, body, bodyMeshes, dress, guides, garmentSpec, hexRGB, FABRIC_ID };
})(typeof globalThis !== 'undefined' ? globalThis : window);
