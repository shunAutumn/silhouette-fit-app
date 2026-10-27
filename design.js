/* シルエット試着 design: 商品写真から背景を取り除き、服に貼るデザイン画像と色を作る */
(function (G) {
  'use strict';

  function loadImage(src, cors) {
    return new Promise((res, rej) => {
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.referrerPolicy = 'no-referrer';
      im.onload = () => res(im); im.onerror = () => rej(new Error('画像を読み込めませんでした'));
      im.src = src;
    });
  }

  // 画像（img / canvas / ImageBitmap）→ { src: 背景を抜いた画像の dataURL, uv: 胴の範囲, color: 代表色 }
  function process(source, kind) {
    const sw = source.naturalWidth || source.width; const sh = source.naturalHeight || source.height;
    const sc = Math.min(1, 640 / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * sc)); const h = Math.max(1, Math.round(sh * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(source, 0, 0, w, h);
    const img = cx.getImageData(0, 0, w, h); // 他サイトの画像で読めないときはここで例外
    const d = img.data;
    // 背景色 = 外周の色の中央値
    const border = [];
    for (let x = 0; x < w; x++) { border.push(x, x + (h - 1) * w); }
    for (let y = 0; y < h; y++) { border.push(y * w, y * w + w - 1); }
    const med = (ch) => { const a = border.map((p) => d[p * 4 + ch]).sort((p, q) => p - q); return a[a.length >> 1]; };
    const bg = [med(0), med(1), med(2)];
    const dist = (p) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]);
    const uniform = border.filter((p) => d[p * 4 + 3] > 0 && dist(p) < 30).length / border.length;
    const alpha = new Uint8Array(w * h).fill(255);
    if (uniform > 0.55) {
      const tol = 34; const seen = new Uint8Array(w * h); const q = [];
      border.forEach((p) => { if (!seen[p] && (dist(p) < tol || d[p * 4 + 3] < 20)) { seen[p] = 1; q.push(p); } });
      while (q.length) {
        const p = q.pop(); alpha[p] = 0;
        const x = p % w; const y = (p / w) | 0;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        nb.forEach((n) => { if (n >= 0 && !seen[n] && (dist(n) < tol || d[n * 4 + 3] < 20)) { seen[n] = 1; q.push(n); } });
      }
      // 境目を少しぼかす
      for (let p = 0; p < w * h; p++) {
        if (!alpha[p]) continue;
        const x = p % w; const y = (p / w) | 0;
        if ((x > 0 && !alpha[p - 1]) || (x < w - 1 && !alpha[p + 1]) || (y > 0 && !alpha[p - w]) || (y < h - 1 && !alpha[p + w])) alpha[p] = 140;
      }
    }
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let p = 0; p < w * h; p++) {
      if (alpha[p] < 128) continue;
      const x = p % w; const y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const cw = x1 - x0 + 1; const ch = y1 - y0 + 1;
    for (let p = 0; p < w * h; p++) d[p * 4 + 3] = Math.min(d[p * 4 + 3], alpha[p]);
    cx.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
    // 代表色: 中央付近の不透明な画素の中央値
    const rs = []; const gs = []; const bs = [];
    for (let y = y0 + ch * 0.25; y < y0 + ch * 0.75; y += 3) for (let x = x0 + cw * 0.3; x < x0 + cw * 0.7; x += 3) {
      const p = (y | 0) * w + (x | 0); if (alpha[p] < 200) continue;
      rs.push(d[p * 4]); gs.push(d[p * 4 + 1]); bs.push(d[p * 4 + 2]);
    }
    const m = (a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 128);
    const hex = `#${[m(rs), m(gs), m(bs)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    // トップスは裾の行の幅を「胴」とみなす（袖の部分は貼らない）
    let uv = [0, 1, 0, 1];
    if (kind === 'top') {
      const row = Math.round(y0 + ch * 0.9); let a = -1; let b = -1;
      for (let x = x0; x <= x1; x++) if (alpha[row * w + x] >= 128) { if (a < 0) a = x; b = x; }
      if (a >= 0 && b - a > cw * 0.25) uv = [(a - x0) / cw, (b - x0 + 1) / cw, 0, 1];
    }
    let src = out.toDataURL('image/webp', 0.86);
    if (!src.startsWith('data:image/webp')) src = out.toDataURL('image/png');
    return { src, uv, color: hex, cut: uniform > 0.55 };
  }

  async function fromUrl(url, kind) {
    const im = await loadImage(url, true);
    return process(im, kind);
  }
  async function fromFile(file, kind) {
    const url = URL.createObjectURL(file);
    try { return process(await loadImage(url, false), kind); } finally { URL.revokeObjectURL(url); }
  }

  G.SFDesign = { process, fromUrl, fromFile, loadImage };
})(typeof globalThis !== 'undefined' ? globalThis : window);
