// ECD Assina — assinatura digital de documentos (demonstração estática)
// ECD Tecnologia · github.com/Du-Edu-Duarte
import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
import { configureAuth, guard, authRoute, me, getConfig } from './ecd-auth.js';
configureAuth({ name: 'ECD Assina', tagline: 'Documentos assinados pelo celular, sem papel.', bullets: ['Envie Word ou PDF', 'Marque onde cada pessoa assina', 'Acompanhe tudo no painel'], home: '#/' });

/* ---------------- utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const COLORS = ['#c8952e', '#2f6fb0', '#1f8a5b', '#a3449b', '#c2412d', '#4b5563'];
const fmtD = t => t ? new Date(t).toLocaleDateString('pt-BR') : '';
const fmtDT = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const fmtDTs = t => t ? new Date(t).toLocaleString('pt-BR') : '';
const initials = n => (n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
const winSafe = s => String(s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF—–•…€]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); }
function device(ua = navigator.userAgent) {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} · ${os}`;
}
async function sha256(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
const codeOf = hash => hash.slice(0, 12).toUpperCase().match(/.{4}/g).join('-');
function download(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);

/* ---------------- banco (IndexedDB) ---------------- */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open('ecd-assina', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('docs', { keyPath: 'id' }); r.result.createObjectStore('files', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return _db;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); });
}
const DB = {
  all: () => tx('docs', 'readonly', s => s.getAll()),
  get: id => tx('docs', 'readonly', s => s.get(id)),
  put: doc => tx('docs', 'readwrite', s => s.put(doc)),
  del: id => Promise.all([tx('docs', 'readwrite', s => s.delete(id)), tx('files', 'readwrite', s => s.delete(id))]),
  file: id => tx('files', 'readonly', s => s.get(id)).then(r => r && r.pdf),
  putFile: (id, pdf) => tx('files', 'readwrite', s => s.put({ id, pdf })),
  clear: () => Promise.all([tx('docs', 'readwrite', s => s.clear()), tx('files', 'readwrite', s => s.clear())]),
};

/* ---------------- status ---------------- */
function statusOf(doc) {
  if (doc.draft) return { k: 'draft', t: 'Rascunho', c: 'b-mut' };
  const n = doc.signers.length, s = doc.signers.filter(x => x.signedAt).length;
  if (s < n) {
    const next = doc.signers.find(x => !x.signedAt);
    return s === 0 ? { k: 'sent', t: 'Aguardando assinaturas', c: 'b-info', next } : { k: 'prog', t: `Aguardando ${next.role || next.name}`, c: 'b-warn', next };
  }
  if (doc.items && doc.items.length && doc.items.every(i => i.returnedAt)) return { k: 'ret', t: 'Devolvido', c: 'b-mut' };
  return { k: 'done', t: 'Concluído', c: 'b-ok' };
}
const signLink = (doc, s) => `${location.origin}${location.pathname}#/assinar/${doc.id}/${s.id}/${s.token}`;
function waLink(doc, s) {
  const msg = `Olá, ${s.name.split(' ')[0]}! Segue o documento "${doc.title}" para você assinar pelo celular:\n${signLink(doc, s)}`;
  const ph = (s.phone || '').replace(/\D/g, '');
  return `https://wa.me/${ph ? (ph.length <= 11 ? '55' + ph : ph) : ''}?text=${encodeURIComponent(msg)}`;
}
const log = (doc, text) => { (doc.events ||= []).push({ at: Date.now(), text }); };

/* ---------------- pré-visualização (pdf.js) ---------------- */
const previewCache = new Map();
async function previews(id, bytes) {
  if (previewCache.has(id)) return previewCache.get(id);
  bytes ||= await DB.file(id);
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i); const vp1 = p.getViewport({ scale: 1 }); const scale = 1400 / vp1.width; const vp = p.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
    out.push({ src: c.toDataURL('image/jpeg', 0.9), w: vp1.width, h: vp1.height });
  }
  previewCache.set(id, out); return out;
}

/* ---------------- campos automáticos {{...}} ---------------- */
const FT = {
  assinatura: { label: 'Assinatura', hint: 'desenhada no celular', w: .30, h: .065 },
  nome: { label: 'Nome', hint: 'preenchido sozinho', w: .30, h: .026 },
  data: { label: 'Data', hint: 'dia da assinatura', w: .16, h: .026 },
  cpf: { label: 'CPF', hint: 'a pessoa digita', w: .20, h: .026 },
  texto: { label: 'Campo de texto', hint: 'a pessoa digita', w: .30, h: .026 },
  fixo: { label: 'Texto fixo', hint: 'você escreve agora', w: .30, h: .026 },
};
function placeholderToField(raw) {
  const m = raw.match(/^\{\{\s*([A-Za-zÀ-ú_ ]+?)\s*(\d?)\s*\}\}$/); if (!m) return null;
  let key = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '_');
  const idx = Math.max(0, (parseInt(m[2] || '1', 10) || 1) - 1);
  const map = { assinatura: 'assinatura', assinar: 'assinatura', nome: 'nome', data: 'data', cpf: 'cpf' };
  const type = map[key] || 'texto';
  const label = type === 'texto' ? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : FT[type].label;
  return { type, signerIdx: idx, label };
}

