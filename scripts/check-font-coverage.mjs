#!/usr/bin/env node
// 폰트 커버리지 게이트 (REQ-804) — 출하 번들이 실제로 그리는 글자를 모으고, `index.html` 의
// `@font-face` 선언이 그 전부를 덮는지 대조한다. 서브셋 문자 집합은 사람이 손으로 관리하므로,
// 새 문구가 조용히 두부(□)로 렌더되는 것을 막을 층이 이것뿐이다.
//
// 사용법:
//   node scripts/check-font-coverage.mjs                        게이트 — 미커버 글자를 열거하고 비-0 종료
//   node scripts/check-font-coverage.mjs --emit-charset         수집한 글자 전량을 stdout 에
//   node scripts/check-font-coverage.mjs --emit-charset <면 파일>  그 면이 담당하는 글자만
//
// 문자 수집과 서브셋 생성이 같은 수집기를 쓰므로 둘이 어긋날 수 없다 — `subset-fonts.sh` 가
// 면별 `--emit-charset` 산출을 그대로 pyftsubset 에 넘기고, 면의 담당 범위는 `index.html` 의
// `unicode-range` 한 곳에서만 정해진다.

// 수집기의 선언된 한계 (best-effort, 여기서 멈춘다): 주석 제거는 따옴표·템플릿 보간·정규식
// 리터럴까지 모델링하되, 정규식과 나눗셈은 직전 토큰으로만 가르므로 `}` 뒤의 `/` 처럼 블록 끝과
// 객체 리터럴 끝이 같은 글자인 자리에서는 어긋날 수 있다. 어긋나면 주석이 남아 과수집되고,
// `src/**` 주석의 범위 밖 기호(2026-09 실측 `≥`·`δ`·`∞` 3자)가 [A] red 로 뜬다 — 오차단이며
// 메시지가 그 글자를 짚어 준다. 완결은 JS 파서를 들여야 닫히는데 무의존 계약과 맞바꿀 값이
// 아니다. 주석 기호가 몰려 있는 CJK 구두점은 `unicode-range` 가 덮어 두었다.

import { existsSync, readFileSync, readdirSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_HTML = 'index.html';

/* ── 1. 출하 번들이 그리는 글자 ────────────────────────────────────────── */

/** 주석은 렌더되지 않으므로 뺀다 — 넣으면 읽히지도 않을 글리프로 서브셋이 부푼다. */
// `/` 가 나눗셈인지 정규식 시작인지는 직전 유의 토큰이 가른다 — 값으로 끝났으면 나눗셈이고,
// 그 값처럼 보이는 것이 식을 여는 키워드면 다시 정규식이다.
const DIV_AFTER = /[\w$)\]]/u;
const EXPR_KEYWORDS = new Set([
  'return', 'throw', 'yield', 'typeof', 'instanceof', 'in', 'of', 'case',
  'delete', 'void', 'new', 'do', 'else', 'await',
]);

/** 정규식 리터럴을 건너뛴다 — 그 안의 따옴표를 문자열로 읽으면 뒤따르는 주석이 통째로 남는다. */
function skipRegex(src, start) {
  let inClass = false;
  for (let i = start + 1; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '\n') return start; // 줄을 넘는 정규식은 없다 — 나눗셈으로 되읽는다
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i;
  }
  return start;
}

