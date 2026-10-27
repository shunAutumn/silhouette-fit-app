/* シルエット試着 sync: GitHub の非公開リポジトリを使って、PC（拡張機能）とスマホ（ウェブアプリ）のデータをそろえる
 *
 * ・リポジトリには sync.json（データ本体）と img/<ハッシュ>.<拡張子>（服の写真・コーデのサムネイル）を置く
 * ・記録ごとに「最後に変えた時刻」を持ち、両方で変わっていたら新しいほうを残す
 * ・前回そろえた内容（base）と比べて、こちらで変えた記録・消した記録を見分ける
 * ・拡張機能では background.js、ウェブアプリでは studio.js から使う（DOM は使わない）
 */
(function (G) {
  'use strict';
  const API = 'https://api.github.com';
  const FILE = 'sync.json';
  const SINGLE = ['profile', 'outfit', 'prefs'];
  const LISTS = ['closet', 'coords'];
  const IMG = 'sfimg:';

  /* ---------- 小物 ---------- */
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  const hash = (s) => fnv(s, 2166136261) + fnv(s, 0x811c9dc5 ^ 0x5bd1e995);
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
  const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const b64decode = (b64) => { const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
  const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:image/');

  /* ---------- GitHub ---------- */
  async function gh(cfg, path, opt) {
    opt = opt || {};
    const r = await fetch(`${API}/repos/${cfg.repo}/contents/${path}`, {
      method: opt.method || 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    if (r.status === 404 && !opt.method) return null;
    if (r.status === 401) throw new Error('トークンが正しくないか、期限が切れています');
    if (r.status === 403) throw new Error('トークンにこのリポジトリへの書き込み権限がありません（または回数制限）');
    if (r.status === 404) throw new Error('リポジトリが見つかりません（名前とトークンの対象を確認してください）');
    if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
    return r.json();
  }

  /* ---------- 写真は別ファイルにする ---------- */
  // 記録の中の data:image/... を sfimg:<ハッシュ>.<拡張子> に置き換え、写真は imgs に集める
  function packImages(data, imgs) {
    const walk = (v) => {
      if (isDataUrl(v)) {
        const m = /^data:image\/(\w+)/.exec(v); const ext = m ? m[1].replace('jpeg', 'jpg') : 'png';
        const name = `${hash(v)}.${ext}`; imgs[name] = v; return IMG + name;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = walk(v[k]); }); return o; }
      return v;
    };
    return walk(data);
  }
  function refs(data, out) {
    const walk = (v) => {
      if (typeof v === 'string' && v.startsWith(IMG)) out.add(v.slice(IMG.length));
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(data); return out;
  }
  function unpackImages(data, have) {
    const walk = (v) => {
      if (typeof v === 'string' && v.startsWith(IMG)) return have[v.slice(IMG.length)] || '';
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = walk(v[k]); }); return o; }
      return v;
    };
    return walk(data);
  }
  const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };

  /* ---------- そろえる ---------- */
  // local: { profile, outfit, prefs, closet: [], coords: [] }（写真は data URL のまま）
  // base: 前回そろえたときの { key: { id: { h, t } } }
  // remote: リポジトリの sync.json（写真は sfimg: 参照）
  function merge(local, base, remote, now) {
    const out = { v: 1, updatedAt: now };
    const nextBase = {};
    const changed = { local: false, remote: false };
    const imgs = {};
    const recs = (key) => {
      if (SINGLE.includes(key)) return local[key] != null ? { _: local[key] } : {};
      const o = {}; (local[key] || []).forEach((x) => { if (x && x.id) o[x.id] = x; }); return o;
    };
    [...SINGLE, ...LISTS].forEach((key) => {
      const L = recs(key); const B = (base && base[key]) || {}; const Rm = (remote && remote[key]) || {};
      const res = {}; nextBase[key] = {};
      const ids = new Set([...Object.keys(L), ...Object.keys(B), ...Object.keys(Rm)]);
      ids.forEach((id) => {
        const packed = L[id] != null ? packImages(L[id], imgs) : null;
        const lh = packed != null ? hash(stable(packed)) : null;
        const b = B[id]; const r = Rm[id];
        const localChanged = b ? lh !== b.h : lh != null;
        const remoteChanged = r ? (!b || r.t > b.t) : false;
        let pick;
        // この端末で初めてそろえるときは、体のデータ・服装・設定はリポジトリ側を優先する（空の初期値で上書きしない）
        if (!b && r && SINGLE.includes(key)) pick = { d: r.d, t: r.t };
        else if (localChanged && (!remoteChanged || now >= r.t)) pick = { d: packed, t: now };
        else if (remoteChanged) pick = { d: r.d, t: r.t };
        else if (b) pick = { d: packed, t: b.t };
        else return;
        res[id] = pick;
        const ph = pick.d != null ? hash(stable(pick.d)) : null;
        nextBase[key][id] = { h: ph, t: pick.t };
        if (ph !== lh) changed.local = true;
        if (!r || r.t !== pick.t || (r.d == null ? null : hash(stable(r.d))) !== ph) changed.remote = true;
      });
      out[key] = res;
    });
    return { doc: out, nextBase, changed, imgs };
  }
  // そろえた結果 → 手元に保存する形（消した記録は外す・写真は data URL に戻す）
  function toLocal(doc, have) {
    const o = {};
    SINGLE.forEach((key) => { const r = doc[key] && doc[key]._; if (r && r.d != null) o[key] = unpackImages(r.d, have); });
    LISTS.forEach((key) => {
      const list = Object.values(doc[key] || {}).filter((r) => r.d != null).map((r) => unpackImages(r.d, have));
      list.sort((a, b) => (a.created || 0) - (b.created || 0));
      o[key] = list;
    });
    return o;
  }

  // adapter: { read(): Promise<local>, write(local): Promise, cfg(): Promise<{repo, token}>, base(): Promise, saveBase(b), status(s) }
  function create(adapter) {
    let running = null; let again = false; let timer = 0;
    async function run(reason) {
      const cfg = await adapter.cfg();
      if (!cfg || !cfg.repo || !cfg.token || cfg.enabled === false) return { skipped: true };
      for (let attempt = 0; attempt < 4; attempt++) {
        const now = Date.now();
        const local = await adapter.read();
        const base = (await adapter.base()) || {};
        const file = await gh(cfg, FILE);
        const remote = file ? JSON.parse(b64decode(file.content)) : null;
        const { doc, nextBase, changed, imgs } = merge(local, base, remote, now);
        // 写真: 必要なのにリポジトリにないものを上げ、手元にないものを下ろす
        const need = new Set(); [...SINGLE, ...LISTS].forEach((k) => Object.values(doc[k] || {}).forEach((r) => { if (r.d != null) refs(r.d, need); }));
        const have = Object.assign({}, imgs);
        let listing = null;
        const remoteNames = async () => { if (!listing) { const l = await gh(cfg, 'img'); listing = new Set((l || []).map((x) => x.name)); } return listing; };
        if (changed.remote) {
          const names = await remoteNames();
          for (const name of need) {
            if (names.has(name) || !imgs[name]) continue;
            await gh(cfg, `img/${name}`, { method: 'PUT', body: { message: '写真を追加', content: imgs[name].split(',')[1] } });
            names.add(name);
          }
        }
        for (const name of need) {
          if (have[name]) continue;
          const cached = adapter.image ? await adapter.image(name) : null;
          if (cached) { have[name] = cached; continue; }
          const f = await gh(cfg, `img/${name}`);
          if (f && f.content) have[name] = `data:${MIME[name.split('.').pop()] || 'image/png'};base64,${f.content.replace(/\s/g, '')}`;
        }
        if (changed.remote) {
          try {
            await gh(cfg, FILE, { method: 'PUT', body: { message: `同期 ${new Date(now).toISOString()}（${reason || '自動'}）`, content: b64encode(JSON.stringify(doc)), ...(file ? { sha: file.sha } : {}) } });
          } catch (e) { if (e.conflict) continue; throw e; }
        }
        if (changed.local) await adapter.write(toLocal(doc, have));
        await adapter.saveBase(nextBase);
        return { ok: true, pulled: changed.local, pushed: changed.remote };
      }
      throw new Error('ほかの端末と同時に保存したため、そろえられませんでした。少し待ってからもう一度お試しください');
    }
    async function syncNow(reason) {
      if (running) { again = true; return running; }
      running = (async () => {
        try {
          const res = await run(reason);
          if (!res.skipped) await adapter.status({ ok: true, at: Date.now(), pulled: res.pulled, pushed: res.pushed });
          return res;
        } catch (e) {
          await adapter.status({ ok: false, at: Date.now(), error: String((e && e.message) || e) });
          return { ok: false, error: String((e && e.message) || e) };
        } finally {
          running = null;
          if (again) { again = false; schedule(2000); }
        }
      })();
      return running;
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => syncNow('変更'), ms == null ? 4000 : ms); }
    return { syncNow, schedule };
  }

  // 書き出し・読み込み用（ファイル 1 つにまとめる）
  function exportDoc(local) { return { app: 'silhouette-fit', v: 1, exportedAt: new Date().toISOString(), data: local }; }
  function importDoc(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!o || o.app !== 'silhouette-fit' || !o.data) throw new Error('シルエット試着の書き出しファイルではありません');
    return o.data;
  }

  G.SFSync = { create, merge, exportDoc, importDoc, KEYS: [...SINGLE, ...LISTS] };
})(typeof globalThis !== 'undefined' ? globalThis : self);
