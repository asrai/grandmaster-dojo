// 헤드리스 회귀 하네스 — 의존성 0, `node tests/harness.mjs` 로 실행한다.
// 기대값은 BALANCE 키에서 직접 산출하므로 파라미터 개명·판정표 변경은 즉시 red 다.

import { readFileSync } from 'node:fs';
import {
  ART_SETS, BALANCE, BALANCE_REV, CHALLENGERS, DISCIPLE, FOE_STYLES, STYLES,
  validateBalance,
} from '../src/balance.mjs';
import { LOG_SCHEMA, TIME_FIELD, createLogBuffer, validate } from '../src/log.mjs';
import {
  createDiscipleHand, createSeededRandom, runHeadlessCycle,
} from '../src/bot.mjs';
import { createMatch, createVirtualTimer, pumpToEnd } from '../src/ui/match.mjs';
import { createSequenceInput } from '../src/ui/sequence-input.mjs';
import {
  ART_ID, EXPORT_SCHEMA, accrueDiscipleRank, addCoins, autoEquip, canEquip, consumeTooltip,
  createSession, createTooltipState, equippedStyles, exportPayload, isCheatFlagged, learnStyle,
  logEvent, pickTooltip, recordDuelVerdict, recordEffectiveSuccess, setBotRunning, setCheatEnabled,
  settleDispatch, settleDuel, simulateTraining, cheatSetStyleRank,
} from '../src/ui/session.mjs';
import {
  composeHooks, dispatchWiring, duelWiring, trainWiring,
} from '../src/ui/wiring.mjs';
import { GRADE_VIEW } from '../src/ui/theme.mjs';
import { KILL, readout } from './kill-readout.mjs';
import {
  accrueDiscipleStyle, accrueRank, applyEffectiveSuccess, artById, artStyles,
  assertCounterIntegrity, assertPrefixFree, canEquipRank, canLearn, canTransmit, challengerById,
  createDisciple, createProgress, createRankState, discipleStyleRank, discipleStyles, finisherOf,
  foePowerOf, foeStyleById, initiativeOf, isEffectiveSuccess, isOneTapRank, judge, ladderBandAt,
  learn, powerOf, promoteByOutcome, resolveMatch, responseWindowMs, selectDiscipleStyle,
  setStyleRank, styleById, styleRank, trainHitsToNext, transmit,
} from '../src/core.mjs';

/** 성 축 재설계가 폐기한 BALANCE 키 (#64) — 잔존 참조 1개가 판정 수식을 조용히 오염시킨다. */
const RETIRED_KEYS = [
  'masteryTrainPct', 'masteryFullPct', 'threshold', 'rankPtsPerStyle',
  'rankStep', 'rankStepMult', 'equipMasteryPct', 'challengerPower',
];

// --------------------------------------------------------------- 단정 도구

let failures = 0;
let checks = 0;
let currentCase = '';

function suite(name, fn) {
  currentCase = name;
  try {
    fn();
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name} — 예외: ${err.message}`);
  }
}

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ [${currentCase}] ${message}`);
  }
}

function eq(actual, expected, message) {
  ok(Object.is(actual, expected), `${message} — 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
}

/** JSON 왕복에서 조용히 null 이 되거나 사라지는 값의 경로를 전부 모은다. */
function jsonLossy(value, path) {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}=${String(value)}`];
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return [`${path}=${String(value)}`];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => jsonLossy(v, `${path}.${k}`));
  }
  return [];
}

// NaN·Infinity·undefined 는 JSON 에서 전부 null 로 접히므로 별도 토큰으로 남긴다.
const stable = (value) => JSON.stringify(value, (_key, v) => {
  if (typeof v === 'number' && !Number.isFinite(v)) return `«${String(v)}»`;
  return v === undefined ? '«undefined»' : v;
});

function deepEq(actual, expected, message) {
  eq(stable(actual), stable(expected), message);
}

function throws(fn, message, match) {
  checks += 1;
  try {
    fn();
  } catch (err) {
    if (match && !String(err.message).includes(match)) {
      failures += 1;
      console.error(`  ✗ [${currentCase}] ${message} — 예외 메시지에 "${match}" 가 없다: ${err.message}`);
    }
    return;
  }
  failures += 1;
  console.error(`  ✗ [${currentCase}] ${message} — 예외가 나지 않았다`);
}

// ------------------------------------------ 판정 기대값 (core 와 독립 산출)

// 속성 삼각을 [이기는 쪽, 지는 쪽] 리터럴로 다시 적는다 — ATTRS.beats 의 대조군.
const TRIANGLE = [['fast', 'hard'], ['hard', 'fine'], ['fine', 'fast']];
const wins = (a, b) => TRIANGLE.some(([w, l]) => w === a && l === b);

function expectedGrade({ self, foe, foeOpen }) {
  if (!self) return 'struck';
  if (foeOpen) return 'crush';
  if (self.counters === foe.id) return 'crush';
  if (foe.finisher && foe.counters === self.id) return 'reversal';
  if (wins(self.attr, foe.attr)) return 'advantage';
  if (wins(foe.attr, self.attr)) return 'disadvantage';
  return 'clash';
}

function expectedVerdict({ self, foe, foeOpen, rank, r, foePower }) {
  const grade = expectedGrade({ self, foe, foeOpen });
  const n = BALANCE.powerBase + BALANCE.powerPerRank * rank;
  const init = BALANCE.initiativeBase + BALANCE.initiativePerRatio * r;
  const selfD = self ? self.d : 0;
  const foeD = foeOpen ? 0 : foe.d;
  const rule = BALANCE.grades[grade];
  const dmg = rule.formula === 'clash'
    ? {
      dmgOut: Math.round((n > foePower ? n - foePower : 0) * selfD * BALANCE.clashK * init),
      dmgIn: Math.round((foePower > n ? foePower - n : 0) * foeD * BALANCE.clashK),
    }
    : {
      dmgOut: Math.round(selfD * n * init * rule.outPct),
      dmgIn: Math.round(foeD * foePower * rule.inPct),
    };
  return { grade, ...dmg, opening: foeOpen ? null : rule.opening };
}

// ------------------------------------------------ 1. 데이터 무결성 (REQ-501~503, 505)

suite('데이터 무결성 (REQ-501·502·503·505)', () => {
  ok(assertPrefixFree(STYLES), 'assertPrefixFree 가 유운검법 4식에서 green');
  ok(assertCounterIntegrity([...STYLES, ...FOE_STYLES]), '파해 1:1 무결성 green');

  throws(() => assertPrefixFree([
    { id: 'a', seq: ['D', 'R'] },
    { id: 'b', seq: ['D', 'R', 'U'] },
  ]), '접두어 쌍은 assertPrefixFree 가 잡는다', 'prefix-free 위반');
  throws(() => assertPrefixFree([
    { id: 'a', seq: ['D', 'R'] },
    { id: 'b', seq: ['D', 'R'] },
  ]), '동일 시퀀스는 assertPrefixFree 가 잡는다', 'prefix-free 위반');
  throws(() => assertCounterIntegrity([
    { id: 'x', counters: 'z' }, { id: 'y', counters: 'z' }, { id: 'z', counters: null },
  ]), '한 초식을 둘이 파하면 1:1 위반', '파해 1:1 위반');
  throws(() => assertCounterIntegrity([{ id: 'x', counters: 'nope' }]), '미존재 파해 대상은 위반', '파해 대상 미존재');

  eq(STYLES.length, 4, '유운검법 초식 수');
  const columns = ['id', 'set', 'order', 'name', 'hanja', 'attr', 'seq', 'd', 'counters', 'gugyeol'];
  for (const s of STYLES) {
    for (const c of columns) ok(s[c] !== undefined, `${s.id} 컬럼 ${c} 존재`);
    ok(String(s.name).length > 0 && String(s.hanja).length > 0, `${s.id} 이름·한자 비어있지 않음`);
    ok(String(s.gugyeol).length > 0, `${s.id} 구결 존재`);
    ok(Number.isInteger(s.d) && s.d > 0, `${s.id} D 가 정수`);
  }
  deepEq(STYLES.map((s) => [s.attr, s.seq.join('')]), [
    ['fast', 'DRU'], ['hard', 'DLR'], ['fine', 'DURL'], ['fast', 'DDRLU'],
  ], '4식의 속성·시퀀스 시드');
  deepEq(STYLES.map((s) => s.d), [10, 10, 14, 20], '4식 D 시드 — damageByLen 에서 파생된 결과');
  deepEq(STYLES.map((s) => s.counters), ['alpha', 'beta', 'gamma', 'delta'], '4식의 파해 대상');

  deepEq(FOE_STYLES.map((s) => [s.id, s.attr, s.len, s.d]), [
    ['alpha', 'hard', 3, 10], ['beta', 'fine', 4, 14], ['gamma', 'fast', 4, 14], ['delta', 'fine', 5, 20],
  ], '적 초식 속성·길이·D 시드');
  deepEq(FOE_STYLES.map((s) => s.d), [10, 14, 14, 20], '적 초식 D 시드 — damageByLen 에서 파생된 결과');
  deepEq(FOE_STYLES.filter((s) => s.finisher).map((s) => s.id), ['delta'], '절초는 δ 하나');
  for (const f of FOE_STYLES) {
    ok(!f.counters || f.finisher, `${f.id} — 파해 대상을 가진 적 초식은 절초여야 역파가 성립한다`);
  }
  ok(assertCounterIntegrity(STYLES, [...STYLES, ...FOE_STYLES]), '유저 초식만 떼어 검사해도 green');

  deepEq(CHALLENGERS.map((c) => [c.id, ...c.styles]), [
    ['A-1', 'alpha'], ['A-2', 'alpha', 'beta'], ['A-3', 'alpha', 'beta', 'gamma'],
    ['B', 'alpha', 'gamma', 'delta'],
  ], '도전자 A 1·2·3차 + B 구성');
  for (const c of CHALLENGERS) {
    ok(BALANCE.hp[c.id] !== undefined, `${c.id} HP 시드 존재`);
    ok(Number.isInteger(BALANCE.challengerRank[c.id]), `${c.id} 성 시드 존재 (REQ-722)`);
    for (const sid of c.styles) ok(foeStyleById(sid), `${c.id} 의 초식 ${sid} 가 테이블에 존재`);
  }
  for (const c of CHALLENGERS) {
    const finishers = c.styles.map(foeStyleById).filter((s) => s.finisher);
    ok(finishers.length <= 1, `${c.id} 절초 ≤ 1 — finisherOf 가 축약하지 않는다`);
  }
  eq(CHALLENGERS.filter((c) => c.group === 'A').every((c) => finisherOf(c) === null), true, 'A 는 절초 없음');
  eq(finisherOf(challengerById('B')).id, 'delta', 'B 의 절초는 δ');
  eq(styleById('pa-un').counters, 'delta', 'δ 의 파해는 4식');

  eq(ART_SETS.length, 1, '무공 테이블 1종');
  deepEq(artById('yuun-geom').styles, STYLES.map((s) => s.id), '무공이 4식을 모두 보유');
  eq(artById('yuun-geom').transmitRank, BALANCE.rankMax, '전수 조건 = 전 초식 성 상한');
  eq(DISCIPLE.level, 1, '제자 레벨 1');
  eq(DISCIPLE.artSlots, 1, '제자 무공 슬롯 1');
});

// ---------------------------------------------- 2. 통합 로그 스키마 (REQ-601)