/* ---------------- Word (.docx) -> PDF no navegador ---------------- */
async function docxToPdf(arrayBuffer, onStep = () => {}) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = p => zip.file(p) ? zip.file(p).async('string') : Promise.resolve(null);
  const xml = s => s ? new DOMParser().parseFromString(s, 'application/xml') : null;
  const docX = xml(await read('word/document.xml'));
  if (!docX) throw new Error('Arquivo Word inválido.');
  const rels = {}; const relX = xml(await read('word/_rels/document.xml.rels'));
  relX && [...relX.getElementsByTagName('Relationship')].forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target'));
  const stylesX = xml(await read('word/styles.xml')); const numX = xml(await read('word/numbering.xml'));
  const W = (el, name) => el ? [...el.children].find(c => c.tagName === 'w:' + name) : null;
  const val = (el, attr = 'val') => el ? el.getAttribute('w:' + attr) : null;
  const tw = v => (parseFloat(v) || 0) / 15; // twips -> px
  // estilos
  const styles = {}; let defSz = 22, defFont = 'Calibri', defAfter = 10.6, defLine = 1.08;
  if (stylesX) {
    const dd = stylesX.getElementsByTagName('w:docDefaults')[0];
    if (dd) {
      const sz = dd.getElementsByTagName('w:sz')[0]; if (sz) defSz = +val(sz);
      const rf = dd.getElementsByTagName('w:rFonts')[0]; if (rf && val(rf, 'ascii')) defFont = val(rf, 'ascii');
      const sp = dd.getElementsByTagName('w:spacing')[0]; if (sp) { if (val(sp, 'after') != null) defAfter = tw(val(sp, 'after')); if (val(sp, 'line')) defLine = +val(sp, 'line') / 240; }
    }
    [...stylesX.getElementsByTagName('w:style')].forEach(st => {
      const id = val(st, 'styleId'); const name = (val(W(st, 'name')) || '').toLowerCase();
      const rpr = W(st, 'rPr'), ppr = W(st, 'pPr');
      styles[id] = { name, based: val(W(st, 'basedOn')), sz: rpr && W(rpr, 'sz') ? +val(W(rpr, 'sz')) : null, b: rpr && W(rpr, 'b') ? val(W(rpr, 'b')) !== '0' : null, color: rpr && W(rpr, 'color') ? val(W(rpr, 'color')) : null, jc: ppr && W(ppr, 'jc') ? val(W(ppr, 'jc')) : null, after: ppr && W(ppr, 'spacing') && val(W(ppr, 'spacing'), 'after') != null ? tw(val(W(ppr, 'spacing'), 'after')) : null, before: ppr && W(ppr, 'spacing') && val(W(ppr, 'spacing'), 'before') != null ? tw(val(W(ppr, 'spacing'), 'before')) : null };
    });
  }
  const sty = (id, k) => { let s = styles[id], g = 0; while (s && g++ < 8) { if (s[k] != null) return s[k]; s = styles[s.based]; } return null; };
  // numeração
  const numFmt = {}; if (numX) {
    const abs = {}; [...numX.getElementsByTagName('w:abstractNum')].forEach(a => { abs[val(a, 'abstractNumId')] = {}; [...a.getElementsByTagName('w:lvl')].forEach(l => abs[val(a, 'abstractNumId')][val(l, 'ilvl')] = val(W(l, 'numFmt'))); });
    [...numX.getElementsByTagName('w:num')].forEach(n => numFmt[val(n, 'numId')] = abs[val(W(n, 'abstractNumId'))] || {});
  }
  const counters = {};
  // página
  const sect = docX.getElementsByTagName('w:sectPr'); const sp = sect[sect.length - 1];
  const pgSz = sp && W(sp, 'pgSz'), pgMar = sp && W(sp, 'pgMar');
  const PW = pgSz ? tw(val(pgSz, 'w')) : 794, PH = pgSz ? tw(val(pgSz, 'h')) : 1123;
  const M = { t: pgMar ? tw(val(pgMar, 'top')) : 96, b: pgMar ? tw(val(pgMar, 'bottom')) : 96, l: pgMar ? tw(val(pgMar, 'left')) : 96, r: pgMar ? tw(val(pgMar, 'right')) : 96 };
  const fontStack = f => `'${f}', ${/times|garamond|georgia|cambria|book/i.test(f) ? "'Liberation Serif', 'Times New Roman', serif" : "Carlito, 'Liberation Sans', Arial, Helvetica, sans-serif"}`;

  async function runHTML(r, pStyle) {
    const rpr = W(r, 'rPr'); let css = '';
    const on = n => rpr && W(rpr, n) && val(W(rpr, n)) !== '0' && val(W(rpr, n)) !== 'false';
    const b = on('b') || (sty(pStyle, 'b') && !(rpr && W(rpr, 'b')));
    if (b) css += 'font-weight:700;'; if (on('i')) css += 'font-style:italic;';
    const u = rpr && W(rpr, 'u') && val(W(rpr, 'u')) !== 'none'; const st = on('strike');
    if (u || st) css += `text-decoration:${u ? 'underline' : ''} ${st ? 'line-through' : ''};`;
    const sz = rpr && W(rpr, 'sz') ? +val(W(rpr, 'sz')) : null; if (sz) css += `font-size:${sz / 2}pt;`;
    const col = rpr && W(rpr, 'color') && val(W(rpr, 'color')) !== 'auto' ? val(W(rpr, 'color')) : null; if (col) css += `color:#${col};`;
    const rf = rpr && W(rpr, 'rFonts'); if (rf && val(rf, 'ascii')) css += `font-family:${fontStack(val(rf, 'ascii'))};`;
    const shd = rpr && W(rpr, 'highlight'); if (shd) css += `background:${val(shd)};`;
    if (rpr && W(rpr, 'caps')) css += 'text-transform:uppercase;';
    if (rpr && W(rpr, 'vertAlign')) css += `vertical-align:${val(W(rpr, 'vertAlign')) === 'superscript' ? 'super' : 'sub'};font-size:smaller;`;
    let out = '';
    for (const c of r.children) {
      if (c.tagName === 'w:t') out += esc(c.textContent);
      else if (c.tagName === 'w:tab') out += '<span style="display:inline-block;width:48px"></span>';
      else if (c.tagName === 'w:br') out += val(c, 'type') === 'page' ? '<span data-pb="1"></span>' : '<br/>';
      else if (c.tagName === 'w:drawing' || c.tagName === 'w:pict') {
        const blip = c.getElementsByTagName('a:blip')[0] || c.getElementsByTagName('v:imagedata')[0];
        const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('r:id'));
        const target = rid && rels[rid]; const f = target && zip.file('word/' + target.replace(/^\.?\//, '').replace(/^word\//, ''));
        if (f) {
          const ext = (target.split('.').pop() || 'png').toLowerCase(); const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
          const b64 = await f.async('base64'); const ex = c.getElementsByTagName('wp:extent')[0];
          const w = ex ? +ex.getAttribute('cx') / 9525 : 200, h = ex ? +ex.getAttribute('cy') / 9525 : null;
          if (/png|jpeg|gif/.test(mime)) out += `<img src="data:${mime};base64,${b64}" style="width:${w}px;${h ? `height:${h}px;` : ''}vertical-align:bottom;max-width:100%"/>`;
        }
      }
    }
    return out ? (css ? `<span style="${css}">${out}</span>` : out) : '';
  }
  async function paraEl(p) {
    const ppr = W(p, 'pPr'); const pStyle = ppr && W(ppr, 'pStyle') ? val(W(ppr, 'pStyle')) : 'Normal';
    const sname = (styles[pStyle] || {}).name || '';
    let css = `margin:0;line-height:${defLine};`;
    const jc = (ppr && W(ppr, 'jc') ? val(W(ppr, 'jc')) : null) || sty(pStyle, 'jc');
    if (jc) css += `text-align:${jc === 'both' ? 'justify' : jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc};`;
    const spc = ppr && W(ppr, 'spacing');
    const after = spc && val(spc, 'after') != null ? tw(val(spc, 'after')) : (sty(pStyle, 'after') ?? defAfter);
    const before = spc && val(spc, 'before') != null ? tw(val(spc, 'before')) : (sty(pStyle, 'before') ?? 0);
    if (spc && val(spc, 'line') && (val(spc, 'lineRule') || 'auto') === 'auto') css = css.replace(/line-height:[^;]+;/, `line-height:${(+val(spc, 'line') / 240).toFixed(2)};`);
    css += `padding:${before}px 0 ${after}px 0;`;
    const ind = ppr && W(ppr, 'ind');
    if (ind) { const l = tw(val(ind, 'left') || val(ind, 'start')); const fl = tw(val(ind, 'firstLine')); const hg = tw(val(ind, 'hanging')); if (l) css += `padding-left:${l}px;`; if (fl) css += `text-indent:${fl}px;`; if (hg) css += `text-indent:-${hg}px;`; }
    const sz = sty(pStyle, 'sz'); const hd = /heading|t[ií]tulo|title/.test(sname);
    css += `font-size:${(sz || defSz) / 2}pt;`; if (hd) css += 'font-weight:700;';
    const col = sty(pStyle, 'color'); if (col && col !== 'auto') css += `color:#${col};`;
    const shd = ppr && W(ppr, 'shd'); if (shd && val(shd, 'fill') && val(shd, 'fill') !== 'auto') css += `background:#${val(shd, 'fill')};`;
    let pre = '';
    const np = ppr && W(ppr, 'numPr');
    if (np) {
      const id = val(W(np, 'numId')), lv = val(W(np, 'ilvl')) || '0'; const fmt = (numFmt[id] || {})[lv] || 'bullet';
      if (id !== '0') {
        if (fmt === 'bullet') pre = '•';
        else { const k = id + ':' + lv; counters[k] = (counters[k] || 0) + 1; Object.keys(counters).forEach(x => { if (x.startsWith(id + ':') && +x.split(':')[1] > +lv) delete counters[x]; }); const n = counters[k]; pre = fmt === 'lowerLetter' ? String.fromCharCode(96 + n) + ')' : fmt === 'upperLetter' ? String.fromCharCode(64 + n) + ')' : fmt === 'lowerRoman' ? ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] + '.' : n + '.'; }
        if (!ind) css += `padding-left:${24 + 24 * +lv}px;text-indent:-18px;`;
        pre = `<span style="display:inline-block;width:18px">${pre}</span>`;
      }
    }
    let inner = '';
    for (const c of p.children) {
      if (c.tagName === 'w:r') inner += await runHTML(c, pStyle);
      else if (c.tagName === 'w:hyperlink' || c.tagName === 'w:smartTag' || c.tagName === 'w:ins' || c.tagName === 'w:sdt') for (const r of c.getElementsByTagName('w:r')) inner += await runHTML(r, pStyle);
    }
    const el = document.createElement('div'); el.setAttribute('style', css); el.innerHTML = pre + (inner || '<br/>');
    if (ppr && W(ppr, 'pageBreakBefore')) el.dataset.pbb = '1';
    return el;
  }
  async function tableEl(t) {
    const tpr = W(t, 'tblPr'); const tstyle = tpr && W(tpr, 'tblStyle') ? val(W(tpr, 'tblStyle')) : '';
    const bord = tpr && W(tpr, 'tblBorders'); const hasB = /grid|grade|table/i.test(tstyle) || (bord && [...bord.children].some(b => val(b) && val(b) !== 'none' && val(b) !== 'nil'));
    const tb = document.createElement('table'); tb.setAttribute('style', `border-collapse:collapse;width:100%;table-layout:auto;margin:0 0 ${defAfter}px 0`);
    const jc = tpr && W(tpr, 'jc'); if (jc && val(jc) === 'center') tb.style.margin = `0 auto ${defAfter}px`;
    for (const tr of [...t.children].filter(c => c.tagName === 'w:tr')) {
      const row = document.createElement('tr');
      for (const tc of [...tr.children].filter(c => c.tagName === 'w:tc')) {
        const tcp = W(tc, 'tcPr'); const vm = tcp && W(tcp, 'vMerge');
        const td = document.createElement('td');
        const span = tcp && W(tcp, 'gridSpan') ? +val(W(tcp, 'gridSpan')) : 1; if (span > 1) td.colSpan = span;
        const w = tcp && W(tcp, 'tcW'); const shd = tcp && W(tcp, 'shd');
        let css = `vertical-align:top;padding:2px 6px;${hasB ? 'border:1px solid #000;' : ''}`;
        if (w && val(w, 'type') === 'dxa') css += `width:${tw(val(w, 'w'))}px;`;
        if (shd && val(shd, 'fill') && val(shd, 'fill') !== 'auto') css += `background:#${val(shd, 'fill')};`;
        if (vm && val(vm) !== 'restart') css += hasB ? 'border-top:0;' : '';
        const va = tcp && W(tcp, 'vAlign'); if (va) css += `vertical-align:${val(va) === 'center' ? 'middle' : val(va)};`;
        td.setAttribute('style', css);
        for (const c of tc.children) { if (c.tagName === 'w:p') { const pe = await paraEl(c); pe.style.paddingBottom = '0px'; td.appendChild(pe); } else if (c.tagName === 'w:tbl') td.appendChild(await tableEl(c)); }
        if (vm && val(vm) !== 'restart') td.innerHTML = '';
        row.appendChild(td);
      }
      tb.appendChild(row);
    }
    return tb;
  }
  onStep('Lendo o Word…');
  const body = docX.getElementsByTagName('w:body')[0]; const blocks = [];
  for (const c of body.children) { if (c.tagName === 'w:p') blocks.push(await paraEl(c)); else if (c.tagName === 'w:tbl') blocks.push(await tableEl(c)); }

  // marca {{campos}} (podem estar divididos em vários trechos)
  function markPH(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; let full = '';
    while (walker.nextNode()) { nodes.push({ n: walker.currentNode, s: full.length }); full += walker.currentNode.nodeValue; }
    const re = /\{\{[^{}]{1,40}\}\}/g; let m; const found = [];
    while ((m = re.exec(full))) found.push([m.index, m.index + m[0].length, m[0]]);
    for (const [a, b, raw] of found.reverse()) {
      const loc = pos => { for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].s <= pos) return [nodes[i].n, pos - nodes[i].s]; };
      const [sn, so] = loc(a), [en, eo] = loc(b - 1);
      const rg = document.createRange(); rg.setStart(sn, so); rg.setEnd(en, eo + 1);
      rg.deleteContents(); const sp = document.createElement('span'); sp.className = 'ph'; sp.dataset.raw = raw;
      const f = placeholderToField(raw); const wpx = { assinatura: 230, nome: 230, cpf: 120, data: 90, texto: 170 }[f ? f.type : 'texto'];
      sp.style.cssText = `display:inline-block;width:${wpx}px;height:${f && f.type === 'assinatura' ? 62 : 1.25}${f && f.type === 'assinatura' ? 'px' : 'em'};vertical-align:bottom`; sp.textContent = '\u00a0'; rg.insertNode(sp);
    }
  }
  blocks.forEach(markPH);

  // paginação
  onStep('Montando as páginas…');
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;';
  document.body.appendChild(host);
  const baseCss = `font-family:${fontStack(defFont)};font-size:${defSz / 2}pt;color:#000;`;
  const pages = [];
  const newPage = () => { const pg = document.createElement('div'); pg.setAttribute('style', `width:${PW}px;height:${PH}px;background:#fff;position:relative;overflow:hidden;box-sizing:border-box;padding:${M.t}px ${M.r}px ${M.b}px ${M.l}px;${baseCss}`); const ct = document.createElement('div'); ct.setAttribute('style', 'width:100%;'); pg.appendChild(ct); host.appendChild(pg); pages.push(pg); return ct; };
  const avail = PH - M.t - M.b; let ct = newPage();
  const over = () => ct.scrollHeight > avail + 1;
  for (const bl of blocks) {
    if ((bl.dataset.pbb) && ct.children.length) ct = newPage();
    if (bl.tagName === 'TABLE') {
      ct.appendChild(bl); if (!over()) continue; ct.removeChild(bl);
      let shell = bl.cloneNode(false); ct.appendChild(shell);
      for (const row of [...bl.rows]) { shell.appendChild(row); if (over() && shell.rows.length > 1) { shell.removeChild(row); ct = newPage(); shell = bl.cloneNode(false); ct.appendChild(shell); shell.appendChild(row); } else if (over() && shell.rows.length === 1 && ct.children.length > 1) { shell.remove(); ct = newPage(); shell = bl.cloneNode(false); ct.appendChild(shell); shell.appendChild(row); } }
      continue;
    }
    ct.appendChild(bl);
    if (over() && ct.children.length > 1) { ct.removeChild(bl); ct = newPage(); ct.appendChild(bl); }
    if (bl.querySelector('[data-pb]')) ct = newPage();
  }
  if (pages.length > 1 && !pages[pages.length - 1].innerText.trim() && !pages[pages.length - 1].querySelector('img')) { pages.pop().remove(); }

  // campos detectados
  const fields = [];
  pages.forEach((pg, pi) => {
    const pr = pg.getBoundingClientRect();
    $$('.ph', pg).forEach(sp => {
      const f = placeholderToField(sp.dataset.raw); if (!f) return;
      const r = sp.getBoundingClientRect(); const d = FT[f.type];
      const w = r.width / PW, h = Math.max(r.height / PH, f.type === 'assinatura' ? 0 : d.h);
      const x = (r.left - pr.left) / PW, y = (r.top - pr.top) / PH + (r.height / PH - h) / 2;
      fields.push({ id: uid(6), page: pi, x: Math.max(0, Math.min(1 - w, x)), y: Math.max(0, Math.min(1 - h, y)), w, h, type: f.type, label: f.label, signerIdx: f.signerIdx });
    });
  });

  // rasteriza cada página (SVG foreignObject) e monta o PDF
  const out = await PDFDocument.create(); const ser = new XMLSerializer(); const S = 2;
  for (let i = 0; i < pages.length; i++) {
    onStep(`Convertendo página ${i + 1} de ${pages.length}…`);
    const xhtml = ser.serializeToString(pages[i]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}"><foreignObject x="0" y="0" width="${PW}" height="${PH}">${xhtml}</foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas'); c.width = PW * S; c.height = PH * S; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const jpg = await (await fetch(c.toDataURL('image/jpeg', 0.92))).arrayBuffer();
    const em = await out.embedJpg(jpg); const pw = PW * 0.75, ph = PH * 0.75; const page = out.addPage([pw, ph]);
    page.drawImage(em, { x: 0, y: 0, width: pw, height: ph });
  }
  host.remove();
  return { bytes: await out.save(), fields };
}

