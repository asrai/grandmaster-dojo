#!/usr/bin/env node
// 폰트 커버리지 게이트 (REQ-804) — 출하 번들이 실제로 그리는 글자를 모으고, `index.html` 의
// `@font-face` 선언이 그 전부를 덮는지 대조한다. 서브셋 문자 집합은 사람이 손으로 관리하므로,
// 새 문구가 조용히 두부(□)로 렌더되는 것을 막을 층이 이것뿐이다.
//
// 사용법:
//   node scripts/check-font-coverage.mjs                 게이트 — 미커버 글자를 열거하고 비-0 종료
//   node scripts/check-font-coverage.mjs --emit-charset  수집한 글자를 stdout 에 (subset-fonts.sh 입력)
//
// 문자 수집과 서브셋 생성이 같은 함수를 쓰므로 둘이 어긋날 수 없다 — `subset-fonts.sh` 는
// `--emit-charset` 산출을 그대로 pyftsubset 에 넘긴다.

import { readFileSync, readdirSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_HTML = 'index.html';

/* ── 1. 출하 번들이 그리는 글자 ────────────────────────────────────────── */

/** 주석은 렌더되지 않으므로 뺀다 — 넣으면 읽히지도 않을 글리프로 서브셋이 부푼다. */
function stripJsComments(src) {
  const out = [];
  const stack = [];
  let state = 'code';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { stack.push(state); state = c; }
      // 템플릿 보간은 다시 코드라, 그 안의 주석도 주석이다.
      else if (c === '}' && stack.length > 0) { state = stack.pop(); }
      out.push(c); i += 1; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out.push(c); } i += 1; continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; } else i += 1; continue; }
    if (c === '\\') { out.push(c, d ?? ''); i += 2; continue; }
    if (state === '`' && c === '$' && d === '{') { stack.push(state); state = 'code'; out.push(c, d); i += 2; continue; }
    if (c === state) { state = stack.pop() ?? 'code'; }
    out.push(c); i += 1;
  }
  return out.join('');
}

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** CSS `content` 의 `\25B8` 는 소스에 ASCII 로 적히지만 화면에는 글리프로 나온다. */
function decodeCssEscapes(css) {
  const cps = [];
  for (const m of css.matchAll(/\\([0-9a-fA-F]{1,6})[ \t\r\n]?/g)) {
    const cp = Number.parseInt(m[1], 16);
    if (cp > 0x20 && cp <= 0x10ffff) cps.push(String.fromCodePoint(cp));
  }
  return cps.join('');
}

/** `<style>`·`<script>` 는 언어가 달라 주석 문법도 다르다 — 블록별로 갈라 벗긴다. */
function renderableTextFromHtml(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const parts = [];
  const re = /<(style|script)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  for (const m of body.matchAll(re)) {
    parts.push(body.slice(last, m.index));
    const inner = m[1].toLowerCase() === 'style'
      ? (() => { const css = stripCssComments(m[2]); return css + decodeCssEscapes(css); })()
      : stripJsComments(m[2]);
    parts.push(inner);
    last = m.index + m[0].length;
  }
  parts.push(body.slice(last));
  return parts.join('\n');
}

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(mjs|json)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** 출하되는 것만 본다 — `docs/`·`tests/`·`scripts/` 는 브라우저에 실리지 않는다. */
function sourceFiles() {
  return [ENTRY_HTML, ...walk('src')];
}

function collectUsedChars() {
  const used = new Set();
  for (const rel of sourceFiles()) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const text = rel === ENTRY_HTML ? renderableTextFromHtml(raw)
      : rel.endsWith('.mjs') ? stripJsComments(raw)
        : raw;
    for (const ch of text) if (ch.codePointAt(0) > 0x20) used.add(ch);
  }
  return used;
}

/* ── 2. `@font-face` 선언 ──────────────────────────────────────────────── */

function parseUnicodeRange(spec) {
  const ranges = [];
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^U\+([0-9a-fA-F]{1,6})(?:-([0-9a-fA-F]{1,6}))?$/);
    if (!m) throw new Error(`unicode-range 를 읽을 수 없다: ${part.trim()}`);
    const lo = Number.parseInt(m[1], 16);
    ranges.push([lo, m[2] ? Number.parseInt(m[2], 16) : lo]);
  }
  return ranges;
}

const inRanges = (cp, ranges) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

