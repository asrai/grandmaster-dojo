// 헤드리스 회귀 하네스 — 의존성 0, `node tests/harness.mjs` 로 실행한다.
// 기대값은 BALANCE 키에서 직접 산출하므로 파라미터 개명·판정표 변경은 즉시 red 다.

import {
  ART_SETS, BALANCE, CHALLENGERS, DISCIPLE, FOE_STYLES, STYLES,
} from '../src/balance.mjs';
import { LOG_SCHEMA, TIME_FIELD, createLogBuffer } from '../src/log.mjs';
import {
  applyEffectiveSuccess, artById, assertCounterIntegrity, assertPrefixFree, canLearn, canTransmit,
  challengerById, createDisciple, createProgress, discipleRankOf, discipleStyles, finisherOf,
  foeStyleById, initiativeOf, isEffectiveSuccess, judge, learn, masteryPct, powerOf, ptsForRank,
  rankForPts, rankOf, responseWindowMs, selectDiscipleStyle, styleById, transmit,
} from '../src/core.mjs';

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
    ok(BALANCE.threshold[s.id] !== undefined, `${s.id} threshold 존재`);
    eq(BALANCE.rankPtsPerStyle[s.id], s.order, `${s.id} 성 포인트 = 초식 차수`);
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
    ok(BALANCE.challengerPower[c.group] !== undefined, `${c.group} 내공 시드 존재`);
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
  eq(artById('yuun-geom').transmitRank, BALANCE.rankMax, '전수 조건 = 성 상한');
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
    mastery: ['styleId', 'from', 'to'],
    rank: ['style_set', 'from', 'to', 'pts'],
    unlock: ['styleId'],
    slot: ['action', 'styleId'],
    transmit: ['style_set'],
    dispatch: ['challenger'],
    select: ['styleId', 'byUser'],
    coins: ['delta', 'reason'],
    cycle: ['phase'],
    session: ['tester_role', 'device'],
  };
  eq(Object.keys(LOG_SCHEMA).length, 17, '이벤트 17종');
  deepEq(Object.keys(LOG_SCHEMA), Object.keys(EXPECTED), '이벤트 이름·순서');
  for (const [event, fields] of Object.entries(EXPECTED)) {
    deepEq(LOG_SCHEMA[event].fields, fields, `${event} 필드`);
  }
  deepEq(LOG_SCHEMA.key.enums.device, ['keyboard', 'button'], 'key.device 열거');
  deepEq(LOG_SCHEMA.session.enums.tester_role, ['self', 'friend', 'bot'], 'session.tester_role 열거');

  let clock = 100;
  const buf = createLogBuffer({ now: () => clock });
  clock = 350;
  const entry = buf.log('narrow', { styleId: 'yuun-bo' });
  eq(entry[TIME_FIELD], 250, `전 이벤트 공통 ${TIME_FIELD}`);
  buf.log('reset');
  eq(buf.entries.length, 2, '버퍼 적재');
  eq(JSON.parse(buf.serialize()).length, 2, 'JSON 내보내기');
  eq(JSON.parse(JSON.stringify(buf.entries)).length, 2, '버퍼를 통째로 직렬화해도 이중 인코딩되지 않는다');
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
            for (const foePower of Object.values(BALANCE.challengerPower)) {
              const expected = expectedVerdict({ self, foe, foeOpen, rank, r, foePower });
              const actual = judge({ selfStyle: self, foeStyle: foe, selfRank: rank, foePower, r, foeOpen });
              deepEq(actual, expected,
                `${self ? self.id : '미완주'} vs ${foe.id} (빈틈=${foeOpen} r=${r} 성=${rank} N적=${foePower})`);
              seenGrades.add(actual.grade);
              combos += 1;
            }
          }
        }
      }
    }
  }
  eq(combos, selfOptions.length * FOE_STYLES.length * 2 * rs.length * ranks.length * 2, '전 조합 수');
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
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha') }),
    '성 결손은 NaN 이 아니라 throw', '성이 유한한 수가 아니다');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, foePower: NaN }),
    '상대 내공 결손은 NaN 이 아니라 throw', '상대 내공이 유한한 수가 아니다');

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

// ---------------------------- 6. 케이스 6 — 최소 경로 45pt (REQ-301·302·303·304)

