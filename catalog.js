/* シルエット試着 catalog: 服の種類・プリセット・色と素材の辞書・体のデータの整え方 */
(function (G) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 体のデータ ---------- */
  const FIELDS = [
    { k: 'height', label: '身長', hint: '裸足でまっすぐ立ち、床から頭のてっぺんまで', color: '#6C63FF' },
    { k: 'shoulder', label: '肩幅', hint: '背中側で、左右の肩先の骨のあいだ', color: '#FF7A59' },
    { k: 'chest', label: '胸囲・バスト', hint: '胸のいちばん高いところを、床と平行に一周', color: '#F5A524' },
    { k: 'waist', label: 'ウエスト', hint: 'おへその少し上、胴のいちばん細いところを一周', color: '#17B897' },
    { k: 'hip', label: 'ヒップ', hint: 'お尻のいちばん高いところを一周', color: '#A855F7' },
    { k: 'arm', label: '腕の長さ', hint: '腕を下ろし、肩先から手首のぐりぐりまで', color: '#3B9EFF' },
    { k: 'inseam', label: '股下', hint: '股の付け根から床まで（内側をまっすぐ）', color: '#F0507C' },
  ];
  const RATIO = {
    m: { shoulder: 0.245, chest: 0.535, waist: 0.455, hip: 0.54, arm: 0.33, inseam: 0.45 },
    f: { shoulder: 0.235, chest: 0.53, waist: 0.42, hip: 0.57, arm: 0.32, inseam: 0.445 },
  };
  RATIO.n = {};
  Object.keys(RATIO.m).forEach((k) => { RATIO.n[k] = (RATIO.m[k] + RATIO.f[k]) / 2; });
  const DEFAULT_H = { m: 171, f: 158, n: 165 };
  // 見た目に使う値は、身長から見た平均の範囲に収める（極端な入力でも人の形を保つ）
  const RANGE = { shoulder: [0.85, 1.2], chest: [0.78, 1.5], waist: [0.72, 1.65], hip: [0.8, 1.45], arm: [0.9, 1.1], inseam: [0.9, 1.1] };

  function normalizeProfile(p) {
    p = p || {};
    const sex = RATIO[p.sex] ? p.sex : 'n';
    const has = (k) => p[k] != null && p[k] !== '' && isFinite(p[k]) && +p[k] > 0;
    const height = has('height') ? clamp(+p.height, 120, 215) : DEFAULT_H[sex];
    const fit = { height }; const geo = { height }; const pred = { height: DEFAULT_H[sex] };
    Object.keys(RATIO[sex]).forEach((k) => {
      const pv = RATIO[sex][k] * height;
      pred[k] = Math.round(pv * 10) / 10;
      fit[k] = has(k) ? +p[k] : pred[k];
      const c = has(k) ? clamp(+p[k], pv * RANGE[k][0], pv * RANGE[k][1]) : pv;
      geo[k] = c * 0.9 + pv * 0.1;
    });
    const filled = {};
    FIELDS.forEach((f) => { filled[f.k] = has(f.k); });
    const count = FIELDS.filter((f) => filled[f.k]).length;
    return { sex, fit, geo, pred, filled, count, skin: p.skin || null };
  }

  /* ---------- 服の種類 ---------- */
  const CATS = {
    underBottom: { label: '肌着（パンツ）', short: '肌着', group: 'bottom', rank: 0, thick: 0.12, fabric: 'rib' },
    underTop: { label: '肌着（シャツ）', short: '肌着', group: 'top', rank: 1, thick: 0.15, fabric: 'rib' },
    jeans: { label: 'ジーンズ', short: 'ジーンズ', group: 'bottom', rank: 2, thick: 0.45, fabric: 'denim' },
    pants: { label: 'パンツ', short: 'パンツ', group: 'bottom', rank: 2, thick: 0.35, fabric: 'twill' },
    shorts: { label: 'ショートパンツ', short: 'ショーツ', group: 'bottom', rank: 2, thick: 0.35, fabric: 'twill' },
    skirt: { label: 'スカート', short: 'スカート', group: 'skirt', rank: 2, thick: 0.3, fabric: 'twill' },
    tee: { label: 'Tシャツ', short: 'Tシャツ', group: 'top', rank: 3, thick: 0.25, fabric: 'jersey' },
    shirt: { label: 'シャツ', short: 'シャツ', group: 'top', rank: 4, thick: 0.25, fabric: 'woven' },
    knit: { label: 'ニット', short: 'ニット', group: 'top', rank: 5, thick: 0.7, fabric: 'knit' },
    hoodie: { label: 'パーカー・スウェット', short: 'パーカー', group: 'top', rank: 5, thick: 0.8, fabric: 'jersey' },
    outer: { label: 'アウター', short: 'アウター', group: 'top', rank: 6, thick: 1.1, fabric: 'nylon' },
    shoes: { label: '靴', short: '靴', group: 'shoes', rank: 7, thick: 0.5, fabric: 'canvas' },
  };

  // スタイル: 体の寸法に足すゆとり（cm）や丈の位置で形を決める
  // top: ease=胸囲ゆとり, sh=肩幅の差, hem=裾の位置, sleeve=袖（腕の長さに対する割合）, neck=首まわり
  // bottom: waist/hip/thigh=ゆとり, hem=裾まわり（knee=ひざと同じ, 数値=足首まわりの倍率）, inseam=股下（null=体に合わせる）, rise=股上
  const STYLES = {
    underTop: {
      crew: { label: '丸首', ease: 2, sh: 0, hem: 'hip', sleeve: 0.27, neck: 'crew' },
      vneck: { label: 'V首', ease: 2, sh: 0, hem: 'hip', sleeve: 0.27, neck: 'v', vDepth: 14 },
      tank: { label: 'タンクトップ', ease: 1, sh: 0, hem: 'hip', sleeve: 0, neck: 'tank' },
    },
    underBottom: {
      boxer: { label: 'ボクサー', waist: -2, hip: -1, thigh: -1, inseam: 9, rise: 'mid' },
      trunks: { label: 'トランクス', waist: -2, hip: 10, thigh: 12, inseam: 11, rise: 'mid', fabric: 'woven' },
      briefs: { label: 'ブリーフ', waist: -2, hip: -1, thigh: 0, inseam: 1.5, rise: 'low' },
    },
    tee: {
      crew: { label: 'クルーネック', ease: 12, sh: 2, hem: 'hipLow', sleeve: 0.37, neck: 'crew' },
      vneck: { label: 'Vネック', ease: 10, sh: 1, hem: 'hipLow', sleeve: 0.35, neck: 'v', vDepth: 10 },
      slim: { label: 'スリム', ease: 5, sh: 0, hem: 'hip', sleeve: 0.33, neck: 'crew' },
      oversized: { label: 'オーバーサイズ', ease: 30, sh: 12, hem: 'crotchLow', sleeve: 0.5, neck: 'crew' },
      longsleeve: { label: 'ロンT', ease: 12, sh: 2, hem: 'hipLow', sleeve: 1.02, neck: 'crew' },
    },
    shirt: {
      regular: { label: 'レギュラー', ease: 16, sh: 2, hem: 'crotch', sleeve: 1.03, neck: 'collar' },
      short: { label: '半袖', ease: 16, sh: 2, hem: 'crotch', sleeve: 0.4, neck: 'collar' },
    },
    knit: {
      crew: { label: 'クルーネック', ease: 14, sh: 4, hem: 'hipLow', sleeve: 1.0, neck: 'crew' },
    },
    hoodie: {
      hoodie: { label: 'パーカー', ease: 22, sh: 6, hem: 'hipLow', sleeve: 1.0, neck: 'hood' },
      sweat: { label: 'スウェット', ease: 20, sh: 6, hem: 'hipLow', sleeve: 1.0, neck: 'crew' },
    },
    outer: {
      jacket: { label: 'ジャケット', ease: 20, sh: 3, hem: 'crotchLow', sleeve: 1.03, neck: 'collar' },
      coat: { label: 'コート', ease: 24, sh: 4, hem: 'knee', sleeve: 1.04, neck: 'collar' },
    },
    jeans: {
      skinny: { label: 'スキニー', waist: 1, hip: 3, thigh: 2, hem: 1.25, inseam: null, rise: 'mid' },
      slim: { label: 'スリム', waist: 2, hip: 5, thigh: 6, hem: 1.6, inseam: null, rise: 'mid' },
      straight: { label: 'ストレート', waist: 2, hip: 8, thigh: 11, hem: 'knee', inseam: null, rise: 'mid' },
      wide: { label: 'ワイド', waist: 2, hip: 14, thigh: 24, hem: 'wide', inseam: null, rise: 'high' },
    },
    pants: {
      straight: { label: 'ストレート', waist: 2, hip: 8, thigh: 10, hem: 'knee', inseam: null, rise: 'mid' },
      wide: { label: 'ワイド', waist: 2, hip: 14, thigh: 24, hem: 'wide', inseam: null, rise: 'high' },
    },
    shorts: {
      regular: { label: 'ひざ上', waist: 2, hip: 8, thigh: 12, hem: 'wide', inseam: 18, rise: 'mid' },
    },
    skirt: {
      aline: { label: 'Aライン', waist: 1, hip: 8, flare: 1.45, length: 'knee', rise: 'high' },
      tight: { label: 'タイト', waist: 1, hip: 3, flare: 1.02, length: 'knee', rise: 'high' },
      long: { label: 'ロング', waist: 1, hip: 10, flare: 1.6, length: 'long', rise: 'high' },
    },
    shoes: {
      sneaker: { label: 'スニーカー', sole: 2.6, collar: 2.5, fabric: 'canvas', sole2: '#F1EFE9' },
      runner: { label: 'ランニング', sole: 3.4, collar: 3.5, fabric: 'mesh', sole2: '#E9E7E2' },
      boots: { label: 'ブーツ', sole: 3.2, collar: 15, fabric: 'leather', sole2: '#2B2623' },
      loafer: { label: 'ローファー', sole: 1.6, collar: -1, fabric: 'leather', sole2: '#3A2A20' },
    },
  };

  const PALETTE = {
    under: [['#F5F5F2', 'ホワイト'], ['#A7A9AD', 'グレー'], ['#3A3C41', 'チャコール'], ['#1D1D1F', 'ブラック'], ['#24324F', 'ネイビー'], ['#D9CBB0', 'ベージュ']],
    tee: [['#F5F5F2', 'ホワイト'], ['#1D1D1F', 'ブラック'], ['#A9ABAE', '杢グレー'], ['#22304D', 'ネイビー'], ['#66704A', 'オリーブ'], ['#D9CBB0', 'ベージュ'], ['#B23A35', 'レッド'], ['#A9C8E8', 'サックス']],
    jeans: [['#1F2C4F', 'ワンウォッシュ'], ['#3E5C8A', '中色'], ['#8DA9CC', 'ライト'], ['#232427', 'ブラック'], ['#6E7176', 'グレー'], ['#ECEAE4', 'ホワイト']],
    shoes: [['#F4F3EF', 'ホワイト'], ['#1E1E20', 'ブラック'], ['#6B4630', 'ブラウン'], ['#24324F', 'ネイビー'], ['#B23A35', 'レッド'], ['#8E9094', 'グレー'], ['#D8C7A8', 'ベージュ']],
  };

  // プリセット（ベーシック）。クローゼットに最初から入っている
  const PRESET_GROUPS = [
    { id: 'under', label: '肌着', items: [['underBottom', 'boxer'], ['underBottom', 'trunks'], ['underBottom', 'briefs'], ['underTop', 'crew'], ['underTop', 'vneck'], ['underTop', 'tank']], palette: 'under' },
    { id: 'tee', label: 'Tシャツ', items: [['tee', 'crew'], ['tee', 'vneck'], ['tee', 'slim'], ['tee', 'oversized'], ['tee', 'longsleeve']], palette: 'tee' },
    { id: 'jeans', label: 'ジーンズ', items: [['jeans', 'skinny'], ['jeans', 'slim'], ['jeans', 'straight'], ['jeans', 'wide']], palette: 'jeans' },
    { id: 'shoes', label: '靴', items: [['shoes', 'sneaker'], ['shoes', 'runner'], ['shoes', 'boots'], ['shoes', 'loafer']], palette: 'shoes' },
  ];
  const paletteFor = (cat) => PALETTE[cat === 'underTop' || cat === 'underBottom' ? 'under' : cat === 'jeans' || cat === 'pants' || cat === 'shorts' || cat === 'skirt' ? 'jeans' : cat === 'shoes' ? 'shoes' : 'tee'];

  const FABRICS = {
    jersey: '天竺（Tシャツ生地）', rib: 'リブ', denim: 'デニム', twill: 'ツイル（チノ）', woven: 'ブロード（シャツ生地）',
    knit: 'ニット', wool: 'ウール', linen: 'リネン', nylon: 'ナイロン', leather: 'レザー', canvas: 'キャンバス', mesh: 'メッシュ',
  };

  /* ---------- 推定（商品名・ページの文章から） ---------- */
  const COLOR_WORDS = [
    [/オフホワイト|off\s*white|エクリュ|ecru/i, '#EEE9DF'], [/アイボリー|ivory/i, '#F1EBDD'], [/クリーム|cream/i, '#F3E6C4'],
    [/ホワイト|白|white/i, '#F4F4F2'], [/チャコール|charcoal/i, '#3D3F44'], [/杢グレー|ヘザー|heather/i, '#A9ABAE'],
    [/ライトグレー|light\s*gr[ae]y/i, '#BFC1C5'], [/グレー|グレイ|灰|gr[ae]y/i, '#8C8F94'], [/ブラック|黒|black/i, '#1E1E20'],
    [/ネイビー|紺|navy/i, '#1F2A44'], [/インディゴ|indigo|ワンウォッシュ|リジッド|raw/i, '#24325A'],
    [/ライトブルー|サックス|水色|light\s*blue|sky/i, '#9CC3E6'], [/ブルー|青|blue/i, '#2F5FA8'],
    [/ベージュ|beige|サンド|sand/i, '#D8C7A8'], [/キャメル|camel/i, '#B78A57'], [/モカ|mocha/i, '#8B6B55'],
    [/ブラウン|茶|brown/i, '#6B4A35'], [/カーキ|khaki/i, '#7A7550'], [/オリーブ|olive/i, '#5E6B3A'],
    [/ミント|mint/i, '#A8D8C4'], [/グリーン|緑|green/i, '#2F6B47'], [/ボルドー|ワイン|bordeaux|burgundy|wine/i, '#6A1E2D'],
    [/レッド|赤|red/i, '#B5332E'], [/ピンク|pink/i, '#E7A3B4'], [/ラベンダー|lavender/i, '#B9A9D9'], [/パープル|紫|purple/i, '#6B4C8A'],
    [/イエロー|黄|yellow|マスタード|mustard/i, '#E2B93B'], [/オレンジ|orange/i, '#E07B39'],
  ];
  function colorFromText(t) {
    t = String(t || '');
    for (const [re, hex] of COLOR_WORDS) if (re.test(t)) return hex;
    return null;
  }

  const CAT_RULES = [
    [/ボクサー|トランクス|ブリーフ|アンダーウェア|下着|underwear|boxer|brief/i, 'underBottom', (t) => (/トランクス|trunks/i.test(t) ? 'trunks' : /ブリーフ|brief/i.test(t) ? 'briefs' : 'boxer')],
    [/インナー|肌着|アンダーシャツ|タンクトップ|キャミソール|tank\s*top|undershirt/i, 'underTop', (t) => (/タンク|キャミ|tank/i.test(t) ? 'tank' : /v\s*ネック|v首|v-neck/i.test(t) ? 'vneck' : 'crew')],
    [/パーカー|フーディ|フーディー|hoodie|parka/i, 'hoodie', () => 'hoodie'],
    [/スウェット|トレーナー|sweatshirt/i, 'hoodie', () => 'sweat'],
    [/ニット|セーター|カーディガン|knit|sweater|cardigan/i, 'knit', () => 'crew'],
    [/ジャケット|コート|ブルゾン|アウター|ダウン|ジャンパー|jacket|coat|blouson|outer/i, 'outer', (t) => (/コート|coat/i.test(t) ? 'coat' : 'jacket')],
    [/ロンT|ロンティー|長袖\s*T|ロングスリーブ|long\s*sleeve/i, 'tee', () => 'longsleeve'],
    [/Tシャツ|ティーシャツ|カットソー|t-?shirt|\btee\b/i, 'tee', (t) => (/オーバーサイズ|ビッグ|ルーズ|oversize|big|loose/i.test(t) ? 'oversized' : /v\s*ネック|v-neck/i.test(t) ? 'vneck' : /スリム|slim|タイト/i.test(t) ? 'slim' : 'crew')],
    [/シャツ|ブラウス|shirt|blouse/i, 'shirt', (t) => (/半袖|short\s*sleeve/i.test(t) ? 'short' : 'regular')],
    [/ジーンズ|ジーパン|デニムパンツ|デニム|jeans|denim/i, 'jeans', (t) => (/スキニー|skinny/i.test(t) ? 'skinny' : /ワイド|バギー|wide|baggy/i.test(t) ? 'wide' : /スリム|テーパード|slim|taper/i.test(t) ? 'slim' : 'straight')],
    [/ショートパンツ|ハーフパンツ|ショーツ|短パン|shorts/i, 'shorts', () => 'regular'],
    [/スカート|skirt/i, 'skirt', (t) => (/タイト|ペンシル|tight|pencil/i.test(t) ? 'tight' : /ロング|マキシ|long|maxi/i.test(t) ? 'long' : 'aline')],
    [/パンツ|スラックス|チノ|トラウザー|ボトムス|pants|trousers|slacks|chino/i, 'pants', (t) => (/ワイド|wide/i.test(t) ? 'wide' : 'straight')],
    [/ブーツ|boots?/i, 'shoes', () => 'boots'],
    [/ローファー|革靴|ドレスシューズ|loafer/i, 'shoes', () => 'loafer'],
    [/ランニング|running|runner/i, 'shoes', () => 'runner'],
    [/スニーカー|シューズ|靴|sneaker|shoes?/i, 'shoes', () => 'sneaker'],
  ];
  function guessCategory(text, fromTable) {
    const t = String(text || '');
    for (const [re, cat, st] of CAT_RULES) if (re.test(t)) return { cat, style: st(t), sure: true };
    if (fromTable === 'pants') return { cat: 'pants', style: 'straight', sure: false };
    if (fromTable === 'skirt') return { cat: 'skirt', style: 'aline', sure: false };
    return { cat: 'tee', style: 'crew', sure: false };
  }
  const FABRIC_RULES = [
    [/デニム|denim/i, 'denim'], [/レザー|革|leather/i, 'leather'], [/ウール|カシミ|wool|cashmere/i, 'wool'],
    [/リネン|麻|linen/i, 'linen'], [/ナイロン|nylon/i, 'nylon'], [/メッシュ|mesh/i, 'mesh'], [/キャンバス|canvas/i, 'canvas'],
  ];
  function guessFabric(text, cat) {
    const t = String(text || '');
    for (const [re, f] of FABRIC_RULES) if (re.test(t)) {
      if (f === 'denim' && (cat === 'shoes')) continue;
      return f;
    }
    if (cat === 'knit' && /コットン|綿|cotton/i.test(t)) return 'knit';
    return (CATS[cat] || CATS.tee).fabric;
  }

  function styleOf(cat, style) {
    const s = STYLES[cat] || STYLES.tee;
    return s[style] || s[Object.keys(s)[0]];
  }
  const firstStyle = (cat) => Object.keys(STYLES[cat] || STYLES.tee)[0];

  /* ---------- 読み取った数値の表（確認・修正用） ---------- */
  const M_LABEL = {
    shoulder: '肩幅', chest: '胸まわり', length: '着丈', sleeve: '袖丈', yuki: '裄丈', waist: 'ウエスト', hip: 'ヒップ',
    rise: '股上', inseam: '股下', thigh: 'わたり（一周）', hem: '裾まわり', height: '身長',
  };
  const M_ORDER = ['height', 'shoulder', 'chest', 'length', 'sleeve', 'yuki', 'waist', 'hip', 'rise', 'inseam', 'thigh', 'hem'];
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function convNote(size, k) {
    const r = size.src && size.src[k]; const v = size.m[k];
    if (!r || r.value == null || v == null) return '';
    const ratio = v / r.value;
    if (Math.abs(ratio - 2) < 0.02) return `表の「${r.label}」${r.value} ×2（平置き→一周）`;
    if (Math.abs(ratio - 2.54) < 0.03) return `表の「${r.label}」${r.value} インチ→cm`;
    if (Math.abs(ratio - 5.08) < 0.05) return `表の「${r.label}」${r.value} インチ ×2`;
    if (Math.abs(ratio - 1) > 0.01) return `表の「${r.label}」${r.value} から換算`;
    return String(r.label).replace(/\s/g, '') === M_LABEL[k] ? '' : `表の「${r.label}」`;
  }
  // sizes: [{ name, m, src }], sel: 選択中のサイズ番号
  function measureTable(sizes, sel) {
    const keys = M_ORDER.filter((k) => sizes.some((s) => s.m[k] != null));
    if (!keys.length) return '';
    const notes = keys.map((k) => { const s = sizes.find((x) => x.m[k] != null); return convNote(s, k); });
    return `<div class="mt-wrap"><table class="mt"><thead><tr><th scope="col">cm</th>${sizes.map((s, i) => `<th scope="col" class="${i === sel ? 'sel' : ''}">${escH(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${keys.map((k, r) => `<tr><th scope="row">${M_LABEL[k] || k}${notes[r] ? `<small>${escH(notes[r])}</small>` : ''}</th>${sizes.map((s, i) => `<td class="${i === sel ? 'sel' : ''}"><input type="number" inputmode="decimal" step="0.5" data-mt="${i}:${k}" value="${s.m[k] != null ? s.m[k] : ''}" aria-label="${escH(s.name)} ${M_LABEL[k] || k}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function applyMeasureEdit(sizes, key, value) {
    const [i, k] = String(key).split(':'); const s = sizes[+i]; if (!s) return false;
    const v = parseFloat(value);
    if (isFinite(v) && v > 0) s.m[k] = Math.round(v * 10) / 10; else delete s.m[k];
    if (k === 'yuki' && s.m.yuki != null) s.m.sleeve = Math.round((s.m.yuki - (s.m.shoulder != null ? s.m.shoulder / 2 : 20)) * 10) / 10;
    return true;
  }
  const MT_CSS = `.mt-wrap{overflow-x:auto;margin-top:8px;border:1px solid var(--line);border-radius:12px}
.mt{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
.mt th,.mt td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
.mt tbody tr:last-child th,.mt tbody tr:last-child td{border-bottom:0}
.mt thead th{font-weight:700;color:var(--muted)}
.mt th[scope=row]{text-align:left;font-weight:700;position:sticky;left:0;background:var(--bg,var(--card))}
.mt th small{display:block;font-weight:500;font-size:10px;color:var(--muted);white-space:normal;max-width:150px;line-height:1.35}
.mt .sel{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.mt thead th.sel{color:var(--ink)}
.mt input{width:54px;border:1px solid transparent;background:transparent;border-radius:6px;padding:3px 4px;text-align:right;font:inherit;color:inherit}
.mt input:hover,.mt input:focus{border-color:var(--line2);background:var(--bg,var(--card))}`;

  G.SFCatalog = {
    measureTable, applyMeasureEdit, MT_CSS,
    FIELDS, normalizeProfile, CATS, STYLES, PALETTE, PRESET_GROUPS, FABRICS, paletteFor,
    colorFromText, guessCategory, guessFabric, styleOf, firstStyle, COLOR_WORDS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
