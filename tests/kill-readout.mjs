// kill-criterion 판독기 (REQ-602·603) — 내보낸 로그 JSON 만으로 (a)(b)(d) 와 선행 게이트를 산출한다.
// 인자 없이 부르면 헤드리스 봇 1사이클을 그 자리에서 만들어 판독한다 (CI 가 쓰는 형태).
//
//   node tests/kill-readout.mjs                 자체 생성 1사이클 판독
//   node tests/kill-readout.mjs <로그.json>      내보낸 파일 판독
//   node tests/kill-readout.mjs --emit <경로>    자체 생성 로그를 그 경로에 쓰고 판독
//
// 종료 코드는 **판독 가능성**이다 — kill 4항의 pass/fail 은 출력이고, 미달이 red 를 만들지 않는다.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BALANCE } from '../src/balance.mjs';
import { isEffectiveSuccess, responseWindowMs } from '../src/core.mjs';
import { LOG_SCHEMA, TIME_FIELD, validate } from '../src/log.mjs';
import { EXPORT_SCHEMA, balanceDigest, exportPayload } from '../src/ui/session.mjs';
import { createSeededRandom, runHeadlessCycle } from '../src/bot.mjs';

/** kill-criterion 임계 (제안서 §7 · spec REQ-603). 판독기는 이 값만 알고 게임 로직은 모른다. */
export const KILL = {
  firstFireMs: 60_000,
  completionRate: 0.5,
  cycleDoneMs: 300_000,
  ignoreRate: 0.15,
};

/** 실전 창 = 사부 대련 구간. 수련 창을 섞으면 (b) 가 손의 증거가 아니라 연습량이 된다. */
const DUEL_PHASE = 'duel';

const SELF_TEST_SEED = 20260902;

// ------------------------------------------------------------------ 로드 · 무결성

function loadPayload(raw) {
  const parsed = JSON.parse(raw);
  // 최상위 배열 = 버퍼만 있는 형태. 그 밖에는 내보내기 계약이라 키 결손을 통과로 접지 않는다.
  if (Array.isArray(parsed)) return { bare: true, entries: parsed, log_violations: [] };
  if (!Array.isArray(parsed.entries)) throw new Error('entries 배열이 없다 — 내보내기 파일이 아니다');
  const missing = ['schema', 'log_violations'].filter((k) => !(k in parsed));
  return {
    ...parsed,
    bare: false,
    missingKeys: missing,
    log_violations: Array.isArray(parsed.log_violations) ? parsed.log_violations : [],
  };
}

/** 필드 결손 0 의 기계적 증명 — 스키마 대조 + 17종 전량 방출 확인 (수용 케이스 11). */
function auditEntries(entries) {
  const problems = [];
  const seen = new Set();
  entries.forEach((entry, i) => {
    const { event, ...rest } = entry;
    seen.add(event);
    if (!(TIME_FIELD in rest)) problems.push(`#${i} ${event}: ${TIME_FIELD} 결손`);
    delete rest[TIME_FIELD];
    try {
      validate(event, rest);
    } catch (err) {
      problems.push(`#${i} ${err.message}`);
    }
  });
  const missing = Object.keys(LOG_SCHEMA).filter((event) => !seen.has(event));
  return { problems, missing, seen };
}

// ------------------------------------------------------------------ 지표 산출

/** 각 항목에 그 시점의 `cycle{phase}` 를 붙인다 — 실전 창과 수련 창의 구분자가 그것뿐이다. */
function withPhase(entries) {
  let phase = null;
  return entries.map((entry) => {
    if (entry.event === 'cycle') phase = entry.phase;
    return { ...entry, phase_at: phase };
  });
}

/**
 * 첫 `cycle_done` 까지 자른다 — 결과 화면에서 계속 플레이한 세션을 그대로 세면
 * (b)·`ignore_rate` 는 2사이클분인데 (d) 만 1사이클분이 되어 지표 구간이 갈린다.
 */