suite('통합 로그 스키마 (REQ-601)', () => {
  // spec § 통합 로그 스키마 표를 글자 그대로 옮긴 대조군.
  const EXPECTED = {
    key: ['dir', 'accepted', 'candidates_n', 'top_attr', 'device'],
    ignore: ['dir'],
    reset: [],
    narrow: ['styleId'],
    fire: ['styleId', 'len', 'oneTap', 'r'],
    timeout: ['styleTop', 'buffer_len'],
    verdict: ['grade', 'dmg_out', 'dmg_in', 'state', 'who'],
    rank: ['actor', 'style', 'from', 'to', 'via'],
    rank_wall: ['actor', 'style', 'at_rank', 'attempted'],
    unlock: ['style', 'prev_style_rank'],
    finish: ['style', 'challenger', 'intended'],
    slot: ['action', 'styleId'],
    transmit: ['style_set'],
    dispatch: ['challenger'],
    select: ['styleId', 'byUser'],
    coins: ['delta', 'reason'],
    cycle: ['phase'],
    cheat: ['action', 'session_flagged'],
    session: ['tester_role', 'device'],
  };
  eq(Object.keys(LOG_SCHEMA).length, 19, '이벤트 19종');
  deepEq(Object.keys(LOG_SCHEMA), Object.keys(EXPECTED), '이벤트 이름·순서');
  for (const [event, fields] of Object.entries(EXPECTED)) {
    deepEq(LOG_SCHEMA[event].fields, fields, `${event} 필드`);
  }
  deepEq(LOG_SCHEMA.key.enums.device, ['keyboard', 'button'], 'key.device 열거');
  deepEq(LOG_SCHEMA.session.enums.tester_role, ['self', 'friend', 'bot'], 'session.tester_role 열거');
  // 뜻이 바뀐 이벤트만 판별 토큰을 단다 — 신설 이벤트는 구 스키마가 없어 `sv` 가 필요 없다 (REQ-791).
  deepEq(Object.entries(LOG_SCHEMA).filter(([, v]) => v.sv).map(([k]) => k), ['rank', 'unlock'],
    'sv: 2 를 다는 이벤트는 rank·unlock 둘');
  for (const gone of ['mastery', 'initiate']) ok(!(gone in LOG_SCHEMA), `${gone} 는 개념과 함께 소멸했다`);

  let clock = 100;
  const buf = createLogBuffer({ now: () => clock });
  clock = 350;
  const entry = buf.log('narrow', { styleId: 'yuun-bo' });
  eq(entry[TIME_FIELD], 250, `전 이벤트 공통 ${TIME_FIELD}`);
  eq(entry.sv, undefined, '뜻이 바뀌지 않은 이벤트에는 판별 토큰이 붙지 않는다');
  eq(buf.log('unlock', { style: 'jeok-un', prev_style_rank: 5 }).sv, 2, '적재 시점에 sv 가 붙는다');
  buf.log('reset');
  eq(buf.entries.length, 3, '버퍼 적재');
  eq(JSON.parse(buf.serialize()).length, 3, 'JSON 내보내기');
  eq(JSON.parse(JSON.stringify(buf.entries)).length, 3, '버퍼를 통째로 직렬화해도 이중 인코딩되지 않는다');
  const loose = createLogBuffer({ now: () => 0, strict: false });
  loose.log('narrow', {});
  eq(loose.entries.length, 1, '비엄격 버퍼는 위반에도 적재를 잇는다');

  throws(() => buf.log('nope', {}), '미정의 이벤트는 throw', '미정의 로그 이벤트');
  throws(() => buf.log('narrow', {}), '필드 결손은 throw', '필드 결손');
  throws(() => buf.log('narrow', { styleId: 'a', extra: 1 }), '스키마 밖 필드는 throw', '스키마 밖 필드');
  throws(() => buf.log('session', { tester_role: 'ghost', device: 'keyboard' }), '열거 밖 값은 throw', '허용 밖 값');
});

// ------------------------------------------ 3. 응수 창 · 파생 수식 (REQ-201·203·204·210)

suite('응수 창 · 파생 수식 (REQ-201·203·204·210)', () => {
  eq(responseWindowMs(3), 2600, '3길이 창');
  eq(responseWindowMs(4), 3100, '4길이 창');
  eq(responseWindowMs(5), 3600, '5길이 창');
  eq(responseWindowMs(3, { selfOpen: true }), 1560, '나 빈틈 창 −40%');
  eq(responseWindowMs(3, { accessibility: true }), 3380, '접근성 창 ×1.3');
  eq(BALANCE.accessibilityWindow, false, '접근성 옵션 기본 off');

  eq(powerOf(1), 1.05, '1성 내공');
  eq(powerOf(10), 1.5, '10성 내공');
  eq(Number(powerOf(12).toFixed(4)), 1.6, '12성 내공');
  eq(initiativeOf(0), 1, '선기 하한');
  eq(initiativeOf(1), 1.3, '선기 상한');

  deepEq(
    Object.keys(BALANCE.grades).filter((g) => isEffectiveSuccess(g)),
    ['crush', 'advantage', 'clash'],
    '유효 성공 = 판정 ≥ 상쇄',
  );
});

// --------------------------- 4. 케이스 5 — 6단 × 빈틈 × 선기 × 성 전 조합 (REQ-202~205)

suite('케이스 5 — 6단 판정 전 조합 (REQ-202·203·204·205)', () => {
  const selfOptions = [null, ...STYLES];
  const rs = [0, 0.4, 1];
  const ranks = [1, 10, BALANCE.rankMax];
  const seenGrades = new Set();
  let combos = 0;

  for (const self of selfOptions) {
    for (const foe of FOE_STYLES) {
      for (const foeOpen of [false, true]) {
        for (const r of rs) {
          for (const rank of ranks) {
            for (const foePower of CHALLENGERS.map((c) => foePowerOf(c.id))) {
              const expected = expectedVerdict({ self, foe, foeOpen, rank, r, foePower });
              const actual = judge({ selfStyle: self, foeStyle: foe, selfRank: rank, foePower, r, foeOpen });
              deepEq(actual, expected,
                `${self ? self.id : '미완주'} vs ${foe.id} (빈틈=${foeOpen} r=${r} 성=${rank} N적=${foePower})`);
              ok(actual.dmgOut >= 0 && actual.dmgIn >= 0, `피해가 음수가 아니다 (${self ? self.id : '미완주'} vs ${foe.id})`);
              seenGrades.add(actual.grade);
              combos += 1;
            }
          }
        }
      }
    }
  }
  eq(combos, selfOptions.length * FOE_STYLES.length * 2 * rs.length * ranks.length * CHALLENGERS.length,
    '전 조합 수');
  deepEq([...seenGrades].sort(), Object.keys(BALANCE.grades).sort(), '6단 전 등급이 조합에 등장');

  // 파해가 삼각보다 우선한다 — 유운보(쾌)는 α(강)에 우세이기도 하지만 파해라 완파다.
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1 }).grade,
    'crush', '파해 우선 (삼각으로는 우세)');
  eq(wins('fast', 'hard'), true, '삼각만 보면 쾌가 강을 이긴다');

  // 빈틈은 1수 지속·중첩 없음.
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1 }).opening,
    'foe', '완파 → 상대 빈틈');
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('delta'), selfRank: 1, foePower: 1.1 }).opening,
    'self', '역파 → 나 빈틈');
  const chained = judge({ selfStyle: styleById('haeng-un'), foeStyle: foeStyleById('gamma'), selfRank: 1, foeOpen: true });
  eq(chained.grade, 'crush', '상대 빈틈 중 아무 초식 완주 = 완파 취급');
  eq(chained.opening, null, '빈틈 중의 완파 취급은 빈틈을 다시 열지 않는다');
  eq(chained.dmgIn, 0, '상대 빈틈에는 받는 피해가 없다');
  eq(judge({ selfStyle: null, foeStyle: foeStyleById('alpha'), selfRank: 1, foeOpen: true }).dmgIn, 0,
    '상대 빈틈 중 미완주도 무피해');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: null, selfRank: 1 }),
    '빈틈이 아닌데 상대 초식이 없으면 throw', '상대 초식이 없다');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, r: 1.5 }),
    '선기 잔여 비율 범위 밖은 throw', '0~1 밖');
  const dom = (over) => () => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, ...over });
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha') }),
    '성 결손은 NaN 이 아니라 throw', '성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: -30 }), '음수 성은 throw — 피해가 회복으로 뒤집힌다', '성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: 0 }), '0성은 throw', '성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: 1.5 }), '비정수 성은 throw', '성이 1 이상의 정수가 아니다');
  throws(dom({ foePower: NaN }), '상대 내공 NaN 은 throw', '상대 내공이 양수가 아니다');
  throws(dom({ foePower: -1 }), '음수 상대 내공은 throw — 받는 피해가 회복으로 뒤집힌다', '상대 내공이 양수가 아니다');
  throws(dom({ foePower: 0 }), '0 상대 내공은 throw', '상대 내공이 양수가 아니다');

  // 파해와 역파가 동시에 성립하면 완파가 이긴다 — 시드 데이터에는 충돌 쌍이 없어 합성한다.
  const mutualSelf = { id: 'm-self', attr: 'fast', d: 10, counters: 'm-foe' };
  const mutualFoe = { id: 'm-foe', attr: 'fast', d: 10, finisher: true, counters: 'm-self' };
  eq(judge({ selfStyle: mutualSelf, foeStyle: mutualFoe, selfRank: 1 }).grade, 'crush', '파해가 역파보다 우선');
});

// ------------------------------------------- 5. 손계산 골든값 (REQ-203 산술 고정)

suite('피해 정수 골든값 (REQ-203)', () => {
  const S = Object.fromEntries(STYLES.map((s) => [s.id, s]));
  const F = Object.fromEntries(FOE_STYLES.map((s) => [s.id, s]));
  const golden = [
    ['완파 1성 r0', { selfStyle: S['yuun-bo'], foeStyle: F.alpha, selfRank: 1, foePower: 1, r: 0 },
      { grade: 'crush', dmgOut: 11, dmgIn: 0, opening: 'foe' }],
    ['완파 12성 r1', { selfStyle: S['yuun-bo'], foeStyle: F.alpha, selfRank: 12, foePower: 1, r: 1 },
      { grade: 'crush', dmgOut: 21, dmgIn: 0, opening: 'foe' }],
    ['우세 1성 r0.4', { selfStyle: S['jeok-un'], foeStyle: F.delta, selfRank: 1, foePower: 1.1, r: 0.4 },
      { grade: 'advantage', dmgOut: 7, dmgIn: 4, opening: null }],
    ['상쇄 우위', { selfStyle: S['haeng-un'], foeStyle: F.beta, selfRank: 12, foePower: 1, r: 0 },
      { grade: 'clash', dmgOut: 4, dmgIn: 0, opening: null }],
    ['상쇄 열위', { selfStyle: S['haeng-un'], foeStyle: F.delta, selfRank: 1, foePower: 1.1, r: 0 },
      { grade: 'clash', dmgOut: 0, dmgIn: 1, opening: null }],
    ['열세', { selfStyle: S['yuun-bo'], foeStyle: F.beta, selfRank: 1, foePower: 1, r: 0 },
      { grade: 'disadvantage', dmgOut: 2, dmgIn: 8, opening: null }],
    ['역파', { selfStyle: S['yuun-bo'], foeStyle: F.delta, selfRank: 1, foePower: 1.1, r: 0 },
      { grade: 'reversal', dmgOut: 0, dmgIn: 22, opening: 'self' }],
    ['피격', { selfStyle: null, foeStyle: F.alpha, selfRank: 1, foePower: 1, r: 0 },
      { grade: 'struck', dmgOut: 0, dmgIn: 10, opening: null }],
    ['연환', { selfStyle: S['haeng-un'], foeStyle: F.gamma, selfRank: 1, foePower: 1, r: 0, foeOpen: true },
      { grade: 'crush', dmgOut: 15, dmgIn: 0, opening: null }],
  ];
  for (const [name, input, expected] of golden) deepEq(judge(input), expected, `골든 ${name}`);
});

// ---------------------------------- 6. 성 계단 사다리 (REQ-702·704) — 적립 3단 + 사건 계단

const ART = ART_SETS[0].id;
const DUEL_A_STAGES = CHALLENGERS.filter((c) => c.mode === 'duel').length;
const LADDER = BALANCE.rankLadder;
const [LOW, HIGH] = LADDER.bands;

/** 전 초식을 학습시킨 뒤 하나만 목표 성으로 세운 진행도 — 계단마다의 국면을 직접 만든다. */
function masterAt(rank, styleId = 'yuun-bo') {
  let progress = createProgress();
  for (const style of artStyles(ART)) progress = setStyleRank(progress, style.id, 1);
  return setStyleRank(progress, styleId, rank);
}

const accrue = (state, mode, opts = {}) => accrueRank(state, { mode, ...opts });