function stripJsComments(src) {
  const out = [];
  const frames = [];
  let state = 'code';
  let depth = 0;
  let prev = '';
  let word = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && (!DIV_AFTER.test(prev) || EXPR_KEYWORDS.has(word))) {
        const end = skipRegex(src, i);
        if (end > i) { out.push(src.slice(i, end + 1)); prev = '/'; word = ''; i = end + 1; continue; }
      }
      if (c === "'" || c === '"' || c === '`') { frames.push({ state, depth }); state = c; }
      else if (c === '{') depth += 1;
      else if (c === '}') {
        // 보간 구간의 닫는 중괄호만이 템플릿으로 되돌리는 신호다 — 그 안의 객체 리터럴이 아니라.
        if (depth > 0) depth -= 1;
        else if (frames.length > 0) ({ state, depth } = frames.pop());
      }
      if (!/\s/u.test(c)) prev = c;
      // 공백은 낱말을 끊지 않는다 — `return /re/` 의 `/` 직전 글자는 공백이 아니라 `n` 이다.
      if (/[\w$]/u.test(c)) word += c;
      else if (!/\s/u.test(c)) word = '';
      out.push(c); i += 1; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out.push(c); } i += 1; continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; } else i += 1; continue; }
    if (c === '\\') { out.push(c, d ?? ''); i += 2; continue; }
    if (state === '`' && c === '$' && d === '{') {
      frames.push({ state, depth }); state = 'code'; depth = 0; out.push(c, d); i += 2; continue;
    }
    if (c === state) { ({ state, depth } = frames.pop() ?? { state: 'code', depth }); prev = c; word = ''; }
    out.push(c); i += 1;
  }
  return out.join('');
}

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** JS 이스케이프로 적힌 문자도 화면에는 글리프로 나온다 — CSS 이스케이프와 같은 축이다. */
function decodeJsEscapes(js) {
  const cps = [];
  for (const m of js.matchAll(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g)) {
    const cp = Number.parseInt(m[1] ?? m[2] ?? m[3], 16);
    if (cp > 0x20 && cp <= 0x10ffff) cps.push(String.fromCodePoint(cp));
  }
  return cps.join('');
}
const stripHtmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, ' ');

/** CSS `content` 의 `\25B6` 는 소스에 ASCII 로 적히지만 화면에는 글리프로 나온다. */
function decodeCssEscapes(css) {
  const cps = [];
  for (const m of css.matchAll(/\\([0-9a-fA-F]{1,6})[ \t\r\n]?/g)) {
    const cp = Number.parseInt(m[1], 16);
    if (cp > 0x20 && cp <= 0x10ffff) cps.push(String.fromCodePoint(cp));
  }
  return cps.join('');
}

const BLOCK_RE = /<(style|script)\b[^>]*>([\s\S]*?)<\/\1>/gi;
// HTML 은 `;` 없는 참조도 해독하므로 종결자를 선택으로 둔다. 명명형은 XML 5종의 `;` 형태만
// 허용하고 나머지는 거부한다 — 목록이 2천 항의 열린 집합이라 해독하는 쪽은 닫히지 않는다.
const NUMERIC_REF_RE = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g;
const ANY_NAMED_REF_RE = /&([A-Za-z][A-Za-z0-9]*)(;?)/g;
const XML_REFS = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** `&#x65B0;` 은 소스에 ASCII 로 적히지만 화면에는 글리프로 나온다 — CSS·JS 이스케이프와 같은 축이다. */
function decodeNumericRefs(markup) {
  const cps = [];
  for (const m of markup.matchAll(NUMERIC_REF_RE)) {
    const cp = Number.parseInt(m[1] ?? m[2], m[1] ? 16 : 10);
    if (cp > 0x20 && cp <= 0x10ffff) cps.push(String.fromCodePoint(cp));
  }
  return cps.join('');
}

/** `<script>`·`<style>` 는 raw text 라 참조를 해독하지 않는다 — 그 안의 `&&` 를 참조로 읽으면 오차단이다. */
const markupText = (html) => stripHtmlComments(html).replace(BLOCK_RE, ' ');

function namedRefs(html) {
  const found = [...markupText(html).matchAll(ANY_NAMED_REF_RE)]
    .filter((m) => !(m[2] === ';' && XML_REFS.has(m[1])))
    .map((m) => `&${m[1]}${m[2]}`);
  return [...new Set(found)].sort();
}

/** `<style>`·`<script>` 는 언어가 달라 주석 문법도 다르다 — 블록별로 갈라 벗긴다. */
function renderableTextFromHtml(html) {
  const body = stripHtmlComments(html);
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(BLOCK_RE)) {
    parts.push(body.slice(last, m.index));
    if (m[1].toLowerCase() === 'style') {
      const css = stripCssComments(m[2]);
      parts.push(css, decodeCssEscapes(css));
    } else {
      const js = stripJsComments(m[2]);
      parts.push(js, decodeJsEscapes(js));
    }
    last = m.index + m[0].length;
  }
  parts.push(body.slice(last));
  return `${parts.join('\n')}\n${decodeNumericRefs(markupText(html))}`;
}