function firstCycle(tagged) {
  const end = tagged.findIndex((e) => e.event === 'cycle' && e.phase === 'cycle_done');
  return end < 0 ? { cycle: tagged, dropped: 0 } : { cycle: tagged.slice(0, end + 1), dropped: tagged.length - end - 1 };
}

const rate = (num, den) => (den ? num / den : null);

export function readout(payload) {
  const { cycle: tagged, dropped } = firstCycle(withPhase(payload.entries));
  const at = (event, pred = () => true) => tagged.find((e) => e.event === event && pred(e)) ?? null;

  const firstFire = at('fire');
  const firstTransmit = at('transmit');
  const cycleDone = at('cycle', (e) => e.phase === 'cycle_done');

  // kill (b) 는 완주율 — 실전 창의 손 입력만 세고 원터치 창은 분모에서 뺀다 (REQ-302·603).
  const duel = tagged.filter((e) => e.phase_at === DUEL_PHASE);
  const handFires = duel.filter((e) => e.event === 'fire' && e.oneTap === false).length;
  const timeouts = duel.filter((e) => e.event === 'timeout').length;

  // 전체와 device별이 같은 술어(`key.accepted`)를 쓴다 — 정의가 갈리면 합이 어긋난다.
  const keys = tagged.filter((e) => e.event === 'key');
  const ignored = keys.filter((e) => !e.accepted);
  const byDevice = {};
  for (const key of keys) {
    byDevice[key.device] ??= { keys: 0, ignores: 0 };
    byDevice[key.device].keys += 1;
    if (!key.accepted) byDevice[key.device].ignores += 1;
  }

  const fires = tagged.filter((e) => e.event === 'fire');
  const selects = tagged.filter((e) => e.event === 'select');
  // 창 잔여의 정확한 값은 비율 `r` 이다 — 창 길이는 **상대 예고**의 수로 열리는데
  // 로그에 그 길이가 없어 ms 환산은 내 시퀀스 길이 기준의 하한 대역으로만 낸다 (REQ-208 게이트).
  const meanRatio = fires.length ? fires.reduce((a, e) => a + e.r, 0) / fires.length : null;

  let attrSwitches = 0;
  let lastAttr = null;
  for (const key of keys) {
    if (key.top_attr && lastAttr && key.top_attr !== lastAttr) attrSwitches += 1;
    if (key.top_attr) lastAttr = key.top_attr;
  }

  return {
    kill: {
      a_first_fire_ms: firstFire ? firstFire[TIME_FIELD] : null,
      b_completion_rate: rate(handFires, handFires + timeouts),
      b_hand_fires: handFires,
      b_timeouts: timeouts,
      d_cycle_done_ms: cycleDone ? cycleDone[TIME_FIELD] : null,
    },
    gate: {
      ignore_rate: rate(ignored.length, keys.length),
      by_device: Object.fromEntries(Object.entries(byDevice)
        .map(([device, v]) => [device, rate(v.ignores, v.keys)])),
    },
    aux: {
      first_transmit_ms: firstTransmit ? firstTransmit[TIME_FIELD] : null,
      select_by_user_rate: rate(selects.filter((e) => e.byUser).length, selects.length),
      one_tap_rate: rate(fires.filter((e) => e.oneTap).length, fires.length),
      tail_ratio_mean: meanRatio,
      tail_ms_band: meanRatio === null ? null
        : [responseWindowMs(BALANCE.windowBaseLen), responseWindowMs(5)].map((w) => Math.round(meanRatio * w)),
      top_attr_switches: attrSwitches,
      verdict_grades: Object.fromEntries(Object.keys(BALANCE.grades).map((grade) => [
        grade, tagged.filter((e) => e.event === 'verdict' && e.grade === grade).length,
      ])),
      effective_success_rate: rate(
        // 외부 파일의 미지 등급은 유효 성공이 아닌 쪽으로 접는다 — 판독이 스택으로 죽지 않게.
        tagged.filter((e) => e.event === 'verdict' && e.who === 'user'
          && e.grade in BALANCE.grades && isEffectiveSuccess(e.grade)).length,
        tagged.filter((e) => e.event === 'verdict' && e.who === 'user').length,
      ),
      tester_role: tagged.findLast((e) => e.event === 'session')?.tester_role ?? null,
      accessibility: payload.accessibility ?? null,
      accessibility_toggles: payload.accessibility_toggles ?? 0,
      dropped_after_cycle: dropped,
    },
  };
}