/* ---------------- PDF: detectar {{campos}} ---------------- */
async function detectPdfFields(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise; const fields = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i); const vp = p.getViewport({ scale: 1 }); const tc = await p.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.includes('{{')) continue;
      const re = /\{\{[^{}]{1,40}\}\}/g; let m;
      while ((m = re.exec(it.str))) {
        const f = placeholderToField(m[0]); if (!f) continue;
        const [a, b, , d, e, ff] = it.transform; const fs = Math.hypot(a, b) || Math.abs(d) || 10;
        const mc = (detectPdfFields._c ||= document.createElement('canvas').getContext('2d')); mc.font = '100px Arial, Helvetica, sans-serif';
        const tot = mc.measureText(it.str).width || 1, k = it.width / tot;
        const x0 = e + mc.measureText(it.str.slice(0, m.index)).width * k, wpt = mc.measureText(m[0]).width * k;
        const [vx, vy] = vp.convertToViewportPoint(x0, ff + fs * 0.9);
        const def = FT[f.type];
        const w = Math.max(wpt / vp.width, f.type === 'assinatura' ? def.w * 0.8 : 0.14), hRaw = (fs * 1.25) / vp.height, h = Math.max(hRaw, def.h);
        let y = vy / vp.height; if (f.type === 'assinatura') y = y + hRaw - h;
        fields.push({ id: uid(6), page: i - 1, x: vx / vp.width, y: Math.max(0, y), w, h, type: f.type, label: f.label, signerIdx: f.signerIdx, cover: { x: vx / vp.width - .002, y: vy / vp.height - .002, w: wpt / vp.width + .006, h: hRaw + .004 } });
      }
    }
  }
  return fields;
}

/* ---------------- modelo: termo de ferramentas ---------------- */
function wrap(text, font, size, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
async function buildTermoPdf(m) {
  const pdf = await PDFDocument.create(); const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, L = 48, R = W - 48; const ink = rgb(.08, .07, .04), gold = rgb(.886, .706, .329), mut = rgb(.42, .4, .36), line = rgb(.82, .79, .72), band = rgb(.96, .93, .87);
  const T = s => winSafe(s);
  let page, y; const fields = [];
  const header = (n, total) => {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: ink });
    page.drawRectangle({ x: 0, y: H - 78, width: W, height: 4, color: gold });
    page.drawText(T(m.empresa || 'Empresa'), { x: L, y: H - 36, size: 15, font: B, color: rgb(1, 1, 1) });
    page.drawText(T('Termo de Responsabilidade · Ferramentas e Equipamentos'), { x: L, y: H - 55, size: 9.5, font: F, color: rgb(.85, .8, .7) });
    page.drawText(T(`${m.codigo || 'TRM-001'}  ·  Página ${n} de ${total}`), { x: R - F.widthOfTextAtSize(T(`${m.codigo || 'TRM-001'}  ·  Página ${n} de ${total}`), 8.5), y: H - 36, size: 8.5, font: F, color: rgb(.85, .8, .7) });
    page.drawText(T('Documento gerado no ECD Assina · ECD Tecnologia'), { x: L, y: 26, size: 7.5, font: F, color: mut });
    y = H - 110;
  };
  const h2 = t => { page.drawText(T(t), { x: L, y, size: 11.5, font: B, color: ink }); y -= 6; page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .8, color: gold }); y -= 16; };
  const para = (t, size = 9.5) => { for (const ln of wrap(T(t), F, size, R - L)) { page.drawText(ln, { x: L, y, size, font: F, color: ink }); y -= size * 1.45; } y -= 6; };
  const kv = rows => {
    const lw = 92, rh = 19;
    rows.forEach(([k, v]) => {
      page.drawRectangle({ x: L, y: y - rh + 13, width: lw, height: rh, color: band, borderColor: line, borderWidth: .6 });
      page.drawRectangle({ x: L + lw, y: y - rh + 13, width: R - L - lw, height: rh, borderColor: line, borderWidth: .6 });
      page.drawText(T(k), { x: L + 7, y: y - 1, size: 8.5, font: B, color: mut }); page.drawText(T(v || '—'), { x: L + lw + 8, y: y - 1, size: 9.5, font: F, color: ink }); y -= rh;
    }); y -= 14;
  };
  header(1, 2);
  page.drawText(T('TERMO DE RESPONSABILIDADE'), { x: L, y, size: 17, font: B, color: ink }); y -= 20;
  page.drawText(T('Entrega e devolução de ferramentas e equipamentos'), { x: L, y, size: 11, font: F, color: mut }); y -= 30;
  h2('1. Objetivo');
  para(`Este termo formaliza a entrega, o uso e a devolução das ferramentas e equipamentos de propriedade da ${m.empresa || 'empresa'} ao colaborador identificado abaixo, estabelecendo as responsabilidades de cada parte durante todo o período em que os itens estiverem sob sua guarda.`);
  h2('2. Identificação do colaborador');
  kv([['Nome', m.nome], ['Função', m.funcao], ['Setor / Obra', m.setor], ['Gestor', m.gestor], ['Data de entrega', fmtD(m.dataEntrega || Date.now())]]);
  h2('3. Ferramentas e equipamentos entregues');
  const cols = [['Item', 30], ['Equipamento / ferramenta', 170], ['Marca / modelo', 110], ['Nº série / patrimônio', 100], ['Qtd.', 32], ['Estado', 57]];
  let x = L; page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 20, color: ink });
  cols.forEach(([t, w]) => { page.drawText(T(t), { x: x + 5, y: y, size: 7.8, font: B, color: rgb(1, 1, 1) }); x += w; }); y -= 20;
  (m.items || []).forEach((it, i) => {
    x = L; page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 20, color: i % 2 ? rgb(1, 1, 1) : rgb(.985, .975, .955), borderColor: line, borderWidth: .4 });
    [String(i + 1).padStart(2, '0'), it.equip, it.marca, it.serie, String(it.qtd || 1), it.estado || 'Bom'].forEach((v, k) => {
      let s = T(v || '—'); const mw = cols[k][1] - 9; while (s.length > 1 && F.widthOfTextAtSize(s, 8.8) > mw) s = s.slice(0, -2) + '…';
      page.drawText(s, { x: x + 5, y, size: 8.8, font: k === 1 ? B : F, color: ink }); x += cols[k][1];
    }); y -= 20;
  });
  header(2, 2);
  h2('4. Responsabilidades do colaborador');
  ['Utilizar as ferramentas e equipamentos somente para as atividades da empresa, conforme as normas de segurança e as orientações recebidas.',
    'Zelar pela guarda e conservação dos itens, comunicando imediatamente ao gestor qualquer dano, defeito, perda ou furto.',
    'Não emprestar, ceder ou retirar os itens do local de trabalho sem autorização do gestor.',
    'Devolver todos os itens em bom estado de conservação, ressalvado o desgaste natural de uso, ao término da atividade, da obra ou do contrato de trabalho.',
    'Em caso de dano por mau uso ou extravio por negligência, poderá haver apuração de responsabilidade conforme a legislação vigente e as políticas internas.'].forEach((t, i) => {
      const lines = wrap(T(t), F, 9.5, R - L - 18); page.drawText(`${i + 1}.`, { x: L, y, size: 9.5, font: B, color: gold });
      lines.forEach(ln => { page.drawText(ln, { x: L + 18, y, size: 9.5, font: F, color: ink }); y -= 14; }); y -= 5;
    });
  y -= 6; h2('5. Responsabilidades da empresa');
  para('Fornecer os itens em condições adequadas de uso, orientar sobre sua utilização correta e registrar a devolução, emitindo o histórico atualizado para o colaborador sempre que solicitado.');
  h2('6. Declaração e assinaturas');
  para('Declaro que recebi os itens relacionados neste termo, em perfeito estado, e que li e concordo com as responsabilidades aqui descritas.');
  y -= 10;
  const boxW = (R - L - 24) / 2, boxH = 128, top = y;
  [['Colaborador', m.nome, 0], ['Gestor responsável', m.gestor, 1]].forEach(([role, name, idx]) => {
    const bx = L + idx * (boxW + 24), by = top - boxH;
    page.drawRectangle({ x: bx, y: by, width: boxW, height: boxH, borderColor: line, borderWidth: .8, color: rgb(.995, .99, .975) });
    page.drawText(T(role.toUpperCase()), { x: bx + 12, y: top - 18, size: 8, font: B, color: gold });
    page.drawLine({ start: { x: bx + 12, y: by + 50 }, end: { x: bx + boxW - 12, y: by + 50 }, thickness: .8, color: ink });
    page.drawText(T('Nome:'), { x: bx + 12, y: by + 33, size: 8, font: B, color: mut });
    page.drawText(T('Data:'), { x: bx + 12, y: by + 15, size: 8, font: B, color: mut });
    const fx = v => v / W, fy = v => (H - v) / H;
    fields.push({ id: uid(6), page: 1, type: 'assinatura', label: 'Assinatura', signerIdx: idx, x: fx(bx + 14), y: fy(by + 50 + 58), w: (boxW - 28) / W, h: 56 / H });
    fields.push({ id: uid(6), page: 1, type: 'nome', label: 'Nome', signerIdx: idx, x: fx(bx + 42), y: fy(by + 33 + 11), w: (boxW - 54) / W, h: 15 / H });
    fields.push({ id: uid(6), page: 1, type: 'data', label: 'Data', signerIdx: idx, x: fx(bx + 42), y: fy(by + 15 + 11), w: 110 / W, h: 15 / H });
  });
  return { bytes: await pdf.save(), fields };
}

