/* シルエット試着 cloth: 布の垂れを計算する（位置ベースの布シミュレーション）
 *
 * ・布は「輪（行）× 角度（列）」の格子。点どうしを伸びにくいばねでつなぐ（横・縦・ななめ・曲げ）
 * ・重力で下に引き、体（と下に着た服）に当たったら外へ押し出す。肩や腰など支える点は動かさない
 * ・model.js から使う。DOM は使わない
 */
(function (G) {
  'use strict';

  // rows: [{ pts: Float32Array(cols*3) }]（列は輪として閉じている）
  // opt: { cols, pin(j,k,x,y,z)→bool, collide(x, i, cache)（x を押し出す）, floor, steps, iters, gravity, damping, jitter, seed }
  function simulate(rows, opt) {
    const R = rows.length; const Cn = opt.cols; const n = R * Cn;
    const x = new Float32Array(n * 3); const prev = new Float32Array(n * 3); const inv = new Float32Array(n).fill(1);
    let seed = opt.seed || 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const id = (j, k) => j * Cn + ((k % Cn) + Cn) % Cn;
    for (let j = 0; j < R; j++) for (let k = 0; k < Cn; k++) {
      const i = id(j, k); const p = rows[j].pts;
      for (let q = 0; q < 3; q++) x[i * 3 + q] = p[k * 3 + q];
      if (opt.pin && opt.pin(j, k, p[k * 3], p[k * 3 + 1], p[k * 3 + 2])) inv[i] = 0;
    }
    // ばね（制約）
    const A = []; const B = []; const L = []; const S = [];
    const link = (a, b, s) => {
      const dx = x[a * 3] - x[b * 3]; const dy = x[a * 3 + 1] - x[b * 3 + 1]; const dz = x[a * 3 + 2] - x[b * 3 + 2];
      A.push(a); B.push(b); L.push(Math.hypot(dx, dy, dz)); S.push(s);
    };
    for (let j = 0; j < R; j++) for (let k = 0; k < Cn; k++) {
      link(id(j, k), id(j, k + 1), 1);
      link(id(j, k), id(j, k + 2), 0.12);
      if (j + 1 < R) { link(id(j, k), id(j + 1, k), 1); link(id(j, k), id(j + 1, k + 1), 0.5); link(id(j, k + 1), id(j + 1, k), 0.5); }
      if (j + 2 < R) link(id(j, k), id(j + 2, k), 0.12);
    }
    const ca = Int32Array.from(A); const cb = Int32Array.from(B); const cl = Float32Array.from(L); const cs = Float32Array.from(S);
    // 小さなゆらぎ（左右対称すぎる形をくずし、しわのきっかけにする）
    const jit = opt.jitter || 0;
    for (let i = 0; i < n; i++) if (inv[i]) for (let q = 0; q < 3; q++) x[i * 3 + q] += rnd() * jit;
    // つなぎ止め: 支点（動かない点）からの距離が、最初の距離より伸びないようにする（布が重力で伸びすぎないため）
    const pins = []; for (let i = 0; i < n; i++) if (!inv[i]) pins.push(i);
    const tA = new Int32Array(n).fill(-1); const tL = new Float32Array(n);
    // 同じ列（縦の糸）に支点があればそれを使い、なければいちばん近い支点にする（列ごとにそろえて裾をまっすぐに）
    if (pins.length) for (let i = 0; i < n; i++) {
      if (!inv[i]) continue;
      const k = i % Cn; let best = -1; let bd = Infinity;
      for (let j = 0; j < R; j++) { const pi = j * Cn + k; if (!inv[pi]) { best = pi; bd = Math.hypot(x[i * 3] - x[pi * 3], x[i * 3 + 1] - x[pi * 3 + 1], x[i * 3 + 2] - x[pi * 3 + 2]); } }
      if (best < 0) for (const pi of pins) { const d = Math.hypot(x[i * 3] - x[pi * 3], x[i * 3 + 1] - x[pi * 3 + 1], x[i * 3 + 2] - x[pi * 3 + 2]); if (d < bd) { bd = d; best = pi; } }
      tA[i] = best; tL[i] = bd * 1.015;
    }
    prev.set(x);
    const cache = new Int32Array(n * 8).fill(-1);
    const steps = opt.steps || 50; const iters = opt.iters || 5;
    const g = (opt.gravity == null ? 980 : opt.gravity) / 3600; const damp = opt.damping == null ? 0.9 : opt.damping;
    const floor = opt.floor == null ? -Infinity : opt.floor;
    const p3 = [0, 0, 0];
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < n; i++) {
        if (!inv[i]) continue;
        const o = i * 3;
        for (let q = 0; q < 3; q++) { const v = (x[o + q] - prev[o + q]) * damp; prev[o + q] = x[o + q]; x[o + q] += v; }
        x[o + 1] -= g;
      }
      for (let it = 0; it < iters; it++) {
        for (let c = 0; c < ca.length; c++) {
          const a = ca[c] * 3; const b = cb[c] * 3; const wa = inv[ca[c]]; const wb = inv[cb[c]]; const ws = wa + wb;
          if (!ws) continue;
          const dx = x[b] - x[a]; const dy = x[b + 1] - x[a + 1]; const dz = x[b + 2] - x[a + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const corr = ((d - cl[c]) / d) * cs[c] / ws;
          x[a] += dx * corr * wa; x[a + 1] += dy * corr * wa; x[a + 2] += dz * corr * wa;
          x[b] -= dx * corr * wb; x[b + 1] -= dy * corr * wb; x[b + 2] -= dz * corr * wb;
        }
        for (let i = 0; i < n; i++) {
          if (!inv[i]) continue;
          const o = i * 3;
          const a = tA[i];
          if (a >= 0) {
            const dx = x[o] - x[a * 3]; const dy = x[o + 1] - x[a * 3 + 1]; const dz = x[o + 2] - x[a * 3 + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d > tL[i]) { const s = tL[i] / d; x[o] = x[a * 3] + dx * s; x[o + 1] = x[a * 3 + 1] + dy * s; x[o + 2] = x[a * 3 + 2] + dz * s; }
          }
          p3[0] = x[o]; p3[1] = x[o + 1]; p3[2] = x[o + 2];
          if (opt.collide) opt.collide(p3, i, cache);
          if (p3[1] < floor) p3[1] = floor;
          x[o] = p3[0]; x[o + 1] = p3[1]; x[o + 2] = p3[2];
        }
      }
    }
    return rows.map((r, j) => ({ pts: x.slice(j * Cn * 3, (j + 1) * Cn * 3) }));
  }

  G.SFCloth = { simulate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