suite('성 계단 사다리 (REQ-702)', () => {
  deepEq(ladderBandAt(1), LOW, '1성은 수련 가능 구간');
  deepEq(ladderBandAt(LOW.maxRank - 1), LOW, `${LOW.maxRank - 1}성까지 수련 가능 구간`);
  deepEq(ladderBandAt(LOW.maxRank), HIGH, `${LOW.maxRank}성부터 대련 전용 구간`);
  deepEq(ladderBandAt(HIGH.maxRank), null, `${HIGH.maxRank}성 위는 적립 구간이 없다`);
  eq(ladderBandAt(BALANCE.rankMax), null, '상한에는 다음 계단이 없다');

  // 시드의 뜻: 수련 3회 = 1성 · 대련 유효 성공 1회 = 1성 (1~7 구간).
  eq(Math.ceil(LOW.cost / LADDER.gain.train), 3, '1~7 구간 수련 3회 = 1성');
  eq(Math.ceil(LOW.cost / LADDER.gain.duel), 1, '1~7 구간 대련 유효 성공 1회 = 1성');
  eq(Math.ceil(HIGH.cost / LADDER.gain.duel), 2, '8~10 구간 대련 유효 성공 2회 = 1성');

  eq(trainHitsToNext({ rank: 1, pts: 0 }), 3, '1성에서 다음 계단까지 수련 3회');
  eq(trainHitsToNext({ rank: 1, pts: LADDER.gain.train }), 2, '한 번 채우면 2회 남는다');
  eq(trainHitsToNext({ rank: LOW.maxRank, pts: 0 }), null, '수련 무효 구간에는 남은 횟수가 없다');

  throws(() => accrue(createRankState(), 'nope'), '알 수 없는 적립 모드는 throw', '알 수 없는 적립 모드');
});

suite('케이스 1 — 적립 3단 (REQ-702·703·706)', () => {
  // (a) 1~7 구간: 수련 3회 = 1성.
  let state = createRankState();
  for (let i = 0; i < 3; i += 1) state = accrue(state, 'train').state;
  eq(state.rank, 2, '수련 3회 = 1성');
  eq(state.pts, 0, '계단을 넘고 남은 적립은 0');

  // (b) 1~7 구간: 대련 유효 성공 1회 = 1성.
  const one = accrue(createRankState(), 'duel');
  eq(one.to, 2, '대련 유효 성공 1회 = 1성');
  eq(one.wall, false, '그 구간에는 벽이 없다');

  // (c) 넘친 적립은 이월한다 — 쌓아 둔 수련이 대련 한 번에 사라지지 않는다.
  const mixed = accrue(accrue(accrue(createRankState(), 'train').state, 'train').state, 'duel');
  eq(mixed.to, 2, '수련 2 + 대련 1 도 한 계단');
  eq(mixed.state.pts, LADDER.gain.train * 2, '넘친 2 는 다음 계단으로 이월');

  // (d) 8~10 구간: 수련 적립 0 + 벽.
  const walled = accrue({ rank: LOW.maxRank, pts: 0 }, 'train');
  eq(walled.to, LOW.maxRank, `${LOW.maxRank}성 수련은 적립 0`);
  eq(walled.wall, true, '8성 벽이 발화한다');
  eq(walled.state.pts, 0, '벽에 막힌 수련은 포인트도 남기지 않는다');

  // (e) 8~10 구간: 대련 2회 = 1성.
  const first = accrue({ rank: LOW.maxRank, pts: 0 }, 'duel');
  eq(first.to, LOW.maxRank, '그 구간 첫 유효 성공은 계단을 넘지 못한다');
  eq(accrue(first.state, 'duel').to, LOW.maxRank + 1, '두 번째에 1성');

  // (f) 적립 상한 — 10성 위는 점수로 오르지 않는다.
  const capped = accrue({ rank: HIGH.maxRank, pts: 0 }, 'duel');
  eq(capped.to, HIGH.maxRank, `${HIGH.maxRank}성 위는 적립이 닿지 않는다`);
  eq(capped.wall, false, '적립 상한은 수련 벽이 아니다');

  // (g) 세션 경로도 같은 규칙 — `rank_wall` 이 실제로 로그에 남는다.
  const session = createSession();
  session.progress = masterAt(LOW.maxRank);
  const changes = recordEffectiveSuccess(session, 'yuun-bo', 'train');
  eq(changes.rank, undefined, '벽에서는 성 전이가 없다');
  deepEq(changes.wall, { style: 'yuun-bo', at_rank: LOW.maxRank, attempted: 'train' }, '벽 변화분');
  const wall = session.log.entries.find((e) => e.event === 'rank_wall');
  deepEq({ actor: wall.actor, style: wall.style, at_rank: wall.at_rank, attempted: wall.attempted },
    { actor: 'master', style: 'yuun-bo', at_rank: LOW.maxRank, attempted: 'train' }, 'rank_wall 로그');

  throws(() => applyEffectiveSuccess(createProgress(), 'jeok-un', { mode: 'duel' }),
    '미학습 초식 적립은 throw', '학습하지 않은 초식');
  throws(() => learn(createProgress(), 'haeng-un'), '순차 해금 밖 초식 학습은 throw', '해금되지 않은 초식');
});

suite('케이스 2 — 11·12성 계단 (REQ-704)', () => {
  const at = (rank, outcome) => promoteByOutcome({ rank, pts: 0 }, outcome);

  eq(at(LADDER.finishRank - 2, { finish: true }).to, LADDER.finishRank - 2, '9성 결정타는 성 불변 (비소급)');
  eq(at(LADDER.finishRank - 1, { finish: true }).to, LADDER.finishRank, '10성 결정타 → 11성');
  eq(at(LADDER.finishRank - 1, { finish: true }).via, 'finish', '전이 사유는 결정타');
  // 한 수 최대 1계단 — 완파 결정타도 11성까지다.
  eq(at(LADDER.finishRank - 1, { finish: true, crush: true }).to, LADDER.finishRank, '10성 완파 결정타 → 11성');
  eq(at(LADDER.finishRank, { crush: true }).to, LADDER.crushRank, '11성 완파 → 12성');
  eq(at(LADDER.finishRank, { crush: true }).via, 'crush', '전이 사유는 완파');
  eq(at(LADDER.finishRank, { finish: true }).to, LADDER.finishRank, '11성 결정타(비완파)는 성 불변');
  eq(at(LADDER.crushRank, { crush: true, finish: true }).to, LADDER.crushRank, '12성 위는 없다');
  eq(at(LADDER.finishRank - 1, { finish: true, max: BALANCE.discipleRankMax }).to, LADDER.finishRank - 1,
    '상한 10 의 주체는 11성 계단에 오르지 못한다 (REQ-705)');

  // 세션 경로 — 결정타 판정이 `judge` 가 아니라 그 수의 승패에서 온다.
  const session = createSession();
  session.progress = masterAt(LADDER.finishRank - 1);
  const changes = recordDuelVerdict(session, {
    verdict: { grade: 'advantage', dmgOut: 9, dmgIn: 0, opening: null },
    fire: { style: styleById('yuun-bo') },
    challenger: challengerById('A-1'),
    outcome: { over: true, win: true, by: 'hp' },
  });
  eq(changes.rank.to, LADDER.finishRank, '승리를 확정한 타격이 11성을 연다');
  eq(changes.rank.via, 'finish', 'via 는 결정타');
  const finish = session.log.entries.find((e) => e.event === 'finish');
  deepEq({ style: finish.style, challenger: finish.challenger, intended: finish.intended },
    { style: 'yuun-bo', challenger: 'A-1', intended: true }, 'finish 로그 (REQ-708)');
});

suite('케이스 4 — 해금 · 장착 · 원터치 계단 (REQ-711~713)', () => {
  const gate = BALANCE.rankGate;
  eq(gate.equip < gate.unlock && gate.unlock < gate.oneTap, true, '장착 < 해금 < 원터치');

  // 해금은 5성이고 7성이 아니다 — 그 분리가 「배울까 마저 밀까」를 만든다.
  for (let rank = 1; rank <= BALANCE.rankMax; rank += 1) {
    eq(canLearn(masterAt(rank), 'jeok-un'), rank >= gate.unlock, `1식 ${rank}성 → 2식 학습 ${rank >= gate.unlock}`);
    eq(canEquipRank(rank), rank >= gate.equip, `${rank}성 장착 ${rank >= gate.equip}`);
    eq(isOneTapRank(rank), rank >= gate.oneTap, `${rank}성 원터치 ${rank >= gate.oneTap}`);
  }
  eq(canLearn(masterAt(gate.oneTap - 1), 'jeok-un'), true, '해금은 원터치 성을 기다리지 않는다');

  // 세션 게이트 — 장착 자격과 빈 슬롯 자동 채움이 같은 계단을 읽는다.
  const session = createSession();
  eq(canEquip(session, 'yuun-bo'), false, '1성은 장착 불가');
  session.progress = masterAt(gate.equip);
  eq(canEquip(session, 'yuun-bo'), true, `${gate.equip}성부터 장착 가능`);
  autoEquip(session);
  eq(session.slots.includes('yuun-bo'), true, '빈 슬롯은 자동으로 채워진다 (REQ-714)');

  // 자리 양보 폐지 — 슬롯이 차면 자동 교체가 일어나지 않는다.
  const full = createSession();
  full.progress = masterAt(BALANCE.rankMax, 'yuun-bo');
  for (const style of artStyles(ART)) full.progress = setStyleRank(full.progress, style.id, BALANCE.rankMax);
  autoEquip(full);
  deepEq(full.slots, artStyles(ART).slice(0, BALANCE.slots).map((st) => st.id), '슬롯 수만큼만 채운다');
  autoEquip(full);
  deepEq(full.slots, artStyles(ART).slice(0, BALANCE.slots).map((st) => st.id), '재호출도 자리를 빼앗지 않는다');

  // 순차 해금 로그 — 발화점이 5성이고 그 시점 성이 함께 실린다.
  const unlocking = createSession();
  unlocking.progress = masterAt(gate.unlock - 1);
  const changes = recordEffectiveSuccess(unlocking, 'yuun-bo', 'duel');
  deepEq(changes.unlock, { style: 'jeok-un', prev_style_rank: gate.unlock }, 'unlock 변화분 (REQ-711)');
  const unlock = unlocking.log.entries.find((e) => e.event === 'unlock');
  eq(unlock.sv, 2, 'unlock 은 뜻이 바뀐 이벤트라 sv 2 를 단다');
});

// ------------------------------------------- 6-b. 케이스 3 — 제자 동형 (REQ-705)

/** 전 초식 12성 사부 — 전수 조건을 만족시키는 최소 상태다. */
const masteredProgress = (() => {
  let progress = createProgress();
  for (const style of artStyles(ART)) progress = setStyleRank(progress, style.id, BALANCE.rankMax);
  return progress;
})();

suite('케이스 3 — 제자는 사부와 동형 (REQ-705)', () => {
  const session = createSession();
  session.disciple = transmit(masteredProgress, createDisciple(), ART);
  deepEq(discipleStyles(session.disciple, ART).map((st) => st.id), artById(ART).styles,
    '제자는 전수 직후 무공의 전 초식을 보유한다');
  for (const style of artStyles(ART)) {
    eq(discipleStyleRank(session.disciple, ART, style.id), BALANCE.discipleStartRank,
      `제자 ${style.name} 은 ${BALANCE.discipleStartRank}성에서 시작`);
  }

  // 파견 유효 성공만으로 상한까지 — 같은 사다리를 타되 11성 계단은 열리지 않는다.
  for (let i = 0; i < 60; i += 1) accrueDiscipleRank(session, 'pa-un');
  eq(discipleStyleRank(session.disciple, ART, 'pa-un'), BALANCE.discipleRankMax, '제자 상한 10성');
  eq(discipleStyleRank(session.disciple, ART, 'yuun-bo'), BALANCE.discipleStartRank,
    '초식 단위라 지시하지 않은 초식은 그대로다');
  const ranks = session.log.entries.filter((e) => e.event === 'rank');
  eq(ranks.every((e) => e.actor === 'disciple' && e.via === 'mission' && e.sv === 2),
    true, '제자 성 로그는 actor·via 로 사부와 갈린다');

  // 제자 수련도 같은 벽을 만난다 — 규칙이 하나라 유저도 한 번만 배운다.
  const walled = accrueDiscipleStyle(session.disciple, ART, 'pa-un', { mode: 'train' });
  eq(walled.wall, true, '상한에서도 수련 벽 판정은 사부와 같은 함수가 낸다');
  eq(accrueDiscipleStyle(session.disciple, 'nope', 'pa-un').to, null, '전수받지 않은 무공은 적립 대상이 아니다');
});