function walk(dir, out = []) {
  const entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(mjs|json)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** 출하되는 것만 본다 — `docs/`·`tests/`·`scripts/` 는 브라우저에 실리지 않는다. */
function sourceFiles() {
  const files = [ENTRY_HTML, ...walk('src')];
  // 대상이 진입 문서 하나뿐이면 통과가 아니라 수집기가 사라진 것이다 (구문 검사 스텝과 같은 원칙).
  if (!files.includes(ENTRY_HTML) || !files.some((f) => f.startsWith('src/'))) {
    throw new Error(`검사 대상이 온전하지 않다 — ${ENTRY_HTML} 과 src/ 모듈이 모두 있어야 한다 (실측 ${files.length}건)`);
  }
  return files;
}

// 기본 무시 문자(ZWSP·방향 표시 등)는 폰트가 글리프를 갖지 않아도 정상 렌더된다 — 유니코드가
// 정의하는 성질이라 배제 목록이 아니다.
const RENDERS = (ch) => ch.codePointAt(0) > 0x20 && !/\p{Default_Ignorable_Code_Point}/u.test(ch);

function collectUsedChars(files) {
  const used = new Set();
  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    let text;
    if (rel === ENTRY_HTML) text = renderableTextFromHtml(raw);
    else if (rel.endsWith('.mjs')) { const js = stripJsComments(raw); text = js + decodeJsEscapes(js); }
    else text = raw;
    for (const ch of text) if (RENDERS(ch)) used.add(ch);
  }
  if (used.size === 0) throw new Error('수집한 글자가 0건이다 — 통과가 아니라 수집기 고장이다');
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

/** 주석 처리된 선언은 살아 있는 면이 아니다 — 수집기와 같은 전처리를 거쳐야 둘이 같은 문서를 본다. */
function parseFontFaces(html) {
  const faces = [];
  for (const m of stripCssComments(stripHtmlComments(html)).matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const block = m[1];
    const src = block.match(/url\(['"]?([^'")]+)['"]?\)/);
    const range = block.match(/unicode-range\s*:\s*([^;}]+)/);
    const weight = block.match(/font-weight\s*:\s*([^;}]+)/);
    if (!src) throw new Error(`@font-face 에 src url 이 없다: ${block.trim().slice(0, 60)}`);
    if (!range) throw new Error(`@font-face 에 unicode-range 가 없다 (${src[1]}) — 범위 없는 면은 커버리지를 판정할 수 없다`);
    faces.push({ file: src[1], ranges: parseUnicodeRange(range[1]), weight: weight ? weight[1].trim() : '?' });
  }
  if (faces.length === 0) throw new Error(`${ENTRY_HTML} 에 @font-face 가 하나도 없다 — 표면이 통째로 시스템 폰트로 떨어진다 (REQ-812)`);
  return faces;
}

/* ── 3. woff2 글리프 커버리지 ──────────────────────────────────────────── */

// WOFF2 known-table 색인 중 이 파서가 이름을 아는 것 — cmap 은 변환 대상이 아니라 그대로 실린다.
const WOFF2_CMAP = 0;
const WOFF2_GLYF = 10;
const WOFF2_LOCA = 11;

function readUIntBase128(buf, pos) {
  let value = 0;
  for (let n = 0; n < 5; n += 1) {
    const b = buf[pos + n];
    if (b === undefined) throw new Error('UIntBase128 이 잘렸다');
    if (n === 0 && b === 0x80) throw new Error('UIntBase128 선행 0 은 스펙 위반이다');
    value = value * 128 + (b & 0x7f);
    if (value > 0xffffffff) throw new Error('UIntBase128 이 2^32 를 넘는다');
    if ((b & 0x80) === 0) return [value, pos + n + 1];
  }
  throw new Error('UIntBase128 이 5바이트를 넘는다');
}