// ------------------------------------------------------------------ 출력

const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const mark = (pass) => (pass == null ? '  ?' : pass ? '  ✓' : '  ✗');

function report(result) {
  const { kill, gate, aux } = result;
  const a = kill.a_first_fire_ms == null ? null : kill.a_first_fire_ms <= KILL.firstFireMs;
  const b = kill.b_completion_rate == null ? null : kill.b_completion_rate >= KILL.completionRate;
  const d = kill.d_cycle_done_ms == null ? null : kill.d_cycle_done_ms <= KILL.cycleDoneMs;
  const g = gate.ignore_rate == null ? null : gate.ignore_rate <= KILL.ignoreRate;

  console.log(`\n판독 대상: tester_role=${aux.tester_role ?? '미상'}`
    + ` · 응수 창 ×1.3 ${aux.accessibility === null ? '미상' : aux.accessibility ? 'on' : 'off'}`
    + (aux.accessibility_toggles ? ` (사이클 중 ${aux.accessibility_toggles}회 전환 — 모집단 혼재)` : '')
    + (aux.dropped_after_cycle ? ` · 1사이클 이후 ${aux.dropped_after_cycle}건 제외` : ''));
  console.log(`${mark(g)} 선행 게이트  ignore_rate ${pct(gate.ignore_rate)} (임계 ${pct(KILL.ignoreRate)})`
    + ` · device별 ${Object.entries(gate.by_device).map(([d, v]) => `${d} ${pct(v)}`).join(' · ') || '—'}`);
  console.log(`${mark(a)} kill (a)  first_fire_t ${secs(kill.a_first_fire_ms)} (임계 ${secs(KILL.firstFireMs)}, 수련 창 포함)`);
  console.log(`${mark(b)} kill (b)  완주율 ${pct(kill.b_completion_rate)}`
    + ` = fire(oneTap=false) ${kill.b_hand_fires} / (+ timeout ${kill.b_timeouts}) (임계 ${pct(KILL.completionRate)})`);
  console.log('    kill (c)  설문 축 — 로그 외 입력');
  console.log(`${mark(d)} kill (d)  cycle_done_t ${secs(kill.d_cycle_done_ms)} (임계 ${secs(KILL.cycleDoneMs)})`);
  console.log(`    보조  first_transmit ${secs(aux.first_transmit_ms)}`
    + ` · select.byUser ${pct(aux.select_by_user_rate)} · oneTap ${pct(aux.one_tap_rate)}`
    + ` · 창 잔여 ${pct(aux.tail_ratio_mean)} (tail_ms ${aux.tail_ms_band?.join('~') ?? '—'})`
    + ` · top_attr 전환 ${aux.top_attr_switches}회`);
  console.log(`    유효 성공률(유저) ${pct(aux.effective_success_rate)} · 등급 ${JSON.stringify(aux.verdict_grades)}`);
  return { a, b, d, gate: g };
}

// ------------------------------------------------------------------ 진입점