suite('성 계단 (REQ-304)', () => {
  eq(rankForPts(0), 1, '0pt = 1성');
  eq(rankForPts(ptsForRank(10)), 10, '10성 도달');
  eq(ptsForRank(10), 27, '10성 = 27pt');
  eq(ptsForRank(11), 33, '11성 = 27 + 3×2');
  eq(ptsForRank(12), 45, '12성 = 33 + 3×4');
  eq(rankForPts(44), 11, '44pt 는 아직 11성');
  eq(rankForPts(45), 12, '45pt = 12성');
  eq(rankForPts(999), BALANCE.rankMax, '성은 상한에서 멈춘다');
  eq(rankForPts(999, { max: BALANCE.discipleRankMax }), BALANCE.discipleRankMax, '제자 성 상한 10');
  eq(rankForPts(0, { max: BALANCE.discipleRankMax }), BALANCE.discipleStartRank, '제자 시작 성 1');
});

const minPath = (() => {
  const plan = [
    { styleId: 'yuun-bo', train: BALANCE.trainGraduateHits, duel: BALANCE.threshold['yuun-bo'] },
    { styleId: 'jeok-un', train: BALANCE.trainGraduateHits, duel: BALANCE.threshold['jeok-un'] },
    { styleId: 'haeng-un', train: BALANCE.trainGraduateHits, duel: BALANCE.threshold['haeng-un'] },
  ];
  let progress = createProgress();
  const events = [];
  let trainHits = 0;
  let duelHits = 0;
  for (const step of plan) {
    if (!progress.styles[step.styleId].learned) progress = learn(progress, step.styleId);
    for (const [mode, times] of [['train', step.train], ['duel', step.duel]]) {
      for (let i = 0; i < times; i += 1) {
        const res = applyEffectiveSuccess(progress, step.styleId, { mode });
        progress = res.progress;
        if (mode === 'train') trainHits += 1; else duelHits += 1;
        events.push({ styleId: step.styleId, mode, index: i + 1, changes: res.changes });
      }
    }
  }
  return { progress, events, trainHits, duelHits };
})();

suite('케이스 6 — 최소 경로 재현 (REQ-302·304)', () => {
  const { progress, events, trainHits, duelHits } = minPath;
  eq(trainHits, 9, '수련 유효 성공 9회');
  eq(duelHits, 13, '실전 유효 성공 13회');
  eq(masteryPct(progress, 'yuun-bo'), BALANCE.masteryFullPct, '유운보 숙련 100%');
  eq(masteryPct(progress, 'jeok-un'), BALANCE.masteryFullPct, '2식 숙련 100%');
  eq(masteryPct(progress, 'haeng-un'), BALANCE.masteryFullPct, '3식 숙련 100%');
  eq(progress.arts['yuun-geom'].rankPts, 45, '누적 성 포인트 45');
  eq(rankOf(progress, 'yuun-geom'), BALANCE.rankMax, '12성 도달');

  const last = events[events.length - 1];
  deepEq([last.styleId, last.mode, last.index], ['haeng-un', 'duel', 5], '마지막 적립은 3식 실전 5회째');
  eq(last.changes.rank?.to, BALANCE.rankMax, '3식 실전 5회째에 12성 전이');
  eq(last.changes.rank?.pts, 45, '전이 시점 누적 포인트');
  const twelveAt = events.filter((e) => e.changes.rank?.to === BALANCE.rankMax);
  eq(twelveAt.length, 1, '12성 전이는 1회뿐');

  deepEq(events.filter((e) => e.changes.unlock).map((e) => e.changes.unlock.styleId),
    ['jeok-un', 'haeng-un', 'pa-un'], '순차 해금 (REQ-303)');
  eq(canLearn(progress, 'pa-un'), true, '4식 학습 가능');
  eq(progress.styles['pa-un'].learned, false, '해금은 학습이 아니다');

  // 수련 3회 = 졸업 30%, 그 뒤 실전 누적이 100% 로 채운다.
  const grad = events.find((e) => e.styleId === 'yuun-bo' && e.mode === 'train' && e.index === 3);
  eq(grad.changes.mastery.to, BALANCE.masteryTrainPct, '수련 3회 = 졸업 숙련 30%');
  eq(BALANCE.masteryTrainPct, BALANCE.equipMasteryPct, '졸업 숙련 = 장착 조건');

  throws(() => learn(createProgress(), 'haeng-un'), '순차 해금 밖 초식 학습은 throw', '해금되지 않은 초식');
  throws(() => applyEffectiveSuccess(createProgress(), 'yuun-bo', { mode: 'nope' }), '알 수 없는 적립 모드는 throw', '알 수 없는 적립 모드');
  throws(() => applyEffectiveSuccess(createProgress(), 'jeok-un', { mode: 'duel' }), '미학습 초식 적립은 throw', '학습하지 않은 초식');
});