// ------------------------------------------------- 7. 전수 = 복사 (REQ-705·707)

suite('전수 = 복사', () => {
  let disciple = createDisciple();
  eq(canTransmit(masteredProgress, ART, disciple), true, '전 초식 12성 + 슬롯 여유 = 전수 가능');
  eq(canTransmit(createProgress(), ART, disciple), false, '1성은 전수 불가');
  eq(canTransmit(setStyleRank(masteredProgress, 'pa-un', BALANCE.rankMax - 1), ART, disciple), false,
    '11성 초식이 하나라도 있으면 불가');
  eq(discipleStyleRank(disciple, ART, 'yuun-bo'), null, '전수 전 제자 성은 예외가 아니라 null');
  deepEq(discipleStyles(disciple, ART), [], '전수 전 제자 초식은 빈 배열');

  disciple = transmit(masteredProgress, disciple, ART);
  deepEq(discipleStyles(disciple, ART).map((st) => st.id), artStyles(ART).map((st) => st.id),
    '사부·제자 노출 목록이 같은 소스에서 나온다');
  for (const style of artStyles(ART)) {
    eq(styleRank(masteredProgress, style.id), BALANCE.rankMax, `사부 ${style.name} 은 성을 유지한다`);
  }
  eq(canTransmit(masteredProgress, ART, disciple), false, '슬롯이 차면 재전수 불가');
  throws(() => transmit(masteredProgress, disciple, ART), '조건 미충족 전수는 throw', '전수 조건 미충족');
});

// ---------------------------------- 7-a. 위력 = 초식 성 (REQ-721·722)

suite('케이스 5 — 위력은 초식 성에서 나온다 (REQ-721·722)', () => {
  // 같은 무공 안에서도 초식마다 성이 다르다 — 그 차이가 피해 정수로 그대로 나온다.
  const progress = setStyleRank(masterAt(4, 'yuun-bo'), 'jeok-un', 7);
  eq(styleRank(progress, 'yuun-bo'), 4, '1식 4성');
  eq(styleRank(progress, 'jeok-un'), 7, '2식 7성');
  const foe = foeStyleById('beta');
  const low = judge({ selfStyle: styleById('yuun-bo'), foeStyle: foe, selfRank: 4, foePower: foePowerOf('A-2') });
  const high = judge({ selfStyle: styleById('jeok-un'), foeStyle: foe, selfRank: 7, foePower: foePowerOf('A-2') });
  eq(low.dmgOut, Math.round(styleById('yuun-bo').d * powerOf(4) * initiativeOf(0) * BALANCE.grades.disadvantage.outPct),
    '4성 초식의 피해는 그 초식의 N 으로 난다');
  eq(high.dmgOut, styleById('jeok-un').counters === foe.id
    ? Math.round(styleById('jeok-un').d * powerOf(7) * initiativeOf(0) * BALANCE.grades.crush.outPct)
    : high.dmgOut, '7성 초식의 피해는 그 초식의 N 으로 난다');
  ok(powerOf(7) > powerOf(4), '성이 높은 초식이 더 큰 N 을 낸다');

  // 도전자 성이 상쇄식의 반대쪽 변이다 — `challengerPower` 상수가 사라진 자리다.
  for (const c of CHALLENGERS) {
    eq(foePowerOf(c.id), powerOf(BALANCE.challengerRank[c.id]), `${c.id} 내공 = powerOf(도전자 성)`);
  }
  const clash = judge({
    selfStyle: styleById('haeng-un'), foeStyle: foeStyleById('beta'),
    selfRank: 1, foePower: foePowerOf('A-3'),
  });
  eq(clash.grade, 'clash', '동속성은 상쇄');
  eq(clash.dmgIn, Math.round(Math.max(0, foePowerOf('A-3') - powerOf(1)) * foeStyleById('beta').d * BALANCE.clashK),
    '상쇄식 양변이 성으로 성립한다');
  // 등급 승격은 보류 — 성 차가 아무리 벌어져도 판정 등급을 뒤집지 않는다 (REQ-723).
  eq(judge({ selfStyle: styleById('haeng-un'), foeStyle: foeStyleById('beta'), selfRank: BALANCE.rankMax, foePower: powerOf(1) }).grade,
    'clash', '12성이어도 상쇄는 상쇄');
});

// -------------------------------------- 8. 제자 자동 선택 (REQ-403)

suite('제자 자동 선택 (REQ-403)', () => {
  const all = STYLES.filter((s) => s.id !== 'pa-un');
  const delta = foeStyleById('delta');
  const pick = (opts) => selectDiscipleStyle({ styles: all, ...opts });

  eq(pick({ foeStyle: foeStyleById('alpha') }).id, 'yuun-bo', 'α(강) 에는 쾌로 우세');
  eq(pick({ foeStyle: foeStyleById('gamma') }).id, 'haeng-un', 'γ(쾌) 에는 정으로 우세');
  eq(pick({ foeStyle: delta }).id, 'jeok-un', 'δ(정) 에는 강으로 우세');

  // 역파 회피는 절초가 예고된 수에만 걸린다 — 그 밖의 수에서 완파를 버리지 않는다.
  eq(judge({ selfStyle: pick({ foeStyle: foeStyleById('alpha') }), foeStyle: foeStyleById('alpha'), selfRank: 1 }).grade,
    'crush', 'δ 를 가진 도전자라도 α 예고 수에는 완파가 나온다');
  const fakeFinisher = { id: 'fake', attr: 'fine', d: 20, finisher: true, counters: 'jeok-un' };
  eq(pick({ foeStyle: fakeFinisher }).id, 'haeng-un', '우세 후보가 예고된 절초의 파해 대상이면 상쇄로 내려간다');
  const fakePlain = { ...fakeFinisher, id: 'fake-plain', finisher: false };
  eq(pick({ foeStyle: fakePlain }).id, 'jeok-un', '절초가 아니면 파해 대상이어도 제외하지 않는다');

  // 우세 없음 → 상쇄, 상쇄도 없음 → 잔여.
  eq(selectDiscipleStyle({ styles: [styleById('haeng-un')], foeStyle: foeStyleById('beta') }).id,
    'haeng-un', '우세가 없으면 상쇄');
  eq(selectDiscipleStyle({ styles: [styleById('yuun-bo')], foeStyle: foeStyleById('beta') }).id,
    'yuun-bo', '우세·상쇄가 모두 없으면 잔여');

  // 상대 빈틈에는 예고가 없어 위력만 남고, 역파 위험도 없다.
  eq(pick({ foeStyle: null }).id, 'haeng-un', '상대 빈틈에는 최대 위력 초식');

  // 동률은 성으로, 성도 동률이면 슬롯 순으로 결정된다.
  const twoFast = [styleById('yuun-bo'), { ...styleById('pa-un'), attr: 'fast' }];
  eq(selectDiscipleStyle({
    styles: twoFast, foeStyle: foeStyleById('alpha'), rankOf: (s) => (s.id === 'pa-un' ? 5 : 1),
  }).id, 'pa-un', '우세 후보 중 성 높은 것');
  eq(selectDiscipleStyle({ styles: twoFast, foeStyle: foeStyleById('alpha') }).id, 'yuun-bo',
    '성 동률이면 슬롯 순');

  eq(selectDiscipleStyle({ styles: [styleById('yuun-bo')], foeStyle: delta }).id, 'yuun-bo',
    '전부 배제되면 역파를 감수한다');
  eq(selectDiscipleStyle({ styles: [] }), null, '보유 초식이 없으면 null');
});

// ----------------------- 9. 케이스 8 — B 밸런스 게이트 시뮬 (REQ-402·403·506)

// 사본이 아니라 실루프다 — `createMatch` 를 가상 시계로 돌려 파견 화면과 같은 코드를 검증한다.
function simulateDispatch({ challengerId, disciple, setId }) {
  const challenger = challengerById(challengerId);
  const session = createSession();
  session.disciple = disciple;
  const styles = discipleStyles(disciple, setId);
  const timer = createVirtualTimer();
  const trace = [];
  let ended = null;
  let match = null;

  const hand = createDiscipleHand({ session, styles, fire: (fired) => match.fire(fired) });
  match = createMatch({
    challenger,
    selfHpMax: BALANCE.hp.disciple,
    rankOf: (style) => discipleStyleRank(session.disciple, setId, style.id),
    openLen: () => Math.max(...styles.map((s) => s.seq.length)),
    accessibility: () => false,
    timer,
    hooks: {
      onTelegraph() { hand.arm(); },
      onTick(view) { hand.tick(view); },
      onVerdict(view) {
        trace.push({
          exchange: view.exchange,
          foe: view.telegraphed ? view.telegraphed.id : null,
          self: view.fire ? view.fire.style.id : null,
          ...view.verdict,
          foeHp: view.foeHp,
          selfHp: view.selfHp,
        });
      },
      onEnd(view) { ended = view; },
    },
  });
  pumpToEnd(match, timer);

  return {
    win: ended.outcome.win,
    exchanges: trace.length,
    foeHp: ended.foeHp,
    selfHp: ended.selfHp,
    trace,
    rank: discipleStyleRank(disciple, setId, styles[0].id),
  };
}

suite('케이스 8 — B 밸런스 게이트 (REQ-403·506)', () => {
  const disciple = transmit(masteredProgress, createDisciple(), 'yuun-geom');
  const sim = simulateDispatch({ challengerId: 'B', disciple, setId: 'yuun-geom' });

  eq(sim.rank, BALANCE.discipleStartRank, '1성 제자');
  eq(powerOf(sim.rank), 1.05, '1성 제자 내공 1.05');
  ok(sim.win, `1성 제자가 무지시로 B 를 이긴다 (남은 HP 적 ${sim.foeHp} / 제자 ${sim.selfHp})`);
  ok(sim.exchanges <= BALANCE.maxExchanges, `수 상한 안에서 결판 (${sim.exchanges}수)`);
  ok(sim.selfHp > 0, '제자가 생존한 채 승리');
  ok(sim.trace.some((t) => t.grade === 'crush'), '완파가 최소 1회');
  eq(sim.trace.every((t) => t.grade !== 'reversal'), true, '역파 회피가 실제로 지켜진다');
  if (!sim.win) {
    console.error('  ! B 밸런스 미달 — BALANCE.hp.B / challengerRank.B 하향 후 docs/balance-log.md 기록 필요');
  }
  console.log(`    B 시뮬: ${sim.exchanges}수, 적 HP ${sim.foeHp}, 제자 HP ${sim.selfHp}, `
    + `등급 ${sim.trace.map((t) => BALANCE.grades[t.grade].label).join('·')}`);
});

// ------------------------- 9-a. A 밸런스 게이트 (REQ-507) — 성 1 고정 유저가 A 를 이기는가

/**
 * 초식을 하나씩 해금 성까지 밀며 각 단계의 실전 슬롯을 남긴다 — A 차수를 만나는 실제 구성이다.
 * 자리 양보가 폐지돼(REQ-714) 슬롯 3 이 차면 4식은 벤치에 남는다.
 */
const unlockSlots = (() => {
  const session = createSession();
  const snapshots = [];
  for (const style of artStyles(ART)) {
    if (!session.progress.styles[style.id].learned) learnStyle(session, style.id);
    while (styleRank(session.progress, style.id) < BALANCE.rankGate.unlock) {
      recordEffectiveSuccess(session, style.id, 'duel');
    }
    snapshots.push(equippedStyles(session));
  }
  return snapshots;
})();

/**
 * 사본이 아니라 실루프다 — 제자의 손을 유저 자리에 세워 「창을 놓치지 않는 손」을 모델한다.
 * 그래서 이 게이트는 상계이고, 실수하는 손의 회귀는 사이클 시뮬의 `wins` 단정이 진다.
 */