function extractCmapTable(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4632) throw new Error('woff2 시그니처가 아니다');
  // 컬렉션은 디렉터리 뒤에 CollectionDirectory 가 더 붙어 오프셋이 어긋난다 — 조용히 오독하느니 거부한다.
  if (buf.readUInt32BE(4) === 0x74746366) throw new Error('woff2 폰트 컬렉션(ttcf)은 이 파서가 읽지 않는다');
  const numTables = buf.readUInt16BE(12);
  let pos = 48;
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos]; pos += 1;
    const index = flags & 0x3f;
    if (index === 0x3f) pos += 4;
    let origLength; [origLength, pos] = readUIntBase128(buf, pos);
    const version = (flags >> 6) & 0x03;
    const transformed = (index === WOFF2_GLYF || index === WOFF2_LOCA) ? version === 0 : version !== 0;
    let length = origLength;
    if (transformed) [length, pos] = readUIntBase128(buf, pos);
    entries.push({ index, length });
  }
  // 압축 스트림 뒤에 metadata·private 블록이 붙을 수 있으므로 헤더가 적은 길이만 넘긴다.
  const data = brotliDecompressSync(buf.subarray(pos, pos + buf.readUInt32BE(20)));
  let offset = 0;
  for (const e of entries) {
    if (e.index === WOFF2_CMAP) return data.subarray(offset, offset + e.length);
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
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = cmap.readUInt16BE(offset);
    // format 12 는 BMP 밖까지 담으므로, 둘 다 있으면 그쪽이 상위 집합이다.
    if (format === 12) { best = { format, offset }; break; }
    if (format === 4 && !best) best = { format, offset };
  }
  if (!best) throw new Error('cmap 에 유니코드 서브테이블(format 4/12)이 없다');
  const cps = new Set();
  if (best.format === 12) {
    const nGroups = cmap.readUInt32BE(best.offset + 12);
    for (let g = 0; g < nGroups; g += 1) {
      const p = best.offset + 16 + g * 12;
      const start = cmap.readUInt32BE(p);
      const end = cmap.readUInt32BE(p + 4);
      const startGid = cmap.readUInt32BE(p + 8);
      // gid 0 은 .notdef 이라 그 코드포인트만 빠진다 — 그룹 전체가 아니다 (format 4 와 같은 판정).
      for (let cp = start; cp <= end; cp += 1) if (startGid + (cp - start) !== 0) cps.add(cp);
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

/* ── 3-b. 자산 참조 ────────────────────────────────────────────────────── */

/** 아이콘은 id 로만 참조되므로 파일이 사라져도 코드가 조용하다 — 참조 해소를 여기서 문다 (REQ-931). */
function brokenAssetRefs(html) {
  const clean = stripCssComments(stripHtmlComments(html));
  const refs = new Set([
    ...[...clean.matchAll(/url\(['"]?(assets\/[^'")]+)['"]?\)/g)].map((m) => m[1]),
    ...[...clean.matchAll(/(?:href|src)="(assets\/[^"]+)"/g)].map((m) => m[1]),
  ]);
  return [...refs].sort().filter((rel) => !existsSync(join(ROOT, rel)));
}

/* ── 4. 게이트 ─────────────────────────────────────────────────────────── */

// `process.exit()` 는 파이프로 나가는 비동기 쓰기를 버린다 — red 사유가 유일한 산출물이라
// 잘리면 운영자가 이유 없는 차단을 본다 (`check-imports.mjs` 와 같은 이유).
const say = (line) => writeSync(1, `${line}\n`);
const fail = (line) => writeSync(2, `${line}\n`);

const label = (ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`;
const sortChars = (chars) => [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const countIn = (used, ranges) => [...used].filter((ch) => inRanges(ch.codePointAt(0), ranges)).length;

function run() {
  const files = sourceFiles();
  const used = collectUsedChars(files);
  const html = readFileSync(join(ROOT, ENTRY_HTML), 'utf8');

  const emitAt = process.argv.indexOf('--emit-charset');
  if (emitAt !== -1) {
    const target = process.argv[emitAt + 1];
    let chars = [...used];
    if (target) {
      const face = parseFontFaces(html).find((f) => f.file === target);
      if (!face) throw new Error(`${ENTRY_HTML} 에 그 @font-face 가 없다: ${target}`);
      chars = chars.filter((ch) => inRanges(ch.codePointAt(0), face.ranges));
    }
    writeSync(1, sortChars(chars).join(''));
    return 0;
  }

  const broken = brokenAssetRefs(html);
  if (broken.length > 0) {
    fail(`::error::[D] index.html 이 가리키는 자산이 없다 (${broken.length}건) — 아이콘은 id 로만 참조되므로 코드는 조용하다 (REQ-931)`);
    for (const rel of broken) fail(`    ${rel}`);
    fail('    조치: 파일을 그 경로에 두거나, index.html 의 참조를 실파일 이름으로 맞춘다.');
    return 1;
  }

  const named = namedRefs(html);
  if (named.length > 0) {
    fail(`::error::[E] index.html 에 명명 문자 참조가 있다 (${named.length}건) — 이 게이트는 해독하지 않으므로 커버리지가 무의미해진다`);
    fail(`    ${named.join(' ')}`);
    fail('    조치: 그 자리에 유니코드 문자를 그대로 적는다 (문서는 UTF-8 이다). 수치형 참조(&#x2026;)는 해독하므로 그대로 써도 된다.');
    return 1;
  }

  const faces = parseFontFaces(html);
  const declared = [];
  const missing = [];
  for (const face of faces) {
    let cps;
    try {
      cps = fontCodepoints(join(ROOT, face.file));
    } catch (err) {
      fail(`::error::[C] ${face.file} 을 읽을 수 없다 — ${err.message}`);
      fail('    조치: index.html 의 @font-face src 경로와 assets/fonts/ 의 실파일을 대조하고, 없으면 bash scripts/subset-fonts.sh 로 다시 만든다.');
      fail(`    그 면의 담당 글자가 0건이면(현재 ${countIn(used, face.ranges)}건) 서브셋이 비어 만들어진 것이다 — 재실행이 아니라 그 @font-face 를 지운다.`);
      return 1;
    }
    declared.push(...face.ranges);
    const gaps = sortChars([...used].filter((ch) => inRanges(ch.codePointAt(0), face.ranges) && !cps.has(ch.codePointAt(0))));
    if (gaps.length > 0) missing.push({ face, gaps });
    say(`${face.file} (weight ${face.weight}) — 글리프 ${cps.size}건 · 담당 글자 ${countIn(used, face.ranges)}건`);
  }
  const unranged = sortChars([...used].filter((ch) => !inRanges(ch.codePointAt(0), declared)));
  say(`빌드 사용 글자 ${used.size}건 · @font-face ${faces.length}벌 · 검사 파일 ${files.length}건`);

  if (unranged.length === 0 && missing.length === 0) {
    say('폰트 커버리지 OK — 미커버 글자 0건');
    return 0;
  }

  fail('::error::폰트 커버리지 미달 — 아래 글자가 두부(□)이거나 시스템 폰트로 떨어진다 (REQ-804)');
  if (unranged.length > 0) {
    fail(`[A] 어느 @font-face 의 unicode-range 에도 들지 않는다 — 시스템 폰트 폴백 (${unranged.length}건)`);
    fail(`    ${unranged.map(label).join(' ')}`);
    fail('    조치: index.html 의 unicode-range 를 넓힌 뒤 scripts/subset-fonts.sh 를 재실행 — 또는 그 글자를 쓰지 않는 문구로 바꾼다.');
  }
  for (const { face, gaps } of missing) {
    fail(`[B] ${face.file} 에 글리프가 없다 — 두부(□) (${gaps.length}건)`);
    fail(`    ${gaps.map(label).join(' ')}`);
  }
  if (missing.length > 0) {
    fail('    조치: bash scripts/subset-fonts.sh 를 재실행해 assets/fonts/ 의 woff2 를 갱신하고 같은 커밋에 담는다.');
    fail('    서브셋은 「현재 빌드에 있는 글자」만 덮으므로, 새 문구를 넣은 커밋마다 이 재실행이 필요한 것이 정상 동작이다 — 게이트를 우회하지 마라.');
    fail('    재실행해도 같은 글자가 남으면 원본 폰트 자체에 그 글리프가 없다는 뜻이다 — 그때는 문구를 바꾼다.');
  }
  return 1;
}

function main() {
  try {
    return run();
  } catch (err) {
    // 여기서 새는 예외는 스택 트레이스만 남겨 red 사유를 잃는다 — 게이트의 산출물은 사유다.
    fail(`::error::폰트 커버리지 게이트가 판정을 내지 못했다 — ${err.message}`);
    return 1;
  }
}

process.exit(main());