/* ---------------- PDF final (assinado + verificação) ---------------- */
async function buildFinal(doc) {
  const orig = await DB.file(doc.id); const pdf = await PDFDocument.load(orig);
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages(); const ink = rgb(.07, .17, .26);
  for (const f of doc.fields) {
    const pg = pages[f.page]; if (!pg) continue; const { width: W, height: H } = pg.getSize();
    if (f.cover && (f.value || f.type === 'fixo')) pg.drawRectangle({ x: f.cover.x * W, y: H - (f.cover.y + f.cover.h) * H, width: f.cover.w * W, height: f.cover.h * H, color: rgb(1, 1, 1) });
    if (!f.value) continue;
    const x = f.x * W, w = f.w * W, h = f.h * H, y = H - f.y * H - h;
    if (f.type === 'assinatura') {
      const png = await pdf.embedPng(await (await fetch(f.value)).arrayBuffer()); const s = Math.min(w / png.width, h / png.height);
      pg.drawImage(png, { x: x + (w - png.width * s) / 2, y: y + 1, width: png.width * s, height: png.height * s });
    } else {
      let size = Math.min(11, h * 0.68); let t = winSafe(f.value); while (size > 6 && F.widthOfTextAtSize(t, size) > w - 3) size -= .5;
      pg.drawText(t, { x: x + 2, y: y + (h - size * 0.72) / 2, size, font: F, color: ink });
    }
  }
  // página de verificação
  const W = 595.28, H = 841.89, L = 48, R = W - 48; const p = pdf.addPage([W, H]); const gold = rgb(.886, .706, .329), dk = rgb(.08, .07, .04), mut = rgb(.42, .4, .36), line = rgb(.85, .82, .75);
  const T = s => winSafe(s);
  p.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: dk }); p.drawRectangle({ x: 0, y: H - 78, width: W, height: 4, color: gold });
  p.drawText('ECD Assina', { x: L, y: H - 38, size: 16, font: B, color: rgb(1, 1, 1) });
  p.drawText(T('Página de verificação das assinaturas'), { x: L, y: H - 56, size: 9.5, font: F, color: rgb(.85, .8, .7) });
  let y = H - 112;
  p.drawText(T(doc.title), { x: L, y, size: 14, font: B, color: dk }); y -= 22;
  const kv = (k, v) => { p.drawText(T(k), { x: L, y, size: 8.5, font: B, color: mut }); p.drawText(T(v), { x: L + 150, y, size: 9.5, font: F, color: dk }); y -= 16; };
  kv('Código de verificação', codeOf(doc.hash)); kv('Documento', doc.fileName || doc.title); kv('Criado em', fmtDTs(doc.createdAt)); kv('Situação', statusOf(doc).t);
  p.drawText(T('Impressão digital do original (SHA-256)'), { x: L, y, size: 8.5, font: B, color: mut }); y -= 13;
  p.drawText(doc.hash, { x: L, y, size: 7.6, font: F, color: dk }); y -= 26;
  p.drawText(T('Assinaturas'), { x: L, y, size: 11.5, font: B, color: dk }); y -= 6; p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .8, color: gold }); y -= 18;
  for (const s of doc.signers) {
    const sig = doc.fields.find(f => f.signer === s.id && f.type === 'assinatura' && f.value);
    p.drawRectangle({ x: L, y: y - 58, width: R - L, height: 70, borderColor: line, borderWidth: .7 });
    p.drawText(T(s.name), { x: L + 12, y: y - 4, size: 10.5, font: B, color: dk });
    p.drawText(T(s.role || ''), { x: L + 12, y: y - 18, size: 8.5, font: F, color: mut });
    p.drawText(T(s.signedAt ? `Assinou em ${fmtDTs(s.signedAt)}` : 'Ainda não assinou'), { x: L + 12, y: y - 34, size: 8.5, font: F, color: s.signedAt ? rgb(.12, .54, .36) : rgb(.72, .47, .12) });
    if (s.device) p.drawText(T(`Aparelho: ${s.device}`), { x: L + 12, y: y - 47, size: 8, font: F, color: mut });
    if (sig) { const png = await pdf.embedPng(await (await fetch(sig.value)).arrayBuffer()); const sc = Math.min(150 / png.width, 50 / png.height); p.drawImage(png, { x: R - 12 - png.width * sc, y: y - 52, width: png.width * sc, height: png.height * sc }); }
    y -= 82;
  }
  if (doc.items && doc.items.some(i => i.returnedAt)) {
    y -= 4; p.drawText(T('Devolução de itens'), { x: L, y, size: 11.5, font: B, color: dk }); y -= 6; p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .8, color: gold }); y -= 16;
    doc.items.forEach(it => { p.drawText(T(`${it.equip} (${it.qtd || 1}) — ${it.returnedAt ? `devolvido em ${fmtD(it.returnedAt)} · ${it.returnState || 'Bom'}${it.returnObs ? ' · ' + it.returnObs : ''}` : 'em uso'}`), { x: L, y, size: 9, font: F, color: dk }); y -= 14; });
    y -= 10;
  }
  y -= 4; p.drawText(T('Histórico'), { x: L, y, size: 11.5, font: B, color: dk }); y -= 6; p.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .8, color: gold }); y -= 16;
  for (const e of (doc.events || []).slice(-14)) { if (y < 60) break; p.drawText(T(fmtDTs(e.at)), { x: L, y, size: 8.5, font: F, color: mut }); p.drawText(T(e.text), { x: L + 120, y, size: 8.5, font: F, color: dk }); y -= 13; }
  p.drawText(T('As assinaturas foram desenhadas na tela pelo próprio signatário, a partir de um link individual. Versão de demonstração da ECD Tecnologia.'), { x: L, y: 30, size: 7.5, font: F, color: mut });
  return pdf.save();
}

/* ---------------- assinatura (pad) ---------------- */
function signaturePad(title = 'Assine aqui') {
  return new Promise(resolve => {
    const md = $('#modal'); md.hidden = false; md.className = 'modal' + (innerWidth < 700 ? ' full' : '');
    md.innerHTML = `<div class="box"><div class="row between" style="margin-bottom:12px"><h2>${esc(title)}</h2><button class="btn sm" data-a="full">${innerWidth < 700 ? 'Janela' : 'Tela cheia'}</button></div>
      <div class="padwrap"><canvas></canvas><div class="base"></div><div class="hint">Desenhe sua assinatura com o dedo ou o mouse</div></div>
      <div class="row between" style="margin-top:14px"><button class="btn" data-a="clear">Limpar</button><div class="row"><button class="btn" data-a="cancel">Cancelar</button><button class="btn primary" data-a="ok" disabled>Usar assinatura</button></div></div></div>`;
    const cv = $('canvas', md), g = cv.getContext('2d'); let strokes = [], cur = null;
    const size = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; g.setTransform(d, 0, 0, d, 0, 0); draw(); };
    const draw = () => { g.clearRect(0, 0, cv.width, cv.height); g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#112c43'; g.lineWidth = 2.8; for (const s of strokes) { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (s.length === 1) g.lineTo(s[0][0] + .1, s[0][1]); g.stroke(); } $('[data-a=ok]', md).disabled = !strokes.length; $('.hint', md).style.opacity = strokes.length ? 0 : 1; };
    const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); draw(); };
    cv.onpointermove = e => { if (!cur) return; cur.push(pt(e)); draw(); };
    cv.onpointerup = cv.onpointercancel = () => cur = null;
    requestAnimationFrame(size);
    const close = v => { md.hidden = true; md.innerHTML = ''; resolve(v); };
    md.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'clear') { strokes = []; draw(); }
      if (a === 'cancel') close(null);
      if (a === 'full') { const sc = strokes.map(s => s.map(p => [p[0] / cv.clientWidth, p[1] / cv.clientHeight])); md.classList.toggle('full'); e.target.textContent = md.classList.contains('full') ? 'Janela' : 'Tela cheia'; requestAnimationFrame(() => { strokes = sc.map(s => s.map(p => [p[0] * cv.clientWidth, p[1] * cv.clientHeight])); size(); }); }
      if (a === 'ok') {
        const all = strokes.flat(); const pad = 8; const x0 = Math.min(...all.map(p => p[0])) - pad, y0 = Math.min(...all.map(p => p[1])) - pad, x1 = Math.max(...all.map(p => p[0])) + pad, y1 = Math.max(...all.map(p => p[1])) + pad;
        const k = 3, c = document.createElement('canvas'); c.width = (x1 - x0) * k; c.height = (y1 - y0) * k; const h = c.getContext('2d');
        h.scale(k, k); h.translate(-x0, -y0); h.lineCap = h.lineJoin = 'round'; h.strokeStyle = '#112c43'; h.lineWidth = 2.8;
        for (const s of strokes) { h.beginPath(); s.forEach((p, i) => i ? h.lineTo(p[0], p[1]) : h.moveTo(p[0], p[1])); if (s.length === 1) h.lineTo(s[0][0] + .1, s[0][1]); h.stroke(); }
        close(c.toDataURL('image/png'));
      }
    };
  });
}
function askText(title, label, value = '', extra = '') {
  return new Promise(resolve => {
    const md = $('#modal'); md.hidden = false; md.className = 'modal';
    md.innerHTML = `<form class="box" style="width:min(460px,100%)"><h2 style="margin-bottom:14px">${esc(title)}</h2><label class="f">${esc(label)}<input name="v" value="${esc(value)}" required></label>${extra}<div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn" data-a="cancel">Cancelar</button><button class="btn primary">Salvar</button></div></form>`;
    const f = $('form', md); setTimeout(() => f.v.focus(), 30);
    const close = v => { md.hidden = true; md.innerHTML = ''; resolve(v); };
    f.onsubmit = e => { e.preventDefault(); close(Object.fromEntries(new FormData(f))); };
    $('[data-a=cancel]', md).onclick = () => close(null);
  });
}
function confirmBox(title, text, ok = 'Confirmar') {
  return new Promise(resolve => {
    const md = $('#modal'); md.hidden = false; md.className = 'modal';
    md.innerHTML = `<div class="box" style="width:min(440px,100%)"><h2 style="margin-bottom:8px">${esc(title)}</h2><p class="mut">${esc(text)}</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-a="n">Cancelar</button><button class="btn dark" data-a="y">${esc(ok)}</button></div></div>`;
    md.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; md.hidden = true; md.innerHTML = ''; md.onclick = null; resolve(a === 'y'); };
  });
}

