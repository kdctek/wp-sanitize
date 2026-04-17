import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { json as jsonLang } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

import './styles.css';
import { unserialize, type Encoding as DecodeEncoding } from './unserialize.ts';
import { serialize, type Encoding as EncodeEncoding } from './serialize.ts';
import { phpToJson, jsonToPhp, type Json } from './bridge.ts';
import { PhpSerializeError } from './types.ts';
import { EXAMPLES } from './examples.ts';
import { WP_COLLATIONS, collationToEncoding } from './collations.ts';

const ENCODING_STORAGE_KEY = 'wp-sanitize:encoding';
const COLLATION_STORAGE_KEY = 'wp-sanitize:collation';
const DEFAULT_ENCODING: DecodeEncoding = 'utf8';

function loadEncoding(): DecodeEncoding {
  const stored = localStorage.getItem(ENCODING_STORAGE_KEY);
  if (stored === 'utf8' || stored === 'latin1' || stored === 'auto') return stored;
  return DEFAULT_ENCODING;
}

function saveEncoding(enc: DecodeEncoding): void {
  localStorage.setItem(ENCODING_STORAGE_KEY, enc);
}

function loadCollation(): string {
  return localStorage.getItem(COLLATION_STORAGE_KEY) ?? '';
}

function saveCollation(value: string): void {
  if (value) localStorage.setItem(COLLATION_STORAGE_KEY, value);
  else localStorage.removeItem(COLLATION_STORAGE_KEY);
}

// For encoding the JSON back to PHP format: `auto` is a decode-only concept,
// so we fall back to UTF-8 (the safe/correct choice for most data).
function toEncodeEncoding(enc: DecodeEncoding): EncodeEncoding {
  return enc === 'latin1' ? 'latin1' : 'utf8';
}

const byteLen = (s: string) => new TextEncoder().encode(s).byteLength;

// One Compartment per editor lets us swap the theme dynamically when the
// OS colour-scheme preference changes.
const themeCompartments: Compartment[] = [];

function currentThemeExt(): Extension {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? oneDark : [];
}

function makeEditor(parent: HTMLElement, initialDoc: string, extra: Extension[] = []): EditorView {
  const themeCompartment = new Compartment();
  themeCompartments.push(themeCompartment);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        themeCompartment.of(currentThemeExt()),
        ...extra,
      ],
    }),
  });
}

function applyThemeToAll(views: EditorView[]): void {
  const next = currentThemeExt();
  views.forEach((view, i) => {
    const compartment = themeCompartments[i];
    if (!compartment) return;
    view.dispatch({ effects: compartment.reconfigure(next) });
  });
}

function replaceDoc(view: EditorView, next: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
  });
}

function getDoc(view: EditorView): string {
  return view.state.doc.toString();
}

const statusEl = document.getElementById('status') as HTMLDivElement;

function setStatus(kind: 'ok' | 'err' | 'warn' | 'info', msg: string) {
  statusEl.classList.remove('ok', 'err', 'warn');
  if (kind !== 'info') statusEl.classList.add(kind);
  statusEl.textContent = msg;
}

function describePhp(v: ReturnType<typeof unserialize>): string {
  switch (v.kind) {
    case 'array':
      return `array · ${v.entries.length} ${v.entries.length === 1 ? 'entry' : 'entries'}`;
    case 'object':
      return `object ${v.className} · ${v.entries.length} ${v.entries.length === 1 ? 'prop' : 'props'}`;
    case 'string':
      return `string · ${byteLen(v.value)} bytes`;
    default:
      return v.kind;
  }
}

const serializedHost = document.getElementById('editor-serialized') as HTMLDivElement;
const jsonHost = document.getElementById('editor-json') as HTMLDivElement;

const serializedView = makeEditor(serializedHost, '');
const jsonView = makeEditor(jsonHost, '', [jsonLang()]);

const serializedPane = serializedHost.closest('.pane') as HTMLElement;
const jsonPane = jsonHost.closest('.pane') as HTMLElement;

function clearPaneHighlights(): void {
  serializedPane.classList.remove('pane--highlight');
  jsonPane.classList.remove('pane--highlight');
}

function flashPane(pane: HTMLElement): void {
  clearPaneHighlights();
  pane.classList.add('pane--highlight');
  // Defer listener install so the current click/keystroke doesn't immediately clear it.
  setTimeout(() => {
    const off = () => {
      clearPaneHighlights();
      document.removeEventListener('keydown', handler, true);
      document.removeEventListener('pointerdown', handler, true);
    };
    const handler = (e: Event) => {
      const target = e.target as Element | null;
      // Interactions inside the highlighted pane (scroll, select, copy) keep the notice visible.
      if (target && pane.contains(target)) return;
      off();
    };
    document.addEventListener('keydown', handler, true);
    document.addEventListener('pointerdown', handler, true);
  }, 0);
}

let currentEncoding: DecodeEncoding = loadEncoding();