function simulateDuelA({ challengerId, styles, rank }) {
  const session = createSession();
  const timer = createVirtualTimer();
  const trace = [];
  let ended = null;
  let match = null;

  const hand = createDiscipleHand({ session, styles, fire: (fired) => match.fire(fired) });
  match = createMatch({
    challenger: challengerById(challengerId),
    selfHpMax: BALANCE.hp.user,
    rankOf: () => rank,
    openLen: () => Math.max(...styles.map((st) => st.seq.length)),
    accessibility: () => false,
    timer,
    hooks: {
      onTelegraph() { hand.arm(); },
      onTick(view) { hand.tick(view); },
      onVerdict(view) { trace.push(view.verdict.grade); },
      onEnd(view) { ended = view; },
    },
  });
  pumpToEnd(match, timer);
  return { win: ended.outcome.win, exchanges: trace.length, foeHp: ended.foeHp, selfHp: ended.selfHp, trace };
}

suite('A 밸런스 게이트 (REQ-503·507)', () => {
  // 최저 성 유저가 A 를 넘는가 — 성이 오르면 위력도 오르므로 이것이 곡선의 하계다.
  const rank = 1;
  eq(powerOf(rank), 1.05, '성 1 내공 1.05');

  // A-3 는 두 구성으로 본다 — 첫 조우(4식 미학습)와 입문 시점 구성은 다른 국면이다.
  const stages = [
    { id: 'A-1', styles: unlockSlots[0] },
    { id: 'A-2', styles: unlockSlots[1] },
    { id: 'A-3', styles: unlockSlots[2] },
    { id: 'A-3', styles: unlockSlots[unlockSlots.length - 1] },
  ];
  for (const stage of stages) {
    const sim = simulateDuelA({ challengerId: stage.id, styles: stage.styles, rank });
    ok(sim.win, `성 1 유저가 ${stage.id} 을 이긴다 (남은 HP 적 ${sim.foeHp} / 유저 ${sim.selfHp})`);
    ok(sim.exchanges <= BALANCE.maxExchanges, `${stage.id} 은 수 상한 안에서 결판 (${sim.exchanges}수)`);
    if (!sim.win) {
      console.error(`  ! A 밸런스 미달 — BALANCE.hp['${stage.id}'] 하향 후 docs/balance-log.md 기록 필요`);
    }
    console.log(`    ${stage.id} 시뮬: ${sim.exchanges}수, 적 HP ${sim.foeHp}, 유저 HP ${sim.selfHp}, `
      + `장착 ${stage.styles.map((st) => st.name).join('·')}`);
  }
  // 4식까지 해금한 시점의 슬롯이 속성 3색을 덮어야 A-3 의 예고 3종에 전부 우세로 답할 수 있다.
  const atLast = unlockSlots[unlockSlots.length - 1];
  deepEq([...new Set(atLast.map((st) => st.attr))].sort(), ['fast', 'fine', 'hard'],
    '전 초식 해금 시점 슬롯이 강·정·쾌를 모두 덮는다');
  deepEq(atLast.map((st) => st.id), artStyles(ART).slice(0, BALANCE.slots).map((st) => st.id),
    '자리 양보 폐지로 슬롯은 먼저 찬 1·2·3식에 머문다 (REQ-714)');
});

// ------------------------------- 10. 대련 종료 판정 (REQ-201) — 상태기계와 공유하는 규칙

suite('대련 종료 판정 (REQ-201)', () => {
  const at = (selfHp, foeHp, exchanges) => resolveMatch({ selfHp, foeHp, exchanges });

  eq(at(100, 40, 1).over, false, '양쪽 생존 · 수 상한 전이면 계속');
  deepEq(at(60, 0, 3), { over: true, win: true, by: 'hp' }, '상대 HP 소진 = 승');
  deepEq(at(0, 20, 3), { over: true, win: false, by: 'hp' }, '내 HP 소진 = 패');
  deepEq(at(0, 0, 3), { over: true, win: true, by: 'hp' }, '상호 소진은 낸 쪽의 승');
  deepEq(at(-5, 10, 3), { over: true, win: false, by: 'hp' }, '음수 HP 도 소진');

  const last = BALANCE.maxExchanges;
  eq(at(40, 30, last - 1).over, false, `${last - 1}수까지는 잔여 HP 비교를 하지 않는다`);
  deepEq(at(40, 30, last), { over: true, win: true, by: 'exchanges' }, '수 상한 · 앞서면 승');
  deepEq(at(30, 40, last), { over: true, win: false, by: 'exchanges' }, '수 상한 · 뒤지면 패');
  deepEq(at(30, 30, last), { over: true, win: false, by: 'exchanges' }, '수 상한 · 동률은 패');

  // 제자 100 vs B 80 — 비율 비교였다면 0.40 < 0.44 로 뒤집힌다.
  eq(at(40, 35, last).win, true, '최대 HP 비대칭에서도 절대값으로 비교한다');
  eq(at(BALANCE.hp.disciple, BALANCE.hp.B, last).win, true, '무피해 종료는 최대 HP 가 큰 쪽 승');
});

// ------------- 10-a. 플레이 경로 로그 검증 (REQ-601·603) — 비엄격 버퍼의 무음 통과를 막는다

suite('플레이 경로 로그 검증 (REQ-601·603)', () => {
  const session = createSession();
  eq(session.log.entries.length, 0, '세션은 빈 버퍼로 시작');
  deepEq(session.logViolations, [], '위반 목록도 빈 상태');

  logEvent(session, 'reset', {});
  eq(session.log.entries.length, 1, '정상 이벤트는 적재된다');
  deepEq(session.logViolations, [], '정상 이벤트는 위반으로 세지 않는다');

  const warn = console.warn;
  console.warn = () => {};
  try {
    // 필드 결손·오타·미정의 이벤트 — 셋 다 적재는 이어지되 관측 가능해야 한다.
    logEvent(session, 'fire', { styleId: 'yuun-bo', len: 3, oneTap: false });
    logEvent(session, 'narrow', { style_id: 'yuun-bo' });
    logEvent(session, 'nope', {});
    logEvent(session, 'key', {
      dir: 'D', accepted: true, candidates_n: 1, top_attr: 'fast', device: 'gamepad',
    });
  } finally {
    console.warn = warn;
  }

  eq(session.log.entries.length, 5, '위반 이벤트도 적재를 끊지 않는다 (시연 중 정지 방지)');
  eq(session.logViolations.length, 4, '결손·오타·미정의·열거 밖이 전부 위반으로 잡힌다');
  deepEq(session.logViolations.map((v) => v.event), ['fire', 'narrow', 'nope', 'key'], '위반 이벤트 이름');
  ok(session.logViolations[0].reason.includes('r'), '결손 필드명이 사유에 남는다');

  // 검증은 관례가 아니라 싱크의 성질이어야 한다 — 원시 버퍼를 우회할 쓰기 경로가 없다.
  const warn2 = console.warn;
  console.warn = () => {};
  try { session.log.log('unlock', {}); } finally { console.warn = warn2; }
  eq(session.logViolations.length, 5, 'session.log.log 직접 호출도 검증을 거친다');
  deepEq(Object.keys(session.log).sort(), ['clear', 'entries', 'log', 'serialize'],
    '세션 로그에 검증 없는 쓰기 API 가 없다');

  // `validate` 가 export 되어 있어야 이 경로가 스키마 정의를 두 벌로 갖지 않는다.
  eq(typeof validate, 'function', 'log.mjs 가 validate 를 노출한다');
  eq(validate('reset', {}), undefined, '정상 이벤트는 통과');
});

// ------------------------- 10-b. 후보 필터 입력기 (REQ-102~109) — DOM 없이 도는 유일한 UI 층

suite('후보 필터 입력기 (REQ-102·103·105·106·108·109)', () => {
  const yuunBo = styleById('yuun-bo');
  const jeokUn = styleById('jeok-un');
  const haengUn = styleById('haeng-un');

  function harnessInput({ pool, mastery = {}, mode = 'duel' }) {
    let clock = 0;
    const events = [];
    const input = createSequenceInput({
      pool,
      masteryOf: (s) => mastery[s.id] ?? 0,
      hintDelayMs: BALANCE.hintDelayMs[mode],
      now: () => clock,
      remainingRatio: () => 0.5,
      log: (event, fields) => events.push({ event, ...fields }),
    });
    input.arm();
    return { input, events, tick: (ms) => { clock += ms; }, ids: () => input.candidates.map((s) => s.id) };
  }

  const pool = [yuunBo, jeokUn, haengUn];

  // 정렬 = 숙련 높은 순 → 동률 슬롯 순 (REQ-102)
  const sorted = harnessInput({ pool, mastery: { 'jeok-un': 100 } });
  deepEq(sorted.ids(), ['jeok-un', 'yuun-bo', 'haeng-un'], '숙련 높은 초식이 최상단');
  const tied = harnessInput({ pool });
  deepEq(tied.ids(), ['yuun-bo', 'jeok-un', 'haeng-un'], '숙련 동률이면 슬롯 순 (결정적)');

  // 접두어 필터 + 갈래 전환 (케이스 2)
  const branch = harnessInput({ pool });
  eq(branch.input.press('D', 'keyboard').accepted, true, '↓ 는 세 초식 공통 접두어');
  deepEq(branch.ids(), ['yuun-bo', 'jeok-un', 'haeng-un'], '↓ 뒤 후보 3');
  branch.input.press('L', 'keyboard');
  deepEq(branch.ids(), ['jeok-un'], '← 로 2식 갈래');
  eq(branch.input.top().attr, 'hard', '최상단 속성이 강으로 갱신 = 진행형 후보 색');

  // 후보 0 이 되는 키는 무시 (REQ-103)
  const ignored = harnessInput({ pool });
  ignored.input.press('D', 'button');
  const beforeBuffer = ignored.input.buffer;
  const result = ignored.input.press('D', 'button');
  eq(result.accepted, false, '후보 0 이 되는 키는 수락되지 않는다');
  deepEq(ignored.input.buffer, beforeBuffer, '버퍼 불변');
  deepEq(ignored.ids(), ['yuun-bo', 'jeok-un', 'haeng-un'], '후보 불변');
  eq(ignored.input.ignores, 1, '무시 누적');
  deepEq(ignored.events.filter((e) => e.event === 'ignore'), [{ event: 'ignore', dir: 'D' }], 'ignore 로깅');
  eq(ignored.events.at(-2).accepted, false, '무시된 키도 key 로 남아 ignore_rate 분모가 된다');

  // 리셋 (REQ-105)
  ignored.input.reset();
  deepEq(ignored.input.buffer, [], '리셋 → 버퍼 비움');
  deepEq(ignored.ids(), ['yuun-bo', 'jeok-un', 'haeng-un'], '리셋 → 후보 전체 복원');
  eq(ignored.input.ignores, 0, '리셋 → 무시 누적도 0');

  // 발동 (REQ-106) + 발동 뒤 잠금
  const firing = harnessInput({ pool });
  for (const dir of yuunBo.seq.slice(0, -1)) firing.input.press(dir, 'keyboard');
  eq(firing.input.press('U', 'keyboard').fired.style.id, 'yuun-bo', '후보 1 ∧ 버퍼 == 시퀀스 → 발동');
  const fireEvent = firing.events.at(-1);
  deepEq(
    [fireEvent.event, fireEvent.styleId, fireEvent.len, fireEvent.oneTap, fireEvent.r],
    ['fire', 'yuun-bo', 3, false, 0.5], 'fire 필드가 스키마 그대로',
  );
  eq(firing.input.press('D', 'keyboard').accepted, false, '발동 뒤 입력은 ignore 가 아니라 무반응');
  eq(firing.events.filter((e) => e.event === 'ignore').length, 0, '발동 뒤 키가 ignore_rate 를 오염시키지 않는다');

  // 딜레이드 힌트 인덱스 경계 (REQ-108)
  const hint = harnessInput({ pool: [yuunBo] });
  eq(hint.input.revealed(), 0, '창이 열린 직후에는 점등 없음');
  hint.tick(BALANCE.hintDelayMs.duel - 1);
  eq(hint.input.revealed(), 0, `${BALANCE.hintDelayMs.duel}ms 직전까지 점등 없음`);
  hint.tick(1);
  eq(hint.input.revealed(), 1, '지연이 지나면 다음 화살표 하나만 점등');
  hint.input.press('D', 'keyboard');
  eq(hint.input.revealed(), 1, '키를 받으면 힌트 시계가 다시 시작한다');
  hint.tick(BALANCE.hintDelayMs.duel);
  eq(hint.input.revealed(), 2, '입력분 + 점등분');
  hint.tick(BALANCE.hintDelayMs.duel * 5);
  eq(hint.input.revealed(), 2, '점등은 키마다 하나씩 — 지연이 쌓여도 앞서 나가지 않는다');

  const trainHint = harnessInput({ pool: [yuunBo], mode: 'train' });
  eq(trainHint.input.revealed(), 1, '수련은 지연 0 이라 즉시 점등');
  const fullHint = harnessInput({ pool: [yuunBo], mastery: { 'yuun-bo': BALANCE.masteryFullPct } });
  eq(fullHint.input.revealed(), yuunBo.seq.length, '숙련 100% 는 지연 없이 전 시퀀스 노출');

  // 원터치 (REQ-109)
  const oneTap = harnessInput({ pool, mastery: { 'yuun-bo': BALANCE.masteryFullPct } });
  eq(oneTap.input.tap(jeokUn), null, '숙련 100% 가 아니면 원터치 불가');
  const tapped = oneTap.input.tap(yuunBo);
  eq(tapped.oneTap, true, '원터치 발동');
  eq(oneTap.events.at(-1).r, 0.5, '원터치 r 은 탭 시점 잔여 비율');
  eq(oneTap.input.tap(yuunBo), null, '발동 뒤 원터치도 잠긴다');

  // arm 이 그 창의 장착을 다시 읽는다
  const rearm = harnessInput({ pool: [yuunBo] });
  rearm.input.arm([yuunBo, jeokUn]);
  deepEq(rearm.ids(), ['yuun-bo', 'jeok-un'], 'arm(pool) 이 후보 집합을 갱신');
});