function main(argv) {
  if (argv[0] === '--emit' && !argv[1]) throw new Error('--emit 뒤에 내보낼 경로가 필요하다');
  const emitAt = argv[0] === '--emit' ? argv[1] : null;
  const file = emitAt ? null : argv[0];
  let payload;

  if (file) {
    // 사람이 내려받은 파일을 넘기는 주 경로다 — 경로 오타·손상 JSON 이 raw 스택으로 죽지 않게 접는다.
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`✗ 로그 파일을 읽을 수 없다: ${file} (${err.code ?? err.message})`);
      return 1;
    }
    try {
      payload = loadPayload(raw);
    } catch (err) {
      console.error(`✗ 로그 파일을 판독 형식으로 읽을 수 없다: ${err.message}`);
      return 1;
    }
    console.log(`로그 파일: ${file}`);
  } else {
    // 시드를 박아 CI 판독 결과가 회차마다 흔들리지 않게 한다 — 시드 강건성은 하네스가 쓸어본다.
    const { session, elapsedMs } = runHeadlessCycle({ random: createSeededRandom(SELF_TEST_SEED) });
    // 파일 경로와 같은 정규화를 태워, 자체 생성분도 JSON 왕복을 거친 형태로만 판독된다.
    payload = loadPayload(JSON.stringify(exportPayload(session)));
    console.log(`헤드리스 봇 1사이클 자체 생성 — 가상시간 ${(elapsedMs / 1000).toFixed(1)}s`
      + ` · 이벤트 ${payload.entries.length}건`);
    if (emitAt) {
      writeFileSync(emitAt, JSON.stringify(payload, null, 2));
      console.log(`내보냄: ${emitAt}`);
    }
  }

  let failures = 0;
  if (payload.bare) {
    console.log('· 최상위 배열 — 버퍼만 있는 형태로 읽는다 (위반 목록·밸런스 지문 없음)');
  } else if (payload.missingKeys.length) {
    console.error(`✗ 내보내기 계약 키 결손: ${payload.missingKeys.join(', ')}`
      + ' — 없는 키를 통과로 접으면 지운 파일이 가장 깨끗해 보인다');
    failures += 1;
  } else if (payload.schema !== EXPORT_SCHEMA) {
    console.error(`✗ 알 수 없는 내보내기 스키마: ${payload.schema}`);
    failures += 1;
  }
  const drifted = Object.entries(balanceDigest())
    .filter(([k, v]) => payload.balance && payload.balance[k] !== v);
  if (drifted.length) {
    console.warn(`! 밸런스 지문 불일치 ${drifted.map(([k, v]) => `${k}: 로그 ${payload.balance[k]} vs 현재 ${v}`).join(' · ')}`
      + ' — 파생 지표(창 잔여·유효 성공률)는 현재 표 기준이다');
  }
  if (payload.log_violations.length) {
    console.error(`✗ 로그 스키마 위반 ${payload.log_violations.length}건 — kill 산식 입력으로 쓸 수 없다`);
    for (const v of payload.log_violations.slice(0, 5)) console.error(`    ${v.event}: ${v.reason}`);
    failures += 1;
  }

  const audit = auditEntries(payload.entries);
  if (audit.problems.length) {
    console.error(`✗ 필드 결손 ${audit.problems.length}건`);
    for (const p of audit.problems.slice(0, 10)) console.error(`    ${p}`);
    failures += 1;
  } else {
    console.log(`✓ 필드 결손 0 — ${payload.entries.length}건 전량이 통합 로그 스키마와 일치`);
  }
  if (audit.missing.length) {
    console.error(`✗ 미방출 이벤트 ${audit.missing.length}종: ${audit.missing.join(', ')}`
      + ' — 1사이클을 다 돌지 않았거나, 그 이벤트를 만드는 밸런스 손잡이(BALANCE.bot.*)가 0 이다');
    failures += 1;
  } else {
    console.log(`✓ 통합 로그 스키마 ${Object.keys(LOG_SCHEMA).length}종 전부 최소 1회 emit`);
  }

  const result = readout(payload);
  if (result.kill.d_cycle_done_ms === null) {
    console.error('✗ cycle_done 이 없다 — 1사이클 미완주 로그라 (d) 를 판독할 수 없다');
    failures += 1;
  }
  const verdicts = report(result);
  const failed = Object.entries(verdicts).filter(([, pass]) => pass === false).map(([k]) => k);
  console.log(`\n판독 ${failures ? 'red' : 'green'}`
    + ` · kill 미달 ${failed.length ? failed.join('·') : '없음'} (미달은 판독 결과이지 판독 실패가 아니다)`);
  return failures ? 1 : 0;
}

// 하네스가 `readout` 을 재사용하므로, 판독 실행은 이 파일이 진입점일 때만 돈다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