function doDecode() {
  const input = getDoc(serializedView).trim();
  if (!input) {
    setStatus('warn', 'Paste serialized PHP into the left pane first.');
    return;
  }
  const warnings: string[] = [];
  try {
    const v = unserialize(input, { encoding: currentEncoding, warnings });
    const json = phpToJson(v);
    replaceDoc(jsonView, JSON.stringify(json, null, 2));
    flashPane(jsonPane);
    const base = `Decoded ${describePhp(v)} · ${byteLen(input)} bytes in · encoding: ${currentEncoding}`;
    if (warnings.length) {
      const head = warnings[0] ?? '';
      const extra = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : '';
      setStatus('warn', `${base}\n⚠ ${head}${extra}`);
    } else {
      setStatus('ok', base);
    }
  } catch (e) {
    const msg = e instanceof PhpSerializeError ? e.message : String(e);
    setStatus('err', `Decode failed: ${msg}`);
  }
}

function doEncode() {
  const input = getDoc(jsonView);
  if (!input.trim()) {
    setStatus('warn', 'Type or paste JSON into the right pane first.');
    return;
  }
  let json: Json;
  try {
    json = JSON.parse(input) as Json;
  } catch (e) {
    setStatus('err', `JSON parse error: ${(e as Error).message}`);
    return;
  }
  const warnings: string[] = [];
  try {
    const v = jsonToPhp(json);
    const encodeEnc = toEncodeEncoding(currentEncoding);
    const out = serialize(v, { encoding: encodeEnc, warnings });
    replaceDoc(serializedView, out);
    flashPane(serializedPane);
    const base = `Encoded to ${byteLen(out)} bytes · encoding: ${encodeEnc}`;
    if (warnings.length) {
      const head = warnings[0] ?? '';
      const extra = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : '';
      setStatus('warn', `${base}\n⚠ ${head}${extra}`);
    } else {
      setStatus('ok', base);
    }
  } catch (e) {
    const msg = e instanceof PhpSerializeError ? e.message : String(e);
    setStatus('err', `Encode failed: ${msg}`);
  }
}

function doFormat() {
  const input = getDoc(jsonView);
  if (!input.trim()) return;
  try {
    const parsed = JSON.parse(input);
    replaceDoc(jsonView, JSON.stringify(parsed, null, 2));
    setStatus('ok', 'JSON reformatted.');
  } catch (e) {
    setStatus('err', `Cannot format — invalid JSON: ${(e as Error).message}`);
  }
}

async function copyFrom(view: EditorView, label: string) {
  const text = getDoc(view);
  if (!text) {
    setStatus('warn', `${label} pane is empty.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus('ok', `Copied ${byteLen(text)} bytes from ${label} pane.`);
  } catch (e) {
    setStatus('err', `Copy failed: ${(e as Error).message}`);
  }
}

document.getElementById('decode')!.addEventListener('click', doDecode);
document.getElementById('encode')!.addEventListener('click', doEncode);
document.getElementById('format-json')!.addEventListener('click', doFormat);
document.getElementById('copy-serialized')!.addEventListener('click', () => copyFrom(serializedView, 'serialized'));
document.getElementById('copy-json')!.addEventListener('click', () => copyFrom(jsonView, 'JSON'));

document.getElementById('clear')!.addEventListener('click', () => {
  replaceDoc(serializedView, '');
  replaceDoc(jsonView, '');
  clearPaneHighlights();
  setStatus('info', '');
});

const encodingEl = document.getElementById('encoding') as HTMLSelectElement;
encodingEl.value = currentEncoding;
encodingEl.addEventListener('change', () => {
  const v = encodingEl.value;
  if (v !== 'utf8' && v !== 'latin1' && v !== 'auto') return;
  currentEncoding = v;
  saveEncoding(v);
  setStatus('info', `Source encoding set to ${v}. Re-decode to apply.`);
});

const selectEl = document.getElementById('examples') as HTMLSelectElement;
for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.serialized;
  opt.textContent = ex.label;
  opt.title = ex.description;
  selectEl.appendChild(opt);
}
selectEl.addEventListener('change', () => {
  const v = selectEl.value;
  if (!v) return;
  replaceDoc(serializedView, v);
  doDecode();
  selectEl.value = '';
});

const collationEl = document.getElementById('collation') as HTMLSelectElement;
for (const group of WP_COLLATIONS) {
  const og = document.createElement('optgroup');
  og.label = group.charset;
  for (const c of group.options) {
    const o = document.createElement('option');
    o.value = c.value;
    o.textContent = c.label;
    o.title = c.title;
    og.appendChild(o);
  }
  collationEl.appendChild(og);
}
collationEl.value = loadCollation();
collationEl.addEventListener('change', () => {
  const v = collationEl.value;
  saveCollation(v);
  if (!v) {
    setStatus('info', 'Collation cleared.');
    return;
  }
  const enc = collationToEncoding(v);
  currentEncoding = enc;
  saveEncoding(enc);
  encodingEl.value = enc;
  setStatus('info', `Collation set to ${v} → Source encoding: ${enc}. Re-decode to apply.`);
});

// Live-swap editor theme when the OS colour-scheme changes.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => applyThemeToAll([serializedView, jsonView]));

setStatus('info', 'Paste serialized PHP on the left, or start typing JSON on the right.');