// --------------------------------- 11. 케이스 4 — 딜레이드 힌트 페이스 (REQ-108·308)

suite('케이스 4 — 딜레이드 힌트 페이스 (REQ-108·308)', () => {
  // 힌트 1개 점등(hintDelay) + 그 화살표를 누르는 시간이 힌트 의존 플레이의 키당 페이스다.
  const KEYPRESS_MS = 350;
  const paceOf = (mode) => BALANCE.hintDelayMs[mode] + KEYPRESS_MS;
  eq(paceOf('duel'), 850, 'spec 케이스 4 실전 페이스 = 키당 0.85s');

  for (const len of [3, 4, 5]) {
    const window = responseWindowMs(len);
    eq(paceOf('duel') * len <= window, len === 3,
      `실전 ${len}키 힌트 의존 완주 (${paceOf('duel') * len}ms vs 창 ${window}ms)`);
    ok(paceOf('train') * len <= window,
      `수련 ${len}키는 힌트 즉시라 완주 (${paceOf('train') * len}ms vs 창 ${window}ms)`);
  }

  // 3키 실전이 통과선인 것이 케이스 4 의 요지 — 여유가 사라지면 hintDelay 튜닝이 필요하다.
  ok(responseWindowMs(3) - paceOf('duel') * 3 >= 0, '유운보 완주 여유가 음수가 아니다');
});

// ------------------- 13. 재화 · 결과 정산 · 로그 내보내기 (REQ-602·604 · 수용 케이스 11)

suite('재화 · 정산 · 내보내기 (REQ-602·604·209)', () => {
  const session = createSession();

  eq(simulateTraining(session), 360, '수련 시뮬 = simEfficiency × simTrainSeconds');
  eq(session.coins, 360, '재화가 세션에 적립된다');
  deepEq(session.log.entries.at(-1).reason, 'train_sim', '수련 시뮬도 coins 이벤트로 남는다');

  const duelLoss = settleDuel(session, { win: false, stage: 1 });
  eq(duelLoss.reward, 0, '패배는 무손실·무보상 (REQ-209)');
  eq(session.stage, 1, '패배로 차수가 움직이지 않는다');

  const duelWin = settleDuel(session, { win: true, stage: 1 });
  eq(duelWin.reward, BALANCE.reward.duelWin, '대련 승리 보상 시드');
  eq(session.stage, 2, '승리로 차수가 전진');
  eq(session.coins, 360 + BALANCE.reward.duelWin, '보상이 재화에 더해진다');

  settleDispatch(session, { win: true });
  eq(session.coins, 360 + BALANCE.reward.duelWin + BALANCE.reward.dispatchWin, '파견 승리 보상 시드');
  const last = session.log.entries.at(-1);
  // kill (d) 종점은 승패와 무관하게 파견 결과에서 닫혀야 한다.
  deepEq([last.event, last.phase], ['cycle', 'cycle_done'], '파견 정산이 cycle_done 을 남긴다');

  const payload = exportPayload(session, { exportedAt: '2026-09-02T00:00:00.000Z' });
  eq(payload.schema, EXPORT_SCHEMA, '내보내기 스키마 이름');
  eq(payload.balance.rev, BALANCE_REV, '밸런스 지문에 판본 rev 가 실린다 (#45)');
  eq(payload.coins, session.coins, '재화 스냅샷 동봉');
  eq(payload.entries.length, session.log.entries.length, '세션 버퍼 전량이 실린다');
  deepEq(payload.log_violations, [], '위반 0건이면 빈 배열');
  eq(JSON.parse(JSON.stringify(payload)).entries.length, payload.entries.length, 'JSON 왕복 무손실');

  // 위반이 있으면 그대로 실려야 판독기가 결손 로그를 거부할 수 있다 (인계 계약).
  const warn = console.warn;
  console.warn = () => {};
  try { logEvent(session, 'unlock', {}); } finally { console.warn = warn; }
  eq(exportPayload(session).log_violations.length, 1, '위반은 내보내기에 함께 실린다');
});

// --------------------- 14. 헤드리스 봇 1사이클 (REQ-601·603·605 · 수용 케이스 11)

suite('헤드리스 봇 1사이클 (REQ-601·603·605)', () => {
  const SEEDS = [20260901, 20260902, 7919, 104729, 1299709];
  const runs = SEEDS.map((seed) => runHeadlessCycle({ random: createSeededRandom(seed) }));

  for (const [i, run] of runs.entries()) {
    const payload = exportPayload(run.session);
    deepEq(run.session.logViolations, [], `시드 ${SEEDS[i]} — 로그 스키마 위반 0건`);

    const emitted = new Set(payload.entries.map((e) => e.event));
    const missing = Object.keys(LOG_SCHEMA).filter((event) => !emitted.has(event));
    // REQ-601 최종 검증 — 실제 1사이클에서 전 종류가 나오지 않으면 kill 산식에 구멍이 있다.
    deepEq(missing, [], `시드 ${SEEDS[i]} — 통합 로그 ${Object.keys(LOG_SCHEMA).length}종 전량 emit`);

    const metrics = readout(payload);
    eq(metrics.aux.tester_role, 'bot', `시드 ${SEEDS[i]} — tester_role 이 봇으로 남는다`);
    ok(metrics.kill.a_first_fire_ms > 0, `시드 ${SEEDS[i]} — first_fire_t 가 가상 시계로 찍힌다`);
    eq(metrics.kill.d_cycle_done_ms, run.elapsedMs, `시드 ${SEEDS[i]} — cycle_done_t = 사이클 총 시간`);
    ok(metrics.kill.b_hand_fires + metrics.kill.b_timeouts > 0,
      `시드 ${SEEDS[i]} — 실전 창 완주율의 분모가 비어 있지 않다`);
    ok(metrics.gate.ignore_rate !== null, `시드 ${SEEDS[i]} — ignore_rate 가 산출된다`);
    ok(metrics.aux.first_transmit_ms !== null, `시드 ${SEEDS[i]} — 전수까지 도달`);
    // kill 임계(300s · 15%)는 여기서 단정하지 않는다 — 이 하네스는 required check 라,
    // 밸런스 시드를 튜닝하는 것만으로 이후 모든 PR 이 막힌다. 임계 판정은 판독기 출력이다.
  }

  // 봇이 중간에 멈추고 사람이 이어 친 로그 — 두 손이 한 분수에 합산되면 kill 판정이 거짓이 된다.
  const base = exportPayload(runs[0].session);
  // 마지막 발동 직전에서 자른다 — 앞의 실전 발동이 전부 봇 몫이 되어 분자 차이가 확실히 생긴다.
  const cut = base.entries.findLastIndex((e) => e.event === 'fire');
  const mixed = {
    ...base,
    entries: [
      ...base.entries.slice(0, cut),
      { event: 'session', t_ms: base.entries[cut].t_ms, tester_role: 'self', device: 'keyboard' },
      ...base.entries.slice(cut),
    ],
  };
  const mixedOut = readout(mixed);
  const pureOut = readout(base);
  eq(mixedOut.aux.mixed_hands, true, '두 손이 섞인 사이클을 혼재로 식별한다');
  eq(mixedOut.aux.tester_role, 'bot+self', '섞인 역할이 둘 다 남는다');
  ok(mixedOut.aux.bot_hand_entries > 0, '봇 구간 항목 수가 보고된다');
  ok(mixedOut.kill.b_hand_fires < pureOut.kill.b_hand_fires, '봇 구간은 완주율 분자에서 빠진다');
  ok(mixedOut.kill.a_first_fire_ms > pureOut.kill.a_first_fire_ms, '(a) 는 사람의 첫 발동으로 다시 잡힌다');
  eq(mixedOut.kill.d_cycle_done_ms, pureOut.kill.d_cycle_done_ms, '(d) 종점은 사이클의 성질이라 그대로다');

  // 봇이 손을 놓은 뒤 사람이 화면만 넘겨 완주한 로그 — 손 입력이 없어도 (d) 는 두 손의 시간이다.
  const doneAt = base.entries.findLastIndex((e) => e.event === 'cycle' && e.phase === 'cycle_done');
  const handover = {
    ...base,
    entries: [
      ...base.entries.slice(0, doneAt),
      { event: 'session', t_ms: base.entries[doneAt].t_ms, tester_role: 'self', device: 'keyboard' },
      ...base.entries.slice(doneAt),
    ],
  };
  const handoverOut = readout(handover);
  eq(handoverOut.aux.mixed_hands, true, '손 입력 없는 역할 인계도 혼재로 잡는다');
  eq(handoverOut.aux.bot_hand_entries, 0, '사람 구간에 손 입력이 없으면 제외분도 0');

  // 창 배율 전환은 첫 사이클 종점에서 봉인된다 — 이후 화면의 전환이 그 사이클의 (b) 를 막지 않는다.
  eq(readout({ ...base, accessibility_toggles: 2 }).aux.accessibility_toggles, 2,
    '사이클 안의 전환은 판독기까지 전달된다');
  eq(pureOut.aux.accessibility_toggles, 0, '전환이 없으면 0');
  const late = createSession();
  settleDispatch(late, { win: true });
  late.accessibilityToggles += 3;
  late.accessibility = true;
  const lateOut = exportPayload(late);
  eq(lateOut.accessibility_toggles, 0, '사이클 종료 뒤의 전환 횟수는 그 사이클에 실리지 않는다');
  eq(lateOut.accessibility, false, '창 배율 상태도 종점 값으로 봉인된다');

  // 실제 UI 순서 — 시작 시 self 선언 뒤 사람이 봇에 넘긴다. 첫 선언은 전환이 아니다.
  const uiOrder = {
    ...base,
    entries: [
      { event: 'session', t_ms: 0, tester_role: 'self', device: 'keyboard' },
      ...base.entries,
    ],
  };
  eq(readout(uiOrder).aux.mixed_hands, true, 'self→bot 인계도 혼재로 잡는다');
  eq(pureOut.aux.mixed_hands, false, '선언이 하나뿐인 사이클은 혼재가 아니다');

  // 같은 시드는 같은 사이클을 그린다 — 이 성질이 없으면 봇 회귀가 회차마다 흔들린다.
  const twice = SEEDS.slice(0, 1).map(() => runHeadlessCycle({ random: createSeededRandom(SEEDS[0]) }));
  eq(twice[0].elapsedMs, runs[0].elapsedMs, '같은 시드 = 같은 가상 시간');

  const metrics = runs.map((r) => readout(exportPayload(r.session)));
  const over = runs.filter((r, i) => r.elapsedMs > KILL.cycleDoneMs || metrics[i].gate.ignore_rate > KILL.ignoreRate);
  console.log(`    봇 v2 ${runs.length}회: 사이클 `
    + `${runs.map((r) => (r.elapsedMs / 1000).toFixed(0)).join('/')}s · 완주율 `
    + `${metrics.map((m) => `${(m.kill.b_completion_rate * 100).toFixed(0)}%`).join('/')} · `
    + `ignore ${metrics.map((m) => `${(m.gate.ignore_rate * 100).toFixed(1)}%`).join('/')}`
    + (over.length ? ` — 임계(300s·15%) 초과 ${over.length}회, balance-log 회차 필요` : ''));
});