/* ---------------- telas ---------------- */
const view = () => $('#view');
const busy = msg => view().innerHTML = `<div class="busy"><div class="spin"></div><div id="busyMsg">${esc(msg)}</div></div>`;
const setBusy = msg => { const b = $('#busyMsg'); if (b) b.textContent = msg; };
let filter = 'all', query = '';

async function Painel() {
  const docs = (await DB.all()).sort((a, b) => b.createdAt - a.createdAt);
  const st = docs.map(d => [d, statusOf(d)]);
  const cnt = k => st.filter(([, s]) => k.includes(s.k)).length;
  const emUso = docs.filter(d => d.items && statusOf(d).k === 'done').reduce((a, d) => a + d.items.filter(i => !i.returnedAt).reduce((x, i) => x + (+i.qtd || 1), 0), 0);
  const rows = st.filter(([d, s]) => (filter === 'all' || (filter === 'pend' ? ['sent', 'prog'].includes(s.k) : filter === s.k)) && (!query || (d.title + ' ' + d.signers.map(x => x.name).join(' ')).toLowerCase().includes(query.toLowerCase())));
  view().innerHTML = `
  <div class="head"><div><div class="eyebrow">Painel</div><h1>Documentos e assinaturas</h1><p class="mut" style="margin:6px 0 0">Acompanhe quem já assinou e quem falta, sem papel e sem planilha.</p></div><a class="btn primary" href="#/novo">+ Novo documento</a></div>
  <div class="kpis">
    <div class="card kpi"><small>Documentos</small><b>${docs.length}</b></div>
    <div class="card kpi warn"><small>Aguardando assinatura</small><b>${cnt(['sent', 'prog'])}</b></div>
    <div class="card kpi ok"><small>Concluídos</small><b>${cnt(['done', 'ret'])}</b></div>
    <div class="card kpi info"><small>Ferramentas em uso</small><b>${emUso}</b></div>
  </div>
  <div class="row filters">
    ${[['all', 'Todos'], ['pend', 'Pendentes'], ['done', 'Concluídos'], ['ret', 'Devolvidos'], ['draft', 'Rascunhos']].map(([k, t]) => `<button class="chipbtn ${filter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}
    <input class="search" id="q" placeholder="Buscar por documento ou pessoa" value="${esc(query)}">
  </div>
  <div class="card" style="overflow:hidden">${rows.length ? `<table class="list"><thead><tr><th>Documento</th><th>Assinantes</th><th>Situação</th><th class="hide-m">Criado em</th></tr></thead><tbody>
    ${rows.map(([d, s]) => `<tr data-id="${d.id}"><td class="doc-t">${esc(d.title)}<small>${d.kind === 'termo' ? 'Termo de ferramentas' : esc(d.fileName || 'Documento')} · ${d.fields.length} campos</small></td>
      <td><div class="signers">${d.signers.map(x => `<span class="av ${x.signedAt ? 'done' : 'wait'}" style="background:${x.color}" title="${esc(x.name)} · ${x.signedAt ? 'assinou ' + fmtDT(x.signedAt) : 'pendente'}">${initials(x.name)}</span>`).join('')}</div></td>
      <td><span class="badge ${s.c}">${esc(s.t)}</span></td><td class="hide-m mut sm">${fmtD(d.createdAt)}</td></tr>`).join('')}
  </tbody></table>` : `<div class="empty">Nenhum documento aqui. <a href="#/novo">Criar o primeiro</a></div>`}</div>`;
  $$('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; Painel(); });
  const q = $('#q'); q.oninput = () => { query = q.value; clearTimeout(q._t); q._t = setTimeout(() => { Painel().then(() => { const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  $$('tr[data-id]').forEach(tr => tr.onclick = () => { const d = docs.find(x => x.id === tr.dataset.id); location.hash = d.draft ? `#/editar/${d.id}` : `#/doc/${d.id}`; });
}

function Novo() {
  view().innerHTML = `
  <div class="head"><div><div class="eyebrow">Novo documento</div><h1>Como você quer começar?</h1></div></div>
  <div class="choose">
    <div class="card opt" id="optUp"><div class="ic">📄</div><h2>Enviar um documento</h2><p class="mut" style="margin:0">Word (.docx) ou PDF. Depois é só arrastar onde cada pessoa assina e quais dados entram sozinhos.</p>
      <div class="drop" id="drop"><b>Arraste o arquivo aqui</b><br><span class="mut sm">ou clique para escolher · .docx ou .pdf</span><input type="file" id="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></div>
      <div class="tip"><b>Dica:</b> escreva no Word <code>{{nome}}</code>, <code>{{cpf}}</code>, <code>{{data}}</code> e <code>{{assinatura}}</code> onde quiser. O sistema já cria os campos nesses lugares. Para a 2ª pessoa use <code>{{assinatura2}}</code>, <code>{{nome2}}</code>…</div>
    </div>
    <a class="card opt" href="#/novo/termo" style="text-decoration:none"><div class="ic">🧰</div><h2>Termo de ferramentas e EPIs</h2><p class="mut" style="margin:0">Modelo pronto: preencha colaborador e itens, o termo é gerado com os campos de assinatura do colaborador e do gestor, e depois você registra a devolução.</p><span class="btn dark" style="align-self:flex-start;margin-top:auto">Usar modelo →</span></a>
  </div>`;
  const drop = $('#drop'), inp = $('#file');
  drop.onclick = () => inp.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); };
  inp.onchange = () => inp.files[0] && handleUpload(inp.files[0]);
}
async function handleUpload(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'; const isDocx = /\.docx$/i.test(file.name);
  if (!isPdf && !isDocx) { toast('Envie um arquivo .docx ou .pdf'); return; }
  busy(isPdf ? 'Lendo o PDF…' : 'Convertendo o Word…');
  try {
    const buf = await file.arrayBuffer(); let bytes, fields;
    if (isPdf) { bytes = new Uint8Array(buf); setBusy('Procurando campos {{…}}…'); fields = await detectPdfFields(bytes); }
    else { const r = await docxToPdf(buf, setBusy); bytes = r.bytes; fields = r.fields; }
    const nSigners = Math.max(1, ...fields.map(f => f.signerIdx + 1), fields.length ? 1 : 2);
    const doc = newDoc({ title: file.name.replace(/\.(pdf|docx)$/i, ''), fileName: file.name, kind: 'upload', signers: Array.from({ length: nSigners }, (_, i) => ({ name: '', role: nSigners === 1 ? 'Signatário' : `Pessoa ${i + 1}` })) });
    doc.fields = fields.map(f => ({ ...f, signer: doc.signers[f.signerIdx]?.id })).map(({ signerIdx, ...f }) => f);
    doc.hash = await sha256(bytes);
    log(doc, `Documento enviado (${isDocx ? 'Word convertido em PDF' : 'PDF'})${fields.length ? ` · ${fields.length} campos {{…}} encontrados` : ''}`);
    await DB.putFile(doc.id, bytes); await DB.put(doc);
    location.hash = `#/editar/${doc.id}`;
    if (fields.length) setTimeout(() => toast(`${fields.length} campos automáticos encontrados no documento`), 600);
  } catch (e) { console.error(e); view().innerHTML = `<div class="card pad"><h2>Não consegui abrir esse arquivo</h2><p class="mut">${esc(e.message || e)}</p><p class="mut">Se for um Word com layout muito complexo, salve como PDF no próprio Word e envie o PDF.</p><a class="btn" href="#/novo">Voltar</a></div>`; }
}
function newDoc({ title, fileName, kind, signers }) {
  return { id: uid(8), title, fileName, kind, createdAt: Date.now(), draft: true, sequential: true, fields: [], events: [], signers: signers.map((s, i) => ({ id: uid(6), token: uid(16), color: COLORS[i % COLORS.length], phone: '', ...s })) };
}

function NovoTermo() {
  const it = (i = {}) => `<tr><td><input name="equip" placeholder="Ex.: Furadeira de impacto" value="${esc(i.equip || '')}"></td><td><input name="marca" placeholder="Marca / modelo" value="${esc(i.marca || '')}"></td><td><input name="serie" placeholder="Nº série" value="${esc(i.serie || '')}"></td><td style="width:70px"><input name="qtd" type="number" min="1" value="${i.qtd || 1}"></td><td style="width:110px"><select name="estado" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px"><option>Novo</option><option selected>Bom</option><option>Regular</option></select></td><td style="width:30px"><button type="button" class="link" data-rm>✕</button></td></tr>`;
  view().innerHTML = `
  <div class="head"><div><div class="eyebrow">Modelo · Termo de ferramentas e EPIs</div><h1>Dados do termo</h1></div><a class="btn" href="#/novo">Voltar</a></div>
  <form id="ft" class="grid">
    <div class="card pad grid"><h2>Empresa e colaborador</h2>
      <div class="form2"><label class="f">Empresa<input name="empresa" value="${esc(getConfig().empresa)}" required></label><label class="f">Código do documento<input name="codigo" value="TRM-${String(Math.floor(Math.random() * 900) + 100)}"></label></div>
      <div class="form3"><label class="f">Nome do colaborador<input name="nome" required placeholder="Nome completo"></label><label class="f">Função<input name="funcao" placeholder="Ex.: Eletricista"></label><label class="f">Telefone (WhatsApp)<input name="tel1" placeholder="(11) 90000-0000"></label></div>
      <div class="form3"><label class="f">Gestor responsável<input name="gestor" required placeholder="Nome do gestor"></label><label class="f">Setor / obra<input name="setor" placeholder="Ex.: Obra Centro"></label><label class="f">Telefone do gestor<input name="tel2" placeholder="(11) 90000-0000"></label></div>
    </div>
    <div class="card pad grid"><div class="row between"><h2>Itens entregues</h2><button type="button" class="btn sm" id="add">+ Adicionar item</button></div>
      <table class="items"><thead><tr><th>Equipamento / ferramenta</th><th>Marca / modelo</th><th>Nº série</th><th>Qtd.</th><th>Estado</th><th></th></tr></thead><tbody id="its">${it()}${it()}</tbody></table>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">Gerar termo e posicionar assinaturas →</button></div>
  </form>`;
  const tb = $('#its'); $('#add').onclick = () => tb.insertAdjacentHTML('beforeend', it());
  tb.onclick = e => { if (e.target.matches('[data-rm]') && tb.rows.length > 1) e.target.closest('tr').remove(); };
  $('#ft').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const m = Object.fromEntries(new FormData(f));
    m.items = [...tb.rows].map(r => ({ equip: $('[name=equip]', r).value.trim(), marca: $('[name=marca]', r).value.trim(), serie: $('[name=serie]', r).value.trim(), qtd: +$('[name=qtd]', r).value || 1, estado: $('[name=estado]', r).value })).filter(i => i.equip);
    if (!m.items.length) { toast('Adicione pelo menos um item'); return; }
    busy('Gerando o termo…');
    const doc = await createTermo(m); location.hash = `#/editar/${doc.id}`;
  };
}
async function createTermo(m, { signedBy = [], when = Date.now(), returned = [] } = {}) {
  m.dataEntrega = when; const { bytes, fields } = await buildTermoPdf(m);
  const doc = newDoc({ title: `Termo de ferramentas · ${m.nome}`, fileName: `termo-${slug(m.nome)}.pdf`, kind: 'termo', signers: [{ name: m.nome, role: 'Colaborador', phone: m.tel1 || '' }, { name: m.gestor, role: 'Gestor', phone: m.tel2 || '' }] });
  doc.createdAt = when; doc.items = m.items.map(i => ({ ...i })); doc.meta = { empresa: m.empresa, funcao: m.funcao, setor: m.setor };
  doc.fields = fields.map(f => ({ ...f, signer: doc.signers[f.signerIdx].id })).map(({ signerIdx, ...f }) => f);
  doc.hash = await sha256(bytes); log(doc, 'Termo gerado pelo modelo'); doc.events[0].at = when;
  await DB.putFile(doc.id, bytes); await DB.put(doc); return doc;
}