// ------------------------------------------------- 7. 전수 = 복사 (REQ-307·401)

suite('전수 = 복사 (REQ-307·401)', () => {
  const master = minPath.progress;
  let disciple = createDisciple();
  eq(canTransmit(master, 'yuun-geom', disciple), true, '12성 + 슬롯 여유 = 전수 가능');
  eq(canTransmit(createProgress(), 'yuun-geom', disciple), false, '1성은 전수 불가');
  eq(discipleRankOf(disciple, 'yuun-geom'), null, '전수 전 제자 성은 예외가 아니라 null');
  deepEq(discipleStyles(disciple, 'yuun-geom'), [], '전수 전 제자 초식은 빈 배열');

  disciple = transmit(master, disciple, 'yuun-geom');
  deepEq(disciple.arts['yuun-geom'].styles, ['yuun-bo', 'jeok-un', 'haeng-un'],
    '제자는 사부가 학습한 초식만 받는다');
  eq(discipleRankOf(disciple, 'yuun-geom'), BALANCE.discipleStartRank, '제자는 1성부터');
  eq(rankOf(master, 'yuun-geom'), BALANCE.rankMax, '사부는 성을 유지한다');
  eq(masteryPct(master, 'yuun-bo'), BALANCE.masteryFullPct, '사부는 숙련을 유지한다');
  eq(canTransmit(master, 'yuun-geom', disciple), false, '슬롯이 차면 재전수 불가');
  throws(() => transmit(master, disciple, 'yuun-geom'), '조건 미충족 전수는 throw', '전수 조건 미충족');
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

function simulateDispatch({ challengerId, disciple, setId }) {
  const challenger = challengerById(challengerId);
  const foePower = BALANCE.challengerPower[challenger.group];
  const rank = discipleRankOf(disciple, setId);
  const styles = discipleStyles(disciple, setId);
  // 제자는 응수 창의 60% 시점에 반드시 실행하므로 선기 잔여는 항상 이 값이다.
  const r = 1 - BALANCE.discipleFireRatio;

  let foeHp = BALANCE.hp[challenger.id];
  let selfHp = BALANCE.hp.disciple;
  let foeOpen = false;
  const trace = [];

  for (let i = 0; i < BALANCE.maxExchanges && foeHp > 0 && selfHp > 0; i += 1) {
    // 빈틈 수에도 예고 순번은 전진한다 — 상대가 그 수를 잃는 것으로 본다.
    const telegraphed = foeOpen ? null : foeStyleById(challenger.styles[i % challenger.styles.length]);
    const selfStyle = selectDiscipleStyle({ styles, foeStyle: telegraphed, rankOf: () => rank });
    if (!selfStyle) throw new Error(`${challenger.id} ${i + 1}수 — 낼 초식이 없다`);
    const verdict = judge({ selfStyle, foeStyle: telegraphed, selfRank: rank, foePower, r, foeOpen });
    foeHp -= verdict.dmgOut;
    selfHp -= verdict.dmgIn;
    foeOpen = verdict.opening === 'foe';
    trace.push({ exchange: i + 1, foe: telegraphed ? telegraphed.id : null, self: selfStyle.id, ...verdict, foeHp, selfHp });
  }
  const win = foeHp <= 0 ? true : selfHp <= 0 ? false : selfHp > foeHp;
  return { win, exchanges: trace.length, foeHp, selfHp, trace, rank };
}

suite('케이스 8 — B 밸런스 게이트 (REQ-403·506)', () => {
  const disciple = transmit(minPath.progress, createDisciple(), 'yuun-geom');
  const sim = simulateDispatch({ challengerId: 'B', disciple, setId: 'yuun-geom' });

  eq(sim.rank, BALANCE.discipleStartRank, '1성 제자');
  eq(powerOf(sim.rank), 1.05, '1성 제자 내공 1.05');
  ok(sim.win, `1성 제자가 무지시로 B 를 이긴다 (남은 HP 적 ${sim.foeHp} / 제자 ${sim.selfHp})`);
  ok(sim.exchanges <= BALANCE.maxExchanges, `수 상한 안에서 결판 (${sim.exchanges}수)`);
  ok(sim.selfHp > 0, '제자가 생존한 채 승리');
  ok(sim.trace.some((t) => t.grade === 'crush'), '완파가 최소 1회');
  eq(sim.trace.every((t) => t.grade !== 'reversal'), true, '역파 회피가 실제로 지켜진다');
  if (!sim.win) {
    console.error(`  ! B 밸런스 미달 — BALANCE.hp.B / challengerPower.B 하향 후 docs/balance-log.md 기록 필요`);
  }
  console.log(`    B 시뮬: ${sim.exchanges}수, 적 HP ${sim.foeHp}, 제자 HP ${sim.selfHp}, `
    + `등급 ${sim.trace.map((t) => BALANCE.grades[t.grade].label).join('·')}`);
});

// -------------------------------------------- 10. BALANCE 파라미터 census (REQ-606)

suite('BALANCE 파라미터 census (REQ-606)', () => {
  // spec § 데이터 구조 파라미터 표의 시드값 — 값이 바뀌면 밸런스 로그 회차가 필요하다.
  const SEEDS = {
    telegraphMs: 1000, windowBaseMs: 2600, windowStepMs: 500, windowBaseLen: 3,
    openingWindowPenalty: 0.4, accessibilityWindowMult: 1.3, accessibilityWindow: false,
    resolveMs: 500, maxExchanges: 12, powerBase: 1, powerPerRank: 0.05,
    initiativeBase: 1, initiativePerRatio: 0.3, clashK: 0.5, effectiveSuccessMaxOrder: 2,
    trainGraduateHits: 3, masteryTrainPct: 30, masteryFullPct: 100,
    rankStep: 3, rankMax: 12, slots: 3, equipMasteryPct: 30,
    discipleStartRank: 1, discipleRankMax: 10, discipleFireRatio: 0.6,
    winColorHintExchanges: Number.MAX_SAFE_INTEGER, simEfficiency: 0.1, buttonHitPx: 56,
  };
  for (const [key, value] of Object.entries(SEEDS)) eq(BALANCE[key], value, `BALANCE.${key}`);
  deepEq(BALANCE.damageByLen, { 3: 10, 4: 14, 5: 20 }, 'BALANCE.damageByLen');
  deepEq(BALANCE.hintDelayMs, { duel: 500, train: 0 }, 'BALANCE.hintDelayMs');
  deepEq(BALANCE.threshold, { 'yuun-bo': 4, 'jeok-un': 4, 'haeng-un': 5, 'pa-un': 5 }, 'BALANCE.threshold');
  deepEq(BALANCE.rankPtsPerStyle, { 'yuun-bo': 1, 'jeok-un': 2, 'haeng-un': 3, 'pa-un': 4 }, 'BALANCE.rankPtsPerStyle');
  deepEq(BALANCE.rankStepMult, { 11: 2, 12: 4 }, 'BALANCE.rankStepMult (spec rank11Mult·rank12Mult)');
  deepEq(BALANCE.hp, { user: 100, disciple: 100, 'A-1': 40, 'A-2': 55, 'A-3': 70, B: 80 }, 'BALANCE.hp');
  deepEq(BALANCE.challengerPower, { A: 1, B: 1.1 }, 'BALANCE.challengerPower');
  deepEq(BALANCE.reward, { duelWin: 30, dispatchWin: 50 }, 'BALANCE.reward');
  deepEq(JSON.parse(JSON.stringify(BALANCE)), JSON.parse(JSON.stringify(BALANCE)), 'BALANCE 는 JSON 직렬화 가능');
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
});

// ------------------------------------------------------------------ 결과

// suite() 가 예외를 삼키므로, 하한이 없으면 스위트가 통째로 건너뛰어도 실패 1건으로만 보인다.
const MIN_CHECKS = 950;
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