// ------------- 14-a. 사이클 시뮬 (REQ-310·603) — 유효 성공률 시나리오별 구간 산출

/**
 * 유효 성공률 시나리오 (#38) — 손 정확도 시드가 그 축의 유일한 입력이라, 두 값은
 * 「이 봇이 그 성공률을 내는 `missRate`」의 실측 역산이다 (아래 출력의 실현 성공률로 확인된다).
 */
const RATE_SCENARIOS = [{ label: '70%', missRate: 0.085 }, { label: '50%', missRate: 0.18 }];
const SIM_SEEDS = [20260901, 20260902, 7919, 104729, 1299709, 31337, 15485863, 2718281,
  161803, 577, 9973, 42];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

suite('사이클 시뮬 — 입문 · 12성 · cycle_done (REQ-310·603)', () => {
  for (const scenario of RATE_SCENARIOS) {
    const runs = SIM_SEEDS.map((seed) => {
      const run = runHeadlessCycle({
        random: createSeededRandom(seed),
        paceSeed: { ...BALANCE.bot, missRate: scenario.missRate },
      });
      const entries = exportPayload(run.session).entries;
      const at = (pred) => entries.find(pred)?.[TIME_FIELD] ?? null;
      const duelVerdicts = entries.filter((e) => e.event === 'verdict' && e.who === 'user');
      return {
        seed,
        initiate: at((e) => e.event === 'initiate'),
        twelve: at((e) => e.event === 'rank' && e.to === BALANCE.rankMax),
        transmit: at((e) => e.event === 'transmit'),
        done: run.elapsedMs,
        ranksBeforeInitiate: entries.filter((e) => e.event === 'rank').length
          ? entries.findIndex((e) => e.event === 'rank') < entries.findIndex((e) => e.event === 'initiate')
          : false,
        wins: entries.filter((e) => e.event === 'coins' && e.reason === 'duel_win').length,
        rate: duelVerdicts.filter((e) => isEffectiveSuccess(e.grade)).length / duelVerdicts.length,
      };
    });

    for (const run of runs) {
      // 순서가 곧 D1 규칙이다 — 성 전이가 입문보다 앞서면 게이트가 새고 있다는 뜻이다.
      ok(run.initiate !== null, `${scenario.label} 시드 ${run.seed} — 입문 이벤트가 남는다`);
      eq(run.ranksBeforeInitiate, false, `${scenario.label} 시드 ${run.seed} — 성 전이는 입문 뒤에만`);
      ok(run.twelve > run.initiate, `${scenario.label} 시드 ${run.seed} — 12성은 입문 뒤`);
      ok(run.transmit > run.twelve, `${scenario.label} 시드 ${run.seed} — 전수는 12성 뒤`);
      ok(run.wins >= DUEL_A_STAGES, `${scenario.label} 시드 ${run.seed} — A 전 차수 승리 도달`);
    }

    const secs = (key) => `${(median(runs.map((r) => r[key])) / 1000).toFixed(0)}s`;
    const span = (key) => `${(Math.min(...runs.map((r) => r[key])) / 1000).toFixed(0)}~`
      + `${(Math.max(...runs.map((r) => r[key])) / 1000).toFixed(0)}s`;
    console.log(`    ${scenario.label} 시나리오 (실현 ${(median(runs.map((r) => r.rate)) * 100).toFixed(0)}%): `
      + `입문 ${secs('initiate')} · 12성 ${secs('twelve')} · cycle_done ${secs('done')} [${span('done')}]`);
  }
  // kill 임계는 여기서 단정하지 않는다 — required check 라 시드 튜닝만으로 이후 PR 이 전부 막힌다.
});

// ----------------------------------------------- 15. 도장 유도 툴팁 대상 (#15)

suite('도장 유도 툴팁 대상 (#15)', () => {
  // 도장 화면이 넘기는 것과 같은 형태 — 우선순위 오름차순, `disabled` 는 화면의 술어값 그대로다.
  // 우선순위 정렬과 문구 조립은 화면 쪽(`dojo.mjs`) 몫이라 이 suite 의 사정권 밖이다.
  const render = (state, locked) => pickTooltip(state, [
    { id: 'train:yuun-bo', disabled: false },
    { id: 'learn:jeok-un', disabled: locked.includes('learn:jeok-un') },
    { id: 'duel', disabled: locked.includes('duel') },
    { id: 'transmit', disabled: locked.includes('transmit') },
  ]);
  const ALL_LOCKED = ['learn:jeok-un', 'duel', 'transmit'];

  const state = createTooltipState();
  deepEq(render(state, ALL_LOCKED), { id: 'train:yuun-bo', kind: 'start' },
    '최초 진입 — 우선순위 순서상 처음으로 잠기지 않은 버튼을 지목한다');
  deepEq(render(state, ALL_LOCKED), { id: 'train:yuun-bo', kind: 'start' },
    '누르지 않은 안내는 다음 렌더에도 남는다 — 다른 화면을 다녀와도 유도가 사라지지 않는다');

  consumeTooltip(state, 'train:yuun-bo');
  eq(render(state, ALL_LOCKED), null, '누른 버튼의 안내는 사라진다');
  eq(render(state, ALL_LOCKED), null, '같은 조건으로 다시 뜨지 않는다');

  deepEq(render(state, ['learn:jeok-un', 'transmit']), { id: 'duel', kind: 'unlocked' },
    '직전 렌더에서 잠겨 있다가 풀린 버튼이 새 안내가 된다');
  deepEq(render(state, ['learn:jeok-un', 'transmit']), { id: 'duel', kind: 'unlocked' },
    '풀린 채로 유지되는 동안 그 안내도 유지된다');

  eq(render(state, ALL_LOCKED), null, '다시 잠기면 안내는 그 자리에서 사라진다');
  eq(render(state, ['learn:jeok-un', 'transmit']), null,
    '장착·해제로 잠금이 오가도 같은 축을 재고지하지 않는다');

  deepEq(render(state, []), { id: 'learn:jeok-un', kind: 'unlocked' },
    '한 렌더에서 둘이 함께 풀리면 우선순위가 앞선 쪽이 안내된다');

  // 수용 기준 2 는 「활성화되는 렌더에서 그 버튼에 뜬다」라, 새 해금이 서 있던 안내를 밀어낸다.
  const shift = createTooltipState();
  deepEq(pickTooltip(shift, [{ id: 'learn:jeok-un', disabled: false }, { id: 'transmit', disabled: true }]),
    { id: 'learn:jeok-un', kind: 'start' }, '먼저 뜬 안내');
  deepEq(pickTooltip(shift, [{ id: 'learn:jeok-un', disabled: false }, { id: 'transmit', disabled: false }]),
    { id: 'transmit', kind: 'unlocked' }, '누르지 않은 안내라도 새로 풀린 버튼이 그 자리를 가져간다');
  eq(pickTooltip(shift, [{ id: 'learn:jeok-un', disabled: false }, { id: 'transmit', disabled: true }]), null,
    '밀려난 안내는 이미 고지된 것이라 되돌아오지 않는다');

  // 안내는 우선순위표가 아니라 잠금 전이에서 나온다 — 직전 렌더에 없던 버튼은 고지 대상이 아니다.
  const late = createTooltipState();
  deepEq(pickTooltip(late, [{ id: 'duel', disabled: true }]), null, '전부 잠긴 첫 렌더는 안내가 없다');
  eq(pickTooltip(late, [{ id: 'duel', disabled: true }, { id: 'train:pa-un', disabled: false }]), null,
    '직전 렌더에 없던 버튼은 신규 활성화가 아니다');
});

// ------------------------------- 16. 계측 배선 공유 (#11) — 화면과 헤드리스가 한 벌을 쓴다