/* ---- editor de campos ---- */
async function Editor(id) {
  const doc = await DB.get(id); if (!doc) return NotFound();
  busy('Abrindo o documento…'); const pv = await previews(id);
  let active = doc.signers[0]?.id, tool = null, sel = null;
  const save = () => { clearTimeout(save._t); save._t = setTimeout(() => DB.put(doc), 300); };
  const signer = sid => doc.signers.find(s => s.id === sid);
  view().innerHTML = `
  <div class="head"><div style="flex:1;min-width:260px"><div class="eyebrow">Posicionar campos</div><input id="title" value="${esc(doc.title)}" style="font:800 26px Inter,sans-serif;letter-spacing:-.02em;border:0;background:transparent;width:100%;padding:0;color:var(--ink)"></div>
    <div class="row"><button class="btn" id="del">Excluir</button><button class="btn primary" id="send">Salvar e gerar links →</button></div></div>
  <div class="editor">
    <aside class="side">
      <div class="card"><div class="row between" style="margin-bottom:8px"><h3>Quem assina</h3><button class="btn sm" id="addS">+ Pessoa</button></div><div id="sgs"></div>
        <label class="row sm" style="margin-top:10px;gap:8px"><input type="checkbox" id="seq" ${doc.sequential ? 'checked' : ''}> Assinar na ordem da lista</label></div>
      <div class="card"><h3 style="margin-bottom:4px">Adicionar campo</h3><p class="mut sm" style="margin:0 0 10px">Escolha o campo e clique no documento, no lugar onde ele deve ficar. Para a pessoa selecionada acima.</p>
        <div class="palette">${Object.entries(FT).map(([k, v]) => `<button class="pal" data-t="${k}">${v.label}<span>${v.hint}</span></button>`).join('')}</div></div>
      <div class="card sm mut" id="cnt"></div>
    </aside>
    <section class="pages" id="pages">${pv.map((p, i) => `<div class="page" data-p="${i}"><span class="pn">Página ${i + 1} de ${pv.length}</span><img src="${p.src}" alt="">${covers(doc, i)}</div>`).join('')}</section>
  </div>`;
  const drawSigners = () => {
    $('#sgs').innerHTML = doc.signers.map((s, i) => `<div class="sg ${s.id === active ? 'on' : ''}" data-s="${s.id}" style="--sgc:${s.color}"><span class="dot" style="background:${s.color}"></span><div style="flex:1;min-width:0"><input data-k="name" placeholder="Nome da pessoa ${i + 1}" value="${esc(s.name)}"><input class="r" data-k="role" placeholder="Papel (ex.: Gestor)" value="${esc(s.role || '')}"><input class="r" data-k="phone" placeholder="WhatsApp (opcional)" value="${esc(s.phone || '')}"></div>${doc.signers.length > 1 ? '<button class="x" title="Remover">✕</button>' : ''}</div>`).join('');
    $$('.sg').forEach(el => {
      const s = signer(el.dataset.s);
      el.onclick = e => { if (e.target.closest('.x')) return; if (active !== s.id) { active = s.id; drawSigners(); } };
      $$('input', el).forEach(inp => inp.oninput = () => { s[inp.dataset.k] = inp.value; save(); if (inp.dataset.k === 'name') drawFields(); });
      const x = $('.x', el); if (x) x.onclick = () => { doc.signers = doc.signers.filter(z => z !== s); doc.fields = doc.fields.filter(f => f.signer !== s.id); if (active === s.id) active = doc.signers[0].id; save(); drawSigners(); drawFields(); };
    });
  };
  const drawFields = () => {
    $$('.fld').forEach(e => e.remove());
    doc.fields.forEach(f => {
      const pg = $(`.page[data-p="${f.page}"]`); if (!pg) return; const s = signer(f.signer);
      const el = document.createElement('div'); el.className = 'fld' + (f.type === 'fixo' ? ' fixed' : '') + (sel === f.id ? ' sel' : ''); el.dataset.f = f.id;
      el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;--c:${f.type === 'fixo' ? '#4b5563' : (s?.color || '#999')}`;
      const who = f.type === 'fixo' ? '' : ` · ${s?.name?.split(' ')[0] || s?.role || '?'}`;
      el.innerHTML = `<span class="lbl">${f.type === 'fixo' ? esc(f.value || 'Texto fixo') : esc((f.type === 'texto' ? f.label : FT[f.type].label) + who)}</span><button class="del" title="Remover">×</button><span class="rs"></span>`;
      pg.appendChild(el);
    });
    const n = doc.fields.length; $('#cnt').innerHTML = `<b style="color:var(--ink)">${n} campo${n === 1 ? '' : 's'}</b> no documento.<br>${doc.signers.map(s => `<span style="color:${s.color};font-weight:700">●</span> ${esc(s.name || s.role || 'Sem nome')}: ${doc.fields.filter(f => f.signer === s.id && f.type === 'assinatura').length} assinatura(s)`).join('<br>')}<br><span class="sm">Arraste para mover · canto para redimensionar · duplo clique para editar.</span>`;
  };
  drawSigners(); drawFields();
  $('#title').oninput = e => { doc.title = e.target.value; save(); };
  $('#seq').onchange = e => { doc.sequential = e.target.checked; save(); };
  $('#addS').onclick = () => { const s = { id: uid(6), token: uid(16), name: '', role: `Pessoa ${doc.signers.length + 1}`, phone: '', color: COLORS[doc.signers.length % COLORS.length] }; doc.signers.push(s); active = s.id; save(); drawSigners(); drawFields(); };
  $$('.pal').forEach(b => b.onclick = () => { tool = tool === b.dataset.t ? null : b.dataset.t; $$('.pal').forEach(x => x.classList.toggle('on', x.dataset.t === tool)); $$('.page').forEach(p => p.classList.toggle('placing', !!tool)); });
  const pages = $('#pages');
  pages.addEventListener('click', async e => {
    const del = e.target.closest('.del'); if (del) { doc.fields = doc.fields.filter(f => f.id !== del.parentElement.dataset.f); save(); drawFields(); return; }
    if (!tool) return; const pg = e.target.closest('.page'); if (!pg || e.target.closest('.fld')) return;
    const r = pg.getBoundingClientRect(); const d = FT[tool]; const t = tool;
    const f = { id: uid(6), page: +pg.dataset.p, type: t, label: d.label, signer: active, w: d.w, h: d.h };
    f.x = Math.max(0, Math.min(1 - f.w, (e.clientX - r.left) / r.width - f.w / 2)); f.y = Math.max(0, Math.min(1 - f.h, (e.clientY - r.top) / r.height - f.h / 2));
    tool = null; $$('.pal').forEach(x => x.classList.remove('on')); $$('.page').forEach(p => p.classList.remove('placing'));
    if (t === 'texto') { const v = await askText('Campo de texto', 'Nome do campo (a pessoa vai preencher)', 'Matrícula'); if (!v) return; f.label = v.v; }
    if (t === 'fixo') { const v = await askText('Texto fixo', 'Texto que vai aparecer no documento', ''); if (!v) return; f.value = v.v; f.signer = null; }
    doc.fields.push(f); sel = f.id; save(); drawFields();
  });
  pages.addEventListener('dblclick', async e => {
    const el = e.target.closest('.fld'); if (!el) return; const f = doc.fields.find(x => x.id === el.dataset.f);
    if (f.type === 'fixo') { const v = await askText('Texto fixo', 'Texto', f.value); if (v) { f.value = v.v; save(); drawFields(); } }
    else if (f.type === 'texto') { const v = await askText('Campo de texto', 'Nome do campo', f.label); if (v) { f.label = v.v; save(); drawFields(); } }
    else { f.signer = active; save(); drawFields(); toast('Campo passado para a pessoa selecionada'); }
  });
  pages.addEventListener('pointerdown', e => {
    const el = e.target.closest('.fld'); if (!el || e.target.closest('.del')) return; e.preventDefault();
    const f = doc.fields.find(x => x.id === el.dataset.f); const pg = el.parentElement; const r = pg.getBoundingClientRect();
    const rs = e.target.classList.contains('rs'); const sx = e.clientX, sy = e.clientY, o = { ...f };
    sel = f.id; $$('.fld').forEach(x => x.classList.toggle('sel', x === el)); el.setPointerCapture(e.pointerId);
    el.onpointermove = ev => {
      const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
      if (rs) { f.w = Math.max(.04, Math.min(1 - f.x, o.w + dx)); f.h = Math.max(.012, Math.min(1 - f.y, o.h + dy)); }
      else { f.x = Math.max(0, Math.min(1 - f.w, o.x + dx)); f.y = Math.max(0, Math.min(1 - f.h, o.y + dy)); }
      Object.assign(el.style, { left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.w * 100 + '%', height: f.h * 100 + '%' });
    };
    el.onpointerup = () => { el.onpointermove = el.onpointerup = null; save(); };
  });
  $('#del').onclick = async () => { if (await confirmBox('Excluir documento?', 'O documento e os campos serão apagados deste navegador.', 'Excluir')) { await DB.del(id); location.hash = '#/'; } };
  $('#send').onclick = async () => {
    const miss = doc.signers.find(s => !s.name.trim()); if (miss) { toast('Coloque o nome de todas as pessoas'); active = miss.id; drawSigners(); return; }
    const noSig = doc.signers.find(s => !doc.fields.some(f => f.signer === s.id && f.type === 'assinatura')); if (noSig) { toast(`Falta um campo de assinatura para ${noSig.name}`); active = noSig.id; drawSigners(); return; }
    doc.draft = false; doc.owner = me()?.nome; log(doc, `Enviado para assinatura por ${me()?.nome || 'usuário'}: ${doc.signers.map(s => s.name).join(', ')}`); await DB.put(doc); location.hash = `#/doc/${doc.id}`;
  };
}

const covers = (doc, i) => doc.fields.filter(f => f.cover && f.page === i).map(f => `<div style="position:absolute;background:#fff;left:${f.cover.x * 100}%;top:${f.cover.y * 100}%;width:${f.cover.w * 100}%;height:${f.cover.h * 100}%"></div>`).join('');
/* ---- campos somente leitura na pré-visualização ---- */
function roFields(doc, showPending = true) {
  return doc.fields.map(f => {
    const st = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`;
    if (f.value) return `<div class="ro-fld" style="${st}${f.cover ? ';background:#fff' : ''}">${f.type === 'assinatura' ? `<img src="${f.value}" alt="assinatura">` : esc(f.value)}</div>`;
    if (!showPending) return f.cover ? `<div class="ro-fld" style="${st};background:#fff"></div>` : '';
    const s = doc.signers.find(x => x.id === f.signer);
    return `<div class="ro-fld pending" style="${st}${f.cover ? ';background:#fff' : ''}">${esc((f.type === 'texto' ? f.label : FT[f.type].label))} · ${esc(s?.name?.split(' ')[0] || '')}</div>`;
  });
}

/* ---- detalhe do documento ---- */
async function Detalhe(id) {
  const doc = await DB.get(id); if (!doc) return NotFound(); if (doc.draft) { location.hash = `#/editar/${id}`; return; }
  busy('Abrindo…'); const pv = await previews(id); const s = statusOf(doc);
  const ro = roFields(doc); const byPage = i => ro.filter((_, k) => doc.fields[k].page === i).join('');
  const canEdit = !doc.signers.some(x => x.signedAt);
  view().innerHTML = `
  <div class="head"><div><div class="eyebrow">${doc.kind === 'termo' ? 'Termo de ferramentas' : 'Documento'}</div><h1>${esc(doc.title)}</h1><div class="row" style="margin-top:8px"><span class="badge ${s.c}">${esc(s.t)}</span><span class="mut sm">Criado em ${fmtDT(doc.createdAt)}</span></div></div>
    <div class="row"><a class="btn" href="#/">← Painel</a>${canEdit ? `<a class="btn" href="#/editar/${doc.id}" id="edit">Editar campos</a>` : ''}<button class="btn dark" id="dl">Baixar PDF${s.k === 'done' || s.k === 'ret' ? ' assinado' : ''}</button></div></div>
  <div class="detail">
    <section class="pages">${pv.map((p, i) => `<div class="page"><span class="pn">Página ${i + 1} de ${pv.length}</span><img src="${p.src}" alt="">${covers(doc, i)}${byPage(i)}</div>`).join('')}</section>
    <aside class="grid" style="position:sticky;top:84px">
      <div class="card pad"><h2 style="margin-bottom:6px">Assinaturas</h2><p class="mut sm" style="margin:0 0 6px">${doc.sequential ? 'Na ordem: cada pessoa só assina depois da anterior.' : 'Em qualquer ordem.'}</p>
        <div class="steps">${doc.signers.map((x, i) => {
          const now = !x.signedAt && (!doc.sequential || doc.signers.slice(0, i).every(y => y.signedAt));
          return `<div class="step ${x.signedAt ? 'done' : now ? 'now' : ''}"><div class="n">${x.signedAt ? '✓' : i + 1}</div><div><b>${esc(x.name)}</b> <span class="mut sm">· ${esc(x.role || '')}</span><div class="sm ${x.signedAt ? '' : 'mut'}" style="${x.signedAt ? 'color:var(--ok);font-weight:600' : ''}">${x.signedAt ? `Assinou em ${fmtDT(x.signedAt)} · ${esc(x.device || '')}` : now ? 'Pode assinar agora' : 'Aguardando a pessoa anterior'}</div>
          ${x.signedAt ? '' : `<div class="acts"><a class="btn sm wa" href="${waLink(doc, x)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn sm" data-copy="${x.id}">Copiar link</button><a class="btn sm" href="#/assinar/${doc.id}/${x.id}/${x.token}">Abrir e assinar</a></div>`}</div></div>`;
        }).join('')}</div>
        <p class="mut sm" style="margin:10px 0 0">Na demonstração o link abre neste navegador. Na versão para empresas ele abre em qualquer celular.</p></div>
      ${doc.items ? `<div class="card pad"><div class="row between" style="margin-bottom:8px"><h2>Devolução</h2><span class="mut sm">${doc.items.filter(i => i.returnedAt).length}/${doc.items.length} devolvidos</span></div>
        <table class="ret" style="width:100%;border-collapse:collapse">${doc.items.map((it, k) => `<tr><td><b>${esc(it.equip)}</b><div class="mut sm">${esc(it.marca || '')} · qtd ${it.qtd || 1}</div></td><td style="text-align:right">${it.returnedAt ? `<span class="badge b-ok">${fmtD(it.returnedAt)}</span><div class="mut sm">${esc(it.returnState || '')}</div>` : (s.k === 'done' ? `<button class="btn sm" data-ret="${k}">Registrar</button>` : '<span class="mut sm">após assinar</span>')}</td></tr>`).join('')}</table></div>` : ''}
      <div class="card pad verify"><h3>Código de verificação</h3><div style="font:800 20px 'DejaVu Sans Mono',ui-monospace,monospace;letter-spacing:.04em;margin:6px 0">${codeOf(doc.hash)}</div><p class="mut sm" style="margin:0">Vai na última página do PDF, com data, hora e aparelho de cada assinatura e a impressão digital do original.</p></div>
      <div class="card pad"><h3 style="margin-bottom:10px">Histórico</h3><div class="hist">${(doc.events || []).slice().reverse().map(e => `<div><time>${fmtDT(e.at)}</time><span>${esc(e.text)}</span></div>`).join('')}</div>
        <button class="link sm mut" id="rm" style="margin-top:14px">Excluir documento</button></div>
    </aside>
  </div>`;
  $$('[data-copy]').forEach(b => b.onclick = async () => { const x = doc.signers.find(y => y.id === b.dataset.copy); try { await navigator.clipboard.writeText(signLink(doc, x)); toast('Link copiado'); } catch { await askText('Link de assinatura', 'Copie o link', signLink(doc, x)); } });
  $('#dl').onclick = async () => { const b = $('#dl'); b.disabled = true; b.textContent = 'Gerando…'; try { download(await buildFinal(doc), `${slug(doc.title)}${s.k === 'done' || s.k === 'ret' ? '-assinado' : '-parcial'}.pdf`); } finally { b.disabled = false; b.textContent = 'Baixar PDF' + (s.k === 'done' || s.k === 'ret' ? ' assinado' : ''); } };
  $$('[data-ret]').forEach(b => b.onclick = async () => {
    const it = doc.items[+b.dataset.ret];
    const v = await askText(`Devolução · ${it.equip}`, 'Data da devolução', new Date().toISOString().slice(0, 10), `<label class="f" style="margin-top:12px">Estado na devolução<select name="estado"><option>Bom</option><option>Com desgaste</option><option>Danificado</option><option>Extraviado</option></select></label><label class="f" style="margin-top:12px">Observação<input name="obs" placeholder="Opcional"></label>`);
    if (!v) return; it.returnedAt = new Date(v.v + 'T12:00').getTime() || Date.now(); it.returnState = v.estado; it.returnObs = v.obs; log(doc, `Devolução registrada: ${it.equip} (${v.estado})`); await DB.put(doc); Detalhe(id);
  });
  $('#rm').onclick = async () => { if (await confirmBox('Excluir documento?', 'Ele será apagado deste navegador.', 'Excluir')) { await DB.del(id); previewCache.delete(id); location.hash = '#/'; } };
}

/* ---- tela de quem assina ---- */
async function Assinar(id, sid, token) {
  const doc = await DB.get(id); const s = doc && doc.signers.find(x => x.id === sid);
  if (!doc || !s || s.token !== token) return view().innerHTML = `<div class="card pad" style="max-width:520px;margin:40px auto;text-align:center"><h2>Link inválido</h2><p class="mut">Este link de assinatura não existe ou foi substituído. Peça um novo link a quem enviou o documento.</p></div>`;
  $('.top nav').style.visibility = 'hidden';
  const idx = doc.signers.indexOf(s);
  if (s.signedAt) return view().innerHTML = `<div class="card pad" style="max-width:560px;margin:40px auto;text-align:center"><div style="font-size:44px">✅</div><h2>Você já assinou este documento</h2><p class="mut">${esc(doc.title)}<br>Assinado em ${fmtDT(s.signedAt)}.</p><button class="btn dark" id="dl">Baixar cópia em PDF</button></div>`, $('#dl').onclick = async () => download(await buildFinal(doc), `${slug(doc.title)}.pdf`);
  if (doc.sequential && doc.signers.slice(0, idx).some(y => !y.signedAt)) { const w = doc.signers.slice(0, idx).find(y => !y.signedAt); return view().innerHTML = `<div class="card pad" style="max-width:560px;margin:40px auto;text-align:center"><div style="font-size:44px">⏳</div><h2>Ainda não é a sua vez</h2><p class="mut">${esc(doc.title)}<br>Aguardando a assinatura de <b>${esc(w.name)}</b>. Você vai receber o aviso quando puder assinar.</p></div>`; }
  busy('Abrindo o documento…'); const pv = await previews(id);
  const mine = doc.fields.filter(f => f.signer === s.id); const vals = {};
  const autoVal = f => f.type === 'nome' ? s.name : f.type === 'data' ? new Date().toLocaleDateString('pt-BR') : null;
  mine.forEach(f => { const a = autoVal(f); if (a) vals[f.id] = a; });
  const others = doc.fields.map((f, k) => [f, k]).filter(([f]) => f.signer !== s.id);
  const ro = roFields(doc, false);
  view().innerHTML = `
  <div class="head"><div><div class="eyebrow">Assinatura de documento</div><h1>${esc(doc.title)}</h1><p class="mut" style="margin:6px 0 0">Olá, <b style="color:var(--ink)">${esc(s.name)}</b>. Leia o documento e preencha os campos em destaque (${mine.length}).</p></div></div>
  <section class="pages" id="pages">${pv.map((p, i) => `<div class="page" data-p="${i}"><span class="pn">Página ${i + 1} de ${pv.length}</span><img src="${p.src}" alt="">${covers(doc, i)}${others.filter(([f]) => f.page === i).map(([, k]) => ro[k]).join('')}</div>`).join('')}</section>
  <div class="signbar"><label class="row sm" style="gap:8px"><input type="checkbox" id="agree"> Li e concordo com este documento</label><div class="row"><span class="mut sm" id="prog"></span><button class="btn primary" id="go" disabled>Concluir assinatura</button></div></div>`;
  const draw = () => {
    $$('.sign-fld').forEach(e => e.remove());
    mine.forEach(f => {
      const pg = $(`.page[data-p="${f.page}"]`); const el = document.createElement('div'); el.className = 'sign-fld' + (vals[f.id] ? ' done' : ''); el.dataset.f = f.id;
      el.style.cssText = `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;${f.cover ? 'background-color:#fff;' : ''}`;
      if (f.type === 'assinatura') el.innerHTML = vals[f.id] ? `<img src="${vals[f.id]}" alt="assinatura">` : '✍️ Assinar';
      else if (f.type === 'nome' || f.type === 'data') { el.innerHTML = `<span style="color:#112c43;font-weight:600;padding:0 4px;width:100%;text-align:left;white-space:nowrap;overflow:hidden">${esc(vals[f.id])}</span>`; el.style.cursor = 'default'; }
      else el.innerHTML = `<input placeholder="${esc(f.type === 'cpf' ? 'CPF' : f.label)}" value="${esc(vals[f.id] || '')}" ${f.type === 'cpf' ? 'inputmode="numeric"' : ''}>`;
      pg.appendChild(el);
    });
    $$('.sign-fld input').forEach(inp => inp.oninput = () => {
      const f = mine.find(x => x.id === inp.parentElement.dataset.f);
      if (f.type === 'cpf') { const d = inp.value.replace(/\D/g, '').slice(0, 11); inp.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); vals[f.id] = d.length === 11 ? inp.value : ''; }
      else vals[f.id] = inp.value.trim();
      inp.parentElement.classList.toggle('done', !!vals[f.id]); upd();
    });
    upd();
  };
  const upd = () => { const done = mine.filter(f => vals[f.id]).length; $('#prog').textContent = `${done} de ${mine.length} campos`; $('#go').disabled = !(done === mine.length && $('#agree').checked); };
  $('#agree').onchange = upd;
  $('#pages').onclick = async e => {
    const el = e.target.closest('.sign-fld'); if (!el) return; const f = mine.find(x => x.id === el.dataset.f); if (f.type !== 'assinatura') return;
    const png = await signaturePad(`Assinatura de ${s.name.split(' ')[0]}`); if (png) { mine.filter(x => x.type === 'assinatura').forEach(x => { if (!vals[x.id] || x.id === f.id) vals[x.id] = png; }); draw(); }
  };
  draw();
  const first = mine.find(f => !vals[f.id]); if (first) setTimeout(() => $(`.sign-fld[data-f="${first.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  $('#go').onclick = async () => {
    mine.forEach(f => { f.value = vals[f.id]; }); s.signedAt = Date.now(); s.device = device();
    log(doc, `${s.name} assinou (${s.device})`); if (doc.signers.every(x => x.signedAt)) log(doc, 'Documento concluído: todas as assinaturas coletadas');
    await DB.put(doc); previewCache.delete(id);
    const next = doc.signers.find(x => !x.signedAt);
    view().innerHTML = `<div class="card pad" style="max-width:560px;margin:40px auto;text-align:center"><div style="font-size:48px">✅</div><h2>Assinatura registrada!</h2><p class="mut">${esc(doc.title)}<br>${fmtDTs(s.signedAt)} · ${esc(s.device)}</p>${next ? `<p class="sm">Próxima pessoa: <b>${esc(next.name)}</b></p>` : '<p class="sm"><b>Todas as assinaturas foram coletadas.</b></p>'}<div class="row" style="justify-content:center"><button class="btn dark" id="dl">Baixar cópia em PDF</button><a class="btn" href="#/doc/${doc.id}">Ver no painel</a></div></div>`;
    $('#dl').onclick = async () => download(await buildFinal(doc), `${slug(doc.title)}.pdf`);
  };
}
const NotFound = () => view().innerHTML = `<div class="card pad"><h2>Documento não encontrado</h2><a class="btn" href="#/">Voltar ao painel</a></div>`;

/* ---------------- exemplos fictícios ---------------- */
function fakeSignature(name, seed = 1) {
  const c = document.createElement('canvas'); c.width = 520; c.height = 160; const g = c.getContext('2d');
  let r = seed * 9301 + 49297; const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  g.strokeStyle = '#112c43'; g.lineWidth = 5; g.lineCap = g.lineJoin = 'round';
  g.font = `italic 600 ${78 + rnd() * 10}px "Segoe Script","Brush Script MT","URW Chancery L",cursive`;
  const first = name.split(' ')[0], last = name.split(' ').slice(-1)[0];
  g.save(); g.translate(30, 108); g.rotate(-.05 - rnd() * .05); g.lineWidth = 2.6; g.fillStyle = '#112c43'; g.fillText(`${first[0]}. ${last}`, 0, 0); g.restore();
  g.beginPath(); g.moveTo(40 + rnd() * 20, 128); g.bezierCurveTo(180, 118 + rnd() * 20, 320, 150, 470, 112 + rnd() * 12); g.lineWidth = 3; g.stroke();
  return c.toDataURL('image/png');
}
async function seed() {
  const day = 864e5, now = Date.now();
  const base = { empresa: 'Construtora Exemplo Ltda', gestor: 'Carlos Mendes', setor: 'Obra Residencial Jardim', tel2: '' };
  const mk = async (m, when, signs, returned = []) => {
    const doc = await createTermo({ ...base, ...m }, { when }); doc.draft = false; doc.events.push({ at: when + 60e3, text: `Enviado para assinatura: ${doc.signers.map(s => s.name).join(', ')}` });
    signs.forEach((h, i) => { const s = doc.signers[i]; s.signedAt = when + h * 36e5; s.device = i ? 'Chrome · Windows' : 'Chrome · Android';
      doc.fields.filter(f => f.signer === s.id).forEach(f => f.value = f.type === 'assinatura' ? fakeSignature(s.name, i + m.nome.length) : f.type === 'nome' ? s.name : f.type === 'data' ? new Date(s.signedAt).toLocaleDateString('pt-BR') : f.value);
      doc.events.push({ at: s.signedAt, text: `${s.name} assinou (${s.device})` }); });
    if (signs.length === 2) doc.events.push({ at: doc.signers[1].signedAt + 1000, text: 'Documento concluído: todas as assinaturas coletadas' });
    returned.forEach(([k, d, st]) => { const it = doc.items[k]; it.returnedAt = when + d * day; it.returnState = st; doc.events.push({ at: it.returnedAt, text: `Devolução registrada: ${it.equip} (${st})` }); });
    await DB.put(doc);
  };
  await mk({ nome: 'Marcos Vinícius Rocha', funcao: 'Eletricista', codigo: 'TRM-104', items: [{ equip: 'Furadeira de impacto', marca: 'Marca A · FI-650', serie: 'PAT-0231', qtd: 1, estado: 'Bom' }, { equip: 'Alicate amperímetro', marca: 'Marca B · AM-20', serie: 'PAT-0412', qtd: 1, estado: 'Novo' }, { equip: 'Luva isolante classe 0', marca: 'Marca C', serie: 'CA 12345', qtd: 2, estado: 'Novo' }] }, now - 9 * day, [2, 5], [[0, 7, 'Bom'], [1, 7, 'Bom'], [2, 8, 'Com desgaste']]);
  await mk({ nome: 'Juliana Prado Nunes', funcao: 'Técnica de segurança', codigo: 'TRM-105', items: [{ equip: 'Detector de gases', marca: 'Marca D · DG-4', serie: 'PAT-0520', qtd: 1, estado: 'Bom' }, { equip: 'Trena a laser 40 m', marca: 'Marca E', serie: 'PAT-0533', qtd: 1, estado: 'Bom' }] }, now - 4 * day, [1, 3]);
  await mk({ nome: 'Rafael Lima Santos', funcao: 'Encarregado de obra', codigo: 'TRM-106', items: [{ equip: 'Esmerilhadeira angular', marca: 'Marca A · EA-115', serie: 'PAT-0618', qtd: 1, estado: 'Bom' }, { equip: 'Serra mármore', marca: 'Marca F · SM-12', serie: 'PAT-0620', qtd: 1, estado: 'Bom' }, { equip: 'Óculos de proteção', marca: 'Marca G', serie: 'CA 23456', qtd: 3, estado: 'Novo' }] }, now - 1 * day, [3]);
  await mk({ nome: 'Ana Beatriz Costa', funcao: 'Auxiliar de obra', codigo: 'TRM-107', items: [{ equip: 'Martelo demolidor', marca: 'Marca A · MD-10', serie: 'PAT-0701', qtd: 1, estado: 'Bom' }, { equip: 'Protetor auricular', marca: 'Marca H', serie: 'CA 34567', qtd: 2, estado: 'Novo' }] }, now - 2 * 36e5, []);
  localStorage.setItem('ecd-assina-seeded', '2');
}

/* ---------------- roteador ---------------- */
async function route() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0].split('/'); $('.top nav').style.visibility = '';
  if (!guard(h[0], ['assinar'])) return; if (h[0] === 'assinar' && !me()) $('.top nav').style.display = 'none';
  $$('.top nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (h[0] || 'painel')));
  $('#modal').hidden = true; window.scrollTo(0, 0);
  try {
    if (!h[0]) await Painel();
    else if (h[0] === 'novo' && h[1] === 'termo') NovoTermo();
    else if (h[0] === 'novo') Novo();
    else if (h[0] === 'editar') await Editor(h[1]);
    else if (h[0] === 'doc') await Detalhe(h[1]);
    else if (h[0] === 'assinar') await Assinar(h[1], h[2], h[3]);
    else if (authRoute(h[0])) {}
    else NotFound();
  } catch (e) { console.error(e); view().innerHTML = `<div class="card pad"><h2>Algo deu errado</h2><p class="mut">${esc(e.message || e)}</p><a class="btn" href="#/">Voltar</a></div>`; }
}
$('#resetDemo').onclick = async () => { if (!(await confirmBox('Restaurar exemplos?', 'Apaga tudo o que você criou neste navegador e recoloca os documentos de exemplo.', 'Restaurar'))) return; busy('Restaurando…'); await DB.clear(); previewCache.clear(); await seed(); location.hash = '#/'; route(); };
window.addEventListener('hashchange', route);
(async () => {
  let seeded = false; try { seeded = localStorage.getItem('ecd-assina-seeded') === '2'; } catch {}
  if (!seeded || !(await DB.all()).length) { busy('Preparando os exemplos…'); await DB.clear(); await seed(); }
  route();
})();
