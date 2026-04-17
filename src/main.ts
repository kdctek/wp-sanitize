import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { json as jsonLang } from '@codemirror/lang-json';

import './styles.css';
import { unserialize } from './unserialize.ts';
import { serialize } from './serialize.ts';
import { phpToJson, jsonToPhp, type Json } from './bridge.ts';
import { PhpSerializeError } from './types.ts';
import { EXAMPLES } from './examples.ts';

const byteLen = (s: string) => new TextEncoder().encode(s).byteLength;

function makeEditor(parent: HTMLElement, initialDoc: string, extra: Extension[] = []): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [basicSetup, EditorView.lineWrapping, EditorState.tabSize.of(2), ...extra],
    }),
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

function doDecode() {
  const input = getDoc(serializedView).trim();
  if (!input) {
    setStatus('warn', 'Paste serialized PHP into the left pane first.');
    return;
  }
  try {
    const v = unserialize(input);
    const json = phpToJson(v);
    replaceDoc(jsonView, JSON.stringify(json, null, 2));
    setStatus('ok', `Decoded ${describePhp(v)} · ${byteLen(input)} bytes in`);
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
  try {
    const v = jsonToPhp(json);
    const out = serialize(v);
    replaceDoc(serializedView, out);
    setStatus('ok', `Encoded to ${byteLen(out)} bytes`);
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
  setStatus('info', '');
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

setStatus('info', 'Paste serialized PHP on the left, or start typing JSON on the right.');
