// ESM import 해석 검사 — `node --check` 가 파일을 하나씩 독립 파싱하느라 못 보는
// 「상대 경로가 실재하는가 · 그 이름을 실제로 export 하는가」 두 축을 닫는다 (#9).
//
//   node scripts/check-imports.mjs
//
// 수단은 `vm.SourceTextModule.link()` 다. 링크는 V8 의 ResolveExport 까지 수행하므로
// named export 파손이 잡히고, 평가는 `evaluate()` 에서만 일어나므로 DOM 을 만지는
// `src/ui/**` 도 브라우저 없이 검사된다 (부수효과로 PR 저자의 코드가 CI 에서 실행되지
// 않는다). 사각은 링크 단계에 오르지 않는 것들 — 동적 `import()` 와 런타임 경로 조립.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const REEXEC = '__CHECK_IMPORTS_REEXEC';

// `process.exit()` 는 파이프로 나가는 비동기 쓰기를 버린다 — red 사유가 유일한 산출물인
// 경로에서 그 줄이 잘리면 운영자가 이유 없는 차단을 본다.
const fail = (line) => writeSync(2, `::error::${line}\n`);

// vm 모듈 API 는 플래그 뒤에 있다 — 호출자가 잊어도 검사가 무음으로 빠지지 않도록
// 스스로 다시 띄우되, 마커로 한 번만 시도한다 (플래그를 무시-수락하는 런타임에서
// 종료 조건 없는 재귀 spawn 이 되지 않도록).
if (typeof vm.SourceTextModule !== 'function') {
  if (process.env[REEXEC]) {
    fail('vm 모듈 API 를 켤 수 없다 — --experimental-vm-modules 를 지원하는 런타임이 필요하다');
    process.exit(1);
  }
  const child = spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-vm-modules', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, [REEXEC]: '1' } },
  );
  process.exit(child.status ?? 1);
}

const BUILTINS = new Set(builtinModules);
const MISSING_EXPORT = /The requested module '(.+?)' does not provide an export named/;

function trackedModules() {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '*.mjs'], { encoding: 'utf8' });
    return out.split('\0').filter(Boolean).map((p) => resolve(ROOT, p));
  } catch (err) {
    fail(`git ls-files 실패 — 검사 대상을 뽑을 수 없다 (${err.message})`);
    process.exit(1);
  }
}

/** 실패는 메시지로 중복 제거한다 — 한 곳의 파손이 그 모듈을 경유하는 진입점 수만큼 재관측된다. */
const failures = new Map();
/** 해석 성공한 (importer, specifier) 간선. 진입점마다 다시 세지 않도록 여기서 합친다. */
const relEdges = new Set();
const builtinEdges = new Set();

const rel = (p) => relative(ROOT, p);

async function builtinRecord(spec) {
  const ns = await import(spec);
  const names = Object.keys(ns);
  const mod = new vm.SyntheticModule(names, function () {
    for (const n of names) this.setExport(n, ns[n]);
  }, { identifier: spec });
  await mod.link(() => { throw new Error('unreachable'); });
  return mod;
}

async function jsonRecord(path, attributes) {
  if (attributes?.type !== 'json') {
    throw new Error(`'${rel(path)}' — JSON 모듈에는 \`with { type: 'json' }\` 가 필요하다 (브라우저가 거부한다)`);
  }
  // JSON 모듈은 `default` 하나만 내놓는다 — 판정표를 JSON 으로 빼는 것이 repo 계약이라
  // 이 갈래가 없으면 그 첫 커밋에서 required check 가 오탐 red 를 낸다.
  const value = JSON.parse(readFileSync(path, 'utf8'));
  const mod = new vm.SyntheticModule(['default'], function () {
    this.setExport('default', value);
  }, { identifier: path });
  await mod.link(() => { throw new Error('unreachable'); });
  return mod;
}