suite('계측 배선 공유 (#11)', () => {
  const session = createSession();
  const style = STYLES[0];
  const input = createSequenceInput({
    pool: [style],
    masteryOf: () => 0,
    hintDelayMs: 0,
    now: () => 0,
    log: (event, fields) => logEvent(session, event, fields),
  });
  const disciple = { arm() {}, tick: () => null };

  // 화면이 계측 hook 을 하나 늘리면 이 목록이 red 가 되고, 그 자리에서 헤드리스도 함께 따라간다.
  deepEq(Object.keys(trainWiring(session, { styleId: style.id, input })).sort(),
    ['onArm', 'onFire'], '수련 배선이 내는 hook 이름 집합');
  deepEq(Object.keys(duelWiring(session, { input })).sort(),
    ['onTelegraph', 'onTimeout', 'onVerdict', 'onWindow'], '대련 배선이 내는 hook 이름 집합');
  deepEq(Object.keys(dispatchWiring(session, { disciple })).sort(),
    ['onTelegraph', 'onTick', 'onVerdict'], '파견 배선이 내는 hook 이름 집합');

  // 이름만 맞고 속이 빈 배선은 위 집합 단정을 통과하므로, hook 이 실제로 계측하는지 함께 본다.
  const before = session.log.entries.length;
  duelWiring(session, { input }).onTimeout();
  eq(session.log.entries.length, before + 1, '대련 배선의 onTimeout 이 항목을 하나 남긴다');
  eq(session.log.entries.at(-1).event, 'timeout', '그 항목이 창 초과 기록이다');

  const armed = trainWiring(session, { styleId: style.id, input }).onArm();
  eq(armed, responseWindowMs(style.seq.length, { accessibility: session.accessibility }),
    '수련 배선의 onArm 이 그 시도의 창 길이를 돌려준다');

  // 화면·헤드리스가 같은 이름으로 자기 hook 을 얹어도 계측이 덮이지 않는다 — 배선 1벌의 강제 지점.
  const calls = [];
  const composed = composeHooks(
    { onTick: (v) => { calls.push(`계측:${v}`); return '계측값'; } },
    {
      onTick: (v, measured) => calls.push(`렌더:${v}:${measured}`),
      onEnd: () => calls.push('렌더:끝'),
    },
  );
  deepEq(Object.keys(composed).sort(), ['onEnd', 'onTick'], '두 묶음의 합집합이 hook 집합이다');
  eq(composed.onTick(1), '계측값', '계측 반환값이 호출부로 그대로 돌아간다');
  deepEq(calls, ['계측:1', '렌더:1:계측값'], '계측이 먼저 돌고 그 결과가 렌더로 넘어간다');
  composed.onEnd();
  eq(calls.at(-1), '렌더:끝', '계측에 없는 hook 도 그대로 불린다');

  const bare = composeHooks({ onTick: () => '계측만' });
  eq(bare.onTick(), '계측만', '렌더를 얹지 않아도 계측은 그대로 돈다');

  // 계측 반환값은 인자 뒤에 붙는다 — hook 인자가 늘면 얹은 쪽의 그 자리도 함께 밀린다.
  const wide = composeHooks({ onVerdict: () => '계측값' }, { onVerdict: (...got) => calls.push(got.join('|')) });
  wide.onVerdict('a', 'b');
  eq(calls.at(-1), 'a|b|계측값', '계측 인자가 늘어도 반환값이 마지막 자리를 지킨다');

  // 위 단정은 팩토리가 바뀔 때만 red 다. 이슈가 이름 붙인 재발 경로는 그 반대편 —
  // 화면이 팩토리를 우회해 자기 hook 에 계측을 직접 다는 것 — 이라 소비처를 원문으로 잠근다.
  // 화면 모듈은 DOM 을 만져 하네스가 import 할 수 없으므로 원문 대조가 유일한 수단이다.
  const CONSUMERS = {
    'src/ui/screens/train.mjs': ['trainWiring'],
    'src/ui/screens/duel.mjs': ['composeHooks', 'duelWiring'],
    'src/ui/screens/dispatch.mjs': ['composeHooks', 'dispatchWiring', 'logDispatchStart'],
    'src/bot.mjs': ['composeHooks', 'dispatchWiring', 'duelWiring', 'logDispatchStart', 'trainWiring'],
  };
  // `log*`/`record*` 규약으로 도출한 계측 함수 — 화면이 이 이름을 직접 쥐면 배선이 두 벌이 된다.
  // 수기 열거는 새로 생긴 계측 함수를 조용히 놓치므로 session.mjs export 에서 도출한다 (#31).
  const sessionSource = readFileSync(new URL('../src/ui/session.mjs', import.meta.url), 'utf8');
  const sessionExports = [...sessionSource.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)]
    .map((m) => m[1] ?? m[2]);
  // 미지원 선언 문법(`export let`·`export {}` 등)은 조용한 누락이 되므로 계수로 loud fail 시킨다.
  eq(sessionExports.length, (sessionSource.match(/^export /gm) ?? []).length,
    'session.mjs 의 export 를 하나도 빠뜨리지 않고 이름으로 뽑았다');
  // 규약을 지키지만 화면이 정당하게 직접 쥐는 이름 — 도출에 넣으면 green 이어야 할 단정이 red 가 된다.
  const NOT_INSTRUMENTS = ['logEvent', 'logSessionMeta'];
  const INSTRUMENTS = sessionExports
    .filter((name) => /^(log|record)[A-Z]/.test(name) && !NOT_INSTRUMENTS.includes(name));
  deepEq(NOT_INSTRUMENTS.filter((name) => sessionExports.includes(name)), NOT_INSTRUMENTS,
    '제외 목록의 이름이 아직 session.mjs export 다');
  // 부재 단정은 도출이 비어도 통과한다 — 양성 대조가 그 공허 통과를 막는다.
  ok(INSTRUMENTS.includes('recordDuelVerdict'), '도출이 실제 계측 함수를 집는다');
  ok(!INSTRUMENTS.includes('equippedStyles'), '화면이 정당하게 쥐는 이름은 도출에 없다');
  for (const [path, expected] of Object.entries(CONSUMERS)) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    // 주석·문자열의 심볼 언급은 배선이 아니다 — required check 를 오탐으로 막지 않게 import 만 본다.
    const imports = (source.match(/^import[\s\S]*?';$/gm) ?? []).join('\n');
    const body = source.replace(/^import[\s\S]*?';$/gm, '');
    deepEq(expected.filter((name) => imports.includes(name)), expected,
      `${path} 가 공유 배선을 import 한다`);
    // 쓰이지 않는 import 를 남긴 채 hook 을 인라인으로 되돌리는 우회를 막는다.
    deepEq(expected.filter((name) => body.includes(`${name}(`)), expected,
      `${path} 가 그 배선을 실제로 호출한다`);
    ok(/from '[^']*\/wiring\.mjs'/.test(imports), `${path} 의 배선 출처가 wiring.mjs 다`);
    deepEq(INSTRUMENTS.filter((name) => imports.includes(name)), [],
      `${path} 는 계측 함수를 직접 쥐지 않는다 — 배선은 한 벌이어야 한다`);
  }
});

// -------------------------------------------- 12. BALANCE 파라미터 census (REQ-606)

suite('BALANCE 파라미터 census (REQ-606)', () => {
  // spec § 데이터 구조 파라미터 표의 시드값 — 값이 바뀌면 밸런스 로그 회차가 필요하다.
  const SEEDS = {
    telegraphMs: 1000, windowBaseMs: 2600, windowStepMs: 500, windowBaseLen: 3,
    openingWindowPenalty: 0.4, accessibilityWindowMult: 1.3, accessibilityWindow: false,
    resolveMs: 500, maxExchanges: 12, powerBase: 1, powerPerRank: 0.05,
    initiativeBase: 1, initiativePerRatio: 0.3, clashK: 0.5, effectiveSuccessMaxOrder: 2,
    trainGraduateHits: 2, ignoreHighlightAt: 3, rankMax: 12, slots: 3,
    discipleStartRank: 1, discipleRankMax: 10, discipleFireRatio: 0.6,
    winColorHintExchanges: Number.MAX_SAFE_INTEGER, simEfficiency: 0.1, simTrainSeconds: 3600,
    buttonHitPx: 56,
  };
  for (const [key, value] of Object.entries(SEEDS)) eq(BALANCE[key], value, `BALANCE.${key}`);
  deepEq(BALANCE.damageByLen, { 3: 10, 4: 14, 5: 20 }, 'BALANCE.damageByLen');
  deepEq(BALANCE.hintDelayMs, { duel: 500, train: 0 }, 'BALANCE.hintDelayMs');
  deepEq(BALANCE.rankGate, { equip: 2, unlock: 5, oneTap: 7 }, 'BALANCE.rankGate (REQ-711·713 계단)');
  deepEq(BALANCE.rankLadder, {
    gain: { train: 1, duel: 3 },
    bands: [{ maxRank: 7, cost: 3, train: true }, { maxRank: 10, cost: 6, train: false }],
    finishRank: 11, crushRank: 12,
  }, 'BALANCE.rankLadder (REQ-702 적립 3단)');
  deepEq(BALANCE.hp, { user: 100, disciple: 100, 'A-1': 30, 'A-2': 45, 'A-3': 80, B: 80 }, 'BALANCE.hp');
  deepEq(BALANCE.challengerRank, { 'A-1': 1, 'A-2': 2, 'A-3': 3, B: 2 }, 'BALANCE.challengerRank (REQ-722)');
  // 폐기 8키가 하나라도 되살아나면 그 값이 무음 `undefined` 로 판정 수식에 흘러든다 (#64).
  for (const key of RETIRED_KEYS) ok(!(key in BALANCE), `폐기 키 ${key} 가 BALANCE 에 없다`);
  deepEq(BALANCE.reward, { duelWin: 30, dispatchWin: 50 }, 'BALANCE.reward');
  deepEq(BALANCE.bot, {
    reactionMs: [450, 650], keyMs: [260, 380], navMs: [300, 600],
    missRate: 0.15, misHitRate: 0.06, pollMs: 30,
  }, 'BALANCE.bot (REQ-605 사람 속도 시드)');
  deepEq(jsonLossy(BALANCE, 'BALANCE'), [], 'BALANCE 에 JSON 왕복에서 소실되는 값이 없다');
  eq(JSON.parse(JSON.stringify(BALANCE)).winColorHintExchanges, BALANCE.winColorHintExchanges,
    '상시 힌트 상한이 JSON 왕복에서 보존된다');
  deepEq(Object.entries(BALANCE.grades).map(([id, g]) => [id, g.label, g.order, g.outPct, g.inPct, g.opening]), [
    ['crush', '완파', 0, 1, 0, 'foe'],
    ['advantage', '우세', 1, 0.6, 0.2, null],
    ['clash', '상쇄', 2, null, null, null],
    ['disadvantage', '열세', 3, 0.2, 0.6, null],
    ['reversal', '역파', 4, 0, 1, 'self'],
    ['struck', '피격', 5, 0, 1, null],
  ], '6단 판정표 시드');
  // 표시 규약이 빠진 등급은 화면에 빈 판정으로 나가므로, 판정표와 같은 키 집합이어야 한다.
  deepEq(Object.keys(GRADE_VIEW).sort(), Object.keys(BALANCE.grades).sort(),
    '판정 표시 규약이 6단 전 등급을 덮는다');
});

suite('밸런스 데이터 스키마 (#45)', () => {
  const source = JSON.parse(readFileSync(new URL('../src/balance.data.json', import.meta.url), 'utf8'));

  // 정본은 JSON 하나다 — 로더가 내놓은 값이 파일 그대로여야 이관이 값 보존이다.
  const { rev, ...values } = source;
  eq(rev, BALANCE_REV, 'rev 가 BALANCE_REV 로 분리 export 된다');
  deepEq(values, BALANCE, 'BALANCE 는 JSON 의 rev 를 뺀 나머지 그대로다');
  deepEq(Object.keys(values), Object.keys(BALANCE), '필드 순서까지 정본을 따른다');
  ok(Object.isFrozen(BALANCE) && Object.isFrozen(BALANCE.grades.crush), '산출물이 깊게 동결된다');

  // 양성 대조 — 불량 데이터가 폴백 없이 죽고, 어느 필드가 왜 틀렸는지 문면에 실린다.
  const clone = () => JSON.parse(JSON.stringify(source));
  const throwsWith = (mutate, needle, label) => {
    const raw = clone();
    mutate(raw);
    let message = null;
    try {
      validateBalance(raw);
    } catch (err) {
      message = err.message;
    }
    ok(message !== null, `${label} — throw 한다`);
    ok(message !== null && message.startsWith('밸런스 데이터 불량 — src/balance.data.json'),
      `${label} — 정본 경로가 문면에 실린다`);
    ok(message !== null && message.includes(needle), `${label} — 문면에 ${needle} 가 실린다 (실제: ${message})`);
  };

  throwsWith((r) => { delete r.masteryFullPct; }, 'masteryFullPct: 필드 누락', '필드 누락');
  throwsWith((r) => { r.telegraphMs = '1000'; }, 'telegraphMs: "1000" 는 유한 수가 아니다', '타입 불일치');
  throwsWith((r) => { r.grades.clash.formula = 'pctt'; }, 'grades.clash.formula: "pctt" 는 ["pct","clash"] 밖', 'formula enum 밖');
  throwsWith((r) => { r.grades.struck.order = 4; }, 'grades.*.order', 'order 중복 (0..5 순열 아님)');
  throwsWith((r) => { delete r.hp['A-3']; }, 'hp: 키 "A-3" 누락 (CHALLENGERS 와 1:1)', 'hp 도전자 키 누락');
  throwsWith((r) => { delete r.threshold['pa-un']; }, 'threshold: 키', 'threshold 초식 키 누락');
  throwsWith((r) => { r.bot.reactionMs = [650, 450]; }, 'bot.reactionMs: [650,450] 는 [최소, 최대] 순서가 뒤집혔다', 'bot 배열 역순');
  throwsWith((r) => { r.rev = ''; }, 'rev: "" 는 비어 있지 않은 판본 문자열이 아니다', 'rev 공백');
  throwsWith((r) => { delete r.damageByLen['5']; }, 'damageByLen: 초식 길이 5 의 피해가 없다', 'damageByLen 이 초식 길이를 못 덮음');
  throwsWith((r) => { r.nonesuch = 1; }, 'nonesuch: 스키마에 없는 필드', '스키마 밖 필드');
  throwsWith((r) => { delete r.challengerPower.A; }, 'challengerPower: 키 "A" 누락', '도전자 군 위력 키 누락');
  throwsWith((r) => { delete r.reward.dispatchWin; }, 'reward: 키 "dispatchWin" 누락', '보상 키 누락');
  throwsWith((r) => { delete r.hintDelayMs.duel; }, 'hintDelayMs: 키 "duel" 누락', '힌트 지연 키 누락');

  // 오류는 전건 수집 후 한 번에 보고한다 — 첫 건에서 멈추면 고칠 때마다 재실행이 필요하다.
  const many = clone();
  delete many.slots;
  many.grades.clash.formula = 'pctt';
  let batched = null;
  try {
    validateBalance(many);
  } catch (err) {
    batched = err.message;
  }
  ok(batched !== null && batched.includes('2건'), `불량 2건이 한 번에 보고된다 (실제: ${batched})`);
  ok(batched !== null && batched.includes('slots') && batched.includes('grades.clash.formula'),
    '전건 수집 — 두 오류가 모두 문면에 실린다');
});

// ------------------------------------------------------------------ 결과

// suite() 가 예외를 삼키므로, 하한이 없으면 스위트가 통째로 건너뛰어도 실패 1건으로만 보인다.
const MIN_CHECKS = 1796;
if (checks < MIN_CHECKS) {
  failures += 1;
  console.error(`  ✗ 단정 수 ${checks} < 하한 ${MIN_CHECKS} — 스위트가 조용히 건너뛰어졌다`);
}

console.log(`\n단정 ${checks}건 · 실패 ${failures}건`);
if (failures > 0) {
  console.error('하네스 red');
  process.exit(1);
}
console.log('하네스 green');