function parseFontFaces(html) {
  const faces = [];
  for (const m of html.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const block = m[1];
    const src = block.match(/url\(['"]?([^'")]+)['"]?\)/);
    const range = block.match(/unicode-range\s*:\s*([^;}]+)/);
    const weight = block.match(/font-weight\s*:\s*([^;}]+)/);
    if (!src) throw new Error(`@font-face 에 src url 이 없다: ${block.trim().slice(0, 60)}`);
    if (!range) throw new Error(`@font-face 에 unicode-range 가 없다 (${src[1]}) — 범위 없는 면은 커버리지를 판정할 수 없다`);
    faces.push({ file: src[1], ranges: parseUnicodeRange(range[1]), weight: weight ? weight[1].trim() : '?' });
  }
  return faces;
}

/* ── 3. woff2 글리프 커버리지 ──────────────────────────────────────────── */

// WOFF2 의 known-table 색인 (스펙 표) — 여기서는 `cmap`(0)·`glyf`(10)·`loca`(11) 만 쓴다.
const WOFF2_GLYF = 10;
const WOFF2_LOCA = 11;

function readUIntBase128(buf, pos) {
  let value = 0;
  for (let n = 0; n < 5; n += 1) {
    const b = buf[pos + n];
    if (b === undefined) throw new Error('UIntBase128 가 잘렸다');
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return [value, pos + n + 1];
  }
  throw new Error('UIntBase128 가 5바이트를 넘는다');
}

/** woff2 컨테이너를 풀어 `cmap` 테이블만 꺼낸다 — cmap 은 변환 대상이 아니라 그대로 실려 있다. */
function extractCmapTable(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4632) throw new Error('woff2 시그니처가 아니다');
  const numTables = buf.readUInt16BE(12);
  let pos = 48;
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos]; pos += 1;
    const index = flags & 0x3f;
    let tag;
    if (index === 0x3f) { tag = buf.toString('latin1', pos, pos + 4); pos += 4; }
    else { tag = index === 0 ? 'cmap' : `#${index}`; }
    let origLength; [origLength, pos] = readUIntBase128(buf, pos);
    const version = (flags >> 6) & 0x03;
    const transformed = (index === WOFF2_GLYF || index === WOFF2_LOCA) ? version === 0 : version !== 0;
    let length = origLength;
    if (transformed) [length, pos] = readUIntBase128(buf, pos);
    entries.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(pos));
  let offset = 0;
  for (const e of entries) {
    if (e.tag === 'cmap') return data.subarray(offset, offset + e.length);
    offset += e.length;
  }
  throw new Error('woff2 에 cmap 테이블이 없다');
}

function codepointsFromCmap(cmap) {
  const numTables = cmap.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 4 + i * 8;
    const platform = cmap.readUInt16BE(rec);
    const encoding = cmap.readUInt16BE(rec + 2);
    const offset = cmap.readUInt32BE(rec + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = cmap.readUInt16BE(offset);
    // format 12 는 BMP 밖까지 담으므로, 둘 다 있으면 그쪽이 상위 집합이다.
    if (format === 12 || (format === 4 && !best)) best = { format, offset };
    if (format === 12) break;
  }
  if (!best) throw new Error('cmap 에 유니코드 서브테이블(format 4/12)이 없다');
  const cps = new Set();
  if (best.format === 12) {
    const nGroups = cmap.readUInt32BE(best.offset + 12);
    for (let g = 0; g < nGroups; g += 1) {
      const p = best.offset + 16 + g * 12;
      const start = cmap.readUInt32BE(p);
      const end = cmap.readUInt32BE(p + 4);
      if (cmap.readUInt32BE(p + 8) === 0) continue;
      for (let cp = start; cp <= end; cp += 1) cps.add(cp);
    }
    return cps;
  }
  const segCount = cmap.readUInt16BE(best.offset + 6) / 2;
  const endBase = best.offset + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  for (let s = 0; s < segCount; s += 1) {
    const end = cmap.readUInt16BE(endBase + s * 2);
    const start = cmap.readUInt16BE(startBase + s * 2);
    const delta = cmap.readInt16BE(deltaBase + s * 2);
    const rangeOffset = cmap.readUInt16BE(rangeBase + s * 2);
    if (start === 0xffff) continue;
    for (let cp = start; cp <= end; cp += 1) {
      let gid;
      if (rangeOffset === 0) gid = (cp + delta) & 0xffff;
      else {
        const gp = rangeBase + s * 2 + rangeOffset + (cp - start) * 2;
        if (gp + 1 >= cmap.length) continue;
        gid = cmap.readUInt16BE(gp);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) cps.add(cp);
    }
  }
  return cps;
}