async function linkFrom(entry) {
  // 링크 실패는 그래프 전체를 못 쓰게 만들므로 진입점마다 캐시를 새로 판다.
  const cache = new Map();

  const load = (path) => {
    const hit = cache.get(path);
    if (hit) return hit;
    const mod = new vm.SourceTextModule(readFileSync(path, 'utf8'), { identifier: path });
    cache.set(path, mod);
    return mod;
  };

  const linker = async (spec, referencing, extra) => {
    const from = referencing.identifier;
    // 이 스크립트가 유일하게 실행하는 남의 지정자다 — 도메인을 코어 모듈로 못박는다.
    if (BUILTINS.has(spec.startsWith('node:') ? spec.slice(5) : spec)) {
      builtinEdges.add(`${rel(from)}\t${spec}`);
      return builtinRecord(spec);
    }
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // 의존성 0 계약이라 bare 지정자는 해석 대상이 아니라 결함이다.
      throw new Error(`bare 지정자 '${spec}' — 이 repo 는 런타임 의존성이 없다`);
    }
    // `python3 -m http.server` 가 repo 루트를 문서 루트로 서빙하므로 `/`-시작도 합법이고,
    // `?v=1`·`#frag` 는 브라우저가 무는 URL 문법이라 파일명에서 떼고 찾는다.
    const path = spec.split(/[?#]/, 1)[0];
    const target = path.startsWith('/') ? resolve(ROOT, `.${path}`) : resolve(dirname(from), path);
    // 절대 경로가 메시지에 새면 머신마다 문면이 달라진다 — repo 상대로 다시 던진다.
    if (!statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`'${spec}' 대상 파일 없음 — ${rel(from)} → ${rel(target)}`);
    }
    relEdges.add(`${rel(from)}\t${spec}`);
    return target.endsWith('.json') ? jsonRecord(target, extra?.attributes) : load(target);
  };

  if (!statSync(entry, { throwIfNoEntry: false })?.isFile()) {
    failures.set(`gone:${rel(entry)}`, `${rel(entry)} — git 이 추적하지만 워킹트리에 없다`);
    return;
  }
  try {
    await load(entry).link(linker);
  } catch (err) {
    failures.set(err.message, `${err.message}${importerHint(cache, err.message)}`);
  }
}

/** V8 의 ResolveExport 오류는 지정자만 담고 누가 import 했는지는 담지 않는다 — 캐시에서 되찾는다. */
function importerHint(cache, message) {
  const spec = MISSING_EXPORT.exec(message)?.[1];
  if (!spec) return '';
  const importers = [...cache.values()]
    .filter((m) => m.dependencySpecifiers?.includes(spec))
    .map((m) => rel(m.identifier));
  return importers.length > 0 ? ` (import 한 곳: ${importers.join(', ')})` : '';
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// 속성값 따옴표는 HTML 에서 선택이다 — 강제하면 정상 마크업이 오탐 red 를 맞는다.
const MODULE_SCRIPT = /<script\b[^>]*\btype\s*=\s*(?:"module"|'module'|module\b)[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** 배포 진입점. 그래프가 온전해도 이 간선이 끊기면 브라우저는 백지이고 CI 는 green 이다. */
function htmlEntryEdges() {
  const html = 'index.html';
  const path = resolve(ROOT, html);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    failures.set('html:missing', `${html} 이 없다 — 배포 산출물 자체가 사라졌다`);
    return 0;
  }
  let found = 0;
  // 주석 안의 태그는 브라우저가 실행하지 않는다 — 세면 유일한 진입점이 주석 처리돼도 green 이 된다.
  const source = readFileSync(path, 'utf8').replace(HTML_COMMENT, '');
  for (const tag of source.match(MODULE_SCRIPT) ?? []) {
    const m = SRC_ATTR.exec(tag);
    const src = m?.[1] ?? m?.[2] ?? m?.[3];
    if (!src || /^[a-z]+:/i.test(src)) continue;
    const file = src.split(/[?#]/, 1)[0];
    const target = resolve(ROOT, file.startsWith('/') ? `.${file}` : file);
    if (statSync(target, { throwIfNoEntry: false })?.isFile()) found += 1;
    else failures.set(`html:${src}`, `'${src}' 대상 파일 없음 — ${html} → ${rel(target)}`);
  }
  // 간선이 0건이면 「끊긴 진입점」과 문면이 같다 — 그 상태를 green 으로 접으면 이 검사가 없는 것과 같다.
  if (found === 0 && failures.size === 0) {
    failures.set('html:none', `${html} 에 해석 가능한 module script src 가 0건 — 배포 진입점이 사라졌다`);
  }
  return found;
}

const entries = trackedModules();
if (entries.length === 0) {
  fail('.mjs 대상 0건 — import 해석 검사가 무음 통과했다');
  process.exit(1);
}

for (const entry of entries) await linkFrom(entry);
const htmlEdges = htmlEntryEdges();

for (const line of failures.values()) fail(line);

const total = relEdges.size + builtinEdges.size + htmlEdges;
const counts = `해석한 지정자 ${total}건 (.mjs ${entries.length} · 상대 ${relEdges.size} · 내장 ${builtinEdges.size} · html 진입 ${htmlEdges})`;
if (failures.size > 0) {
  writeSync(2, `import 해석 실패 ${failures.size}건 — ${counts}\n`);
  process.exitCode = 1;
} else if (relEdges.size === 0) {
  // 내장 지정자만 남은 상태는 통과가 아니라 검사 대상이 사라진 것이다.
  fail(`상대 지정자 0건 — ${counts}`);
  process.exitCode = 1;
} else {
  console.log(counts);
}
