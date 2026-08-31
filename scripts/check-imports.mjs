// ESM import 해석 검사 — `node --check` 가 파일을 하나씩 독립 파싱하느라 못 보는
// 「상대 경로가 실재하는가 · 그 이름을 실제로 export 하는가」 두 축을 닫는다 (#9).
//
//   node scripts/check-imports.mjs
//
// 판정은 종료 코드다. 대상 0건도 실패로 친다 — 검사가 사라진 것과 통과가 같은
// 문면이 되지 않도록, green 경로에 「해석한 지정자 N건」을 stdout 에 남긴다.
//
// 수단은 `vm.SourceTextModule.link()` 다. link 는 V8 의 ModuleDeclarationInstantiation
// 을 태워 ResolveExport 까지 수행하므로 named export 파손이 SyntaxError 로 뜨고,
// 평가는 `evaluate()` 에서만 일어나므로 DOM 을 만지는 `src/ui/**` 도 브라우저 없이
// 안전하게 검사된다 (실측: node 22·26 동일).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');

// vm 모듈 API 는 플래그 뒤에 있다 — 호출자가 잊어도 검사가 무음으로 빠지지 않도록
// 스스로 다시 띄운다.
if (typeof vm.SourceTextModule !== 'function') {
  const re = spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules', SELF, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(re.status ?? 1);
}

const BUILTINS = new Set(builtinModules);

function trackedModules() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '*.mjs'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean).map((p) => resolve(ROOT, p));
}

/** 실패는 `<모듈>::<메시지>` 로 중복 제거한다 — 같은 파손이 여러 진입점에서 재관측된다. */
const failures = new Map();
/** 해석 성공한 (importer, specifier) 간선. 진입점마다 다시 세지 않도록 여기서 합친다. */
const edges = new Set();

const rel = (p) => relative(ROOT, p);

async function builtinRecord(spec) {
  const ns = await import(spec);
  const names = Object.keys(ns);
  const m = new vm.SyntheticModule(names, function () {
    for (const n of names) this.setExport(n, ns[n]);
  }, { identifier: spec });
  await m.link(() => { throw new Error('unreachable'); });
  return m;
}

async function linkFrom(entry) {
  // 링크 실패는 그래프 전체를 못 쓰게 만들므로 진입점마다 캐시를 새로 판다.
  const cache = new Map();

  const load = (path) => {
    const hit = cache.get(path);
    if (hit) return hit;
    const src = readFileSync(path, 'utf8');
    const mod = new vm.SourceTextModule(src, { identifier: path });
    cache.set(path, mod);
    return mod;
  };

  const linker = async (spec, referencing) => {
    const from = referencing.identifier;
    if (spec.startsWith('node:') || BUILTINS.has(spec)) {
      edges.add(`${rel(from)}\t${spec}`);
      return builtinRecord(spec);
    }
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // 의존성 0 계약이라 bare 지정자는 해석 대상이 아니라 결함이다.
      throw new Error(`bare 지정자 '${spec}' — 이 repo 는 런타임 의존성이 없다`);
    }
    const target = resolve(dirname(from), spec);
    // 절대 경로가 메시지에 새면 머신마다 문면이 달라진다 — repo 상대로 다시 던진다.
    try {
      readFileSync(target);
    } catch {
      throw new Error(`'${spec}' 대상 없음 — ${rel(from)} → ${rel(target)}`);
    }
    edges.add(`${rel(from)}\t${spec}`);
    return load(target);
  };

  try {
    await load(entry).link(linker);
  } catch (err) {
    failures.set(`${rel(entry)}::${err.message}`, `${rel(entry)}: ${err.message}`);
  }
}

const entries = trackedModules();
if (entries.length === 0) {
  console.error('::error::.mjs 대상 0건 — import 해석 검사가 무음 통과했다');
  process.exit(1);
}

for (const entry of entries) await linkFrom(entry);

if (edges.size === 0) {
  console.error(`::error::import 지정자 0건 (.mjs ${entries.length}) — 해석 대상이 사라졌다`);
  process.exit(1);
}

if (failures.size > 0) {
  for (const line of failures.values()) console.error(`::error::${line}`);
  console.error(`import 해석 실패 ${failures.size}건 (.mjs ${entries.length} · 해석한 지정자 ${edges.size}건)`);
  process.exit(1);
}

console.log(`해석한 지정자 ${edges.size}건 (.mjs ${entries.length})`);