function fontCodepoints(absPath) {
  const cps = codepointsFromCmap(extractCmapTable(readFileSync(absPath)));
  // 0 글리프는 파싱 성공이 아니라 판독 실패다 — 통과로 접으면 게이트가 조용히 무력해진다.
  if (cps.size === 0) throw new Error('cmap 에서 읽어낸 글리프가 0건이다');
  return cps;
}

/* ── 4. 게이트 ─────────────────────────────────────────────────────────── */

// `process.exit()` 는 파이프로 나가는 비동기 쓰기를 버린다 — red 사유가 유일한 산출물이라
// 잘리면 운영자가 이유 없는 차단을 본다 (`check-imports.mjs` 와 같은 이유).
const say = (line) => writeSync(1, `${line}\n`);
const fail = (line) => writeSync(2, `${line}\n`);

const label = (ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`;
const sortChars = (chars) => [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const countIn = (used, ranges) => [...used].filter((ch) => inRanges(ch.codePointAt(0), ranges)).length;

function main() {
  const used = collectUsedChars();
  if (process.argv.includes('--emit-charset')) {
    writeSync(1, sortChars(used).join(''));
    return 0;
  }

  const html = readFileSync(join(ROOT, ENTRY_HTML), 'utf8');
  const faces = parseFontFaces(html);
  if (faces.length === 0) {
    fail('::error::index.html 에 @font-face 가 하나도 없다 — 표면이 통째로 시스템 폰트로 떨어진다 (REQ-812)');
    return 1;
  }

  const declared = [];
  const missing = [];
  for (const face of faces) {
    let cps;
    try {
      cps = fontCodepoints(join(ROOT, face.file));
    } catch (err) {
      fail(`::error::[C] ${face.file} 을 읽을 수 없다 — ${err.message}`);
      fail('    조치: index.html 의 @font-face src 경로와 assets/fonts/ 의 실파일을 대조하고, 없으면 bash scripts/subset-fonts.sh 로 다시 만든다.');
      return 1;
    }
    declared.push(...face.ranges);
    const gaps = sortChars([...used].filter((ch) => inRanges(ch.codePointAt(0), face.ranges) && !cps.has(ch.codePointAt(0))));
    if (gaps.length > 0) missing.push({ face, gaps });
    say(`${face.file} (weight ${face.weight}) — 글리프 ${cps.size}건 · 담당 글자 ${countIn(used, face.ranges)}건`);
  }
  const unranged = sortChars([...used].filter((ch) => !inRanges(ch.codePointAt(0), declared)));
  say(`빌드 사용 글자 ${used.size}건 · @font-face ${faces.length}벌 · 검사 파일 ${sourceFiles().length}건`);

  if (unranged.length === 0 && missing.length === 0) {
    say('폰트 커버리지 OK — 미커버 글자 0건');
    return 0;
  }

  fail('::error::폰트 커버리지 미달 — 아래 글자가 두부(□)이거나 시스템 폰트로 떨어진다 (REQ-804)');
  if (unranged.length > 0) {
    fail(`[A] 어느 @font-face 의 unicode-range 에도 들지 않는다 — 시스템 폰트 폴백 (${unranged.length}건)`);
    fail(`    ${unranged.map(label).join(' ')}`);
    fail('    조치: index.html 의 unicode-range 와 scripts/subset-fonts.sh 의 대응 범위를 함께 넓힌 뒤 재실행 — 또는 그 글자를 쓰지 않는 문구로 바꾼다.');
  }
  for (const { face, gaps } of missing) {
    fail(`[B] ${face.file} 에 글리프가 없다 — 두부(□) (${gaps.length}건)`);
    fail(`    ${gaps.map(label).join(' ')}`);
  }
  if (missing.length > 0) {
    fail('    조치: bash scripts/subset-fonts.sh 를 재실행해 assets/fonts/ 의 woff2 를 갱신하고 같은 커밋에 담는다.');
    fail('    서브셋은 「현재 빌드에 있는 글자」만 덮으므로, 새 문구를 넣은 커밋마다 이 재실행이 필요한 것이 정상 동작이다 — 게이트를 우회하지 마라.');
  }
  return 1;
}

process.exit(main());
