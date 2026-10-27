/* シルエット試着 studio: 試着ルーム（体のデータ・立体表示・クローゼット・重ね着・コーデ） */
(function () {
  'use strict';
  const C = SFCatalog; const M3 = SFModel; const SF = SizeFit;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const FIELD = {}; C.FIELDS.forEach((f) => { FIELD[f.k] = f; });

  /* ---------- 保存先（拡張機能: chrome.storage / ウェブ: localStorage） ---------- */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const LS = 'sf2:';
  const store = {
    get(keys) {
      if (hasChrome) return new Promise((r) => chrome.storage.local.get(keys, r));
      const o = {};
      keys.forEach((k) => { try { const v = localStorage.getItem(LS + k); if (v != null) o[k] = JSON.parse(v); } catch (e) { /* 読めないときは空 */ } });
      return Promise.resolve(o);
    },
    set(obj, fromSync) {
      if (hasChrome) return new Promise((r) => chrome.storage.local.set(obj, r));
      Object.entries(obj).forEach(([k, v]) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { toast('この端末に保存できませんでした（写真が多すぎるかもしれません）', 'err'); } });
      // ウェブアプリでは、データを変えたら少し待って同期する（拡張機能では background が同期する）
      if (!fromSync && webSync && DATA_KEYS.some((k) => k in obj)) webSync.schedule();
      return Promise.resolve();
    },
    on(cb) {
      if (hasChrome) chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local') cb(Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, v.newValue]))); });
      else window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(LS)) { try { cb({ [e.key.slice(LS.length)]: JSON.parse(e.newValue) }); } catch (x) { /* 無視 */ } } });
    },
  };

  const S = {
    profile: {}, closet: [], outfit: [], coords: [], prefs: { presetColors: {} },
    tab: 'closet', measure: false, autoMeasure: false, fit: false, focus: null, sheet: null, pasteDraft: null,
  };
  let R = null; let model = null; let ready = false; let webSync = null;
  const DATA_KEYS = ['profile', 'outfit', 'prefs', 'closet', 'coords'];
  const app = $('.app');

  /* ---------- 小物 ---------- */
  // 右下に積み重なるお知らせ（kind: ok / err / info）
  function toast(msg, kind) {
    const box = $('[data-r="toasts"]');
    // モーダルの画面が開いているときは、その中に出す（最前面より下に隠れないように）
    const dlg = $('[data-r="sync-dlg"]');
    const host = dlg && dlg.open ? dlg : document.body;
    if (box.parentNode !== host) host.appendChild(box);
    const t = document.createElement('div');
    t.className = `toast ${kind || 'ok'}`; t.innerHTML = '<i></i><span></span>';
    t.querySelector('span').textContent = msg;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, kind === 'err' ? 6000 : 2800);
  }
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const saveProfile = debounce(() => store.set({ profile: S.profile }), 350);
  const saveOutfit = () => store.set({ outfit: S.outfit });
  let lastCloset = '';
  const saveCloset = () => { lastCloset = JSON.stringify(S.closet); return store.set({ closet: S.closet }); };
  const savePrefs = () => store.set({ prefs: S.prefs });
  const rank = (cat) => (C.CATS[cat] || C.CATS.tee).rank;
  const catOf = (e) => (e.src === 'item' ? (itemById(e.itemId) || {}).cat : e.cat) || 'tee';
  const itemById = (id) => S.closet.find((i) => i.id === id);
  const presetColor = (cat, style) => S.prefs.presetColors[`${cat}:${style}`] || (cat === 'underBottom' ? '#3A3C41' : C.paletteFor(cat)[0][0]);
  const findPreset = (cat, style) => S.outfit.find((e) => e.src === 'preset' && e.cat === cat && e.style === style);
  const findItem = (id) => S.outfit.find((e) => e.src === 'item' && e.itemId === id);
  const SLOT = (cat) => (cat === 'underBottom' ? 'ub' : cat === 'shoes' ? 'shoes' : ['jeans', 'pants', 'shorts', 'skirt'].includes(cat) ? 'bottom' : null);

  const ICON = {
    tee: 'M16 8 10 11 4 18 9 23 13 20 13 42 35 42 35 20 39 23 44 18 38 11 32 8C30 11 27 12 24 12 21 12 18 11 16 8Z',
    teeWide: 'M14 8 6 12 2 22 8 26 12 22 12 42 36 42 36 22 40 26 46 22 42 12 34 8C31 11 28 12 24 12 20 12 17 11 14 8Z',
    long: 'M16 8 9 11 3 31 8 33 13 20 13 42 35 42 35 20 40 33 45 31 39 11 32 8C30 11 27 12 24 12 21 12 18 11 16 8Z',
    tank: 'M17 6 17 12C15 16 13 18 13 22L13 42 35 42 35 22C35 18 33 16 31 12L31 6 28 6C27 10 26 12 24 12 22 12 21 10 20 6Z',
    shirt: 'M16 7 9 10 3 31 8 33 13 20 13 42 35 42 35 20 40 33 45 31 39 10 32 7 28 11 24 9 20 11Z',
    hoodie: 'M17 9 9 12 3 32 8 34 13 21 13 42 35 42 35 21 40 34 45 32 39 12 31 9C33 6 30 3 24 3 18 3 15 6 17 9Z',
    outer: 'M16 7 8 10 3 33 9 35 13 22 13 43 23 43 23 14 25 14 25 43 35 43 35 22 39 35 45 33 40 10 32 7 24 15Z',
    jeans: 'M13 6 35 6 37 42 28 42 24 18 20 42 11 42Z',
    wide: 'M13 6 35 6 42 42 27 42 24 19 21 42 6 42Z',
    shorts: 'M12 10 36 10 39 31 27 31 24 21 21 31 9 31Z',
    boxer: 'M11 14 37 14 38 31 28 33 24 27 20 33 10 31Z',
    briefs: 'M11 16 37 16 35 24C30 26 27 30 26 34L22 34C21 30 18 26 13 24Z',
    skirt: 'M15 8 33 8 41 40 7 40Z',
    sneaker: 'M5 31 5 22C5 19 8 18 11 18L18 18C22 22 28 24 36 25 41 26 44 28 44 31Z',
    boots: 'M11 5 23 5 23 25C29 26 37 27 41 29 43 30 44 32 44 33L11 33Z',
    loafer: 'M5 31C5 27 8 25 13 25L30 26C38 27 43 28 43 31Z',
  };
  function iconKey(cat, style) {
    if (cat === 'shoes') return style === 'boots' ? 'boots' : style === 'loafer' ? 'loafer' : 'sneaker';
    if (cat === 'underBottom') return style === 'briefs' ? 'briefs' : 'boxer';
    if (cat === 'underTop') return style === 'tank' ? 'tank' : 'tee';
    if (cat === 'tee') return style === 'oversized' ? 'teeWide' : style === 'longsleeve' ? 'long' : 'tee';
    if (cat === 'jeans' || cat === 'pants') return style === 'wide' ? 'wide' : 'jeans';
    return { shirt: 'shirt', knit: 'long', hoodie: 'hoodie', outer: 'outer', shorts: 'shorts', skirt: 'skirt' }[cat] || 'tee';
  }
  function luminance(hex) { const [r, g, b] = M3.hexRGB(hex); return 0.3 * r + 0.59 * g + 0.11 * b; }
  function icon(cat, style, color, cls) {
    const k = iconKey(cat, style); const light = luminance(color) > 0.7;
    const sole = cat === 'shoes' ? `<rect x="4" y="31" width="41" height="5" rx="2" fill="${esc(C.styleOf('shoes', style).sole2)}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>` : '';
    const v = (cat === 'tee' || cat === 'underTop') && style === 'vneck' ? '<path d="M19 9 24 17 29 9" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>' : '';
    return `<svg class="${cls || 'ic'}" viewBox="0 0 48 48" aria-hidden="true"><path d="${ICON[k]}" fill="${esc(color)}" stroke="${light ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.18)'}" stroke-width="1" stroke-linejoin="round"/>${sole}${v}</svg>`;
  }
  function visual(info, cls) {
    if (info.image) return `<img class="${cls === 'ic' ? 'thumb' : cls}" src="${esc(info.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">`;
    return icon(info.cat, info.style, info.color, cls);
  }

  /* ---------- 服の情報 ---------- */
  function info(e) {
    if (e.src === 'item') {
      const it = itemById(e.itemId); if (!it) return null;
      const size = it.sizes && it.sizes[it.sizeIdx];
      return { cat: it.cat, style: it.style, color: it.color, fabric: it.fabric, name: it.name, image: it.image || (it.print && it.print.src), size: size ? size.name : null, item: it };
    }
    const st = C.styleOf(e.cat, e.style);
    return { cat: e.cat, style: e.style, color: e.color, fabric: st.fabric || C.CATS[e.cat].fabric, name: `${st.label}${C.CATS[e.cat].short === st.label ? '' : ' ' + C.CATS[e.cat].short}` };
  }

  function fitBody() { return C.normalizeProfile(S.profile).fit; }

  function garmentM(it) {
    const s = it.sizes && it.sizes[it.sizeIdx]; if (!s) return null;
    if (!it.nude) return s.m;
    const st = C.styleOf(it.cat, it.style); const m = s.m; const o = {};
    if (C.CATS[it.cat].group === 'top') {
      if (m.chest != null) o.chest = m.chest + (st.ease != null ? st.ease : 10);
      if (m.shoulder != null) o.shoulder = m.shoulder + (st.sh || 0);
    } else {
      if (m.waist != null) o.waist = m.waist + (st.waist != null ? st.waist : 2);
      if (m.hip != null) o.hip = m.hip + (st.hip != null ? st.hip : 6);
      if (m.inseam != null) o.inseam = m.inseam;
    }
    return o;
  }

  function resolveOutfit() {
    return S.outfit.map((e, i) => {
      const f = info(e); if (!f) return null;
      return { uid: e.uid, cat: f.cat, style: f.style, color: f.color, fabric: f.fabric, m: f.item ? garmentM(f.item) : null, fit: S.fit, layer: i, print: f.item && f.item.print && f.item.usePrint !== false ? f.item.print : null };
    }).filter(Boolean);
  }

  function evalItem(it, idx) {
    const s = it.sizes && it.sizes[idx == null ? it.sizeIdx : idx]; if (!s) return null;
    return SF.evaluate(fitBody(), s.m, { nude: !!it.nude });
  }
  const VERDICT = {
    tight: 'きつい部分があります', snug: 'ぴったりめ。体に沿うシルエット', good: 'ちょうどいいサイズ感', loose: 'ゆとりのあるサイズ感', big: '大きめ。オーバーサイズで着るならアリ',
  };

  /* ---------- 着る・脱ぐ ---------- */
  function wear(entry) {
    const cat = catOf(entry); const slot = SLOT(cat);
    if (slot) S.outfit = S.outfit.filter((e) => SLOT(catOf(e)) !== slot);
    const r = rank(cat);
    let i = S.outfit.findIndex((e) => rank(catOf(e)) > r);
    if (i < 0) i = S.outfit.length;
    S.outfit.splice(i, 0, Object.assign({ uid: uid() }, entry));
    if (S.measure) { S.measure = false; S.autoMeasure = false; }
    changed();
  }
  function takeOff(uidv) { S.outfit = S.outfit.filter((e) => e.uid !== uidv); changed(); }
  function togglePreset(cat, style) {
    const w = findPreset(cat, style);
    if (w) takeOff(w.uid); else wear({ src: 'preset', cat, style, color: presetColor(cat, style) });
  }
  function toggleItem(id) {
    const w = findItem(id);
    if (w) takeOff(w.uid); else wear({ src: 'item', itemId: id });
  }
  function changed() { saveOutfit(); rebuild(); renderSide(); }

  /* ---------- 立体表示 ---------- */
  let bodyKey = ''; let bodyParts = null;
  function rebuild() {
    if (!ready) return;
    const key = JSON.stringify(['height', 'shoulder', 'chest', 'waist', 'hip', 'arm', 'inseam', 'sex'].map((k) => S.profile[k]));
    if (key !== bodyKey || !model) { model = M3.body(S.profile); bodyKey = key; bodyParts = M3.bodyMeshes(model); }
    if (!R) return;
    const P = C.normalizeProfile(S.profile);
    const skin = M3.hexRGB(S.profile.skin || '#E6C4A6');
    const grey = [0.8, 0.81, 0.84];
    const tint = P.count === 0 ? 0 : Math.max(0, (1 - P.count / C.FIELDS.length) * 0.8);
    const hair = null; // MakeHuman の髪の補助形状は板状で不自然なので表示しない
    const list = [];
    bodyParts.forEach((b) => {
      if (b.id === 'body') list.push({ mesh: b.mesh, mat: 0, color: P.count === 0 ? grey : skin, tint });
      else if (b.id === 'eyes') list.push({ mesh: b.mesh, mat: 15, color: [1, 1, 1], tint: P.count === 0 ? 1 : 0 });
      else if (hair) list.push({ mesh: b.mesh, mat: 16, color: M3.hexRGB(hair), tint: P.count === 0 ? 1 : 0 });
    });
    let lift = 0;
    if (S.measure) {
      M3.guides(model).forEach((g) => {
        list.push({ mesh: g.mesh, mat: 9, key: g.key, color: P.filled[g.key] ? M3.hexRGB(FIELD[g.key].color) : [0.7, 0.72, 0.76], hi: S.focus === g.key ? 1 : 0 });
      });
    } else {
      const dr = M3.dress(model, resolveOutfit());
      lift = dr.lift;
      dr.parts.forEach((p) => list.push({
        mesh: p.mesh, mat: M3.FABRIC_ID[p.fabric] != null ? M3.FABRIC_ID[p.fabric] : 1, color: M3.hexRGB(p.color),
        cut: p.cut, placket: p.placket, fit: S.fit, uid: p.uid, print: S.fit ? null : p.print,
      }));
    }
    R.setScene(list, { H: model.H, lift, legY: [model.Y.crotch - 14, model.Y.knee] });
    $('[data-act="measure"]').setAttribute('aria-pressed', String(S.measure));
    $('[data-act="fit"]').setAttribute('aria-pressed', String(S.fit));
    $('[data-r="legend"]').hidden = !S.fit || S.measure;
    renderBadge();
  }
  const rebuildSoon = debounce(rebuild, 120);

  function turnTo(target) {
    if (!R) return;
    const v = R.view; v.vel = 0;
    const d = ((((target - v.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const from = v.yaw; const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 520); const e = 1 - Math.pow(1 - t, 3);
      v.yaw = from + d * e; R.redraw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const VIEW_FOR = { height: 0.5, shoulder: Math.PI, chest: 0.2, waist: 0.2, hip: 0.35, arm: 1.1, inseam: 0.35 };

  function setMeasure(on, auto) {
    if (S.measure === on) return;
    S.measure = on; S.autoMeasure = !!(on && auto);
    rebuild();
  }
  function setFocus(k) {
    S.focus = k;
    $$('.field').forEach((li) => li.classList.toggle('focus', li.dataset.k === k));
    $$('.figure g[data-k]').forEach((g) => g.classList.toggle('focus', g.dataset.k === k));
    if (k) {
      if (!S.measure) setMeasure(true, true);
      else if (R) R.update((it) => { if (it.key) it.hi = it.key === k ? 1 : 0; });
      turnTo(VIEW_FOR[k] || 0.2);
    } else if (R) R.update((it) => { if (it.key) it.hi = 0; });
  }

  /* ---------- からだ ---------- */
  function smoothPath(pts) {
    const n = pts.length; const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    let d = `M${f(pts[0])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]; const p1 = pts[i]; const p2 = pts[(i + 1) % n]; const p3 = pts[(i + 2) % n];
      d += `C${f([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${f([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${f(p2)}`;
    }
    return `${d}Z`;
  }
  function figureSVG() {
    const L = [[60, 33], [54, 35], [44, 40], [36, 44], [34, 50], [35, 60], [37, 72], [39, 86], [38, 98], [35, 110], [35, 122], [37, 140], [39, 160], [40, 176], [41, 196], [42, 214], [41, 224], [47, 226], [51, 224], [51, 212], [52, 196], [53, 176], [55, 156], [57, 138], [59, 130]];
    const body = L.concat(L.slice().reverse().map(([x, y]) => [120 - x, y]));
    const arm = [[32, 46], [27, 70], [24.5, 92], [22.5, 110], [21.5, 119], [20.5, 125], [22, 132], [26, 131], [27.5, 124], [28, 114], [29.5, 98], [31.5, 82], [33.5, 64]];
    const armR = arm.map(([x, y]) => [120 - x, y]).reverse();
    const lines = {
      height: '<path class="ml" d="M8,6 L8,226"/><path class="ml" d="M4,6 L12,6 M4,226 L12,226"/><circle class="md" cx="8" cy="6" r="2"/><circle class="md" cx="8" cy="226" r="2"/>',
      shoulder: '<path class="ml" d="M33,45 Q60,40 87,45"/><circle class="md" cx="33" cy="45" r="2"/><circle class="md" cx="87" cy="45" r="2"/>',
      chest: '<path class="ml" d="M35,62 Q60,67 85,62"/>',
      waist: '<path class="ml" d="M38.5,88 Q60,92 81.5,88"/>',
      hip: '<path class="ml" d="M35,114 Q60,119 85,114"/>',
      arm: '<path class="ml" d="M31,47 L26,71 L23.5,93 L21.5,115"/><circle class="md" cx="31" cy="47" r="2"/><circle class="md" cx="21.5" cy="115" r="2"/>',
      inseam: '<path class="ml" d="M58.5,131 L56,156 L54,180 L52.5,204 L51.5,224"/><circle class="md" cx="58.5" cy="131" r="2"/><circle class="md" cx="51.5" cy="224" r="2"/>',
    };
    return `<svg class="figure" viewBox="0 0 120 232" aria-hidden="true">
      <ellipse class="fig-body" cx="60" cy="17" rx="10.5" ry="13"/><path class="fig-body" d="${smoothPath(body)}"/>
      <path class="fig-body" d="${smoothPath(arm)}"/><path class="fig-body" d="${smoothPath(armR)}"/>
      ${C.FIELDS.map((f) => `<g data-k="${f.k}" style="--c:${f.color}">${lines[f.k]}</g>`).join('')}</svg>`;
  }
  const SKINS = ['#F3D9C4', '#E6C4A6', '#D4A784', '#B58060', '#8A5A3E', '#5C3B28'];

  function renderBody() {
    const el = $('[data-panel="body"]');
    const p = S.profile;
    el.innerHTML = `<div class="pad">
      <div class="ph"><h2>からだのサイズ</h2><span class="prog"><span data-r="pc"></span><span class="bar"><i data-r="pb"></i></span></span></div>
      <div class="seg" role="radiogroup" aria-label="体型のベース">${[['m', 'メンズ寄り'], ['n', 'ニュートラル'], ['f', 'レディース寄り']].map(([v, l]) => `<button type="button" role="radio" data-sex="${v}" aria-checked="${(p.sex || 'n') === v}">${l}</button>`).join('')}</div>
      <div class="measure">${figureSVG()}
        <ul class="fields">${C.FIELDS.map((f) => `<li class="field" data-k="${f.k}" style="--c:${f.color}">
          <label class="lbl" for="in-${f.k}"><span class="dot"></span>${f.label}</label>
          <span class="inp"><input id="in-${f.k}" data-in="${f.k}" type="number" inputmode="decimal" step="0.5" min="0" value="${p[f.k] != null ? esc(p[f.k]) : ''}" aria-describedby="hint-${f.k}">cm</span>
          <span class="hint" id="hint-${f.k}">${f.hint}</span></li>`).join('')}</ul>
      </div>
      <div class="skin"><div class="lab small muted"><b>肌の色</b></div><div class="sw swatches" role="radiogroup" aria-label="肌の色">${SKINS.map((c) => `<button type="button" class="sw-btn" role="radio" data-skin="${c}" style="--c:${c}" aria-label="肌の色 ${c}" aria-checked="${(p.skin || SKINS[1]) === c}"></button>`).join('')}</div></div>
      <p class="privacy"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/></svg>入力した値はこの端末の中だけに保存されます。空欄は身長から推定した値で表示します。</p>
    </div>`;
    updateBody();
  }
  function updateBody() {
    const P = C.normalizeProfile(S.profile);
    $('[data-r="pc"]').textContent = `${P.count}/${C.FIELDS.length} 入力済み`;
    $('[data-r="pb"]').style.width = `${(P.count / C.FIELDS.length) * 100}%`;
    C.FIELDS.forEach((f) => {
      const filled = P.filled[f.k];
      const li = $(`.field[data-k="${f.k}"]`); li.classList.toggle('filled', filled);
      $(`.figure g[data-k="${f.k}"]`).classList.toggle('filled', filled);
      $(`[data-in="${f.k}"]`).placeholder = String(Math.round(P.pred[f.k]));
    });
  }

  /* ---------- 右側のパネル ---------- */
  function renderSide() {
    renderCloset(); renderWear(); renderCoords();
    if (S.sheet) renderSheet();
    const n = S.outfit.length;
    $('[data-r="wear-count"]').textContent = n ? String(n) : '';
  }

  function itemCard(it) {
    const worn = !!findItem(it.id);
    const size = it.sizes && it.sizes[it.sizeIdx];
    const rec = it.sizes && it.sizes.length ? SF.recommend(fitBody(), it.sizes, { nude: !!it.nude }) : -1;
    return `<div class="card ${worn ? 'worn' : ''}"><button type="button" class="card-open" data-open="i:${esc(it.id)}" aria-label="${esc(it.name)}の詳細"></button>
      ${visual(Object.assign({}, it, { image: it.image || (it.print && it.print.src) }), 'thumb')}<span class="nm">${esc(it.name)}</span><span class="sub">${esc(C.CATS[it.cat].short)}${size ? ` · ${esc(size.name)}` : ''}</span>
      ${rec >= 0 && size && rec === it.sizeIdx ? '<span class="tag">おすすめ</span>' : ''}
      <button type="button" class="wear-tog" data-wear="i:${esc(it.id)}" aria-label="${worn ? '脱ぐ' : '着る'}">${worn ? '✓' : '+'}</button></div>`;
  }
  function presetCard(cat, style) {
    const w = findPreset(cat, style); const st = C.styleOf(cat, style);
    const color = w ? w.color : presetColor(cat, style);
    return `<div class="card ${w ? 'worn' : ''}"><button type="button" class="card-open" data-open="p:${cat}:${style}" aria-label="${esc(st.label)}の詳細"></button>
      ${icon(cat, style, color)}<span class="nm">${esc(st.label)}</span><span class="sub">${esc(C.CATS[cat].short)}</span>
      <button type="button" class="wear-tog" data-wear="p:${cat}:${style}" aria-label="${w ? '脱ぐ' : '着る'}">${w ? '✓' : '+'}</button></div>`;
  }
  function renderCloset() {
    const el = $('[data-panel="closet"]');
    const n = S.closet.length;
    el.innerHTML = `<div class="pad">
      <div class="ph"><h2>クローゼット</h2><button type="button" class="btn sm" data-act="add-paste">＋ サイズ表から追加</button></div>
      <h3>取り込んだ服 <span class="count">${n}</span></h3>
      ${n ? `<div class="grid">${S.closet.slice().reverse().map(itemCard).join('')}</div>` : `<div class="empty">通販サイトの商品ページで拡張機能のボタンを押すと、ここに服が入ります。<br>サイズ表をコピーして「サイズ表から追加」でも入れられます。</div>`}
      <h3>ベーシック</h3>
      ${C.PRESET_GROUPS.map((g) => `<div class="group"><div class="gh">${esc(g.label)}</div><div class="grid">${g.items.map(([c, s]) => presetCard(c, s)).join('')}</div></div>`).join('')}
    </div>`;
  }

  function renderWear() {
    const el = $('[data-panel="wear"]');
    const rows = S.outfit.map((e, i) => ({ e, i, f: info(e) })).filter((r) => r.f).reverse();
    el.innerHTML = `<div class="pad">
      <div class="ph"><h2>着ているもの</h2>${rows.length ? '<button type="button" class="btn sm" data-act="undress">すべて脱ぐ</button>' : ''}</div>
      ${rows.length ? `<ul class="layers">${rows.map(({ e, i, f }, k) => {
        const ev = f.item ? evalItem(f.item) : null;
        return `<li class="layer">${visual(f, 'ic')}<div class="info"><b>${esc(f.name)}</b><span>${k === 0 ? 'いちばん外側 · ' : ''}${esc(C.CATS[f.cat].short)}${f.size ? ` · ${esc(f.size)}` : ''}${ev ? ` · ${esc(VERDICT[ev.worst])}` : ''}</span></div>
          <button type="button" class="ib" data-move="${i}" data-dir="1" aria-label="外側へ" ${i === S.outfit.length - 1 ? 'disabled' : ''}>↑</button>
          <button type="button" class="ib" data-move="${i}" data-dir="-1" aria-label="内側へ" ${i === 0 ? 'disabled' : ''}>↓</button>
          <button type="button" class="ib" data-off="${esc(e.uid)}" aria-label="脱ぐ">✕</button></li>`;
      }).join('')}</ul><p class="layer-hint">上にあるものほど外側に重なります。↑↓ で入れ替えると、タックイン・アウトも切り替えられます。</p>`
        : '<div class="empty">まだ何も着ていません。クローゼットから選んでください。</div>'}
    </div>`;
  }

  function renderCoords() {
    const el = $('[data-panel="coords"]');
    el.innerHTML = `<div class="pad">
      <div class="ph"><h2>コーデ</h2></div>
      <div class="save-row"><input class="text" data-r="coord-name" maxlength="40" placeholder="コーデの名前（例：週末デニム）" aria-label="コーデの名前"><button type="button" class="btn primary" data-act="save-coord">保存</button></div>
      ${S.coords.length ? `<div class="coords">${S.coords.slice().reverse().map((c) => `<div class="coord">
        <button type="button" class="open" data-coord="${esc(c.id)}" aria-label="${esc(c.name)}を着る"></button>
        <button type="button" class="del" data-coord-del="${esc(c.id)}" aria-label="${esc(c.name)}を削除">✕</button>
        ${c.thumb ? `<img src="${esc(c.thumb)}" alt="">` : '<img alt="">'}
        <div class="cm"><b>${esc(c.name)}</b><span>${new Date(c.created).toLocaleDateString('ja-JP')} · ${c.outfit.length}点</span></div></div>`).join('')}</div>`
        : '<div class="empty" style="margin-top:16px">いまの着こなしを名前をつけて保存できます。保存したコーデは、押すとすぐに着せ替えられます。</div>'}
    </div>`;
  }

  function renderBadge() {
    const el = $('[data-r="badge"]');
    if (S.measure) { el.hidden = true; return; }
    const worn = S.outfit.map(info).filter((f) => f && f.item && f.item.sizes && f.item.sizes.length);
    if (!worn.length) { el.hidden = true; return; }
    const f = worn[worn.length - 1]; const ev = evalItem(f.item);
    el.hidden = false;
    el.innerHTML = `<span class="dot st-${ev ? ev.worst : 'info'}"></span><b>${esc(f.name)}</b><span class="muted">${esc(f.size || '')} · ${ev ? esc(VERDICT[ev.worst]) : ''}</span>`;
    el.dataset.open = `i:${f.item.id}`;
  }

  /* ---------- 詳細シート ---------- */
  function openSheet(ref) { S.sheet = ref; renderSheet(); const sh = $('[data-r="sheet"]'); sh.scrollTop = 0; const b = $('.back', sh); if (b) b.focus(); }
  function closeSheet() { S.sheet = null; $('[data-r="sheet"]').hidden = true; }

  function colorRow(cat, current, extra) {
    const pal = (extra || []).concat(C.paletteFor(cat));
    const seen = new Set();
    return `<div class="swatches" role="radiogroup" aria-label="色">${pal.filter(([c]) => !seen.has(c.toUpperCase()) && seen.add(c.toUpperCase())).map(([c, n]) => `<button type="button" class="sw-btn" role="radio" data-color="${c}" style="--c:${c}" aria-label="${esc(n)}" title="${esc(n)}" aria-checked="${current.toUpperCase() === c.toUpperCase()}"></button>`).join('')}
      <label class="sw-custom" title="ほかの色"><input type="color" data-color-input value="${esc(current)}" aria-label="ほかの色"></label></div>`;
  }

  function renderSheet() {
    const sh = $('[data-r="sheet"]'); const ref = S.sheet;
    if (!ref) { sh.hidden = true; return; }
    sh.hidden = false;
    if (ref === 'paste') { sh.innerHTML = pasteSheet(); return; }
    const [kind, a, b] = ref.split(':');
    if (kind === 'p') {
      const cat = a; const style = b; const st = C.styleOf(cat, style); const w = findPreset(cat, style);
      const color = w ? w.color : presetColor(cat, style);
      const fab = st.fabric || C.CATS[cat].fabric;
      sh.innerHTML = `<div class="sheet-head"><button type="button" class="back" data-act="close-sheet" aria-label="戻る">‹</button><b>${esc(st.label)}</b></div>
      <div class="pad">
        <div class="hero">${icon(cat, style, color)}<div class="meta"><b>${esc(st.label)} ${esc(C.CATS[cat].short)}</b><span class="muted small">${esc(C.FABRICS[fab] || '')} · ベーシック</span></div></div>
        <div class="row"><span class="lab">スタイル</span><div class="pills" role="radiogroup">${Object.entries(C.STYLES[cat]).map(([k, s]) => `<button type="button" class="pill" role="radio" data-style="${k}" aria-checked="${k === style}">${esc(s.label)}</button>`).join('')}</div></div>
        <div class="row"><span class="lab">色</span>${colorRow(cat, color)}</div>
        <div class="actions"><button type="button" class="btn ${w ? '' : 'primary'}" data-act="sheet-wear">${w ? '脱ぐ' : '着る'}</button></div>
        <p class="muted small" style="margin-top:14px">ベーシックの服は、あなたの体に合わせた標準的なゆとりで表示します。</p>
      </div>`;
      return;
    }
    const it = itemById(a);
    if (!it) { closeSheet(); return; }
    const w = findItem(it.id);
    const rec = it.sizes.length ? SF.recommend(fitBody(), it.sizes, { nude: !!it.nude }) : -1;
    const ev = evalItem(it);
    const extra = (it.colors || []).map((c) => [c.hex, c.name]);
    let host = '';
    try { host = it.url ? new URL(it.url).hostname.replace(/^www\./, '') : ''; } catch (e) { host = ''; }
    sh.innerHTML = `<div class="sheet-head"><button type="button" class="back" data-act="close-sheet" aria-label="戻る">‹</button><b>${esc(it.name)}</b></div>
    <div class="pad">
      <div class="hero">${visual(it, 'ic')}<div class="meta"><b>${esc(it.name)}</b>${it.price ? `<span class="small">${esc(it.price)}</span><br>` : ''}${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(host || '商品ページ')} を開く ↗</a>` : '<span class="muted small">手入力で追加</span>'}</div></div>
      ${it.sizes.length ? `<div class="row"><span class="lab">サイズ${it.nude ? '（体の寸法の表）' : ''}</span><div class="pills" role="radiogroup">${it.sizes.map((s, i) => `<button type="button" class="pill" role="radio" data-size="${i}" aria-checked="${i === it.sizeIdx}">${esc(s.name)}${i === rec ? '<small>おすすめ</small>' : ''}</button>`).join('')}</div>
        ${ev ? `<div class="verdict"><span class="dot st-${ev.worst}"></span>${esc(it.sizes[it.sizeIdx].name)}：${esc(VERDICT[ev.worst])}</div>
        <ul class="evals">${ev.items.map((x) => {
          const d = x.diffShown != null ? x.diffShown : x.diff;
          const val = x.body == null || x.status === 'info' ? `服 ${x.garment}cm` : `服 ${x.garment}cm / 体 ${x.body}cm${x.bodyNote ? `（${x.bodyNote}）` : ''} → ${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}cm`;
          return `<li><span class="dot st-${x.status}"></span><b>${esc(x.label)}</b><span>${esc(x.text)}</span><span class="v">${val}</span></li>`;
        }).join('')}</ul>` : ''}</div>
        <div class="row"><span class="lab">読み取った数値（一周の長さに換算済み・押すと直せます）</span>${C.measureTable(it.sizes, it.sizeIdx)}</div>`
        : '<div class="row"><div class="empty">サイズ表が読み取れていません。下の「サイズ表を貼りつける」から入れると、サイズ判定とおすすめが出ます。今は標準のゆとりで表示しています。</div></div>'}
      <div class="row"><span class="lab">デザインに使う写真</span>
        <div class="design-row">${it.print ? `<img class="design-thumb" src="${esc(it.print.src)}" alt="服に貼っている写真">` : '<span class="design-thumb empty">写真なし</span>'}
          <div class="design-acts"><label class="btn sm">写真を選ぶ<input type="file" accept="image/*" data-design-file hidden></label>
          ${it.print ? `<label class="small"><input type="checkbox" data-use-print ${it.usePrint !== false ? 'checked' : ''}> 服に貼る</label><button type="button" class="btn sm" data-act="design-remove">外す</button>` : ''}</div></div>
        <p class="small muted" style="margin:6px 0 0">背景が無地の商品写真（平置き・トルソー）がきれいに貼れます。モデルが着ている写真は形がずれます。</p></div>
      <div class="row"><label for="it-cat">種類</label><select id="it-cat" data-it="cat">${Object.entries(C.CATS).map(([k, c]) => `<option value="${k}" ${k === it.cat ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="row"><span class="lab">形</span><div class="pills" role="radiogroup">${Object.entries(C.STYLES[it.cat]).map(([k, s]) => `<button type="button" class="pill" role="radio" data-style="${k}" aria-checked="${k === it.style}">${esc(s.label)}</button>`).join('')}</div></div>
      <div class="row"><span class="lab">色</span>${colorRow(it.cat, it.color, extra)}</div>
      <div class="row"><label for="it-fab">素材・質感</label><select id="it-fab" data-it="fabric">${Object.entries(C.FABRICS).map(([k, l]) => `<option value="${k}" ${k === it.fabric ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <details class="row"><summary class="small muted">サイズ表を貼りつける・読み直す</summary>
        <textarea class="text" data-r="it-table" placeholder="サイズ表をコピーして貼りつけ" style="margin-top:8px"></textarea>
        <button type="button" class="btn sm" data-act="it-table" style="margin-top:6px">読み込む</button></details>
      <div class="actions"><button type="button" class="btn ${w ? '' : 'primary'}" data-act="sheet-wear">${w ? '脱ぐ' : '着る'}</button><button type="button" class="btn danger" data-act="item-del">削除</button></div>
    </div>`;
  }

  function pasteSheet() {
    const d = S.pasteDraft || (S.pasteDraft = { text: '', name: '', cat: '', color: '#F5F5F2' });
    const sizes = d.text ? parseTable(d.text).sizes : [];
    const g = guess(d);
    return `<div class="sheet-head"><button type="button" class="back" data-act="close-sheet" aria-label="戻る">‹</button><b>サイズ表から追加</b></div>
    <div class="pad">
      <div class="row" style="margin-top:0"><label for="ps-name">商品名</label><input id="ps-name" class="text" data-ps="name" value="${esc(d.name)}" placeholder="例：ヘビーウェイト Tシャツ"></div>
      <div class="row"><label for="ps-text">サイズ表</label><textarea id="ps-text" class="text" data-ps="text" placeholder="通販サイトのサイズ表を、項目名ごとコピーして貼りつけ&#10;例）&#10;サイズ 着丈 身幅 肩幅 袖丈&#10;S 66 50 44 20&#10;M 69 53 46 21">${esc(d.text)}</textarea>
        <p class="small muted" data-r="ps-status">${d.text ? (sizes.length ? `${sizes.length} サイズを読み取りました（${sizes.map((s) => esc(s.name)).join('・')}）` : '数値を読み取れませんでした。項目名（着丈・身幅など）ごとコピーしてください。') : 'サイズ表が画像のサイトでは、数値を手で打ち込んでも大丈夫です。'}</p></div>
      <div class="row"><label for="ps-cat">種類</label><select id="ps-cat" data-ps="cat">${Object.entries(C.CATS).map(([k, c]) => `<option value="${k}" ${k === g.cat ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="row"><span class="lab">色</span>${colorRow(g.cat, d.color)}</div>
      <div class="actions"><button type="button" class="btn primary" data-act="ps-add">クローゼットに追加</button></div>
    </div>`;
  }
  function parseTable(text) {
    const raw = SF.parseText(text); const opts = SF.detectOptions(text, raw);
    return { sizes: SF.finalize(raw, opts), opts };
  }
  function guess(d) {
    if (d.cat) return { cat: d.cat, style: C.firstStyle(d.cat) };
    const sizes = d.text ? parseTable(d.text).sizes : [];
    return C.guessCategory(d.name, sizes.length ? SF.category(sizes[0].m) : null);
  }

  function addItem(o) {
    const it = Object.assign({ id: uid(), created: Date.now(), sizes: [], sizeIdx: 0, colors: [] }, o);
    if (it.sizes.length) {
      const rec = SF.recommend(fitBody(), it.sizes, { nude: !!it.nude });
      if (it.sizeIdx == null || it.sizeIdx < 0 || it.sizeIdx >= it.sizes.length) it.sizeIdx = Math.max(0, rec);
    }
    S.closet.push(it); saveCloset();
    return it;
  }
  function updateItem(it, patch) {
    Object.assign(it, patch); saveCloset();
    if (findItem(it.id)) rebuild();
    renderSide();
  }

  /* ---------- コーデ ---------- */
  function saveCoord() {
    if (!S.outfit.length) { toast('何か着てから保存してください'); return; }
    const nameEl = $('[data-r="coord-name"]');
    const name = (nameEl && nameEl.value.trim()) || `コーデ ${S.coords.length + 1}`;
    if (S.measure) setMeasure(false);
    let thumb = '';
    try { if (R) thumb = R.snapshot(240, 300); } catch (e) { thumb = ''; }
    S.coords.push({ id: uid(), name, created: Date.now(), thumb, outfit: S.outfit.map((e) => Object.assign({}, e)) });
    store.set({ coords: S.coords });
    renderCoords();
    toast(`「${name}」を保存しました`);
  }
  function loadCoord(id) {
    const c = S.coords.find((x) => x.id === id); if (!c) return;
    const list = c.outfit.filter((e) => e.src !== 'item' || itemById(e.itemId));
    if (list.length < c.outfit.length) toast('削除した服はとばしました');
    S.outfit = list.map((e) => Object.assign({}, e, { uid: uid() }));
    S.measure = false;
    changed();
    toast(`「${c.name}」を着ました`);
  }

  /* ---------- 操作 ---------- */
  function setTab(t) {
    S.tab = t; app.dataset.tab = t;
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (t === 'body' && !S.measure) setMeasure(true, true);
    else if (t !== 'body' && S.autoMeasure) setMeasure(false);
  }

  function bind() {
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('button, [data-open]');
      if (!t) return;
      const d = t.dataset;
      if (d.tab) { setTab(d.tab); return; }
      if (d.act === 'theme') {
        const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = dark ? 'light' : 'dark'; S.prefs.theme = document.documentElement.dataset.theme; savePrefs(); return;
      }
      if (d.act === 'save-coord') { saveCoord(); return; }
      if (d.act === 'sync-open') { openSyncDialog(); return; }
      if (d.act && /^(sync-|data-)/.test(d.act)) { syncClick(d.act); return; }
      if (d.act === 'measure') { setMeasure(!S.measure, false); return; }
      if (d.act === 'fit') { S.fit = !S.fit; if (S.measure) S.measure = false; rebuild(); return; }
      if (d.act === 'spin') { if (R) R.spin(0.16); return; }
      if (d.act === 'reset') { if (R) R.reset(); return; }
      if (d.sex) { S.profile.sex = d.sex; $$('[data-sex]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sex === d.sex))); updateBody(); saveProfile(); rebuildSoon(); renderSide(); return; }
      if (d.skin) { S.profile.skin = d.skin; $$('[data-skin]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.skin === d.skin))); saveProfile(); rebuildSoon(); return; }
      if (d.wear) { const [k, a, b] = d.wear.split(':'); if (k === 'p') togglePreset(a, b); else toggleItem(a); return; }
      if (d.open) { openSheet(d.open); return; }
      if (d.act === 'add-paste') { S.pasteDraft = null; openSheet('paste'); return; }
      if (d.act === 'close-sheet') { closeSheet(); return; }
      if (d.act === 'undress') { S.outfit = []; changed(); return; }
      if (d.move != null) {
        const i = +d.move; const j = i + +d.dir;
        if (j < 0 || j >= S.outfit.length) return;
        const o = S.outfit; [o[i], o[j]] = [o[j], o[i]]; changed(); return;
      }
      if (d.off) { takeOff(d.off); return; }
      if (d.coord) { loadCoord(d.coord); return; }
      if (d.coordDel) {
        const c = S.coords.find((x) => x.id === d.coordDel);
        if (c && confirm(`「${c.name}」を削除しますか？`)) { S.coords = S.coords.filter((x) => x !== c); store.set({ coords: S.coords }); renderCoords(); }
        return;
      }
      sheetClick(t, d);
    });

    const bodyPanel = $('[data-panel="body"]');
    bodyPanel.addEventListener('input', (ev) => {
      const k = ev.target.dataset.in; if (!k) return;
      const v = parseFloat(ev.target.value);
      if (isFinite(v) && v > 0) S.profile[k] = v; else delete S.profile[k];
      updateBody(); saveProfile(); rebuildSoon();
    });
    bodyPanel.addEventListener('change', () => renderSide());
    bodyPanel.addEventListener('focusin', (ev) => { const k = ev.target.dataset.in; if (k) setFocus(k); });
    bodyPanel.addEventListener('focusout', (ev) => {
      if (!ev.relatedTarget || !bodyPanel.contains(ev.relatedTarget)) {
        setFocus(null);
        if (S.autoMeasure && S.tab !== 'body') setMeasure(false);
      }
    });
    bodyPanel.addEventListener('click', (ev) => { const li = ev.target.closest('.field'); if (li && ev.target.tagName !== 'INPUT') $('input', li).focus(); });

    const side = $('.side-panel');
    side.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.dataset.ps) {
        S.pasteDraft[el.dataset.ps] = el.value;
        if (el.dataset.ps === 'text' || el.dataset.ps === 'name') {
          const sizes = S.pasteDraft.text ? parseTable(S.pasteDraft.text).sizes : [];
          const st = $('[data-r="ps-status"]');
          if (st) st.textContent = S.pasteDraft.text ? (sizes.length ? `${sizes.length} サイズを読み取りました（${sizes.map((s) => s.name).join('・')}）` : '数値を読み取れませんでした。項目名（着丈・身幅など）ごとコピーしてください。') : '';
          if (!S.pasteDraft.cat) { const sel = $('[data-ps="cat"]'); if (sel) sel.value = guess(S.pasteDraft).cat; }
        }
      }
      if (el.matches('[data-color-input]')) applyColor(el.value, true);
    });
    side.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.matches('[data-color-input]')) applyColor(el.value, false);
      if ((el.matches('[data-design-file]') || el.matches('[data-use-print]')) && S.sheet && S.sheet.startsWith('i:')) {
        const it = itemById(S.sheet.slice(2)); if (!it) return;
        if (el.matches('[data-use-print]')) { updateItem(it, { usePrint: el.checked }); return; }
        const file = el.files && el.files[0]; if (!file) return;
        const kind = (C.CATS[it.cat] || {}).group === 'top' ? 'top' : 'bottom';
        SFDesign.fromFile(file, kind).then((d) => { updateItem(it, { print: { src: d.src, uv: d.uv }, color: d.color, usePrint: true }); toast('写真を服に貼りました'); })
          .catch(() => toast('この写真は読み込めませんでした'));
        return;
      }
      if (el.dataset.mt && S.sheet && S.sheet.startsWith('i:')) {
        const it = itemById(S.sheet.slice(2)); if (!it) return;
        C.applyMeasureEdit(it.sizes, el.dataset.mt, el.value);
        updateItem(it, { sizes: it.sizes });
        toast('数値を直しました');
      }
      if (el.dataset.ps === 'cat') { S.pasteDraft.cat = el.value; renderSheet(); }
      if (el.dataset.it && S.sheet && S.sheet.startsWith('i:')) {
        const it = itemById(S.sheet.slice(2)); if (!it) return;
        if (el.dataset.it === 'cat') updateItem(it, { cat: el.value, style: C.firstStyle(el.value), fabric: C.guessFabric(it.name, el.value) });
        else updateItem(it, { [el.dataset.it]: el.value });
      }
    });

    $('[data-r="badge"]').addEventListener('click', () => { const r = $('[data-r="badge"]').dataset.open; if (r) { if (S.tab === 'body') setTab('closet'); openSheet(r); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet && !$('[data-r="sync-dlg"]').open) closeSheet(); });
    $('[data-r="sync-dlg"]').addEventListener('change', (e) => { if (e.target.matches('[data-import]') && e.target.files[0]) importFile(e.target.files[0]); });
  }

  function applyColor(c, live) {
    const ref = S.sheet; if (!ref) return;
    if (ref === 'paste') { S.pasteDraft.color = c; S.pasteDraft.colorSet = true; if (!live) renderSheet(); return; }
    const [kind, a, b] = ref.split(':');
    if (kind === 'p') {
      S.prefs.presetColors[`${a}:${b}`] = c; savePrefs();
      const w = findPreset(a, b); if (w) { w.color = c; saveOutfit(); rebuildSoon(); }
      if (!live) renderSide();
    } else {
      const it = itemById(a); if (!it) return;
      it.color = c; saveCloset();
      if (findItem(it.id)) rebuildSoon();
      if (!live) renderSide();
    }
  }

  function sheetClick(t, d) {
    const ref = S.sheet; if (!ref) return;
    if (d.color) { applyColor(d.color, false); return; }
    if (ref === 'paste') {
      if (d.act === 'ps-add') {
        const dr = S.pasteDraft; const { sizes, opts } = dr.text ? parseTable(dr.text) : { sizes: [], opts: {} };
        if (!dr.text.trim() && !dr.name.trim()) { toast('サイズ表か商品名を入れてください'); return; }
        const g = guess(dr);
        const color = dr.colorSet ? dr.color : (C.colorFromText(dr.name) || dr.color);
        const it = addItem({ name: dr.name.trim() || `${C.CATS[g.cat].short}（手入力）`, cat: g.cat, style: g.style, color, fabric: C.guessFabric(dr.name, g.cat), sizes, nude: !!opts.nude, inch: !!opts.inch, sizeIdx: -1 });
        S.pasteDraft = null;
        renderSide(); openSheet(`i:${it.id}`);
        toast('クローゼットに追加しました');
      }
      return;
    }
    const [kind, a, b] = ref.split(':');
    if (kind === 'p') {
      if (d.style) {
        const w = findPreset(a, b);
        if (w && !findPreset(a, d.style)) { w.style = d.style; w.color = presetColor(a, d.style) || w.color; saveOutfit(); rebuild(); }
        S.sheet = `p:${a}:${d.style}`; renderSide(); return;
      }
      if (d.act === 'sheet-wear') { togglePreset(a, b); return; }
      return;
    }
    const it = itemById(a); if (!it) return;
    if (d.size != null) { updateItem(it, { sizeIdx: +d.size }); return; }
    if (d.style) { updateItem(it, { style: d.style }); return; }
    if (d.act === 'sheet-wear') { toggleItem(it.id); return; }
    if (d.act === 'design-remove') { updateItem(it, { print: null }); return; }
    if (d.act === 'it-table') {
      const text = $('[data-r="it-table"]').value;
      const { sizes, opts } = parseTable(text);
      if (!sizes.length) { toast('数値を読み取れませんでした'); return; }
      const rec = SF.recommend(fitBody(), sizes, { nude: !!opts.nude });
      updateItem(it, { sizes, nude: !!opts.nude, inch: !!opts.inch, sizeIdx: Math.max(0, rec) });
      toast(`${sizes.length} サイズを読み込みました`);
      return;
    }
    if (d.act === 'item-del') {
      if (!confirm(`「${it.name}」をクローゼットから削除しますか？`)) return;
      S.closet = S.closet.filter((x) => x !== it);
      S.outfit = S.outfit.filter((e) => !(e.src === 'item' && e.itemId === it.id));
      saveCloset(); closeSheet(); changed();
    }
  }

  /* ---------- 起動 ---------- */
  async function init() {
    const d = await store.get(['profile', 'closet', 'outfit', 'coords', 'prefs']);
    S.profile = d.profile || {};
    S.closet = Array.isArray(d.closet) ? d.closet : [];
    S.coords = Array.isArray(d.coords) ? d.coords : [];
    S.prefs = Object.assign({ presetColors: {} }, d.prefs || {});
    S.outfit = Array.isArray(d.outfit) ? d.outfit : [
      { uid: uid(), src: 'preset', cat: 'underBottom', style: 'boxer', color: '#3A3C41' },
      { uid: uid(), src: 'preset', cat: 'underTop', style: 'crew', color: '#F5F5F2' },
    ];
    if (S.prefs.theme) document.documentElement.dataset.theme = S.prefs.theme;
    const mt = document.createElement('style'); mt.textContent = C.MT_CSS; document.head.appendChild(mt);
    try { R = SF3D.create($('#view'), { onView() { const h = $('[data-r="hint"]'); if (h && R && Math.abs(R.view.yaw - 0.35) > 0.3) h.style.opacity = '0'; } }); } catch (e) { R = null; console.warn(e); }
    if (!R) $('.nogl').hidden = false;
    window.SFStudio = { get renderer() { return R; }, state: S }; // 確認・デバッグ用
    const ng = $('.nogl');
    if (R) { ng.textContent = '人体モデルを読み込んでいます…'; ng.hidden = false; }
    try { await M3.load(''); ready = true; if (R) ng.hidden = true; } catch (e) { console.warn(e); ng.textContent = '人体モデルを読み込めませんでした。ページを開き直してください。'; ng.hidden = false; }
    renderBody(); bind(); setTab(matchMedia('(max-width: 960px)').matches ? 'closet' : 'closet');
    rebuild(); renderSide();
    const q = new URLSearchParams(location.search);
    const id = q.get('item');
    if (id && itemById(id)) { openSheet(`i:${id}`); if (q.get('wear') === '1' && !findItem(id)) toggleItem(id); }
    // ほかのタブ・取り込みパネル・同期で変わったデータを反映する
    store.on((ch) => {
      const d = {};
      DATA_KEYS.forEach((k) => { if (ch[k] !== undefined && JSON.stringify(ch[k]) !== JSON.stringify(S[k])) d[k] = ch[k]; });
      if (Object.keys(d).length) applyData(d);
      if (ch.syncState) onSyncState(ch.syncState);
    });
    initSync();
  }

  /* ---------- データの反映（同期・ほかのタブ・読み込み） ---------- */
  function applyData(d) {
    if (d.profile) S.profile = d.profile || {};
    if (d.closet) { S.closet = d.closet; lastCloset = JSON.stringify(d.closet); }
    if (d.coords) S.coords = d.coords;
    if (d.prefs) S.prefs = Object.assign({ presetColors: {} }, d.prefs);
    if (d.outfit) S.outfit = d.outfit;
    if (d.profile) {
      C.FIELDS.forEach((f) => { const el = $(`[data-in="${f.k}"]`); if (el && document.activeElement !== el) el.value = S.profile[f.k] != null ? S.profile[f.k] : ''; });
      $$('[data-sex]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sex === (S.profile.sex || 'n'))));
      $$('[data-skin]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.skin === (S.profile.skin || '#E6C4A6'))));
      updateBody();
    }
    renderSide(); rebuild();
  }

  /* ---------- 同期とデータ ---------- */
  let lastSyncMsg = '';
  function onSyncState(s) {
    const dot = $('[data-r="sync-dot"]');
    dot.hidden = false; dot.classList.toggle('ok', !!s.ok);
    if (!s.ok && s.error !== lastSyncMsg) toast(`同期できませんでした: ${s.error}`, 'err');
    if (s.ok && s.pulled) toast('ほかの端末の変更を取り込みました', 'info');
    lastSyncMsg = s.ok ? '' : s.error;
    if ($('[data-r="sync-dlg"]').open) renderSyncDialog();
  }
  function syncNow() {
    if (webSync) return webSync.syncNow('手動');
    return new Promise((r) => chrome.runtime.sendMessage({ type: 'sf-sync-now' }, r));
  }
  function initSync() {
    if (!hasChrome && typeof SFSync !== 'undefined') {
      webSync = SFSync.create({
        read: async () => JSON.parse(JSON.stringify({ profile: S.profile, outfit: S.outfit, prefs: S.prefs, closet: S.closet, coords: S.coords })),
        write: async (l) => { await store.set(l, true); applyData(l); },
        cfg: async () => (await store.get(['syncCfg'])).syncCfg,
        base: async () => (await store.get(['syncBase'])).syncBase,
        saveBase: async (b) => store.set({ syncBase: b }, true),
        status: async (s) => { await store.set({ syncState: s }, true); onSyncState(s); },
      });
      webSync.syncNow('起動');
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') webSync.syncNow('表示'); });
      setInterval(() => { if (document.visibilityState === 'visible') webSync.syncNow('定期'); }, 2 * 60000);
    }
    store.get(['syncCfg', 'syncState']).then((o) => { if (o.syncCfg && o.syncCfg.token && o.syncState) { const dot = $('[data-r="sync-dot"]'); dot.hidden = false; dot.classList.toggle('ok', !!o.syncState.ok); } });
  }

  async function renderSyncDialog() {
    const dlg = $('[data-r="sync-dlg"]');
    const { syncCfg: c = {}, syncState: s } = await store.get(['syncCfg', 'syncState']);
    const when = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const state = !c.token ? '<div class="sync-state"><i></i><span>まだ設定していません</span></div>'
      : s ? `<div class="sync-state ${s.ok ? 'ok' : 'err'}"><i></i><span>${s.ok ? `${when(s.at)} に同期しました` : `${when(s.at)} 同期できませんでした: ${esc(s.error)}`}</span></div>`
        : '<div class="sync-state"><i></i><span>まだ同期していません</span></div>';
    dlg.innerHTML = `<div class="pad">
      <div class="ph"><h2>同期とデータ</h2><button type="button" class="back" data-act="sync-close" aria-label="閉じる">×</button></div>
      <p class="small muted" style="margin:0">PC（拡張機能）とスマホ（ウェブアプリ）で、体のデータ・クローゼット・コーデ・服の写真をそろえます。データはあなたの GitHub の<b>非公開</b>リポジトリに保存されます。</p>
      ${state}
      <div class="field2"><label for="sy-repo">保存先のリポジトリ</label><input class="text" id="sy-repo" value="${esc(c.repo || 'shunAutumn/silhouette-fit-data')}" placeholder="ユーザー名/リポジトリ名" autocomplete="off" spellcheck="false"></div>
      <div class="field2"><label for="sy-token">トークン${c.token ? '（保存済み。変えるときだけ貼りつけ）' : ''}</label><input class="text" id="sy-token" type="password" autocomplete="off" spellcheck="false" placeholder="${c.token ? '••••••••（保存済み）' : 'github_pat_… を貼りつけ'}"></div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="sy-on" ${c.enabled === false ? '' : 'checked'}> この端末で同期する</label>
      <div class="row-btns"><button type="button" class="btn primary" data-act="sync-save">保存して同期</button>${c.token ? '<button type="button" class="btn" data-act="sync-now">今すぐ同期</button><button type="button" class="btn danger" data-act="sync-forget">この端末のトークンを消す</button>' : ''}</div>
      <details style="margin-top:14px"><summary class="small">トークンの作り方（最初に 1 回だけ）</summary><ol>
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub のトークン作成ページ</a>を開く</li>
        <li>Token name に「silhouette-fit」、Expiration に好きな期限（最長 1 年）を入れる</li>
        <li>Repository access で「Only select repositories」を選び、<b>${esc(c.repo || 'shunAutumn/silhouette-fit-data')}</b> だけを選ぶ</li>
        <li>Permissions の「Repository permissions」で「Contents」を「Read and write」にする</li>
        <li>「Generate token」を押し、表示された github_pat_… をコピーして、上の欄に貼る（スマホでも同じものを貼る）</li>
      </ol><p class="small muted">トークンはこの端末の中にだけ保存し、GitHub 以外には送りません。期限が切れたら作り直して貼り直してください。</p></details>
      <h3>データの控え</h3>
      <div class="row-btns"><button type="button" class="btn" data-act="data-export">ファイルに書き出す</button><label class="btn" style="cursor:pointer">ファイルから読み込む<input type="file" accept="application/json,.json" data-import hidden></label></div>
      <p class="small muted" style="margin:8px 0 0">読み込むと、いまの体のデータ・クローゼット・コーデは、ファイルの内容に置き換わります。</p>
    </div>`;
  }
  async function openSyncDialog() { await renderSyncDialog(); const dlg = $('[data-r="sync-dlg"]'); if (!dlg.open) dlg.showModal(); }

  async function syncClick(act) {
    const dlg = $('[data-r="sync-dlg"]');
    if (act === 'sync-close') { dlg.close(); return; }
    if (act === 'sync-save') {
      const { syncCfg: c = {} } = await store.get(['syncCfg']);
      const repo = $('#sy-repo', dlg).value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '');
      const tok = $('#sy-token', dlg).value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('リポジトリは「ユーザー名/リポジトリ名」の形で入れてください', 'err'); return; }
      if (!tok && !c.token) { toast('トークンを貼りつけてください', 'err'); return; }
      const next = { repo, token: tok || c.token, enabled: $('#sy-on', dlg).checked };
      if (repo !== c.repo) await store.set({ syncBase: null }, true);
      await store.set({ syncCfg: next }, true);
      toast('同期の設定を保存しました', 'info');
      const r = await syncNow();
      if (r && r.ok) toast('同期しました');
      renderSyncDialog();
      return;
    }
    if (act === 'sync-now') { const r = await syncNow(); if (r && r.ok) toast('同期しました'); renderSyncDialog(); return; }
    if (act === 'sync-forget') {
      if (!confirm('この端末に保存したトークンを消しますか？（GitHub のデータは消えません）')) return;
      await store.set({ syncCfg: { repo: ($('#sy-repo', dlg).value || '').trim(), token: '', enabled: false }, syncState: null }, true);
      $('[data-r="sync-dot"]').hidden = true; renderSyncDialog(); return;
    }
    if (act === 'data-export') {
      const doc = SFSync.exportDoc(JSON.parse(JSON.stringify({ profile: S.profile, outfit: S.outfit, prefs: S.prefs, closet: S.closet, coords: S.coords })));
      const url = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `silhouette-fit-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('ファイルに書き出しました');
    }
  }
  async function importFile(file) {
    try {
      const data = SFSync.importDoc(await file.text());
      if (!confirm(`「${file.name}」の内容で、いまのデータを置き換えますか？`)) return;
      const d = {}; DATA_KEYS.forEach((k) => { if (data[k] !== undefined) d[k] = data[k]; });
      await store.set(d);
      applyData(d);
      toast('ファイルから読み込みました');
    } catch (e) { toast(e.message || '読み込めませんでした', 'err'); }
  }
  init();
})();
