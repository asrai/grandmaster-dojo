// 헤드리스 회귀 하네스 — 의존성 0, `node tests/harness.mjs` 로 실행한다.
// 기대값은 BALANCE 키에서 직접 산출하므로 파라미터 개명·판정표 변경은 즉시 red 다.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  ART_SETS, ATTRS, BALANCE, BALANCE_REV, CHALLENGERS, DISCIPLE, FOE_STYLES, STYLES,
  validateBalance, validateStyleContent, valueDigest,
} from '../src/balance.mjs';
import {
  FRAME_SCENES, LOG_SCHEMA, SCREEN_IDS, TIME_FIELD, createLogBuffer, validate,
} from '../src/log.mjs';
import {
  createDiscipleHand, createSeededRandom, nextDojoAction, nextDuelStage, runHeadlessCycle,
  runHeadlessMissions,
} from '../src/bot.mjs';
import { createMatch, createVirtualTimer, pumpToEnd } from '../src/ui/match.mjs';
import { createSequenceInput } from '../src/ui/sequence-input.mjs';
import { CUE } from '../src/ui/audio.mjs';
import { createFrameBudget } from '../src/ui/frame-budget.mjs';
import {
  ART_ID, DISPATCH_CHALLENGER, EXPORT_SCHEMA, accrueDiscipleRank, addCoins, advanceDiscipleTraining,
  autoEquip, beatenChallengers, beginDuel, beginMission, canDiscipleTrain, canDispatch, canEquip,
  canTransmitNow, challengerOfStage, consumeTooltip, createSession, createTooltipState, currentMission,
  designateDiscipleTraining, discipleTrainProgress, duelAttemptOf, duelFoeRank, enterPhase, equip,
  equippedStyles, exportPayload, isCheatFlagged, isFirstEncounterOf, isRematch, learnStyle, logEvent,
  challengerEntry, challengerRoster, missionLockRankOf, missionShortfallOf, nextChallengerEntry,
  pickTooltip, recordDispatchVerdict, recordDuelVerdict, recordEffectiveSuccess,
  runTransmit, setBotRunning, setCheatEnabled, settleDiscipleTraining, settleDispatch, settleDuel,
  simulateTraining, cheatSetStyleRank, boutLedger, enterTransmit, settleResult,
} from '../src/ui/session.mjs';
import {
  composeHooks, dispatchWiring, duelWiring, logDispatchAbort, logDispatchResult, trainWiring,
} from '../src/ui/wiring.mjs';
import {
  ATTR_VIEW, EXTREME_GRADES, GRADE_VIEW, REASON_VIEW, REVEAL_VIEW, SCREEN, TRAIN_DONE_VIEW, particle,
} from '../src/ui/theme.mjs';
import { TABLET, tabletStates } from '../src/ui/tablet-state.mjs';
import { BOT_UNREACHABLE, BROWSER_ONLY, KILL, killVerdicts, readout } from './kill-readout.mjs';
import {
  REVEAL_TIER, SELECT_REASON,
  accrueDiscipleStyle, accrueRank, applyDiscipleTraining, applyEffectiveSuccess, applyOutcome,
  artById, artStyles, assertAttrCoverage, assertChallengerStyles, assertCounterIntegrity,
  assertGugyeol, assertPrefixFree,
  canEquipRank, canLearn, canTransmit,
  challengerById, createDisciple, createProgress, createRankState, discipleMinRank,
  discipleStyleRank, discipleStyles, discipleTrainMsPerRank, discipleTrainSteps, finisherOf,
  finisherRevealTier, foePowerOf, foeRankOf, foeStyleById, initiativeOf, isEffectiveSuccess,
  isFirstEncounter,
  isMissionUnlocked,
  isOneTapRank, judge, ladderBandAt, learn, missionFoeRank, missionFoeSet, missionLockRank,
  missionShortfall, powerOf, promoteByOutcome, rematchFoeRank, resolveMatch, responseWindowMs,
  reversalDecayFactor, selectDiscipleStyle, setStyleRank, styleById, styleRank, trainAccrualCap,
  trainHitsToNext, trainVisitSpan, transmit,
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

function expectedVerdict({ self, foe, foeOpen, rank, r, foePower, foeRank }) {
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
      // 역파만 성 차로 감쇠하되 관통 하한 아래로는 내려가지 않는다 (REQ-771) — core 와 독립 산출.
      dmgIn: Math.round(foeD * foePower * rule.inPct * (grade === 'reversal'
        ? Math.max(BALANCE.reversalDecay.pierceFloor,
          1 - BALANCE.reversalDecay.perRank * Math.max(0, rank - foeRank))
        : 1)),
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
  throws(() => assertGugyeol([{ id: 'x', seq: ['D', 'R'], gugyeol: ['한 구절'] }]),
    '구결 구절 수가 시퀀스와 다르면 위반', '구결 구절 수 불일치');
  throws(() => assertGugyeol([{ id: 'x', seq: ['D'], gugyeol: ['  '] }]), '빈 구절은 위반', '빈 구결 구절');
  throws(() => assertAttrCoverage([{ id: 'x', attr: 'fast' }]),
    '세 속성을 못 덮는 무공은 위반', '무공이 덮지 못한 속성');
  ok(assertGugyeol(STYLES) && assertAttrCoverage(STYLES), '유운검법은 두 단정을 통과한다');

  eq(STYLES.length, 4, '유운검법 초식 수');
  const columns = ['id', 'set', 'order', 'name', 'hanja', 'attr', 'seq', 'd', 'counters', 'gugyeol'];
  for (const s of STYLES) {
    for (const c of columns) ok(s[c] !== undefined, `${s.id} 컬럼 ${c} 존재`);
    ok(String(s.name).length > 0 && String(s.hanja).length > 0, `${s.id} 이름·한자 비어있지 않음`);
    ok(Array.isArray(s.gugyeol) && s.gugyeol.length === s.seq.length,
      `${s.id} 구결 구절이 방향 한 개씩에 1:1 대응`);
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
    ['A-4', 'alpha', 'gamma', 'delta'], ['B', 'alpha', 'gamma', 'delta'],
  ], '도전자 A 1~4차 + B 구성 (REQ-731)');
  for (const c of CHALLENGERS) {
    ok(BALANCE.hp[c.id] !== undefined, `${c.id} HP 시드 존재`);
    ok(Number.isInteger(BALANCE.challengerRank[c.id]), `${c.id} 성 시드 존재 (REQ-722)`);
    for (const sid of c.styles) ok(foeStyleById(sid), `${c.id} 의 초식 ${sid} 가 테이블에 존재`);
  }
  for (const c of CHALLENGERS) {
    const finishers = c.styles.map(foeStyleById).filter((s) => s.finisher);
    ok(finishers.length <= 1, `${c.id} 절초 ≤ 1 — finisherOf 가 축약하지 않는다`);
  }
  eq(['A-1', 'A-2', 'A-3'].every((id) => finisherOf(challengerById(id)) === null), true, 'A-3 까지는 절초 없음');
  eq(finisherOf(challengerById('A-4')).id, 'delta', 'A-4 의 절초는 δ — 사부가 δ 를 처음 만나는 자리 (REQ-731)');
  eq(finisherOf(challengerById('B')).id, 'delta', 'B 의 절초는 δ');
  eq(styleById('pa-un').counters, 'delta', 'δ 의 파해는 4식');

  // 완파 무대 (REQ-731) — 파해 대상을 예고에 가진 도전자에게서만 그 초식의 12성이 열린다.
  const crushStages = (styleId) => CHALLENGERS
    .filter((c) => c.mode === 'duel' && c.styles.includes(styleById(styleId).counters)).map((c) => c.id);
  deepEq(crushStages('yuun-bo'), ['A-1', 'A-2', 'A-3', 'A-4'], '유운보 완파 무대');
  deepEq(crushStages('jeok-un'), ['A-2', 'A-3'], '적운압정 완파 무대');
  deepEq(crushStages('haeng-un'), ['A-3', 'A-4'], '행운유수 완파 무대');
  deepEq(crushStages('pa-un'), ['A-4'], '파운현월 완파 무대는 A-4 뿐 — 재대련 상한이 도달 가능성 불변식인 근거');
  // 사부 대련 4판이 결정타 4회를 초식 4개에 1:1 배분할 수 있어야 한다 (REQ-731).
  eq(new Set(STYLES.map((s) => crushStages(s.id)[0])).size, STYLES.length,
    '초식마다 서로 다른 첫 완파 무대를 갖는다');
  /**
   * 위 무대 표는 **파해 완파**의 무대다 (#64 가 #65 로 이관한 판정). 빈틈 수의 완파 취급도
   * 12성 자격이므로 「파운현월 완파는 A-4 에서만」은 파해 경로에 한정된 서술이고, 재대련 상한은
   * 유일 경로가 아니라 **주 경로**의 도달 가능성을 지킨다. 이 단정이 그 사실을 결정으로 고정한다 —
   * 없으면 다음 회차가 이것을 결함으로 읽고 `gradeOf`(무변경 계약)를 건드린다.
   */
  const openCrush = judge({
    selfStyle: styleById('pa-un'), foeStyle: foeStyleById('alpha'), selfRank: BALANCE.rankLadder.crushRank - 1,
    foeRank: foeRankOf('A-1'), foeOpen: true,
  });
  eq(openCrush.grade, 'crush', '빈틈 수에는 파해 관계 없이 완파 취급이다');
  deepEq(applyOutcome(setStyleRank(createProgress(), 'pa-un', BALANCE.rankLadder.crushRank - 1), 'pa-un',
    { crush: openCrush.grade === 'crush' }).changes.rank,
  { style: 'pa-un', from: BALANCE.rankLadder.crushRank - 1, to: BALANCE.rankLadder.crushRank, via: 'crush' },
  '빈틈 완파도 12성 자격이다 — 무대 표는 파해 완파의 것이다');

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
    rematch: ['challenger', 'foe_rank', 'attempt_n'],
    slot: ['action', 'styleId', 'challenger'],
    transmit: ['art', 'styles'],
    dispatch: ['stage', 'foe_set', 'disciple_ranks', 'locked_until', 'result'],
    disciple_train: ['style', 'from', 'to', 'elapsed_ms', 'master_activity'],
    select: ['styleId', 'byUser'],
    coins: ['delta', 'reason'],
    cycle: ['phase'],
    cheat: ['action', 'session_flagged'],
    session: ['tester_role', 'device'],
    screen_view: ['screen', 'ms', 'from'],
    font_ready: ['ms', 'bytes', 'subset_hit'],
    frame_budget: ['screen', 'scene', 'p95_ms', 'dropped'],
    undo_used: ['screen', 'count', 'exchange_no'],
    audio_state: ['resumed', 'muted', 'ms_to_resume'],
  };
  eq(Object.keys(LOG_SCHEMA).length, 26, '이벤트 26종');
  deepEq(Object.keys(LOG_SCHEMA), Object.keys(EXPECTED), '이벤트 이름·순서');
  for (const [event, fields] of Object.entries(EXPECTED)) {
    deepEq(LOG_SCHEMA[event].fields, fields, `${event} 필드`);
  }
  deepEq(LOG_SCHEMA.key.enums.device, ['keyboard', 'button'], 'key.device 열거');
  deepEq(LOG_SCHEMA.session.enums.tester_role, ['self', 'friend', 'bot'], 'session.tester_role 열거');
  deepEq(LOG_SCHEMA.dispatch.enums.result, ['win', 'loss', 'abort'], 'dispatch.result 열거');
  // 열거만 넓어졌고 필드 뜻은 그대로라 판별 토큰은 2 에 머문다 — 올리면 구 판본 로그가 통째로 위반이 된다.
  eq(LOG_SCHEMA.dispatch.sv, 2, 'abort 확장은 좌표 모델을 바꾸지 않는다');
  // 신설 5종은 화면 좌표축에 키잉된다 (spec § 통합 로그 스키마) — 축을 잃으면 「어느 화면이
  // 아직 구 크롬을 쓰는가」가 판독 불능이 된다.
  deepEq(SCREEN_IDS, ['s1', 's2', 's3', 's4', 's5', 's6', 's7'], '화면 좌표축 7칸');
  deepEq(FRAME_SCENES, ['verdict', 'parallax', 'idle'], '프레임 예산 장면 3종');
  for (const keyed of ['screen_view', 'frame_budget', 'undo_used']) {
    deepEq(LOG_SCHEMA[keyed].enums.screen, SCREEN_IDS, `${keyed}.screen 은 화면 축에 묶인다`);
  }
  deepEq(LOG_SCHEMA.frame_budget.enums.scene, FRAME_SCENES, 'frame_budget.scene 열거');
  // 라우트 8개가 7좌표를 나눠 쓴다 — 파견은 예고와 관전이 `s4` 한 칸을 공유한다.
  deepEq(Object.keys(SCREEN), ['duel', 'dojo', 'train', 'preview', 'dispatch', 'transmit', 'result', 'select'],
    '라우트 → 화면 좌표 표의 키 집합');
  deepEq([...new Set(Object.values(SCREEN).map((v) => v.id))].sort(), SCREEN_IDS, '7좌표가 전부 도달된다');
  // 뜻이 바뀐 이벤트만 판별 토큰을 단다 — 신설 이벤트는 구 스키마가 없어 `sv` 가 필요 없다 (REQ-791).
  deepEq(Object.entries(LOG_SCHEMA).filter(([, v]) => v.sv).map(([k]) => k),
    ['rank', 'unlock', 'slot', 'transmit', 'dispatch'],
    'sv: 2 는 좌표 모델이 바뀐 다섯 이벤트에만 붙는다');
  // 부착 층이 이벤트별 선언이라는 것이 이 단정의 내용이다 — 층이 일괄 부착하면 신설 5종이 함께 물든다.
  for (const fresh of ['rank_wall', 'rematch', 'finish', 'disciple_train', 'cheat']) {
    eq(LOG_SCHEMA[fresh].sv, undefined, `${fresh} 은 신설이라 구 스키마가 없다 — sv 는 거짓 신호가 된다`);
  }
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
  throws(() => buf.log('screen_view', { screen: 's8', ms: 1, from: null }),
    '축 밖 화면은 throw', '허용 밖 값');
  throws(() => buf.log('frame_budget', { screen: 's1', scene: 'blur', p95_ms: 1, dropped: 0 }),
    '정의 밖 장면은 throw', '허용 밖 값');
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
            for (const foeRank of CHALLENGERS.map((c) => foeRankOf(c.id))) {
              const foePower = powerOf(foeRank);
              const expected = expectedVerdict({ self, foe, foeOpen, rank, r, foePower, foeRank });
              const actual = judge({ selfStyle: self, foeStyle: foe, selfRank: rank, foeRank, r, foeOpen });
              deepEq(actual, expected,
                `${self ? self.id : '미완주'} vs ${foe.id} (빈틈=${foeOpen} r=${r} 성=${rank} 적성=${foeRank})`);
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
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1 }).grade,
    'crush', '파해 우선 (삼각으로는 우세)');
  eq(wins('fast', 'hard'), true, '삼각만 보면 쾌가 강을 이긴다');

  // 빈틈은 1수 지속·중첩 없음.
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1 }).opening,
    'foe', '완파 → 상대 빈틈');
  eq(judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('delta'), selfRank: 1, foeRank: 2 }).opening,
    'self', '역파 → 나 빈틈');
  const chained = judge({ selfStyle: styleById('haeng-un'), foeStyle: foeStyleById('gamma'), selfRank: 1, foeRank: 1, foeOpen: true });
  eq(chained.grade, 'crush', '상대 빈틈 중 아무 초식 완주 = 완파 취급');
  eq(chained.opening, null, '빈틈 중의 완파 취급은 빈틈을 다시 열지 않는다');
  eq(chained.dmgIn, 0, '상대 빈틈에는 받는 피해가 없다');
  eq(judge({ selfStyle: null, foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1, foeOpen: true }).dmgIn, 0,
    '상대 빈틈 중 미완주도 무피해');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: null, selfRank: 1, foeRank: 1 }),
    '빈틈이 아닌데 상대 초식이 없으면 throw', '상대 초식이 없다');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1, r: 1.5 }),
    '선기 잔여 비율 범위 밖은 throw', '0~1 밖');
  const dom = (over) => () => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1, ...over });
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha') }),
    '성 결손은 NaN 이 아니라 throw', '성이 1 이상의 정수가 아니다');
  throws(() => judge({ selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('alpha'), selfRank: 1 }),
    '상대 성 결손도 throw — 역파 감쇠가 NaN 으로 새면 그 수에서야 죽는다', '상대 성이 1 이상의 정수가 아니다');
  throws(dom({ foeRank: 0 }), '0 상대 성은 throw', '상대 성이 1 이상의 정수가 아니다');
  throws(dom({ foeRank: 2.5 }), '비정수 상대 성은 throw', '상대 성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: -30 }), '음수 성은 throw — 피해가 회복으로 뒤집힌다', '성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: 0 }), '0성은 throw', '성이 1 이상의 정수가 아니다');
  throws(dom({ selfRank: 1.5 }), '비정수 성은 throw', '성이 1 이상의 정수가 아니다');
  throws(dom({ foePower: NaN }), '상대 내공 NaN 은 throw', '상대 내공이 양수가 아니다');
  throws(dom({ foePower: -1 }), '음수 상대 내공은 throw — 받는 피해가 회복으로 뒤집힌다', '상대 내공이 양수가 아니다');
  throws(dom({ foePower: 0 }), '0 상대 내공은 throw', '상대 내공이 양수가 아니다');

  // 파해와 역파가 동시에 성립하면 완파가 이긴다 — 시드 데이터에는 충돌 쌍이 없어 합성한다.
  const mutualSelf = { id: 'm-self', attr: 'fast', d: 10, counters: 'm-foe' };
  const mutualFoe = { id: 'm-foe', attr: 'fast', d: 10, finisher: true, counters: 'm-self' };
  eq(judge({ selfStyle: mutualSelf, foeStyle: mutualFoe, selfRank: 1, foeRank: 1 }).grade, 'crush', '파해가 역파보다 우선');
});

// ------------------------------------------- 5. 손계산 골든값 (REQ-203 산술 고정)

suite('피해 정수 골든값 (REQ-203)', () => {
  const S = Object.fromEntries(STYLES.map((s) => [s.id, s]));
  const F = Object.fromEntries(FOE_STYLES.map((s) => [s.id, s]));
  const golden = [
    ['완파 1성 r0', { selfStyle: S['yuun-bo'], foeStyle: F.alpha, selfRank: 1, foeRank: 1, foePower: 1, r: 0 },
      { grade: 'crush', dmgOut: 11, dmgIn: 0, opening: 'foe' }],
    ['완파 12성 r1', { selfStyle: S['yuun-bo'], foeStyle: F.alpha, selfRank: 12, foeRank: 1, foePower: 1, r: 1 },
      { grade: 'crush', dmgOut: 21, dmgIn: 0, opening: 'foe' }],
    ['우세 1성 r0.4', { selfStyle: S['jeok-un'], foeStyle: F.delta, selfRank: 1, foeRank: 2, foePower: 1.1, r: 0.4 },
      { grade: 'advantage', dmgOut: 7, dmgIn: 4, opening: null }],
    ['상쇄 우위', { selfStyle: S['haeng-un'], foeStyle: F.beta, selfRank: 12, foeRank: 1, foePower: 1, r: 0 },
      { grade: 'clash', dmgOut: 4, dmgIn: 0, opening: null }],
    ['상쇄 열위', { selfStyle: S['haeng-un'], foeStyle: F.delta, selfRank: 1, foeRank: 2, foePower: 1.1, r: 0 },
      { grade: 'clash', dmgOut: 0, dmgIn: 1, opening: null }],
    ['열세', { selfStyle: S['yuun-bo'], foeStyle: F.beta, selfRank: 1, foeRank: 1, foePower: 1, r: 0 },
      { grade: 'disadvantage', dmgOut: 2, dmgIn: 8, opening: null }],
    // 성이 상대 이하면 감쇠가 걸리지 않는다 — 이 골든값이 #64 판본과 같아야 감쇠가 무관한 수를 건드리지 않은 것이다.
    ['역파 무감쇠', { selfStyle: S['yuun-bo'], foeStyle: F.delta, selfRank: 1, foeRank: 2, foePower: 1.1, r: 0 },
      { grade: 'reversal', dmgOut: 0, dmgIn: 22, opening: 'self' }],
    ['역파 감쇠 (A-4 · 성 차 7)', { selfStyle: S['yuun-bo'], foeStyle: F.delta, selfRank: 11, foeRank: 4, r: 0 },
      { grade: 'reversal', dmgOut: 0, dmgIn: 11, opening: 'self' }],
    ['역파 관통 하한 (A-4 · 성 차 8 = 정의역 상계)', { selfStyle: S['yuun-bo'], foeStyle: F.delta, selfRank: 12, foeRank: 4, r: 0 },
      { grade: 'reversal', dmgOut: 0, dmgIn: 10, opening: 'self' }],
    ['역파 관통 하한 고정 (성 차 11)', { selfStyle: S['yuun-bo'], foeStyle: F.delta, selfRank: 12, foeRank: 1, r: 0 },
      { grade: 'reversal', dmgOut: 0, dmgIn: 8, opening: 'self' }],
    ['피격', { selfStyle: null, foeStyle: F.alpha, selfRank: 1, foeRank: 1, foePower: 1, r: 0 },
      { grade: 'struck', dmgOut: 0, dmgIn: 10, opening: null }],
    ['연환', { selfStyle: S['haeng-un'], foeStyle: F.gamma, selfRank: 1, foeRank: 1, foePower: 1, r: 0, foeOpen: true },
      { grade: 'crush', dmgOut: 15, dmgIn: 0, opening: null }],
  ];
  for (const [name, input, expected] of golden) deepEq(judge(input), expected, `골든 ${name}`);
});

// ---------------------------------- 6. 성 계단 사다리 (REQ-702·704) — 적립 3단 + 사건 계단

const ART = ART_SETS[0].id;
const DUEL_A_STAGES = CHALLENGERS.filter((c) => c.mode === 'duel').length;
const LADDER = BALANCE.rankLadder;
const [LOW, HIGH] = LADDER.bands;

/** 한 초식만 목표 성으로 세운 진행도 — 계단마다의 국면을 직접 만든다. */
const masterAt = (rank, styleId = 'yuun-bo') => setStyleRank(createProgress(), styleId, rank);

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

  // 화면이 3 을 상수로 갖지 않는다 — 칸 수가 계단 비용에서 파생돼야 비용 튜닝이 계단을 따라온다 (REQ-845).
  deepEq(trainVisitSpan({ rank: 1, pts: 0 }), { done: 0, total: 3 }, '갓 오른 성의 수련 계단은 3칸 전부 빈다');
  deepEq(trainVisitSpan({ rank: 1, pts: LADDER.gain.train }), { done: 1, total: 3 }, '한 번 채우면 한 칸이 찬다');
  eq(trainVisitSpan({ rank: LOW.maxRank, pts: 0 }), null, '수련 무효 구간에는 계단 자체가 없다');

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

  /**
   * 적립과 계단이 같은 수의 *같은* 성을 보는지 — 이 자리가 「한 수 최대 1계단」의 실제 파손점이다.
   * 계단을 적립보다 뒤에 두면 적립이 만든 성을 계단이 다시 보고 두 계단이 오른다.
   */
  const partial = (rank, pts, grade) => {
    const s = createSession();
    const base = setStyleRank(createProgress(), 'yuun-bo', rank);
    s.progress = { ...base, styles: { ...base.styles, 'yuun-bo': { ...base.styles['yuun-bo'], pts } } };
    recordDuelVerdict(s, {
      verdict: { grade, dmgOut: 9, dmgIn: 0, opening: null },
      fire: { style: styleById('yuun-bo') },
      challenger: challengerById('A-1'),
      outcome: { over: true, win: true, by: 'hp' },
    });
    return { rank: styleRank(s.progress, 'yuun-bo'), steps: s.log.entries.filter((e) => e.event === 'rank') };
  };
  // 수 상한 판정승은 결정타가 아니다 — 그 수가 승리를 확정한 것이 아니라 시계가 끝난 것이다.
  const byExchanges = createSession();
  byExchanges.progress = setStyleRank(createProgress(), 'yuun-bo', LADDER.finishRank - 1);
  recordDuelVerdict(byExchanges, {
    verdict: { grade: 'advantage', dmgOut: 9, dmgIn: 0, opening: null },
    fire: { style: styleById('yuun-bo') },
    challenger: challengerById('A-1'),
    outcome: { over: true, win: true, by: 'exchanges' },
  });
  eq(styleRank(byExchanges.progress, 'yuun-bo'), LADDER.finishRank - 1, '수 상한 판정승은 11성을 열지 않는다');
  eq(byExchanges.log.entries.some((e) => e.event === 'finish'), false, 'finish 로그도 남지 않는다');

  const carried = partial(HIGH.maxRank - 1, HIGH.cost - LADDER.gain.duel, 'advantage');
  eq(carried.rank, HIGH.maxRank, `${HIGH.maxRank - 1}성에 적립이 반쯤 찬 채 낸 결정타도 ${HIGH.maxRank}성에서 멈춘다`);
  eq(carried.steps.length, 1, '그 수의 성 전이는 1건뿐');
  eq(partial(LADDER.finishRank, 0, 'crush').rank, LADDER.crushRank, '11성 완파 결정타는 12성까지');
  eq(partial(LADDER.finishRank - 1, 0, 'crush').steps.length, 1, '10성 완파 결정타도 전이 1건');
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

// ---------------------------------- 6-a. 케이스 14 — 개발자 치트 (REQ-781~783)

suite('케이스 14 — 개발자 치트 (REQ-781~783)', () => {
  const session = createSession();
  eq(session.cheat.enabled, false, '기본은 숨김 — 명시 토글만이 연다 (REQ-781)');
  eq(cheatSetStyleRank(session, 'yuun-bo', 5), false, '꺼져 있으면 주입 자체가 없던 일이다');
  eq(styleRank(session.progress, 'yuun-bo'), 1, '상태도 그대로');
  eq(isCheatFlagged(session), false, '플래그도 켜지지 않는다');

  setCheatEnabled(session, true);
  eq(cheatSetStyleRank(session, 'yuun-bo', BALANCE.rankMax), true, '켠 뒤 주입 성공');
  eq(styleRank(session.progress, 'yuun-bo'), BALANCE.rankMax, '성이 계단을 건너뛰고 주입된다');
  const cheat = session.log.entries.find((e) => e.event === 'cheat');
  deepEq({ action: cheat.action, session_flagged: cheat.session_flagged },
    { action: `rank:yuun-bo=${BALANCE.rankMax}`, session_flagged: true }, 'cheat 로그 (REQ-782)');
  eq(isCheatFlagged(session), true, '세션 플래그는 지워지지 않는다');
  eq(exportPayload(session).cheat_flagged, true, '내보내기가 플래그를 실어 판독기가 표본을 뺄 수 있다');

  // 범위 밖 주입은 화면 핸들러 밖으로 새는 throw 가 아니라 거절이다.
  for (const bad of [0, -1, BALANCE.rankMax + 1, 1.5, Number.NaN]) {
    eq(cheatSetStyleRank(session, 'jeok-un', bad), false, `${bad} 주입은 거절된다`);
  }
  eq(styleRank(session.progress, 'jeok-un'), 1, '거절된 주입은 상태를 건드리지 않는다');

  // 봇 구동 중 강제 off (REQ-783) — 페이스 표본에 주입이 섞이면 그 회차가 무엇을 잰 것인지 알 수 없다.
  setBotRunning(session, true);
  eq(session.cheat.enabled, false, '봇이 돌기 시작하면 그 자리에서 닫힌다');
  eq(setCheatEnabled(session, true), false, '봇이 도는 동안에는 열리지 않는다');
  eq(cheatSetStyleRank(session, 'jeok-un', 5), false, '따라서 주입도 불가');
  setBotRunning(session, false);
  eq(setCheatEnabled(session, true), true, '봇이 멈추면 다시 열 수 있다');

  // 봉투를 벗겨 낸 배열도 제외된다 — 플래그만 보면 `entries` 만 남기는 것이 세탁 경로가 된다 (REQ-782).
  const flagged = exportPayload(session);
  ok(flagged.entries.some((e) => e.event === 'cheat'), '봉투를 벗겨도 cheat 이벤트는 로그에 남는다');

  // 헤드리스 사이클도 같은 계약을 진다 — 봇 축의 유일한 진입점이 이 플래그를 세운다.
  const botRun = runHeadlessCycle({ random: createSeededRandom(20260902) });
  eq(isCheatFlagged(botRun.session), false, '봇 사이클은 치트 없이 완주한다');
  eq(botRun.session.botRunning, false, '사이클이 끝나면 구동 표식이 내려간다');
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
  const atWall = transmit(masteredProgress, createDisciple(), ART);
  atWall.arts[ART].styles['yuun-bo'] = { rank: LOW.maxRank, pts: 0 };
  eq(accrueDiscipleStyle(atWall, ART, 'yuun-bo', { mode: 'train' }).wall, true,
    `제자도 ${LOW.maxRank}성에서 같은 수련 벽을 만난다`);
  eq(accrueDiscipleStyle(session.disciple, ART, 'pa-un', { mode: 'train' }).wall, false,
    '상한은 벽이 아니다 — 오를 계단 자체가 없다');
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
  const low = judge({ selfStyle: styleById('yuun-bo'), foeStyle: foe, selfRank: 4, foeRank: foeRankOf('A-2') });
  const high = judge({ selfStyle: styleById('jeok-un'), foeStyle: foe, selfRank: 7, foeRank: foeRankOf('A-2') });
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
    selfRank: 1, foeRank: foeRankOf('A-3'),
  });
  eq(clash.grade, 'clash', '동속성은 상쇄');
  eq(clash.dmgIn, Math.round(Math.max(0, foePowerOf('A-3') - powerOf(1)) * foeStyleById('beta').d * BALANCE.clashK),
    '상쇄식 양변이 성으로 성립한다');
  // 등급 승격은 보류 — 성 차가 아무리 벌어져도 판정 등급을 뒤집지 않는다 (REQ-723).
  eq(judge({ selfStyle: styleById('haeng-un'), foeStyle: foeStyleById('beta'), selfRank: BALANCE.rankMax, foeRank: 1 }).grade,
    'clash', '12성이어도 상쇄는 상쇄');
});

// -------- 7-b. 재대련 · 역파 감쇠 (REQ-731~736·771·772) — A-4 가 세운 무대의 규칙

suite('재대련 성 누적 (REQ-734)', () => {
  const { rankGain, rankCap } = BALANCE.rematch;
  const base = foeRankOf('A-4');
  eq(base, foeRankOf('A-3') + 1, 'A-4 도전자 성은 A-3 보다 한 단계만 위 (REQ-733)');

  eq(rematchFoeRank(base, 0), base, '초회 대면은 +0');
  for (let n = 1; n <= rankCap; n += 1) {
    eq(rematchFoeRank(base, n), base + rankGain * n, `${n}회 이긴 뒤 재대련은 +${rankGain * n}`);
  }
  // 상한은 편의 파라미터가 아니라 도달 가능성 불변식이다 — 상한이 없으면 A-4 반복 실패가
  // 파운현월 12성(유일 무대 A-4)을 영구 봉쇄한다.
  eq(rematchFoeRank(base, rankCap + 1), base + rankCap, '상한을 넘긴 회차도 상한에 머문다');
  eq(rematchFoeRank(base, 99), base + rankCap, '몇 번을 더 쳐도 상한을 넘지 않는다');
  eq(rematchFoeRank(BALANCE.rankMax, rankCap), BALANCE.rankMax, '강화는 성 상한을 넘지 않는다');
  throws(() => rematchFoeRank(base, -1), '음수 승수는 throw', '재대련 승수가 0 이상의 정수가 아니다');
  throws(() => rematchFoeRank(base, 1.5), '비정수 승수는 throw', '재대련 승수가 0 이상의 정수가 아니다');

  // 세션 축 — 회차·강화·무보상·로그가 한 흐름에서 맞물린다.
  const session = createSession({ now: () => 0 });
  const stage = challengerOfStage(1);
  const winOnce = () => settleDuel(session, { win: true, stage: stage.stage });

  eq(isRematch(session, stage.id), false, '이기기 전에는 재대련이 아니다');
  eq(duelAttemptOf(session, stage.id), 1, '초회 대면은 1번째');
  // 첫 대면 판별은 회차 0 에서 도출된다 (REQ-894) — 별도 `seen` 플래그가 세션에 없다는 것이 그 결정이다.
  eq(isFirstEncounter(0), true, '재대련 회차 0 이 첫 대면이다');
  eq(isFirstEncounter(1), false, '한 번이라도 이겼으면 첫 대면이 아니다');
  throws(() => isFirstEncounter(-1), '음수 승수는 throw', '재대련 승수가 0 이상의 정수가 아니다');
  eq(isFirstEncounterOf(session, stage.id), true, '이기기 전에는 첫 대면이다');
  eq(Object.keys(session).some((k) => /seen/i.test(k)), false, '첫 대면용 새 플래그를 세션에 두지 않았다');
  deepEq(beatenChallengers(session), [], '이긴 도전자가 없으면 재대련 목록도 없다');
  deepEq(beginDuel(session, stage.id), { foeRank: foeRankOf(stage.id), attemptN: 1 }, '초회 대면은 무강화');
  eq(session.log.entries.filter((e) => e.event === 'rematch').length, 0, '초회 대면은 rematch 를 남기지 않는다');

  const first = winOnce();
  eq(isFirstEncounterOf(session, stage.id), false, '한 번 이긴 뒤로는 첫 대면이 아니다 — 절초 공개가 여기서 열린다');
  eq(first.rematch, false, '첫 승리는 재대련이 아니다');
  eq(first.reward, BALANCE.reward.duelWin, '첫 승리에는 재화가 나온다');
  eq(session.coins, BALANCE.reward.duelWin, '재화가 실제로 적립된다');
  deepEq(beatenChallengers(session).map((c) => c.id), [stage.id], '이긴 도전자가 재대련 목록에 오른다');

  for (let n = 1; n <= rankCap + 1; n += 1) {
    const expectedRank = foeRankOf(stage.id) + Math.min(rankCap, rankGain * n);
    deepEq(beginDuel(session, stage.id), { foeRank: expectedRank, attemptN: n + 1 },
      `${n + 1}번째 대면 — 도전자 성 ${expectedRank}`);
    const settled = settleDuel(session, { win: true, stage: stage.stage });
    eq(settled.rematch, true, `${n + 1}번째 대면 승리는 재대련`);
    eq(settled.reward, 0, '재대련 승리에는 재화가 없다 (파밍 루프 차단)');
  }
  eq(session.coins, BALANCE.reward.duelWin, `재대련 ${rankCap + 1}회를 이겨도 재화는 첫 승리분 그대로다`);
  eq(duelFoeRank(session, stage.id), foeRankOf(stage.id) + rankCap, '4회째부터는 상한 강화가 유지된다');

  // 중단·패배 후 재진입은 승수를 올리지 않으므로 같은 서수가 다시 찍힌다 — 항목 수가 진입 수이고
  // 서수의 최댓값이 중단 지점이다. 이 단정이 그 성질을 결정으로 고정한다 (L5 지적 대응).
  const reentryAt = session.log.entries.length;
  beginDuel(session, stage.id);
  beginDuel(session, stage.id);
  const reentries = session.log.entries.slice(reentryAt).filter((e) => e.event === 'rematch');
  deepEq(reentries.map((e) => e.attempt_n), [duelAttemptOf(session, stage.id), duelAttemptOf(session, stage.id)],
    '이기지 않은 재진입은 같은 서수로 다시 찍힌다');

  const logged = session.log.entries.filter((e) => e.event === 'rematch');
  deepEq(logged.map((e) => e.attempt_n), [2, 3, 4, 5, 6, 6], 'rematch 는 재대련 진입마다 남는다');
  deepEq(logged.map((e) => e.foe_rank),
    [1, 2, 3, 3, 3, 3].map((b) => foeRankOf(stage.id) + b), 'rematch.foe_rank 가 그 대면의 강화를 싣는다');
  deepEq([...new Set(logged.map((e) => e.challenger))], [stage.id], 'rematch.challenger 는 그 도전자다');

  // 패배는 승수를 올리지 않는다 — 「이미 이긴 도전자를 다시 치는 것」이 재대련의 정의다.
  const loser = createSession({ now: () => 0 });
  settleDuel(loser, { win: false, stage: stage.stage });
  eq(isRematch(loser, stage.id), false, '패배 뒤 재도전은 재대련이 아니다');
  eq(isFirstEncounterOf(loser, stage.id), true, '패배는 대면 이력을 남기지 않는다 — 절초는 여전히 소문이다');
  eq(duelFoeRank(loser, stage.id), foeRankOf(stage.id), '패배는 상대를 여물게 하지 않는다');
});

// ------- 7-c. 절초 공개 3층 (REQ-882~884·894) — 대면 이력이 층을 가르는 순수 술어

suite('절초 공개 3층 전이 (REQ-882·883·884·894)', () => {
  eq([...new Set(Object.values(REVEAL_TIER))].length, 3, '공개 층은 셋이고 값이 겹치지 않는다');
  for (const tier of Object.values(REVEAL_TIER)) {
    const view = REVEAL_VIEW[tier];
    ok(view, `층 ${tier} 에 화면 문구가 있다 — 미매핑이 조용히 통과하지 않는다`);
    ok(typeof view.cls === 'string', `층 ${tier} 의 표시 클래스가 문자열이다`);
  }

  const plain = challengerById('A-1');
  const ult = challengerById('A-4');
  eq(finisherOf(plain), null, 'A-1 은 절초가 없다');
  ok(finisherOf(ult), 'A-4 는 절초를 쓰는 유일한 사부 대련 상대다 (REQ-733)');

  // 절초가 없으면 대면 이력과 무관하게 공개할 것이 없다 — 층이 이력에만 매이지 않는다.
  eq(finisherRevealTier(plain, true), REVEAL_TIER.NONE, '절초 없는 상대는 첫 대면도 NONE');
  eq(finisherRevealTier(plain, false), REVEAL_TIER.NONE, '절초 없는 상대는 재대련도 NONE');
  eq(finisherRevealTier(ult, true), REVEAL_TIER.RUMOR, '첫 대면은 존재만 소문으로 (REQ-883)');
  eq(finisherRevealTier(ult, false), REVEAL_TIER.COUNTER, '재대련부터 이름과 파해 대상 (REQ-884)');
  throws(() => finisherRevealTier(ult, 0), '불리언이 아닌 대면 여부는 throw', '첫 대면 여부가 불리언이 아니다');

  // 층은 이 세 문구를 실제로 낸다 — 소문 층이 이름을 쥐면 층 구분이 문구 하나로 무너진다.
  const finisher = finisherOf(ult);
  const answer = styleById(finisher.counters);
  const rumor = REVEAL_VIEW[REVEAL_TIER.RUMOR];
  ok(!rumor.title({}).includes(finisher.name) && !rumor.note({}).includes(answer.name),
    '소문 층 문구에 절초 이름도 파해 대상도 없다 (REQ-883)');
  const counter = REVEAL_VIEW[REVEAL_TIER.COUNTER];
  ok(counter.title({ finisher }).includes(finisher.name), '공개 층 문구가 절초 이름을 댄다');
  ok(counter.note({ answer }).includes(answer.name), '공개 층 문구가 파해 대상을 댄다 (REQ-884)');

  // 세션 축 — 그 도전자를 이긴 사건 하나가 층을 옮긴다.
  const session = createSession({ now: () => 0 });
  session.stage = DUEL_A_STAGES;
  eq(challengerEntry(session, ult).tier, REVEAL_TIER.RUMOR, '이기기 전에는 소문 층이다');
  settleDuel(session, { win: false, stage: ult.stage });
  eq(challengerEntry(session, ult).tier, REVEAL_TIER.RUMOR, '패배는 층을 올리지 않는다 (REQ-894)');
  settleDuel(session, { win: true, stage: ult.stage });
  eq(challengerEntry(session, ult).tier, REVEAL_TIER.COUNTER, '한 번 이긴 뒤로 파해가 공개된다');

  // 목록 소유가 홈과 S7 사이를 오가도 파생은 한 자리다 — 두 화면이 다른 층을 말하면 예고가 함정이 된다.
  const roster = challengerRoster(session);
  eq(roster.length, session.stage, '목록은 해금된 차수까지다 (REQ-834)');
  deepEq(roster.map((e) => e.challenger.stage), roster.map((_, i) => i + 1), '목록 순서가 곧 차수다 (REQ-887)');
  const home = nextChallengerEntry(session);
  eq(home.challenger.id, roster[roster.length - 1].challenger.id, '홈 요약은 가장 최근에 열린 차수다');
  eq(home.tier, roster[roster.length - 1].tier, '홈 요약과 목록이 같은 공개 층을 쓴다 (REQ-835)');
  eq(home.firstEncounter, isFirstEncounterOf(session, home.challenger.id), '요약의 대면 이력도 같은 술어에서 나온다');

  const fresh = createSession({ now: () => 0 });
  eq(challengerRoster(fresh).length, 1, '첫 진입에는 해금된 도전자가 하나뿐이다');

  // 브리핑은 초식과 파해 대상을 **이름으로** 읽으므로 결손이 화면에서 익명 TypeError 로만 드러난다.
  eq(assertChallengerStyles(CHALLENGERS), true, '출하 도전자 표는 초식·파해 대상이 전부 실재한다');
  throws(() => assertChallengerStyles([{ id: 'X', styles: ['nope'] }]),
    '미존재 초식을 세운 도전자는 throw', '도전자 미존재 초식');
  // 「절초인데 파해 대상이 없다」는 `assertCounterIntegrity` 의 `if (!s.counters) continue` 를
  // 그대로 빠져나가므로, 그 그물의 구멍을 이 단정이 메운다는 사실을 여기서 고정한다.
  eq(assertCounterIntegrity([{ id: 'orphan', counters: null, finisher: true }]), true,
    '파해 대상 없는 절초는 counter 무결성 검사를 통과한다 — 그래서 도전자 단정이 따로 필요하다');
  for (const c of CHALLENGERS) {
    const f = finisherOf(c);
    if (f) ok(styleById(f.counters), `${c.id} 의 절초 ${f.id} 가 파해 대상을 갖는다 — 브리핑이 그 이름을 읽는다`);
  }
});

// 조사는 데이터 이름에 붙으므로 문구에 박을 수 없다 (REQ-830).
suite('받침 조사 (REQ-830)', () => {
  eq(particle('파운현월', '이', '가'), '이', '받침이 있으면 이/은/을');
  eq(particle('유운보', '이', '가'), '가', '받침이 없으면 가/는/를');
  eq(particle('행운유수', '이', '가'), '가', '중성으로 끝나는 이름도 받침 없음');
  eq(particle('적운압정', '이', '가'), '이', 'ㅇ 받침도 받침이다');
  for (const style of STYLES) {
    ok(['이', '가'].includes(particle(style.name, '이', '가')), `${style.name} 에 조사가 붙는다`);
  }
});

suite('역파 성 차 감쇠 · 관통 하한 (REQ-771)', () => {
  const { perRank, pierceFloor } = BALANCE.reversalDecay;
  const factor = (self, foe) => reversalDecayFactor(self, foe);

  eq(factor(1, 4), 1, '상대보다 여물지 않으면 감쇠가 없다');
  eq(factor(4, 4), 1, '성이 같아도 감쇠가 없다');
  for (let diff = 1; diff * perRank < 1 - pierceFloor; diff += 1) {
    eq(factor(1 + diff, 1), 1 - perRank * diff, `성 차 ${diff} — 계수 ${1 - perRank * diff}`);
  }
  const bindAt = Math.round((1 - pierceFloor) / perRank);
  eq(factor(1 + bindAt, 1), pierceFloor, `성 차 ${bindAt} 에서 관통 하한에 정확히 닿는다`);
  eq(factor(1 + bindAt + 1, 1), pierceFloor, '그 아래로는 내려가지 않는다');
  eq(factor(BALANCE.rankMax, 1), pierceFloor, '최대 성 차에서도 하한이다');
  ok(factor(BALANCE.rankMax, 1) > 0, '하한이 0 이 아니다 — 절초는 여전히 관통한다');

  /**
   * 하한이 정의역 안에서 실제로 물리는가 (REQ-771). 역파는 절초 보유 도전자에게서만 나므로
   * 그 무대의 최대 성 차가 감쇠의 정의역 상계이고, 하한이 그보다 뒤에서 물리면 하한은 死表다.
   */
  const arenas = CHALLENGERS.filter((c) => finisherOf(c)).map((c) => ({
    id: c.id,
    spread: (c.mode === 'duel' ? BALANCE.rankMax : BALANCE.discipleRankMax) - foeRankOf(c.id),
  }));
  deepEq(arenas.map((a) => a.id), ['A-4', 'B'], '역파 무대는 A-4(사부) 와 B(제자) 다 (REQ-772)');
  for (const arena of arenas) {
    ok(bindAt <= arena.spread,
      `${arena.id} — 하한이 물리는 성 차 ${bindAt} 가 무대 상계 ${arena.spread} 안에 있다`);
    eq(factor(foeRankOf(arena.id) + arena.spread, foeRankOf(arena.id)), pierceFloor,
      `${arena.id} — 가장 여문 초식이 맞으면 정확히 관통 하한이다`);
  }

  // 감쇠는 피해량 축이지 등급 축이 아니다 — 성 차가 아무리 벌어져도 판정과 빈틈은 그대로다.
  const at = (selfRank) => judge({
    selfStyle: styleById('yuun-bo'), foeStyle: foeStyleById('delta'), selfRank, foeRank: foeRankOf('A-4'),
  });
  const grades = [1, 6, BALANCE.rankMax].map((r) => at(r));
  deepEq([...new Set(grades.map((v) => v.grade))], ['reversal'], '성 차와 무관하게 등급은 역파');
  deepEq([...new Set(grades.map((v) => v.opening))], ['self'], '성 차와 무관하게 나 빈틈');
  ok(at(1).dmgIn > at(6).dmgIn && at(6).dmgIn > at(BALANCE.rankMax).dmgIn, '성이 높을수록 덜 아프다');
  eq(at(BALANCE.rankMax).dmgIn,
    Math.round(foeStyleById('delta').d * powerOf(foeRankOf('A-4')) * pierceFloor),
    '하한에서의 피격은 정수로 고정된다');
  // 감쇠가 피격(6단)보다 아프지 않게 만드는 것은 규칙 위반이 아니다 — 역파의 벌칙은 빈틈이 진다.
  eq(judge({ selfStyle: null, foeStyle: foeStyleById('delta'), selfRank: 1, foeRank: foeRankOf('A-4') }).opening,
    null, '피격은 빈틈을 열지 않는다');
});

suite('역파는 회피 대상이다 (REQ-772)', () => {
  const delta = foeStyleById('delta');
  const foeRank = foeRankOf('A-4');
  // δ 예고 수에 파해 대상(유운보)을 내지 않으면 어떤 초식으로도 역파가 나오지 않는다.
  for (const style of STYLES) {
    const grade = judge({ selfStyle: style, foeStyle: delta, selfRank: BALANCE.rankMax, foeRank }).grade;
    if (style.id === delta.counters) eq(grade, 'reversal', `${style.name} 은 δ 의 파해 대상이라 역파`);
    else ok(grade !== 'reversal', `${style.name} 은 δ 예고 수에도 역파가 아니다 (${BALANCE.grades[grade].label})`);
  }
  // 감쇠는 회피 설계의 대체가 아니다 — 피하면 애초에 0 이다.
  eq(judge({ selfStyle: styleById('pa-un'), foeStyle: delta, selfRank: 1, foeRank }).grade, 'crush',
    '파해를 내면 절초가 완파당한다 — 예고 공개(REQ-732)가 가르치는 답');
  // δ 가 예고되지 않은 수에는 파해 대상을 내도 역파가 아니다 — 절초가 실제로 나온 수만 성립한다.
  for (const foe of FOE_STYLES.filter((f) => !f.finisher)) {
    ok(judge({ selfStyle: styleById(delta.counters), foeStyle: foe, selfRank: 1, foeRank }).grade !== 'reversal',
      `${foe.name} 예고 수에는 역파가 없다`);
  }
  eq(judge({ selfStyle: styleById(delta.counters), foeStyle: delta, selfRank: 1, foeRank, foeOpen: true }).grade,
    'crush', '상대 빈틈에는 파해 대상을 내도 완파 취급이다');
});

suite('예고 화면 슬롯 교체 · 봇 무대 선택 (REQ-731·736)', () => {
  // 예고 화면의 교체는 그 도전자를 앞두고 내린 판단이라, 도장 교체와 로그에서 갈려야 한다.
  const session = createSession({ now: () => 0 });
  for (const style of STYLES) session.progress = setStyleRank(session.progress, style.id, BALANCE.rankGate.unlock);
  autoEquip(session);
  const benched = STYLES.find((st) => !session.slots.includes(st.id));
  eq(session.slots.filter(Boolean).length, BALANCE.slots, '슬롯 3 이 차고 초식 하나가 벤치에 남는다');
  session.log.clear();
  ok(equip(session, benched.id, 0, { challenger: 'A-4' }), '예고 화면에서 슬롯 0 을 교체한다');
  eq(session.slots[0], benched.id, '교체가 슬롯에 반영된다 — 대련 진입이 이 배열을 읽는다');
  const slots = session.log.entries.filter((e) => e.event === 'slot');
  deepEq(slots.map((e) => [e.action, e.challenger]), [['unequip', 'A-4'], ['equip', 'A-4']],
    '해제·장착 양쪽에 도전자가 실린다');
  deepEq([...new Set(slots.map((e) => e.sv))], [2], 'slot 은 sv:2 로 나간다 (REQ-791)');
  session.log.clear();
  equip(session, STYLES.find((st) => !session.slots.includes(st.id)).id, 1);
  deepEq([...new Set(session.log.entries.filter((e) => e.event === 'slot').map((e) => e.challenger))], [null],
    '도장 교체는 도전자가 없다 — 「진짜 판단」의 분리 식별자다');

  // 봇은 계단이 요구하는 무대로 간다 (REQ-731) — 최고 차수만 반복하면 완파 무대가 오지 않는다.
  const at = createSession({ now: () => 0 });
  at.stage = DUEL_A_STAGES;
  for (const style of STYLES) at.progress = setStyleRank(at.progress, style.id, 1);
  at.slots = ['yuun-bo', 'jeok-un', 'haeng-un'];
  eq(nextDuelStage(at), at.stage, '계단에 선 초식이 없으면 최고 차수를 친다');
  at.progress = setStyleRank(at.progress, 'jeok-un', BALANCE.rankLadder.crushRank - 1);
  eq(challengerOfStage(nextDuelStage(at)).styles.includes(styleById('jeok-un').counters), true,
    '완파를 앞둔 초식은 그 파해 대상을 예고하는 무대로 이끈다');
  at.slots = ['pa-un', 'jeok-un', 'haeng-un'];
  at.progress = setStyleRank(at.progress, 'pa-un', BALANCE.rankLadder.crushRank - 1);
  eq(challengerOfStage(nextDuelStage(at)).id, 'A-4',
    '파운현월의 완파 무대는 A-4 뿐이라 그리로 간다');
  const locked = createSession({ now: () => 0 });
  locked.slots = ['pa-un', null, null];
  locked.progress = setStyleRank(locked.progress, 'pa-un', BALANCE.rankLadder.crushRank - 1);
  eq(nextDuelStage(locked), locked.stage, '해금하지 않은 차수는 무대로 고르지 않는다');
});

// -------------------------------------- 8. 제자 자동 선택 (REQ-403)

suite('제자 자동 선택 (REQ-403·853)', () => {
  const all = STYLES.filter((s) => s.id !== 'pa-un');
  const delta = foeStyleById('delta');
  const pick = (opts) => selectDiscipleStyle({ styles: all, ...opts });

  eq(pick({ foeStyle: foeStyleById('alpha') }).style.id, 'yuun-bo', 'α(강) 에는 쾌로 우세');
  eq(pick({ foeStyle: foeStyleById('gamma') }).style.id, 'haeng-un', 'γ(쾌) 에는 정으로 우세');
  eq(pick({ foeStyle: delta }).style.id, 'jeok-un', 'δ(정) 에는 강으로 우세');

  // 역파 회피는 절초가 예고된 초에만 걸린다 — 그 밖의 초에서 완파를 버리지 않는다.
  eq(judge({ selfStyle: pick({ foeStyle: foeStyleById('alpha') }).style, foeStyle: foeStyleById('alpha'), selfRank: 1, foeRank: 1 }).grade,
    'crush', 'δ 를 가진 도전자라도 α 예고 초에는 완파가 나온다');
  const fakeFinisher = { id: 'fake', attr: 'fine', d: 20, finisher: true, counters: 'jeok-un' };
  eq(pick({ foeStyle: fakeFinisher }).style.id, 'haeng-un', '우세 후보가 예고된 절초의 파해 대상이면 상쇄로 내려간다');
  const fakePlain = { ...fakeFinisher, id: 'fake-plain', finisher: false };
  eq(pick({ foeStyle: fakePlain }).style.id, 'jeok-un', '절초가 아니면 파해 대상이어도 제외하지 않는다');

  // 우세 없음 → 상쇄, 상쇄도 없음 → 잔여.
  eq(selectDiscipleStyle({ styles: [styleById('haeng-un')], foeStyle: foeStyleById('beta') }).style.id,
    'haeng-un', '우세가 없으면 상쇄');
  eq(selectDiscipleStyle({ styles: [styleById('yuun-bo')], foeStyle: foeStyleById('beta') }).style.id,
    'yuun-bo', '우세·상쇄가 모두 없으면 잔여');

  // 상대 빈틈에는 예고가 없어 위력만 남고, 역파 위험도 없다.
  eq(pick({ foeStyle: null }).style.id, 'haeng-un', '상대 빈틈에는 최대 위력 초식');

  // 동률은 성으로, 성도 동률이면 슬롯 순으로 결정된다.
  const twoFast = [styleById('yuun-bo'), { ...styleById('pa-un'), attr: 'fast' }];
  eq(selectDiscipleStyle({
    styles: twoFast, foeStyle: foeStyleById('alpha'), rankOf: (s) => (s.id === 'pa-un' ? 5 : 1),
  }).style.id, 'pa-un', '우세 후보 중 성 높은 것');
  eq(selectDiscipleStyle({ styles: twoFast, foeStyle: foeStyleById('alpha') }).style.id, 'yuun-bo',
    '성 동률이면 슬롯 순');

  eq(selectDiscipleStyle({ styles: [styleById('yuun-bo')], foeStyle: delta }).style.id, 'yuun-bo',
    '전부 배제되면 역파를 감수한다');
  eq(selectDiscipleStyle({ styles: [] }), null, '보유 초식이 없으면 null');

  // 이유 3계열 — 화면 문구가 이 값에 매핑되므로 각 계열이 실제로 발화하는 입력이 있어야 한다 (REQ-853).
  eq(pick({ foeStyle: foeStyleById('alpha') }).reason, SELECT_REASON.ADVANTAGE, '우세 후보를 냈으면 우세 계열');
  eq(pick({ foeStyle: null }).reason, SELECT_REASON.ADVANTAGE, '빈틈은 어떤 완주든 완파라 우세 계열');
  eq(selectDiscipleStyle({ styles: [styleById('haeng-un')], foeStyle: foeStyleById('beta') }).reason,
    SELECT_REASON.CLASH, '우세가 없어 같은 속성으로 맞섰으면 상쇄 계열');
  eq(pick({ foeStyle: fakeFinisher }).reason, SELECT_REASON.AVOID_REVERSAL,
    '배제가 우세 후보를 걷어내 선택이 바뀌었으면 역파 회피 계열');
  eq(pick({ foeStyle: delta }).reason, SELECT_REASON.ADVANTAGE,
    '배제해도 같은 초식을 골랐으면 회피가 아니다 — 유운보는 δ 에 우세 후보가 아니었다');
  eq(selectDiscipleStyle({ styles: [styleById('yuun-bo')], foeStyle: delta }).reason,
    SELECT_REASON.CLASH, '전부 배제돼 역파를 감수한 초는 회피가 아니다');
  // 배제 여부 판정은 배제된 초식이 슬롯 뒤에 있을 때 갈린다 — 정렬 기준이 넘어온 목록이 아니라
  // 걸러낸 목록에 매여 있으면 배제분이 인덱스 -1 로 앞서 「바뀌지 않은 선택」이 회피로 오라벨된다.
  const twoHard = [
    { ...styleById('jeok-un'), id: 'hard-front' },
    { ...styleById('jeok-un'), id: 'hard-back' },
  ];
  const finisherOnBack = { id: 'fake-back', attr: 'fine', d: 20, finisher: true, counters: 'hard-back' };
  const behind = selectDiscipleStyle({ styles: twoHard, foeStyle: finisherOnBack });
  eq(behind.style.id, 'hard-front', '배제분이 뒤 슬롯이면 앞 슬롯이 그대로 뽑힌다');
  eq(behind.reason, SELECT_REASON.ADVANTAGE, '선택이 바뀌지 않았으므로 회피가 아니다');

  deepEq([...new Set(Object.values(SELECT_REASON))].length, 3, '이유 계열은 3종이고 값이 겹치지 않는다');
  // 화면 문구가 계열마다 있어야 한다 — 없으면 그 초의 판단이 빈칸으로 뜬다 (theme.mjs 부팅 단정의 짝).
  for (const reason of Object.values(SELECT_REASON)) {
    ok(typeof REASON_VIEW[reason] === 'string' && REASON_VIEW[reason].length > 0,
      `${reason} 에 화면 문구가 있다`);
  }

  // 제자의 손이 내보내는 형태 — 지시받은 초에는 판단이 없으므로 이유가 비고 그 사실이 `byUser` 로 선다.
  const handSession = createSession({ now: () => 0 });
  handSession.disciple = transmit(masteredProgress, createDisciple(), ART_ID);
  const handStyles = discipleStyles(handSession.disciple, ART_ID);
  const shots = [];
  const hand = createDiscipleHand({ session: handSession, styles: handStyles, fire: (f) => shots.push(f) });
  const atFire = { ratio: 1 - BALANCE.discipleFireRatio - 0.01, telegraphed: foeStyleById('alpha') };
  hand.arm();
  const auto = hand.tick(atFire);
  eq(auto.byUser, false, '지시가 없으면 제자가 판단한다');
  ok(Object.values(SELECT_REASON).includes(auto.reason), '자동 선택에는 이유 계열이 실린다');
  hand.arm();
  const told = hand.tick(atFire, styleById('haeng-un'));
  eq(told.style.id, 'haeng-un', '지시는 그 초의 선택을 대체한다');
  eq(told.byUser, true, '지시받은 초는 byUser 다');
  eq(told.reason, null, '판단하지 않은 초에는 이유가 없다 — 화면이 그것으로 문구를 가른다');
  eq(shots.length, 2, '두 초 모두 실제로 발동했다');
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

// ------- 9-b. 파견 2단화 · 제자 수련 (REQ-741~745·751~754·761·791~794)

/** 전수 직후 상태에서 초식별 성만 갈아 끼운 제자 — 잠금·벽 케이스의 시작 상태다. */
function discipleAt(rank, overrides = {}) {
  const disciple = transmit(masteredProgress, createDisciple(), ART);
  for (const style of artStyles(ART)) {
    disciple.arts[ART].styles[style.id] = { rank: overrides[style.id] ?? rank, pts: 0 };
  }
  return disciple;
}

suite('B-1 고정 · B-2 랜덤 임무 (REQ-741·742)', () => {
  const session = createSession();
  session.disciple = discipleAt(BALANCE.discipleStartRank);
  session.transmitted = true;

  const first = beginMission(session, { random: createSeededRandom(1) });
  eq(first.label, 'B-1', '전수 직후의 첫 임무는 B-1');
  deepEq(first.foeSet, DISPATCH_CHALLENGER.styles, 'B-1 은 고정 상대 — 난수를 줘도 조합이 흔들리지 않는다');
  eq(first.foeRank, foeRankOf(DISPATCH_CHALLENGER.id), 'B-1 도전자 성은 초회 값 그대로다');
  eq(missionLockRank(1), null, 'B-1 에는 잠금이 없다 — 전수 직후의 통쾌함이 지연되지 않는다');

  // 난이도 곡선은 성으로만 오른다 — 파견 무대(HP)는 하나를 공유한다.
  const base = foeRankOf(DISPATCH_CHALLENGER.id);
  for (let stage = 1; stage <= 5; stage += 1) {
    eq(missionFoeRank(stage, base), base + BALANCE.mission.rankStep * (stage - 1),
      `B-${stage} 도전자 성은 곡선 데이터로 오른다`);
  }
  eq(missionFoeRank(99, base), BALANCE.rankMax, '임무 성도 성 상한을 넘지 않는다');

  // 시드 고정 = 재현 · 호출마다 = 새 조합. 둘이 함께 성립해야 검증 가능한 랜덤이다.
  const draws = (seed, n) => {
    const random = createSeededRandom(seed);
    return Array.from({ length: n }, () => missionFoeSet(random));
  };
  const drawn = draws(4242, 12);
  deepEq(drawn, draws(4242, 12), '시드를 고정하면 같은 조합열이 재현된다');
  ok(new Set(drawn.map((set) => set.join('+'))).size > 1, '호출마다 조합이 달라진다');
  for (const set of drawn) {
    eq(set.length, BALANCE.mission.foeCount, `한 임무의 상대 수는 ${BALANCE.mission.foeCount}`);
    eq(new Set(set).size, set.length, '한 임무에 같은 아키타입이 두 번 들지 않는다');
    eq(set.every((id) => foeStyleById(id) !== null), true, '뽑힌 id 는 전부 적 초식 아키타입이다');
  }
  ok(drawn.some((set) => set.includes('delta')), '절초 δ 도 뽑힌다 — 역파의 제자 무대다 (REQ-772)');
});

suite('B-2 하드 잠금 = 전 초식 최소 성 (REQ-743)', () => {
  const need = BALANCE.mission.unlockRank;
  const session = createSession();
  session.disciple = discipleAt(BALANCE.discipleStartRank);
  session.transmitted = true;
  eq(canDispatch(session), true, 'B-1 은 1성 제자에게도 열려 있다');

  session.dispatchStage = 2;
  eq(missionLockRankOf(session), need, `B-2 잠금 기준은 권장 성 ${need}`);
  eq(canDispatch(session), false, '1성 제자는 B-2 에 나갈 수 없다');

  session.disciple = discipleAt(need - 1);
  eq(discipleMinRank(session.disciple, ART), need - 1, '최소 성이 잠금의 입력이다');
  eq(canDispatch(session), false, `전 초식 ${need - 1}성이면 버튼이 잠긴다`);
  deepEq(missionShortfallOf(session).map((s) => s.id), artStyles(ART).map((s) => s.id),
    '부족한 초식이 빠짐없이 표시된다');
  eq(missionShortfallOf(session)[0].rank, need - 1, '부족 표시에 현재 성이 함께 실린다');

  // 하나만 뒤처져도 잠기는 것이 「평균이 아니라 최소」의 내용이다 — 방치 경로를 남기지 않는다.
  session.disciple = discipleAt(need, { 'pa-un': need - 1 });
  eq(canDispatch(session), false, '한 초식만 뒤처져도 잠긴다');
  deepEq(missionShortfallOf(session).map((s) => s.id), ['pa-un'], '뒤처진 그 초식만 지목된다');

  // 잠긴 차수에서 봇이 두는 한 수는 예고 직행이 아니다 — 자격 없이 들어가면 되돌아 나오는 길밖에 없다.
  deepEq([nextDojoAction(session).kind, nextDojoAction(session).styleId], ['trainDisciple', 'pa-un'],
    '잠긴 차수의 다음 한 수는 잠금을 쥔 그 초식을 걸어 두는 것이다');

  session.disciple = discipleAt(need);
  eq(canDispatch(session), true, `전 초식 ${need}성에 닿으면 열린다`);
  deepEq(missionShortfallOf(session), [], '열린 뒤에는 부족 초식이 없다');
  eq(nextDojoAction(session).kind, 'preview', '자격이 차면 예고로 간다');

  // 조합은 한 판에 한 번 확정된다 — 예고 재진입이 공짜 리롤이면 가장 쉬운 조합에 눌러앉을 수 있다.
  const drawnOnce = currentMission(session, { random: createSeededRandom(7) });
  deepEq(currentMission(session, { random: createSeededRandom(11) }).foeSet, drawnOnce.foeSet,
    '예고에 다시 들어와도 같은 조합을 본다');
  settleDispatch(session, { win: true });
  eq(session.mission, null, '한 판이 끝나면 그 임무는 소비된다');
  eq(session.dispatchStage, 3, '이긴 차수만 다음 임무를 연다');
  ok(currentMission(session, { random: createSeededRandom(7) }).stage === 3,
    '다음 차수는 그 차수의 조합을 새로 뽑는다');
  eq(isMissionUnlocked(createDisciple(), ART, 2), false, '전수받지 않은 제자는 최소 성 자체가 없다');
  eq(canDispatch(createSession()), false, '전수 전에는 파견이 열리지 않는다');
});

suite('제자 수련 계단 산술 (REQ-753·706)', () => {
  const per = discipleTrainMsPerRank();
  eq(per, BALANCE.discipleTrain.secondsPerRank * 1000, '1성당 시간은 정본 JSON 이 진다');
  deepEq(discipleTrainSteps(1, 0), { steps: 0, restMs: 0, wall: false }, '0 은 계단을 열지 않는다');
  deepEq(discipleTrainSteps(1, per - 1), { steps: 0, restMs: per - 1, wall: false }, '모자란 시간은 이월된다');
  deepEq(discipleTrainSteps(1, per * 3 + 5), { steps: 3, restMs: 5, wall: false }, '넘친 시간도 이월된다');
  const cap = BALANCE.rankGate.oneTap;
  deepEq(discipleTrainSteps(cap - 1, per), { steps: 1, restMs: 0, wall: false }, `${cap}성까지는 수련이 민다`);
  eq(discipleTrainSteps(cap, per).wall, true, `${cap}성 위의 수련 적립 시도는 무효다`);
  eq(discipleTrainSteps(cap, per).steps, 0, '무효 시도는 계단을 열지 않는다');
  eq(discipleTrainSteps(BALANCE.discipleRankMax, per).wall, false, '상한은 벽이 아니다 — 오를 계단이 없다');
  eq(applyDiscipleTraining(createDisciple(), ART, 'yuun-bo', per).to, null,
    '전수받지 않은 제자에게는 걸 초식 자체가 없다');
});

suite('제자 수련 — 병렬 · 지정 초식만 · 7성 정지 (REQ-751~754·706)', () => {
  const per = discipleTrainMsPerRank();
  let clock = 0;
  const session = createSession({ now: () => clock });
  session.disciple = discipleAt(BALANCE.discipleStartRank);
  session.transmitted = true;

  eq(designateDiscipleTraining(session, 'yuun-bo'), true, '수련시킬 초식을 지정해 걸어 둔다');
  clock += per - 1;
  settleDiscipleTraining(session);
  eq(discipleStyleRank(session.disciple, ART, 'yuun-bo'), 1, '1성당 시간에 못 미치면 오르지 않는다');
  const partial = discipleTrainProgress(session);
  eq(partial.styleId, 'yuun-bo', '진척 막대는 지정 초식 하나를 가리킨다');
  ok(partial.ratio > 0.99 && partial.ratio < 1, '막대가 다음 계단까지의 비율로 찬다');

  clock += 1;
  settleDiscipleTraining(session);
  eq(discipleStyleRank(session.disciple, ART, 'yuun-bo'), 2, '1성당 시간이 차면 한 계단 오른다');

  // 정산이 시각을 두 번 읽으면 그 사이가 매번 증발한다 — 흐르는 시계로 여러 번 정산해도 총량이 보존된다.
  // 읽을 때마다 전진하는 시계 — 정산이 시각을 두 번 읽으면 읽는 간격만큼이 정산마다 증발한다.
  // 바깥 `clock` 과 분리해야 뒤 단정의 기준이 함께 밀리지 않는다.
  const step = per / 8;
  let ticks = 0;
  const ticking = createSession({ now: () => { ticks += step; return ticks; } });
  ticking.disciple = discipleAt(BALANCE.discipleStartRank);
  designateDiscipleTraining(ticking, 'haeng-un');
  for (let i = 0; i < 24; i += 1) settleDiscipleTraining(ticking);
  eq(discipleStyleRank(ticking.disciple, ART, 'haeng-un'), 4,
    '잦은 정산이 경과를 갉아먹지 않는다 — 시각은 한 정산에 한 번만 읽는다');
  eq(discipleStyleRank(session.disciple, ART, 'jeok-un'), BALANCE.discipleStartRank,
    '지정하지 않은 초식은 그대로다 — 그 통제권이 요구의 핵심이다');

  const trains = session.log.entries.filter((e) => e.event === 'disciple_train');
  eq(trains.length, 1, 'disciple_train 이 한 번 남는다');
  deepEq([trains[0].style, trains[0].from, trains[0].to, trains[0].elapsed_ms], ['yuun-bo', 1, 2, per],
    '성이 오른 구간과 소비한 시간이 그대로 실린다');
  eq(trains[0].sv, undefined, '신설 이벤트라 판별 토큰이 붙지 않는다');
  const discipleRankLogs = session.log.entries.filter((e) => e.event === 'rank' && e.actor === 'disciple');
  deepEq([discipleRankLogs.at(-1).via, discipleRankLogs.at(-1).to], ['train', 2],
    '성 변화는 rank 이벤트로도 남아 적립 축과 같은 자리에서 읽힌다');

  // 병렬 — 사부 대련이 도는 동안에도 시계가 흐르고, 대련 진입이 차단되지 않는다 (REQ-752).
  enterPhase(session, 'duel');
  const timer = createVirtualTimer();
  const duel = createMatch({
    challenger: challengerById('A-1'),
    selfHpMax: BALANCE.hp.user,
    rankOf: () => 1,
    openLen: () => 3,
    accessibility: () => false,
    timer,
  });
  ok(pumpToEnd(duel, timer).view.outcome.over, '제자 수련이 걸린 채로도 사부 대련이 끝까지 돈다');
  eq(discipleTrainProgress(session).styleId, 'yuun-bo', '대련이 지정을 빼앗지 않는다 — 상태기계를 점유하지 않는다');
  clock += per;
  settleDiscipleTraining(session);
  eq(discipleStyleRank(session.disciple, ART, 'yuun-bo'), 3, '사부가 대련하는 동안에도 제자 성이 올랐다');
  eq(session.log.entries.filter((e) => e.event === 'disciple_train').at(-1).master_activity, 'duel',
    '사부가 그동안 무엇을 했는지가 병렬성의 유일한 증거다');

  // 지정 교체는 이전 초식의 미완 시간을 버리지 않는다 — 버리면 유저가 지정을 옮기지 않게 된다.
  clock += per / 2;
  designateDiscipleTraining(session, 'jeok-un');
  clock += per;
  settleDiscipleTraining(session);
  eq(discipleStyleRank(session.disciple, ART, 'jeok-un'), 2, '옮긴 초식이 그 자리에서 오른다');
  designateDiscipleTraining(session, 'yuun-bo');
  clock += per / 2;
  settleDiscipleTraining(session);
  eq(discipleStyleRank(session.disciple, ART, 'yuun-bo'), 4, '돌아온 초식은 두고 간 절반부터 이어 찬다');

  // 7성 정지 + rank_wall (REQ-706) — 그 위는 파견 유효 성공 전용이다.
  const walled = createSession({ now: () => clock });
  walled.disciple = discipleAt(BALANCE.discipleStartRank, { 'yuun-bo': BALANCE.rankGate.oneTap - 1 });
  designateDiscipleTraining(walled, 'yuun-bo');
  clock += per * 2;
  settleDiscipleTraining(walled);
  eq(discipleStyleRank(walled.disciple, ART, 'yuun-bo'), BALANCE.rankGate.oneTap,
    `제자 수련은 ${BALANCE.rankGate.oneTap}성에서 정지한다`);
  const wall = walled.log.entries.filter((e) => e.event === 'rank_wall');
  eq(wall.length, 1, '무효가 된 적립 시도가 rank_wall 로 남는다');
  deepEq([wall[0].actor, wall[0].at_rank, wall[0].attempted],
    ['disciple', BALANCE.rankGate.oneTap, 'train'], '벽 로그는 사부와 같은 형이되 actor 로 갈린다');
  eq(discipleTrainProgress(walled), null, '벽에 닿으면 지정이 풀린다 — 무효인 시간을 계속 태우지 않는다');
  eq(canDiscipleTrain(walled, 'yuun-bo'), false, '벽 위 초식은 다시 지정할 수도 없다');
  eq(trainAccrualCap(), BALANCE.rankGate.oneTap, '수련 상한은 지금 원터치 계단과 같은 수이지만 다른 축이다');
  // 벽 위 구간의 유일한 경로는 파견 유효 성공이고, 그마저 상한 10 에서 멈춘다 (REQ-705).
  for (let i = 0; i < 60; i += 1) accrueDiscipleRank(walled, 'yuun-bo');
  eq(discipleStyleRank(walled.disciple, ART, 'yuun-bo'), BALANCE.discipleRankMax,
    `벽 위는 파견 유효 성공으로 ${BALANCE.discipleRankMax}성까지 오른다`);
  eq(discipleStyleRank(walled.disciple, ART, 'yuun-bo') < BALANCE.rankLadder.finishRank, true,
    '제자는 11성에 진입하지 않는다 — 결정타·완파는 자동 전투가 하지 않는 판단이다');

  // 상한(제자 10성)에 닿은 초식도 지정이 풀린다 — 놓지 않으면 막대가 규칙에 없는 11성을 가리킨다.
  const capped = createSession({ now: () => clock });
  capped.disciple = discipleAt(BALANCE.discipleStartRank, { 'yuun-bo': BALANCE.rankGate.oneTap - 1 });
  designateDiscipleTraining(capped, 'yuun-bo');
  capped.disciple.arts[ART].styles['yuun-bo'] = { rank: BALANCE.discipleRankMax, pts: 0 };
  clock += per;
  settleDiscipleTraining(capped);
  eq(discipleTrainProgress(capped), null, '상한에 닿으면 지정이 풀린다 — 오를 계단이 없다');
  eq(capped.log.entries.filter((e) => e.event === 'rank_wall').length, 0,
    '상한은 벽이 아니다 — 무효 적립 시도가 아니므로 rank_wall 을 남기지 않는다');

  // 시간 주입 — 걸어 둔 시각을 앞당길 뿐, 게임 수치(1성당 시간)는 그대로다 (REQ-792).
  const injected = createSession({ now: () => clock });
  injected.disciple = discipleAt(BALANCE.discipleStartRank);
  designateDiscipleTraining(injected, 'haeng-un');
  advanceDiscipleTraining(injected, per * 3);
  eq(discipleStyleRank(injected.disciple, ART, 'haeng-un'), 4, '주입한 시간만큼 계단이 열린다');
  eq(BALANCE.discipleTrain.secondsPerRank, 1800, '주입은 1성당 시간을 건드리지 않는다');
  // 방치 압축 버튼도 같은 자리를 지난다 — 재화만 주던 시뮬이 제자 성에 연결된다 (REQ-753).
  const simSession = createSession({ now: () => clock });
  simSession.disciple = discipleAt(BALANCE.discipleStartRank);
  designateDiscipleTraining(simSession, 'pa-un');
  simulateTraining(simSession);
  eq(discipleStyleRank(simSession.disciple, ART, 'pa-un'),
    1 + Math.floor((BALANCE.simTrainSeconds * 1000) / per), '1시간 수련 시뮬이 제자 성에도 걸린다');
});

suite('전수 조건 · transmit 로그 (REQ-761·791)', () => {
  const partial = createSession();
  partial.progress = setStyleRank(masteredProgress, 'pa-un', BALANCE.rankMax - 1);
  eq(canTransmitNow(partial), false, '11성 초식이 1개라도 있으면 전수 불가');

  const session = createSession();
  session.progress = masteredProgress;
  eq(canTransmitNow(session), true, '전 초식 12성이면 전수 가능');
  runTransmit(session);
  const record = session.log.entries.filter((e) => e.event === 'transmit').at(-1);
  eq(record.art, ART, '전수 단위는 무공 통째다');
  eq(record.sv, 2, '뜻이 바뀐 이벤트라 판별 토큰이 붙는다');
  deepEq(record.styles, artStyles(ART).map((s) => ({ id: s.id, rank: BALANCE.discipleStartRank })),
    '제자는 전 초식 1성에서 시작한다 — 사부 성은 상속되지 않는다');
  eq(session.label, '고수', '전수로 단계 라벨이 오른다');
});

suite('파견 실행 규칙 승계 (REQ-745)', () => {
  const disciple = transmit(masteredProgress, createDisciple(), ART);
  const sim = simulateDispatch({ challengerId: 'B', disciple, setId: ART });
  eq(sim.trace.every((t) => t.self !== null), true, '항상 성공 — 제자는 창을 흘리지 않는다 (REQ-402)');
  eq(sim.trace.every((t) => t.grade !== 'struck'), true, '미완주 판정이 나오지 않는다');
  eq(sim.trace.every((t) => t.grade !== 'reversal'), true, '자동 선택이 역파를 피한다 (REQ-403)');

  // 관전이 기본 — 지시 콜백을 주지 않은 배선은 그 수에 null 을 넘긴다 (REQ-407).
  const session = createSession();
  session.disciple = disciple;
  const picked = [];
  const stub = { arm() {}, tick: (view, instructed) => { picked.push(instructed); return null; } };
  dispatchWiring(session, { disciple: stub }).onTick({ ratio: 1 });
  deepEq(picked, [null], '관전 기본 — 지시가 없으면 그 수의 값은 null 이다');
  const style = styleById('yuun-bo');
  dispatchWiring(session, { disciple: stub, instructed: () => style }).onTick({ ratio: 1 });
  eq(picked.at(-1), style, '지시는 선택적으로 그 수만 대체한다 (REQ-404)');
});

suite('헤드리스 파견 2단 · 제자 수련 셀프 관측 (REQ-742·744·751~753·792·794)', () => {
  const run = runHeadlessCycle({ random: createSeededRandom(20260902) });
  const dispatches = run.session.log.entries.filter((e) => e.event === 'dispatch');
  eq(dispatches.length, 1, '1사이클의 파견은 한 번');
  eq(dispatches[0].stage, 'B-1', '그 한 번은 B-1 이다');
  eq(dispatches[0].sv, 2, '뜻이 바뀐 이벤트라 판별 토큰이 붙는다');
  eq(dispatches[0].locked_until, null, 'B-1 에는 잠금이 없다');
  deepEq(dispatches[0].foe_set, DISPATCH_CHALLENGER.styles, 'B-1 조합은 고정이다');
  deepEq(Object.keys(dispatches[0].disciple_ranks).sort(), artStyles(ART).map((s) => s.id).sort(),
    '그 시점 제자 성이 초식별로 실린다');
  eq(dispatches[0].result, 'win', '1성 제자가 무지시 자동으로 B-1 을 이긴다 — 무패 보장 (REQ-741)');
  // 파견 중에도 성이 오르므로, 종료 시점 성을 찍으면 승패가 실제보다 여문 성에 귀속된다 (REQ-744).
  deepEq(Object.values(dispatches[0].disciple_ranks), artStyles(ART).map(() => BALANCE.discipleStartRank),
    '기록된 성은 그 임무에 투입된 성이다 — 싸우며 오른 성이 아니다');
  ok(artStyles(ART).some((st) => discipleStyleRank(run.session.disciple, ART, st.id) > BALANCE.discipleStartRank),
    '실제로 그 파견에서 제자 성이 올랐다 — 위 단정이 공허하지 않다');

  const missions = runHeadlessMissions({
    session: run.session, timer: run.timer, stages: 2, random: createSeededRandom(31337),
  });
  eq(missions.length, 2, 'B-2 이후 임무가 이어서 돈다');
  eq(missions.every((m) => m.stage !== 'B-1'), true, '이어지는 임무는 B-1 이 아니다');
  eq(missions.every((m) => m.foeSet.length === BALANCE.mission.foeCount), true, '임무마다 조합이 새로 짜인다');
  const entries = run.session.log.entries;
  // 판정 범위의 표현은 「종점이 하나」가 아니라 「**첫** 종점이 B-1 이고 판독기가 거기서 자른다」다 (REQ-792).
  const firstDone = entries.findIndex((e) => e.event === 'cycle' && e.phase === 'cycle_done');
  eq(entries.slice(0, firstDone).filter((e) => e.event === 'dispatch').length, 1,
    '첫 종점 앞의 파견은 B-1 하나뿐이다');
  const later = entries.filter((e) => e.event === 'dispatch').slice(1);
  eq(later.length, 2, 'B-2 이후 파견도 같은 스키마로 남는다');
  eq(later.every((e) => e.locked_until === BALANCE.mission.unlockRank), true,
    'B-2 부터는 그 임무가 요구한 최소 성이 로그에 실린다');
  const trains = entries.filter((e) => e.event === 'disciple_train');
  ok(trains.length > 0, '잠금을 풀기까지 제자 수련이 실제로 돌았다');
  eq(trains.every((e) => e.to > e.from), true, '성이 오르지 않은 정산은 항목을 남기지 않는다');

  // 로그만으로 산출 — 신규 지표 5종이 판독기에서 나온다 (REQ-794).
  const payload = exportPayload(run.session);
  const { metrics, kill, aux } = readout(payload);
  eq(kill.d_cycle_done_ms, run.elapsedMs, '(d) 종점은 B-1 의 것이다 — B-2 이후는 절단선 밖이다');
  ok(aux.dropped_after_cycle > 0, 'B-2 이후 항목은 첫 사이클 밖으로 떨어진다');
  eq(metrics.dispatch_by_stage.length, 3, '파견 3건이 조합·승패와 함께 판독된다');
  eq(metrics.rank_wall, 0, '사부 축 8성 벽은 제자 방치분과 섞이지 않는다');
  ok(metrics.disciple_train_ranks > 0, '제자 수련 성 상승분이 로그만으로 산출된다');
  ok(Object.keys(metrics.disciple_train_activity).length > 0, '병렬성 지표(master_activity)가 산출된다');
  ok(metrics.rematch_deepest >= 1, '재대련 중단 지점(attempt_n 분포)이 산출된다');
  ok(Object.keys(metrics.finish_by_style).length > 0, '결정타 배분이 산출된다');
  eq(typeof metrics.finish_intended_rate, 'number', '결정타 의도 일치율이 산출된다');
  eq(typeof metrics.rank_wall, 'number', '8성 벽 충돌 횟수가 산출된다');
});

suite('파견 중도 이탈 = abort — 한 판 한 결과 · 승률 분모 밖 (REQ-744)', () => {
  const run = runHeadlessCycle({ random: createSeededRandom(20260902) });
  const { session } = run;
  const stub = { arm() {}, tick: () => null };
  const dispatchesOf = () => session.log.entries.filter((e) => e.event === 'dispatch');
  const before = dispatchesOf().length;

  // abort 가 한 건도 없는 로그 — 계수는 0 이고 승률은 그때도 win/loss 만으로 선다.
  const legacy = readout(exportPayload(session)).metrics;
  eq(legacy.dispatch_aborts, 0, 'abort 없는 로그에서도 판독이 죽지 않고 계수는 0 이다');
  eq(legacy.dispatch_win_rate, 1, 'abort 없는 로그의 승률도 win/loss 만으로 산출된다');

  // ① 관전 중 이탈 — 판을 연 뒤 결과 없이 나가면 그 판의 결과 항목이 abort 로 남는다.
  const mission = currentMission(session, { random: createSeededRandom(20260903) });
  dispatchWiring(session, { disciple: stub });
  ok(logDispatchAbort(session, { mission }), '진행 중인 판의 이탈은 결과 항목을 낸다');
  eq(dispatchesOf().length, before + 1, '이탈 1건이 로그에 실린다');
  eq(dispatchesOf().at(-1).result, 'abort', '이탈은 패배와 다른 결과값으로 갈린다');
  eq(dispatchesOf().at(-1).stage, mission.label, '이탈도 그 임무의 조합·차수를 함께 진다');
  deepEq(dispatchesOf().at(-1).foe_set, mission.foeSet, '이탈 항목의 조합은 실제로 싸운 그 임무의 것이다');

  // ② 같은 판에서 한 번 더 나가도 분모는 늘지 않는다 — 한 판은 결과를 하나만 낸다.
  eq(logDispatchAbort(session, { mission }), null, '같은 판의 두 번째 이탈은 아무것도 남기지 않는다');
  eq(dispatchesOf().length, before + 1, '중복 이탈이 분모를 부풀리지 않는다');

  // ③ 재진입 = 새 판 — 완주하면 win/loss 가 별도로 한 건 더 실린다.
  dispatchWiring(session, { disciple: stub });
  ok(logDispatchResult(session, { mission, win: true }), '재진입한 판은 자기 결과를 낸다');
  eq(dispatchesOf().length, before + 2, '이탈 1건 + 재진입 완주 1건 = 2건');
  deepEq(dispatchesOf().slice(-2).map((e) => e.result), ['abort', 'win'],
    'dispatch_by_stage 에 이탈·완주가 일어난 순서로 실린다');

  // ④ 판 종료 후 이탈 — 결과 화면으로 넘어간 판을 뒤늦게 떠나도 abort 는 나지 않는다.
  eq(session.logViolations.length, 0, '여기까지 계약 위반은 없다 — 아래 단정이 공허하지 않다');
  eq(logDispatchAbort(session, { mission }), null, '이미 결과를 낸 판의 이탈은 abort 가 아니다');
  eq(dispatchesOf().length, before + 2, '종료 후 이탈은 abort 0건이다');
  eq(session.logViolations.length, 0, '이탈의 무기록은 설계된 침묵이라 위반이 아니다');

  // ⑤ 반대로 **승패**가 거부되는 것은 끝난 판이 분모에서 사라진 것이라, 같은 침묵으로 접지 않는다.
  eq(logDispatchResult(session, { mission, win: false }), null, '두 번째 승패도 항목을 늘리지 않는다');
  eq(dispatchesOf().length, before + 2, '거부된 승패는 로그에 실리지 않는다');
  eq(session.logViolations.length, 1, '거부된 승패는 내보내기가 싣는 계약 위반으로 남는다');
  eq(session.logViolations.at(-1).event, 'dispatch', '위반이 그 이벤트 이름으로 귀속된다');
  session.logViolations.length = 0;

  const { metrics } = readout(exportPayload(session));
  eq(metrics.dispatch_aborts, 1, '판독기가 이탈을 계수로 노출한다');
  eq(metrics.dispatch_by_stage.length, before + 2, '이탈도 dispatch_by_stage 에 그대로 실린다');
  const settled = metrics.dispatch_by_stage.filter((m) => m.result !== 'abort');
  eq(metrics.dispatch_win_rate,
    settled.filter((m) => m.result === 'win').length / settled.length,
    '승률의 분모는 win+loss 다 — 이탈은 빠진다');
});

suite('파견 판의 투입 성은 판마다 다시 뜬다 (REQ-744)', () => {
  const stub = { arm() {}, tick: () => null };
  const styleIds = artStyles(ART).map((st) => st.id).sort();
  const per = discipleTrainMsPerRank();
  // 전수까지 마친 세션 — 제자가 있어야 투입 성이 값을 가진다.
  const transmitted = () => {
    const session = createSession();
    session.progress = masteredProgress;
    runTransmit(session);
    return session;
  };
  const dispatchesOf = (session) => session.log.entries.filter((e) => e.event === 'dispatch');

  // ① 이탈 → 도장 복귀에서 성 상승 → 재진입 완주 — 두 항목의 투입 성이 갈린다.
  const session = transmitted();
  const mission = currentMission(session, { random: createSeededRandom(20260903) });
  dispatchWiring(session, { disciple: stub });
  ok(logDispatchAbort(session, { mission }), '관전 중 이탈이 결과 항목을 낸다');

  eq(designateDiscipleTraining(session, 'yuun-bo'), true, '도장 복귀 전에 제자 수련이 걸려 있다');
  const grown = advanceDiscipleTraining(session, per);
  ok(grown.to > grown.from, '복귀 정산이 실제로 성을 올렸다 — 아래 대조가 공허하지 않다');

  dispatchWiring(session, { disciple: stub });
  ok(logDispatchResult(session, { mission, win: true }), '재진입한 판이 자기 결과를 낸다');

  // 양성 대조 ⓐ — 두 항목이 실재한다. 항목이 없으면 아래 「갈린다」가 공허하게 통과한다.
  eq(dispatchesOf(session).length, 2, '이탈 1건 + 재진입 완주 1건이 남는다');
  const [aborted, won] = dispatchesOf(session).slice(-2);
  deepEq([aborted.result, won.result], ['abort', 'win'], '두 항목이 이탈·완주 순으로 실린다');

  // 양성 대조 ⓑ — 두 항목 모두 초식 전건을 모집단으로 든다. 부분 소실·필드 오타가 여기서 걸린다.
  deepEq(Object.keys(aborted.disciple_ranks ?? {}).sort(), styleIds,
    '이탈 항목의 투입 성이 초식 전건을 싣는다');
  deepEq(Object.keys(won.disciple_ranks ?? {}).sort(), styleIds,
    '완주 항목의 투입 성이 초식 전건을 싣는다');

  // 차이 단정 — 그 모집단 위에서 두 값이 실제 성 상승을 반영해 갈린다.
  eq(aborted.disciple_ranks['yuun-bo'], grown.from, '이탈 항목은 이탈 시점의 성을 지킨다');
  eq(won.disciple_ranks['yuun-bo'], grown.to, '완주 항목은 재진입 시점의 여문 성을 진다');
  ok(aborted.disciple_ranks['yuun-bo'] !== won.disciple_ranks['yuun-bo'],
    '두 항목의 투입 성이 갈린다 — 재진입 판이 이탈 시점의 스냅샷을 물려받지 않는다');
  // 재스냅샷은 세션의 임무에 쓰고 로그는 호출부가 든 임무를 읽는다 — 두 출처가 갈리면 갱신이
  // 로그에 닿지 않은 채 무음으로 무효화되므로, 같은 값임을 여기서 문다.
  deepEq(won.disciple_ranks, session.mission.ranks,
    '로그가 실은 투입 성은 배선이 그 판에 다시 뜬 바로 그 값이다');
  ok(won.disciple_ranks !== session.mission.ranks,
    '로그 항목은 임무의 사본을 진다 — 다음 판의 재스냅샷이 지난 항목을 소급해 바꾸지 않는다');

  // ② 반대 방향 — 성이 오르지 않은 재진입은 같은 값이다. 재스냅샷이 값을 흔들지 않는다.
  const still = transmitted();
  const stillMission = currentMission(still, { random: createSeededRandom(20260903) });
  dispatchWiring(still, { disciple: stub });
  ok(logDispatchAbort(still, { mission: stillMission }), '성 무변화 세션에서도 이탈 항목이 남는다');
  dispatchWiring(still, { disciple: stub });
  ok(logDispatchResult(still, { mission: stillMission, win: false }), '재진입 판이 자기 결과를 낸다');
  const [left, lost] = dispatchesOf(still).slice(-2);
  deepEq(lost.disciple_ranks, left.disciple_ranks, '성이 오르지 않은 재진입의 투입 성은 그대로다');

  // ③ 반대 방향 — 한 판 안에서는 불변. 파견 도중 정산된 성은 그 판의 귀속에 섞이지 않는다.
  const during = transmitted();
  const duringMission = currentMission(during, { random: createSeededRandom(20260903) });
  dispatchWiring(during, { disciple: stub });
  const opened = { ...duringMission.ranks };
  eq(designateDiscipleTraining(during, 'jeok-un'), true, '판 도중에도 수련은 걸려 있다');
  const midBout = advanceDiscipleTraining(during, per);
  ok(midBout.to > midBout.from, '판 도중에 성이 실제로 올랐다 — 아래 불변 단정이 공허하지 않다');
  deepEq(duringMission.ranks, opened, '판 도중의 성 상승은 그 판의 투입 성을 바꾸지 않는다');
  ok(logDispatchResult(during, { mission: duringMission, win: true }), '그 판의 결과가 남는다');
  deepEq(dispatchesOf(during).at(-1).disciple_ranks, opened,
    '판 도중에 오른 성은 그 판의 항목에 실리지 않는다');
});

suite('kill (b) 판독 유효 조건 — 표본 하한 · 치트 제외 (REQ-782·793)', () => {
  const at = (event, fields) => ({ event, [TIME_FIELD]: 0, ...fields });
  const duelCycle = (fires) => ({
    entries: [
      at('session', { tester_role: 'self', device: 'keyboard' }),
      at('cycle', { phase: 'duel' }),
      ...Array.from({ length: fires }, () => at('fire', { styleId: 'yuun-bo', len: 3, oneTap: false, r: 0.5 })),
      at('cycle', { phase: 'cycle_done' }),
    ],
  });

  const thin = readout(duelCycle(KILL.minManualWindows - 1));
  eq(thin.kill.b_manual_windows, KILL.minManualWindows - 1, '수동 창 표본 수가 그대로 산출된다');
  eq(killVerdicts(thin).verdicts.b, null,
    `수동 창 ${KILL.minManualWindows} 미만은 (b) 판독 불가 — 모집단 축소가 만드는 소표본 오판을 막는다`);
  const enough = readout(duelCycle(KILL.minManualWindows));
  eq(enough.kill.b_completion_rate, 1, '산식은 불변 — fire(oneTap=false) / (fire + timeout)');
  eq(killVerdicts(enough).verdicts.b, true, '표본이 차면 그 자리에서 판독된다');
  eq(KILL.minManualWindows, BALANCE.killReadout.minManualWindows, '표본 하한은 정본 JSON 이 진다');

  // 원터치 창은 분모에서 빠지고 그 제외 시점이 7성이다 (REQ-793 — 산식 불변, 시점만 이동).
  eq(BALANCE.rankGate.oneTap, 7, '원터치 제외 시점 = 7성');
  const mixedTap = duelCycle(KILL.minManualWindows);
  mixedTap.entries.splice(2, 0, at('fire', { styleId: 'yuun-bo', len: 3, oneTap: true, r: 0.5 }));
  eq(readout(mixedTap).kill.b_manual_windows, KILL.minManualWindows, '원터치 창은 수동 창 표본에 들지 않는다');

  const flagged = { ...duelCycle(KILL.minManualWindows), cheat_flagged: true };
  eq(readout(flagged).aux.cheat_flagged, true, '치트 플래그가 판독 결과에 실린다');
  eq(killVerdicts(readout(flagged)).verdicts.b, null, '치트 세션은 (b) 표본에서 빠진다');
  eq(killVerdicts(readout(flagged)).verdicts.d, null, '치트 세션은 (d) 표본에서도 빠진다');
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
function simulateDuelA({ challengerId, styles, rank, foeRank = undefined }) {
  const session = createSession();
  const timer = createVirtualTimer();
  const trace = [];
  let ended = null;
  let match = null;

  const hand = createDiscipleHand({ session, styles, fire: (fired) => match.fire(fired) });
  match = createMatch({
    challenger: challengerById(challengerId),
    foeRank: foeRank ?? foeRankOf(challengerId),
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

suite('A 밸런스 게이트 (REQ-503·507·735)', () => {
  // 최저 성 유저가 A 를 넘는가 — 성이 오르면 위력도 오르므로 이것이 곡선의 하계다.
  const rank = 1;
  eq(powerOf(rank), 1.05, '성 1 내공 1.05');

  // A-3 는 두 구성으로 본다 — 첫 조우(4식 미학습)와 4식 해금 시점 구성은 다른 국면이다.
  // A-4 는 4식을 해금한 뒤에만 열리므로 그 구성 하나뿐이다 (REQ-731 A-3 승리 후 해금).
  const stages = [
    { id: 'A-1', styles: unlockSlots[0] },
    { id: 'A-2', styles: unlockSlots[1] },
    { id: 'A-3', styles: unlockSlots[2] },
    { id: 'A-3', styles: unlockSlots[unlockSlots.length - 1] },
    { id: 'A-4', styles: unlockSlots[unlockSlots.length - 1] },
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

  // A-4 는 재대련으로도 강화되므로 상한(+3)까지 밀어 둔 성으로도 게이트가 서야 한다 (REQ-734·735).
  const capped = rematchFoeRank(foeRankOf('A-4'), BALANCE.rematch.rankCap);
  const hardened = simulateDuelA({
    challengerId: 'A-4', styles: unlockSlots[unlockSlots.length - 1], rank: BALANCE.rankGate.oneTap, foeRank: capped,
  });
  eq(capped, foeRankOf('A-4') + BALANCE.rematch.rankCap, '재대련 상한 A-4 성');
  ok(hardened.win, `원터치 성 유저가 상한 강화 A-4 를 이긴다 (남은 HP 적 ${hardened.foeHp} / 유저 ${hardened.selfHp})`);
  console.log(`    A-4 상한 강화 시뮬(도전자 성 ${capped}): ${hardened.exchanges}수, `
    + `적 HP ${hardened.foeHp}, 유저 HP ${hardened.selfHp}`);
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

  function harnessInput({ pool, ranks = {}, mode = 'duel' }) {
    let clock = 0;
    const events = [];
    const input = createSequenceInput({
      pool,
      rankOf: (s) => ranks[s.id] ?? 1,
      hintDelayMs: BALANCE.hintDelayMs[mode],
      now: () => clock,
      remainingRatio: () => 0.5,
      log: (event, fields) => events.push({ event, ...fields }),
      screen: SCREEN[mode === 'train' ? 'train' : 'duel'].id,
    });
    input.arm();
    return { input, events, tick: (ms) => { clock += ms; }, ids: () => input.candidates.map((s) => s.id) };
  }

  const pool = [yuunBo, jeokUn, haengUn];

  // 정렬 = 성 높은 순 → 동률 슬롯 순 (REQ-102)
  const sorted = harnessInput({ pool, ranks: { 'jeok-un': BALANCE.rankMax } });
  deepEq(sorted.ids(), ['jeok-un', 'yuun-bo', 'haeng-un'], '성 높은 초식이 최상단');
  const tied = harnessInput({ pool });
  deepEq(tied.ids(), ['yuun-bo', 'jeok-un', 'haeng-un'], '성 동률이면 슬롯 순 (결정적)');

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
  const belowGate = harnessInput({ pool: [yuunBo], ranks: { 'yuun-bo': BALANCE.rankGate.oneTap - 1 } });
  belowGate.tick(BALANCE.hintDelayMs.duel);
  eq(belowGate.input.revealed(), 1, `${BALANCE.rankGate.oneTap - 1}성은 딜레이드 힌트를 유지한다 (REQ-712)`);
  const fullHint = harnessInput({ pool: [yuunBo], ranks: { 'yuun-bo': BALANCE.rankGate.oneTap } });
  eq(fullHint.input.revealed(), yuunBo.seq.length, `${BALANCE.rankGate.oneTap}성은 지연 없이 전 시퀀스 노출`);

  // 원터치 (REQ-713)
  const oneTap = harnessInput({ pool, ranks: { 'yuun-bo': BALANCE.rankGate.oneTap } });
  eq(oneTap.input.tap(jeokUn), null, `${BALANCE.rankGate.oneTap}성이 아니면 원터치 불가`);
  const tapped = oneTap.input.tap(yuunBo);
  eq(tapped.oneTap, true, '원터치 발동');
  eq(oneTap.events.at(-1).r, 0.5, '원터치 r 은 탭 시점 잔여 비율');
  eq(oneTap.input.tap(yuunBo), null, '발동 뒤 원터치도 잠긴다');

  // arm 이 그 창의 장착을 다시 읽는다
  const rearm = harnessInput({ pool: [yuunBo] });
  rearm.input.arm([yuunBo, jeokUn]);
  deepEq(rearm.ids(), ['yuun-bo', 'jeok-un'], 'arm(pool) 이 후보 집합을 갱신');
});

// ------------- 10-a. 케이스 3·4 — 죽간 상태 전이 (REQ-824·825·826)

suite('케이스 3·4 — 죽간 상태 전이 (REQ-824·825·826)', () => {
  const state = (prev, next) => tabletStates(prev, next).map((t) => `${t.id}:${t.state}`);

  // 매수 자체가 「좁혀진다」의 표현이라, 살아남은 매와 탈락한 매가 한 번에 갈린다.
  deepEq(state([], ['a', 'b', 'c', 'd']), ['a:enter', 'b:enter', 'c:enter', 'd:enter'],
    '첫 렌더의 네 매는 전부 enter');
  deepEq(state(['a', 'b', 'c', 'd'], ['b', 'd']), ['a:exit', 'b:hold', 'c:exit', 'd:hold'],
    '탈락한 매는 자기가 있던 자리에서 exit — 살아남은 매가 그 자리를 건너뛰지 않는다');
  deepEq(state(['b', 'd'], ['d']), ['b:exit', 'd:only'], '1매 = 확정이라 only 가 hold 를 덮는다');
  deepEq(state(['d'], ['d']), ['d:only'], '확정 상태는 재렌더에도 그대로다 (금테가 깜빡이지 않는다)');
  deepEq(state([], ['d']), ['d:only'], '갓 등장한 1매도 enter 가 아니라 확정이다');
  deepEq(state(['d'], ['a', 'b', 'c', 'd']), ['a:enter', 'b:enter', 'c:enter', 'd:hold'],
    '다음 초의 arm 은 남아 있던 매를 유지하고 나머지만 새로 세운다');
  deepEq(state(['a'], []), ['a:exit'], '후보가 비면 남은 매는 지워지지 않고 가라앉는다');

  // 실제 입력기가 좁히는 경로를 그대로 태운다 — 상태 계산이 후보 목록과 갈리면 여기서 죽는다.
  // 두 초식이 마지막 키에서만 갈리는 구성이라, 그 키 하나가 확정과 완주를 겸한다 (REQ-826).
  const pool = [
    { id: 's1', attr: 'fast', seq: ['D', 'R', 'U'], gugyeol: [], hanja: '', name: 's1' },
    { id: 's2', attr: 'hard', seq: ['D', 'R', 'L', 'U'], gugyeol: [], hanja: '', name: 's2' },
    { id: 's3', attr: 'fine', seq: ['D', 'L', 'R'], gugyeol: [], hanja: '', name: 's3' },
    { id: 's4', attr: 'fast', seq: ['D', 'U', 'R'], gugyeol: [], hanja: '', name: 's4' },
  ];
  const input = createSequenceInput({
    pool,
    rankOf: () => 1,
    hintDelayMs: BALANCE.hintDelayMs.duel,
    now: () => 0,
    remainingRatio: () => 1,
    log: () => {},
    screen: SCREEN.duel.id,
  });
  input.arm();

  const ids = () => input.candidates.map((st) => st.id);
  let drawn = [];
  const step = (dir) => {
    const result = dir === null ? { fired: null } : input.press(dir, 'keyboard');
    const next = ids();
    const drew = tabletStates(drawn, next);
    drawn = next;
    return { drew, fired: result.fired };
  };

  const armed = step(null);
  eq(armed.drew.length, 4, '장착 4식이 4매로 선다');
  ok(armed.drew.every((t) => t.state === TABLET.ENTER), '첫 장은 전부 enter');

  const first = step('D');
  eq(first.drew.filter((t) => t.state === TABLET.HOLD).length, 4, '공통 접두어 ↓ 는 아무도 떨구지 않는다');

  const narrowed = step('R');
  eq(narrowed.drew.filter((t) => t.state === TABLET.EXIT).length, 2, '→ 로 두 매가 탈락한다');
  deepEq(narrowed.drew.filter((t) => t.state === TABLET.HOLD).map((t) => t.id), ['s1', 's2'],
    '4매 → 2매 — 남은 후보만 hold 로 이어진다 (spec 수용 케이스 3)');
  eq(narrowed.fired, null, '2매 구간에서는 아직 발동하지 않는다');

  const confirmed = step('U');
  deepEq(confirmed.drew, [{ id: 's1', state: TABLET.ONLY }, { id: 's2', state: TABLET.EXIT }],
    '2매 → 1매 — 마지막 키가 확정과 완주를 겸해도 그 매는 only 로 그려진다 (spec 수용 케이스 4)');
  ok(confirmed.fired !== null && confirmed.fired.style.id === 's1',
    '같은 키가 초식을 발동시킨다 — 그래서 확정 연출에 최소 표시 시간이 필요하다 (REQ-826)');
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
    const unreachable = [...BOT_UNREACHABLE, ...BROWSER_ONLY];
    const missing = Object.keys(LOG_SCHEMA).filter((event) => !emitted.has(event) && !unreachable.includes(event));
    // REQ-601 최종 검증 — 실제 1사이클에서 전 종류가 나오지 않으면 kill 산식에 구멍이 있다.
    deepEq(missing, [], `시드 ${SEEDS[i]} — 통합 로그 ${Object.keys(LOG_SCHEMA).length - unreachable.length}종 전량 emit`);

    const metrics = readout(payload);
    eq(metrics.aux.tester_role, 'bot', `시드 ${SEEDS[i]} — tester_role 이 봇으로 남는다`);
    ok(metrics.kill.a_first_fire_ms > 0, `시드 ${SEEDS[i]} — first_fire_t 가 가상 시계로 찍힌다`);
    eq(metrics.kill.d_cycle_done_ms, run.elapsedMs, `시드 ${SEEDS[i]} — cycle_done_t = 사이클 총 시간`);
    ok(metrics.kill.b_hand_fires + metrics.kill.b_timeouts > 0,
      `시드 ${SEEDS[i]} — 실전 창 완주율의 분모가 비어 있지 않다`);
    // 표본 하한 아래로 내려가면 (b) 는 판독 불가가 되는데 판독기 종료 코드는 그것을 red 로 만들지 않는다.
    ok(metrics.kill.b_manual_windows >= KILL.minManualWindows,
      `시드 ${SEEDS[i]} — 수동 창 표본이 하한 ${KILL.minManualWindows} 이상이라 (b) 가 판독된다`);
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

// ---- 14-a. 사이클 시뮬 (REQ-711·713·603) — 유효 성공률 시나리오별 구간 산출

/**
 * 유효 성공률 시나리오 (#38) — 손 정확도 시드가 그 축의 유일한 입력이라, 두 값은
 * 「이 봇이 그 성공률을 내는 `missRate`」의 실측 역산이다 (아래 출력의 실현 성공률로 확인된다).
 */
const RATE_SCENARIOS = [{ label: '70%', missRate: 0.085 }, { label: '50%', missRate: 0.18 }];
const SIM_SEEDS = [20260901, 20260902, 7919, 104729, 1299709, 31337, 15485863, 2718281,
  161803, 577, 9973, 42];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

suite('사이클 시뮬 — 해금 · 원터치 · 12성 · cycle_done (REQ-711·713·603)', () => {
  for (const scenario of RATE_SCENARIOS) {
    const runs = SIM_SEEDS.map((seed) => {
      const run = runHeadlessCycle({
        random: createSeededRandom(seed),
        paceSeed: { ...BALANCE.bot, missRate: scenario.missRate },
      });
      const entries = exportPayload(run.session).entries;
      const at = (pred) => entries.find(pred)?.[TIME_FIELD] ?? null;
      const duelVerdicts = entries.filter((e) => e.event === 'verdict' && e.who === 'user');
      const masterRank = (e) => e.event === 'rank' && e.actor === 'master';
      return {
        seed,
        unlock: at((e) => e.event === 'unlock'),
        oneTap: at((e) => masterRank(e) && e.to === BALANCE.rankGate.oneTap),
        finishStep: at((e) => masterRank(e) && e.via === 'finish'),
        twelve: at((e) => masterRank(e) && e.to === BALANCE.rankMax),
        transmit: at((e) => e.event === 'transmit'),
        done: run.elapsedMs,
        screens: run.screens,
        wins: entries.filter((e) => e.event === 'coins' && e.reason === 'duel_win').length,
        // 재대련 회차 분포 — A-4 가 세운 무대를 손이 몇 번이나 다시 밟는지의 관측치 (REQ-734).
        rematches: entries.filter((e) => e.event === 'rematch').length,
        deepest: entries.filter((e) => e.event === 'rematch')
          .reduce((m, e) => Math.max(m, e.attempt_n), 0),
        rate: duelVerdicts.filter((e) => isEffectiveSuccess(e.grade)).length / duelVerdicts.length,
      };
    });

    for (const run of runs) {
      // 순서가 곧 계단 규칙이다 (REQ-704·711) — 어긋나면 순차·비소급이 새고 있다는 뜻이다.
      ok(run.unlock !== null, `${scenario.label} 시드 ${run.seed} — 해금 이벤트가 남는다`);
      ok(run.oneTap > run.unlock, `${scenario.label} 시드 ${run.seed} — 원터치 성은 해금 뒤`);
      ok(run.finishStep > run.oneTap, `${scenario.label} 시드 ${run.seed} — 결정타 계단은 원터치 뒤`);
      ok(run.twelve >= run.finishStep, `${scenario.label} 시드 ${run.seed} — 12성은 결정타 계단 뒤`);
      ok(run.transmit > run.twelve, `${scenario.label} 시드 ${run.seed} — 전수는 12성 뒤`);
      ok(run.wins >= DUEL_A_STAGES, `${scenario.label} 시드 ${run.seed} — A 전 차수 승리 도달`);
    }

    const secs = (key) => `${(median(runs.map((r) => r[key])) / 1000).toFixed(0)}s`;
    const span = (key) => `${(Math.min(...runs.map((r) => r[key])) / 1000).toFixed(0)}~`
      + `${(Math.max(...runs.map((r) => r[key])) / 1000).toFixed(0)}s`;
    console.log(`    ${scenario.label} 시나리오 (실현 ${(median(runs.map((r) => r.rate)) * 100).toFixed(0)}%): `
      + `해금 ${secs('unlock')} · 원터치 ${secs('oneTap')} · 12성 ${secs('twelve')} · `
      + `cycle_done ${secs('done')} [${span('done')}] · 화면 최대 ${Math.max(...runs.map((r) => r.screens))} · `
      + `재대련 진입 ${median(runs.map((r) => r.rematches))}회 (최심 ${Math.max(...runs.map((r) => r.deepest))}번째 대면)`);
  }
  // kill 임계는 여기서 단정하지 않는다 — required check 라 시드 튜닝만으로 이후 PR 이 전부 막힌다.
});

// ------- 14-b. 손 굶주림 회귀 (REQ-704·731) — 계단이 아닌 초식도 창을 얻는가

/**
 * 「이기는 색」 동률을 슬롯 순으로 깨면 같은 속성의 앞 슬롯이 창을 독점해 뒤 초식이 적립에서
 * 굶는다 — A-4 의 예고에 강(α)이 하나뿐이라 쾌 두 초식(유운보·파운현월)이 정확히 그 자리에 선다.
 * 아래 6시드는 그 고착으로 사이클이 화면 상한을 넘던 실측 표본이다 (L5d 적대 리뷰 지적).
 */
suite('손 굶주림 회귀 — 계단 밖 초식의 적립 (REQ-704·731)', () => {
  const STARVED_SEEDS = [99, 153, 155, 318, 387, 496];
  for (const seed of STARVED_SEEDS) {
    const session = createSession({ now: () => 0 });
    let screens = null;
    try {
      ({ screens } = runHeadlessCycle({ session, random: createSeededRandom(seed) }));
    } catch (err) {
      failures += 1;
      console.error(`  ✗ 시드 ${seed} — ${err.message}`);
    }
    ok(screens !== null, `시드 ${seed} — 1사이클이 화면 상한 안에서 끝난다`);
    const ranks = STYLES.map((st) => styleRank(session.progress, st.id));
    deepEq([...new Set(ranks)], [BALANCE.rankMax],
      `시드 ${seed} — 전 초식이 12성에 닿는다 (성 ${ranks.join('/')})`);
  }
  // 굶주림의 판별자는 「낸 초식의 분포」다 — 어느 초식도 사이클 전체에서 한 자릿수로 밀리지 않는다.
  const probe = createSession({ now: () => 0 });
  runHeadlessCycle({ session: probe, random: createSeededRandom(STARVED_SEEDS[0]) });
  const fired = probe.log.entries.filter((e) => e.event === 'fire');
  for (const style of STYLES) {
    const n = fired.filter((e) => e.styleId === style.id).length;
    ok(n >= BALANCE.rankMax, `${style.name} 이 사이클에서 ${n}회 발동 — 적립에 필요한 창을 얻는다`);
  }
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
    rankOf: () => 1,
    hintDelayMs: 0,
    now: () => 0,
    log: (event, fields) => logEvent(session, event, fields),
    screen: SCREEN.train.id,
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
    'src/ui/screens/dispatch.mjs': ['composeHooks', 'dispatchWiring', 'logDispatchAbort', 'logDispatchResult'],
    'src/bot.mjs': ['composeHooks', 'dispatchWiring', 'duelWiring', 'logDispatchResult', 'trainWiring'],
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

// --------------------------------- 12-a-2. 원장 판독 층 (#132)

suite('원장 ms 판독은 한 벌 (#132)', () => {
  // 수기 열거는 새로 생긴 모듈을 조용히 놓치므로 트리를 훑는다 — 모양이 아니라 전량이 모집단이다.
  const walk = (rel) => readdirSync(new URL(`../${rel}`, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]))
    .filter((path) => path.endsWith('.mjs'));
  // 주석·JSDoc 의 심볼 언급은 판독이 아니다 — required check 를 오탐으로 막지 않게 코드만 센다.
  // 과다 제거는 아래 건수 1 단정이 0 으로 무너뜨려 잡는다.
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const srcFiles = walk('src').sort();
  // 훑기가 비면 아래 집합·⊆ 단정이 전부 공허하게 통과한다 — 하한이 그 갈래를 막는다.
  ok(srcFiles.length >= 20, `src/ 의 .mjs 를 실제로 훑었다 — ${srcFiles.length}개`);

  // (I1) 커스텀 속성은 `getPropertyValue` 로만 읽히므로 이 토큰이 판독기의 전 모집단이다.
  const readers = srcFiles.filter((path) => read(path).includes('getPropertyValue'));
  deepEq(readers, ['src/ui/dom.mjs'], '원장 판독기는 dom.mjs 한 벌뿐이다');
  // 부재 단정만 두면 「전부 지웠다」도 통과한다 — 건수 1 이 그 공허 통과를 막는 양성 대조다.
  const readCount = srcFiles
    .reduce((n, path) => n + (read(path).match(/getPropertyValue/g) ?? []).length, 0);
  eq(readCount, 1, '그 한 벌이 실재한다 — 판독 출현 건수');

  // 조용한 0 으로 접히는 폴백이 정본으로 되돌아오면 무음 실패의 원천이 되살아난다.
  // 모집단은 함수 본문뿐 — 모듈 전체를 물면 무관한 `|| 0` 한 줄이 후속 PR 을 상시 막는다.
  const domSource = readFileSync(new URL('../src/ui/dom.mjs', import.meta.url), 'utf8');
  const ledgerBody = domSource.match(/export function ledgerMs\([\s\S]*?\n}/)?.[0];
  ok(ledgerBody, 'dom.mjs 가 ledgerMs 를 함수 선언으로 export 한다');
  ok(!/\|\|\s*0\b/.test(ledgerBody ?? '||0'), 'ledgerMs 본문에 `|| 0` 폴백이 없다');
  ok(/throw new Error\(/.test(ledgerBody ?? ''), '형식 위반이 그 자리에서 죽는다');

  // (I1′) 부팅 전건 검사의 모집단은 이 목록이라, 목록 밖 토큰은 검사받지 않은 채 연출에서 읽힌다.
  const listedBlock = domSource.match(/export const LEDGER_MS =[^[]*\[([^\]]*)\]/);
  ok(listedBlock, 'dom.mjs 가 LEDGER_MS 목록을 리터럴 배열로 export 한다');
  const listed = [...(listedBlock?.[1] ?? '').matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]);
  // 중복 이름은 부팅의 `Object.fromEntries` 에서 조용히 접힌다 — 목록이 곧 검사 모집단이라 문다.
  eq(new Set(listed).size, listed.length, 'LEDGER_MS 에 중복 토큰이 없다');

  const uiFiles = srcFiles.filter((path) => path.startsWith('src/ui/'));
  const called = uiFiles
    .flatMap((path) => [...read(path).matchAll(/\bledgerMs\('(--[\w-]+)'\)/g)].map((m) => m[1]));
  // ⊆ 는 호출 0건에서도 참이다 — 호출 실재가 그 짝의 양성 대조다.
  ok(called.length >= 1, `이름을 박은 판독 호출이 실재한다 — ${called.length}건`);
  deepEq([...new Set(called)].filter((name) => !listed.includes(name)), [],
    '목록 밖 토큰을 읽는 호출이 없다');

  // 리터럴만 세면 `ledgerMs(t)` 같은 간접 호출이 ⊆ 를 공허하게 통과해, 목록 밖 토큰이 검사를
  // 건너뛴 채 연출 도중 throw 한다 — 이 스위트가 없애려는 바로 그 경로다. 계수로 loud fail 시킨다.
  const callSites = uiFiles.reduce((n, path) => n
    + (read(path).replace(/^import[\s\S]*?';$/gm, '').replace(/export function ledgerMs\(/, '')
      .match(/\bledgerMs\(/g) ?? []).length, 0);
  eq(callSites, called.length + 1,
    '리터럴 밖 호출은 부팅 전건 읽기 하나뿐이다 — 그 하나가 목록 자체를 인자로 돈다');

  // 목록은 부팅 단정이 실제로 소비해야 뜻이 있다 — 미소비 목록은 위 ⊆ 를 장식으로 만든다.
  ok(/\bLEDGER_MS\b[\s\S]{0,80}?\bledgerMs\(/.test(read('src/ui/app.mjs')),
    '부팅이 LEDGER_MS 전건을 ledgerMs 로 읽는다');

  // 목록에만 오르고 원장에 없는 토큰은 이제 「연출 하나 소실」이 아니라 부팅 사망이다 —
  // 그 실패를 브라우저가 아니라 이 자리에서 낸다. 원장 핀의 선례는 12-c 의 `.verdict-pop` 규칙.
  const ledgerHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const name of listed) {
    ok(new RegExp(`\\n\\s*${name}:\\s*\\d+(\\.\\d+)?ms\\s*;`).test(ledgerHtml),
      `${name} 이 :root 에 ms 값으로 선언돼 있다`);
  }
});

// ------------------------- 12-a-3. 크롬 조립 계약 — 띠 원장 · 히트 축 · 포커스 소유 (#133)

suite('크롬 원장은 한 토큰 한 값 (#133)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // (I2) 두 띠가 같은 토큰을 쓰는가. 규칙 블록을 떼어내지 못하면 아래 부재 단정이 전부 공허하게
  // 참이 되므로, 블록 실재 → 토큰 실재 → px 리터럴 부재 순으로 물린다.
  // 첫 블록만 떼어내면 뒤에 온 같은 선택자의 재정의가 캐스케이드로 이기고도 핀을 통과한다.
  const heads = (sel) => (html.match(new RegExp(`^\\${sel} \\{`, 'gm')) ?? []).length;
  for (const sel of ['.top-band', '.stage-band']) {
    const block = html.match(new RegExp(`^\\${sel} \\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1];
    ok(block, `${sel} 규칙 블록을 실제로 떼어냈다`);
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
    ok(/height:\s*var\(--band-h\)/.test(block ?? ''), `${sel} 의 높이가 --band-h 다`);
    ok(!/(^|[;\s])height:\s*\d/.test(block ?? ' height: 1'), `${sel} 에 px 리터럴 높이가 없다`);
  }

  // (I3) 히트 축 44 의 정본은 `--hit-min` 하나다. 경계 인식이 없으면 `-144px` 같은 부분 문자열이
  // 히트로 잡혀, 이름 열거 예외 목록을 달게 되고 그 목록이 토큰마다 낡는다.
  const HIT44 = /(?<![\d-])44px/g;
  const rootAt = html.match(/^:root \{[\s\S]*?\n\}/m);
  ok(rootAt, ':root 블록을 실제로 떼어냈다');
  const rootBlock = rootAt?.[0] ?? '';
  // 양성 대조 — 모집단이 0 으로 접히면 아래 둘이 먼저 무너진다. 절대 계수를 박지 않는 것은
  // 무관한 토큰(판정 시프트·낙관 좌표)이 44 를 쓰기 시작하면 핀이 래칫 카운터로 퇴화해서다.
  ok((rootBlock.match(HIT44) ?? []).length >= 1, ':root 의 44px 리터럴을 경계 인식 검색이 실제로 문다');
  ok(/--hit-min:\s*44px/.test(rootBlock), '히트 축 44 의 정본은 --hit-min 이다');
  // 경계가 실제로 걸러내는지 — `--watch-y: -144px` 는 44px 리터럴이 아닌데 부분 문자열로는 걸린다.
  ok(/--watch-y:\s*-144px/.test(rootBlock), '부분 문자열로만 걸리는 토큰이 :root 에 실재한다');
  ok((rootBlock.match(/44px/g) ?? []).length > (rootBlock.match(HIT44) ?? []).length,
    '경계 인식이 그 부분 문자열 히트를 실제로 걸러낸다');

  // 추출이 빗나갔을 때 예외로 죽으면 아래 단정이 통째로 건너뛰어진다 — 계수로 red 를 낸다.
  const outside = rootAt ? html.slice(0, rootAt.index) + html.slice(rootAt.index + rootBlock.length) : '';
  ok(outside.length > 1000, `:root 밖 모집단이 실재한다 — ${outside.length}자`);
  deepEq(outside.match(HIT44) ?? [], [], ':root 밖에 44px 리터럴이 없다');
  // 부재만 두면 「그 규칙을 통째로 지웠다」도 통과한다 — 치환이 실제로 앉았음을 함께 문다.
  // 계수 문턱은 선재 호출부가 이미 채워 부분 소실을 못 본다: 세 자리를 이름으로 하나씩 문다.
  for (const sel of ['.row-head', '.tele-attr', '.cand']) {
    const block = outside.match(new RegExp(`^\\${sel} \\{([\\s\\S]*?)\\n?\\}`, 'm'))?.[1];
    ok(block, `${sel} 규칙 블록을 실제로 떼어냈다`);
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
    ok(/var\(--hit-min\)/.test(block ?? ''), `${sel} 의 히트 축이 --hit-min 이다`);
  }

  // 두 원장이 만나는 자리 — 실효 히트는 `min(buttonHitPx, --band-h)` 이고 REQ-910 하한은
  // `--hit-min` 이다. 어느 한쪽만 내려도 확장 상자가 조용히 44 밑으로 잘리므로 셋을 함께 문다.
  const px = (name) => Number(rootBlock.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]);
  const hitMin = px('--hit-min'); const bandH = px('--band-h');
  ok(Number.isFinite(hitMin) && Number.isFinite(bandH),
    `원장에서 두 값을 실제로 읽었다 — --hit-min ${hitMin} · --band-h ${bandH}`);
  ok(hitMin <= bandH, `띠가 확장 상자를 하한 밑으로 자르지 않는다 — ${hitMin} <= ${bandH}`);
  ok(hitMin <= BALANCE.buttonHitPx,
    `주입 히트 크기가 하한을 밑돌지 않는다 — ${hitMin} <= ${BALANCE.buttonHitPx}`);
});

// 원장 축과 스위트를 가르는 것은 격리다 — 한쪽 추출이 무너져도 다른 축의 단정이 함께 침묵하지 않는다.
suite('화면 모듈은 포커스를 직접 조작하지 않는다 (#133)', () => {
  // (I4) 재렌더 포커스의 소유는 `dom.mjs` 의 `composeScreen` 한 곳이다. 화면이 자기 손으로
  // 되돌리면 id 가 전이하는 경로에서 헛돌고, 그 헛돎이 화면마다 따로 재발한다.
  // 모집단은 화면 모듈뿐 — `composeScreen` 의 소유 호출은 이 계약의 정본이라 의도적으로 밖이다.
  const screensDir = new URL('../src/ui/screens/', import.meta.url);
  const screens = readdirSync(screensDir).filter((name) => name.endsWith('.mjs')).sort();
  ok(screens.length >= 7, `화면 모듈을 실제로 훑었다 — ${screens.length}개`);
  // 주석의 언급은 조작이 아니다. 과다 제거는 아래 건수 단정이 0 으로 무너뜨려 잡는다.
  const read = (name) => readFileSync(new URL(name, screensDir), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 옵셔널 체이닝 유무와 무관하게 물어야 한다 — `node.focus()` 로 쓴 복원은 `?.focus()` 패턴을
  // 그대로 빠져나간다. 계약의 정본(`main.focus(...)`)이 바로 그 형태다.
  const TOUCH = /\.focus\(|activeElement/g;
  const touched = screens.filter((name) => (read(name).match(TOUCH) ?? []).length > 0);
  deepEq(touched.map((name) => `src/ui/screens/${name}`), ['src/ui/screens/select.mjs'],
    '포커스를 직접 조작하는 화면은 select 하나뿐이다');
  // 집합은 파일 단위로 접히므로 한 파일 안의 재발을 못 본다 — 출현 건수가 그 짝의 양성 대조다.
  const touches = screens.reduce((n, name) => n + (read(name).match(TOUCH) ?? []).length, 0);
  eq(touches, 2, '그 한 곳이 실재한다 — 조작 출현 건수(activeElement 1 · focus 1)');
});

// ------------------------- 12-a-4. 실루엣 배경 — 단축이 이미지를 되돌리지 않는가 (#137)

suite('실루엣 규칙은 background 단축을 쓰지 않는다 (#137)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // 모집단 = 선택자에 `.fig` 나 `.part` 가 든 선언 블록 전부 — 실루엣 이미지를 덮을 수 있는 자리는
  // 그 둘을 맞히는 규칙뿐이고, 파츠만 보면 자세 쪽 같은 클래스의 재발을 못 본다 (#137).
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => [m[1].trim(), m[2]])
    .filter(([sel]) => /(^|[\s,>+~])\.(fig|part)\b/.test(sel));
  const heads = (sel) => rules.filter(([s]) => s === sel).length;

  // 양성 대조 ① — 추출이 실패해 모집단이 비면 아래 부재 단정이 공허하게 참이 된다.
  ok(rules.length >= 20, `.fig · .part 계열 규칙을 실제로 떼어냈다 — ${rules.length}건`);
  // 양성 대조 ② — 덮일 대상인 실루엣 이미지 선언이 실재하는가. 이름으로 물어 부분 소실도 잡는다.
  // 실패하면 자세·파츠가 늘거나 줄었다는 뜻이니, 아래 목록을 실제 납품분으로 맞춰라.
  deepEq(rules.filter(([, body]) => /background-image:/.test(body)).map(([sel]) => sel).sort(), [
    '.fig.sil_challenger_prone', '.fig.sil_challenger_stance', '.fig.sil_disciple_dojo',
    '.fig.sil_disciple_stance', '.fig.sil_master_dojo', '.fig.sil_master_prone',
    '.fig.sil_master_stance', '.fig.sil_master_watch',
    '.part.sil_disciple_follow_arm', '.part.sil_disciple_follow_body',
    '.part.sil_master_demo_arm', '.part.sil_master_demo_body',
  ], '납품된 자세 8 · 파츠 4 의 background-image 선언이 실재한다');

  // 부재 단정 — 단축은 명시 안 한 하위 속성을 initial 로 되돌리므로, 이미지 선언 규칙을 특이도나
  // 순서로 이기는 순간 그 이미지가 none 이 된다. 경계 인식이 없으면 `background-image:` 를 물어 공허해진다.
  const SHORTHAND = /(^|[;{\s])background\s*:/;
  deepEq(rules.filter(([, body]) => SHORTHAND.test(body)).map(([sel]) => sel), [],
    '.fig · .part 계열에 background 단축이 없다');
  // 부재만 두면 「규칙을 통째로 지웠다」도 통과한다 — 풀어 쓴 개별 속성이 실제로 앉았음을 함께 문다.
  // 머리 계수가 없으면 뒤에 온 같은 선택자의 재정의가 캐스케이드로 이기고도 첫 블록으로 통과한다.
  for (const sel of ['.fig', '.fig > .part']) {
    const block = rules.find(([s]) => s === sel)?.[1] ?? '';
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
    ok(/background-position:\s*center bottom/.test(block), `${sel} 의 배치가 개별 속성으로 남아 있다`);
    ok(/background-size:\s*contain/.test(block) && /background-repeat:\s*no-repeat/.test(block),
      `${sel} 의 크기·반복이 개별 속성으로 남아 있다`);
  }
});

// ------------------------- 12-a-5. 죽간 탈락 좌표의 기준 상자 (#138)

suite('흐름에서 뺀 죽간은 매수 불변 상자를 기준으로 선다 (#138)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const heads = (sel) => rules.filter(([s]) => s === sel).length;
  const body = (sel) => rules.find(([s]) => s === sel)?.[1] ?? null;

  // ① 모집단 — 흐름 밖으로 나가는 매가 실재해야 아래 좌표 단정이 공허하지 않다.
  const narrowed = tabletStates(['a', 'b', 'c'], ['a']);
  deepEq(narrowed.map((t) => `${t.id}:${t.state}`), ['a:only', 'b:exit', 'c:exit'],
    '3매에서 한 매만 남으면 두 매가 자기 자리에서 흐름 밖으로 나간다');

  // ② 그 두 매가 서는 좌표계를 이루는 규칙이 실재한다. 추출이 빗나가면 아래가 전부 공허해진다.
  for (const sel of ['.slip-row', '.tablets', '.slip', '.slip.out']) {
    ok(body(sel), `${sel} 규칙 블록을 실제로 떼어냈다`);
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
  }
  ok(/position:\s*absolute/.test(body('.slip.out') ?? ''), '가라앉는 매는 흐름 밖으로 나간다');

  // ③ 기준 상자 대조 — absolute 의 포함 블록은 가장 가까운 positioned **조상**이므로, 모집단은
  // `.slip.out` 자신이 아니라 그 위 사슬(`.slip-row` > `.tablets`)이다. 죽간 줄 쪽은 이름이 아니라
  // **선택자 매칭**으로 잡는다 — 합성·그룹 선택자(`.pad.bot .tablets`)로 한 줄 들어와도 기준이
  // 그 줄로 돌아가는데, 완전 일치 조회는 그 갈래를 통째로 못 본다.
  const POSITIONED = /(^|[;{\s])position\s*:\s*(relative|absolute|fixed|sticky)/i;
  const tabletsRules = rules.filter(([sel]) => /(^|[\s,>+~])\.tablets\b/.test(sel));
  ok(tabletsRules.length >= 2, `죽간 줄을 겨누는 규칙을 실제로 떼어냈다 — ${tabletsRules.length}건`);
  deepEq(tabletsRules.filter(([, b]) => POSITIONED.test(b)).map(([sel]) => sel), [],
    '죽간 줄을 positioned 로 만드는 규칙이 없다');
  ok(POSITIONED.test(body('.slip-row') ?? ''), '탈락 매의 기준 상자는 .slip-row 다');

  // 포함 블록을 만드는 축은 `position` 하나가 아니다 — `transform` 계열이 붙으면 CSS 어디에도
  // `position` 이 없는 채로 포함 블록만 죽간 줄로 되돌아가고, JS 가 재는 기준은 그대로라 같은
  // 어긋남이 재발한다. 그 재발은 이름으로 찾을 단서가 없어 여기서 문다.
  const CONTAINING = /(^|[;{\s])(transform|filter|backdrop-filter|will-change|contain)\s*:/i;
  deepEq(tabletsRules.filter(([, b]) => CONTAINING.test(b)).map(([sel]) => sel), [],
    '죽간 줄에 포함 블록을 만드는 속성이 없다');

  // ④ 차이 단정 — 죽간 줄은 매수마다 폭이 갈리고, 가운데 정렬이라 그 차이의 절반이 곧 원점 이동이다.
  // 그것이 이 줄을 좌표 기준에서 뺀 이유다. 값은 시각 원장(:root)에서 읽어 계단이 바뀌면 함께 움직인다.
  const rootBlock = css.match(/^:root \{[\s\S]*?\n\}/m)?.[0];
  ok(rootBlock, ':root 블록을 실제로 떼어냈다');
  const px = (name) => Number(rootBlock?.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]);
  const gap = px('--slip-gap');
  const stepW = [1, 2, 3].map((n) => px(`--slip-w${n}`));
  ok([gap, ...stepW].every(Number.isFinite), `폭 계단과 간격을 원장에서 실제로 읽었다 — ${stepW} / ${gap}`);
  const rowW = (n) => n * stepW[n - 1] + (n - 1) * gap;
  eq(new Set([1, 2, 3].map(rowW)).size, 3, '매수마다 죽간 줄의 폭이 갈린다 — 원점이 매수를 따라 움직인다');
  // 이동량 자체는 원장이 정하므로 값을 박지 않는다 — 박으면 죽간 폭을 조정한 무관한 PR 이 red 가 된다.
  ok((rowW(3) - rowW(1)) / 2 > 0, `3매 → 1매에서 죽간 줄의 원점이 ${(rowW(3) - rowW(1)) / 2}px 움직인다`);

  // ⑤ 동일 단정 (회귀) — 기준 상자를 옮겨도 3매의 시각 결과는 그대로여야 한다. 그 결과를 정하는
  // 것은 폭 계단과 두 겹의 가운데 정렬뿐이므로, 셋이 제자리에 있으면 3매 화면은 변하지 않는다.
  for (const sel of ['.slip-row', '.tablets']) {
    ok(/justify-content:\s*center/.test(body(sel) ?? ''), `${sel} 이 자기 내용을 가운데로 모은다`);
  }
  ok(!/(^|[;{\s])width:/.test(body('.tablets') ?? ''), '죽간 줄은 자기 폭을 박지 않는다 — 폭은 매수의 것이다');
  for (const n of [1, 2, 3]) {
    eq(heads(`.tablets[data-n="${n}"] .slip`), 1, `${n}매의 폭 계단 규칙이 하나 있다`);
  }
  // 기준 상자가 매수 축을 다시 물면 같은 결함이 되돌아온다 — 그 축을 읽는 선택자가 이 행에 없다.
  deepEq(rules.map(([sel]) => sel).filter((sel) => /\[data-n=/.test(sel) && /\.slip-row/.test(sel)), [],
    '매수를 읽는 선택자가 .slip-row 를 겨누지 않는다');
  ok(!/--slip-w/.test(body('.slip-row') ?? ''), '.slip-row 의 폭 결정자에 매수 계단이 없다');
});

// ------------------------- 12-a-6. 도장 초식 행 — 이름은 한 줄, 양보는 말줄임으로 (#139)

suite('초식명·한자는 행에서 폭을 양보하지 않는다 (#139)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const heads = (sel) => rules.filter(([s]) => s === sel).length;
  const body = (sel) => rules.find(([s]) => s === sel)?.[1] ?? null;

  // ① 폭 예산의 한쪽 끝은 배지 문구가 정한다. 도장 화면은 하네스가 import 하지 않으므로(DOM 접촉이
  // 허용된 자리다) 선언 원문에서 라벨의 정적 텍스트를 떼어내 문다.
  const dojo = readFileSync(new URL('../src/ui/screens/dojo.mjs', import.meta.url), 'utf8');
  const label = dojo.match(/^const rankLabel = \([^)]*\) =>(.+?);\s*(?:\/\/.*)?$/m);
  ok(label, 'dojo.mjs 가 rankLabel 을 한 줄 선언으로 둔다');
  const literals = [...(label?.[1] ?? '').matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  eq(literals.length, 1, '성 라벨은 갈래 없이 템플릿 하나로 정해진다');
  eq((literals[0] ?? '').replace(/\$\{[^}]*\}/g, ''), '성',
    '배지 문구는 성 수와 「성」 한 글자뿐이다 — 문구가 길어지면 그 행이 다시 접힌다');
  // 선언만 물면 호출부에서 다시 이어 붙이는 갈래가 그대로 통과한다 — 문구는 라벨이 낸 그대로 쓰인다.
  ok(!/\$\{\s*rankLabel\(/.test(dojo) && !/rankLabel\([^)]*\)\s*\+/.test(dojo),
    '호출부가 라벨에 문구를 이어 붙이지 않는다');
  // 부재 단정만 두면 「배지를 통째로 지웠다」도 통과한다 — 호출 실재가 그 양성 대조다.
  eq((dojo.match(/\brankLabel\(/g) ?? []).length, 2, '접힌 행의 배지와 성 계단이 그 라벨을 쓴다');
  // 이름이 다시 인터랙티브해지면 행마다 포커스 정지점과 낭독 한 줄이 함께 되돌아온다 (#165).
  ok(/el\('div', \{ class: 'row-name' \}/.test(dojo), '행 이름 상자는 정적 div 다');
  ok(!/aria-expanded/.test(dojo), '도장에 펼침 상태를 낭독하는 속성이 없다');
  // 축약이 성립하는 것은 만성 문구를 다른 자리가 지기 때문이다 — 그 자리가 사라지면 문구가 게임에서 소멸한다.
  const duel = readFileSync(new URL('../src/ui/screens/duel.mjs', import.meta.url), 'utf8');
  ok(/완벽히 깨달음/.test(duel), '만성 문구는 성이 오르는 순간의 대련 토스트가 진다');

  // ② 행 이름 상자를 이루는 규칙이 실재한다. 추출이 빗나가면 아래가 전부 공허해진다.
  const NAME_KIDS = '.row-name > b, .row-name > .hj';
  const YIELDERS = '.row-name > .badge, .row-name > .tag';
  for (const sel of ['.row-name', NAME_KIDS, YIELDERS, '.row-head', '.row-head button']) {
    ok(body(sel), `${sel} 규칙 블록을 실제로 떼어냈다`);
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
  }
  ok(/white-space:\s*nowrap/.test(body(NAME_KIDS) ?? '')
    && /flex-shrink:\s*0/.test(body(NAME_KIDS) ?? ''),
    '초식명·한자는 줄바꿈도 압축도 하지 않는다');

  // ③ 부재 단정의 모집단은 이름이 아니라 **선택자 매칭**이다 — 합성·그룹 선택자로 한 줄 들어와도
  // 같은 결함이 되돌아오는데, 완전 일치 조회는 그 갈래를 통째로 못 본다.
  // `div.row-name`·`.row-name.done` 같은 합성 형태는 앞 문자가 공백류가 아니라, 공백류만 보면
  // 그 갈래를 통째로 놓친다.
  const rowName = rules.filter(([sel]) => /(^|[\s,>+~]|[\w\])])\.row-name\b/.test(sel));
  ok(rowName.length >= 3, `.row-name 을 겨누는 규칙을 실제로 떼어냈다 — ${rowName.length}건`);
  // `white-space` 는 `text-wrap-mode` 의 단축이라 뒤에 온 `text-wrap: wrap` 한 줄이 nowrap 을 무력화한다.
  const WRAPS = /(white-space|text-wrap(-mode)?):\s*(normal|wrap|pre-wrap|pre-line|break-spaces)/;
  deepEq(rowName.filter(([, b]) => WRAPS.test(b)).map(([sel]) => sel), [],
    '.row-name 계열에 줄바꿈을 되살리는 선언이 없다');
  // `flex` 단축은 명시하지 않은 shrink 를 1 로 되돌린다 — 이름·한자에 붙는 순간 압축이 되살아난다.
  deepEq(rowName.filter(([, b]) => /(^|[;{\s])flex\s*:/.test(b)).map(([sel]) => sel), ['.row-name'],
    'flex 단축은 행 이름 상자 자신에만 있다');
  // 개별 속성으로 압축을 되살리는 갈래는 단축 필터에 걸리지 않는다 — 이름·한자를 겨누는 자리에만 문다.
  deepEq(rowName.filter(([sel, b]) => /(b|\.hj)\s*$/.test(sel.split(',').pop() ?? '')
    && /flex-shrink:\s*[1-9]/.test(b)).map(([sel]) => sel), [],
    '이름·한자의 flex-shrink 를 되살리는 규칙이 없다');

  // ④ 차이 단정 — 폭이 모자랄 때 양보하는 쪽은 배지·태그이고, 그 양보는 줄바꿈이 아니라 말줄임이다.
  // 플렉스 자식의 기본 min-width:auto 가 남아 있으면 nowrap 텍스트가 줄지 않아 말줄임이 발화하지 않는다.
  const yielders = body(YIELDERS) ?? '';
  for (const decl of ['min-width: 0', 'white-space: nowrap', 'overflow: hidden', 'text-overflow: ellipsis']) {
    ok(new RegExp(decl.replace(': ', ':\\s*')).test(yielders), `배지·태그가 ${decl} 을 갖춘다`);
  }
  // 단일 블록만 보면 다른 규칙 한 줄이 양보를 멈추는 갈래를 못 본다 — 여기서도 모집단은 선택자 매칭이다.
  deepEq(rowName.filter(([sel, b]) => /(\.badge|\.tag)\s*$/.test(sel.split(',').pop() ?? '')
    && /flex-shrink:\s*0/.test(b)).map(([sel]) => sel), [],
    '양보하는 쪽의 압축을 막는 규칙이 없다');

  // ⑤ 동일 단정 (회귀) — 행 높이 40 은 시안 축이고 `.row-head` 의 `--hit-min` 은 탭 히트 하한이라
  // 서로 다른 계약이다. 그리고 손가락 몫은 의사요소가 지므로, 높이를 지키자고 그것을 줄이면 교환이 된다.
  ok(/min-height:\s*40px/.test(body('.row-head button') ?? ''), '행 액션 버튼의 시안 높이 40 이 그대로다');
  // 압축을 거부한 이름이 갈 곳은 넘침뿐이라, 그 처분이 없으면 폴백 서체에서 액션 버튼을 덮는다.
  ok(/overflow:\s*hidden/.test(body('.row-name') ?? ''), '행 이름 상자가 자기 넘침을 안에서 잘라 둔다');
  ok(/min-height:\s*var\(--hit-min\)/.test(body('.row-head') ?? ''), '행의 탭 히트 하한은 --hit-min 이다');
  const hit = body('.row-head button::after, .band-sim::after') ?? '';
  ok(/width:\s*100%/.test(hit) && /height:\s*var\(--hit-min\)/.test(hit)
    && /min-width:\s*var\(--hit-min\)/.test(hit),
    '히트 영역 의사요소가 REQ-910 하한을 그대로 진다');
});


// ------------------------- 12-a-7. 확정 매의 미끄러짐과 위아래 (#152)

suite('확정 매는 옛 자리에서 미끄러져 오고 탈락 매 위에 선다 (#152)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const heads = (sel) => rules.filter(([s]) => s === sel).length;
  const body = (sel) => rules.find(([s]) => s === sel)?.[1] ?? null;

  // ⓪ 모집단 앵커 — 이 전이가 발화하는 순간이 실재해야 아래 단정이 공허하지 않다.
  deepEq(tabletStates(['a', 'b', 'c'], ['a']).map((t) => `${t.id}:${t.state}`),
    ['a:only', 'b:exit', 'c:exit'], '3매에서 한 매만 남으면 확정 1 · 탈락 2 로 갈린다');

  // ① 짝 단정 — 음수 z 는 그것을 받아 줄 쌓임 문맥이 있어야 뜻을 갖고, 문맥은 내려갈 것이 있어야
  // 뜻을 갖는다. 한쪽만 남으면 탈락 매가 확정 매를 덮거나 곁판 배경 아래로 사라진다.
  for (const sel of ['.slip-row', '.slip', '.slip.out']) {
    ok(body(sel), `${sel} 규칙 블록을 실제로 떼어냈다`);
    eq(heads(sel), 1, `${sel} 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다`);
  }
  ok(/isolation:\s*isolate/.test(body('.slip-row') ?? ''),
    '탈락 매가 내려갈 바닥을 .slip-row 가 만든다');
  const zOut = Number(body('.slip.out')?.match(/(^|[;{\s])z-index:\s*(-?\d+)/)?.[2]);
  ok(Number.isFinite(zOut) && zOut < 0, `사라지는 매는 음수 z 로 내려간다 — .slip.out z-index=${zOut}`);
  // 문맥만 만들고 자기 층은 갖지 않는 것이 계약이다 — 층을 가지면 무대의 z 순서에 함께 진입한다.
  // 모집단은 이름이 아니라 선택자 매칭이다 — 합성·자손 갈래(`.pad .slip-row`)로 한 줄 들어와도
  // 같은 결함이 되돌아오는데, 완전 일치 조회는 그 갈래를 통째로 못 본다.
  const rowRules = rules.filter(([sel]) => /(^|[\s,>+~]|[\w\])])\.slip-row(?![\w-])/.test(sel));
  ok(rowRules.length >= 1, `.slip-row 를 겨누는 규칙을 실제로 떼어냈다 — ${rowRules.length}건`);
  deepEq(rowRules.filter(([, b]) => /(^|[;{\s])z-index:/.test(b)).map(([sel]) => sel), [],
    '.slip-row 계열이 무대의 z 순서에 들어가지 않는다');
  deepEq(rowRules.filter(([, b]) => /isolation:\s*auto/.test(b)).map(([sel]) => sel), [],
    '.slip-row 계열이 그 문맥을 되돌리지 않는다');

  // ② 합성 문면 — 위치는 WAAPI 의 `translate` 채널이 지므로 CSS 전이 목록은 그 속성을 갖지
  // 않는다. 들어오면 되돌림 단계 자체에 전이가 걸려 미끄러짐이 제자리 흔들림으로 바뀐다.
  // 모집단 = 선택자가 `.slip` 자체를 겨누는 규칙 전부 — `-` 는 단어 문자가 아니라 `\b` 로는
  // `.slip-head` 류까지 물고, 합성·자손 갈래는 완전 일치 조회로는 보이지 않는다.
  const slipRules = rules.filter(([sel]) => /(^|[\s,>+~]|[\w\])])\.slip(?![\w-])/.test(sel));
  ok(slipRules.length >= 10, `.slip 자체를 겨누는 규칙을 실제로 떼어냈다 — ${slipRules.length}건`);
  const transitioned = (b) => [...b.matchAll(/(^|[;{\s])transition(-property)?:\s*([^;}]+)/g)]
    .flatMap((m) => m[3].split(',').map((item) => item.trim().split(/\s+/)[0]));
  // 양성 대조 — 목록 자체가 사라지면 「그 목록에 translate 가 없다」가 공허하게 참이 된다.
  const slipTransition = transitioned(body('.slip') ?? '');
  ok(slipTransition.includes('width') && slipTransition.includes('transform'),
    `.slip 의 전이 목록이 실재한다 — ${slipTransition.join(' · ')}`);
  // `all` 은 이름을 대지 않고 같은 결과를 내므로 목록 항목으로 함께 문다.
  deepEq(slipRules.filter(([, b]) => transitioned(b).some((prop) => prop === 'translate' || prop === 'all'))
    .map(([sel]) => sel), [], '.slip 계열의 전이 목록이 translate 를 지지 않는다');

  // ③ 미끄러짐의 담지자 — 죽간 렌더러는 DOM 을 만지므로 하네스가 import 하지 않는다(#138 핀과
  // 같은 자리다). 그래서 선언 원문으로 문다: 실재하는가, 그리고 인라인 쓰기로 새지 않는가.
  const src = readFileSync(new URL('../src/ui/tablets.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const keyframes = [...src.matchAll(/\.animate\(\s*\[([\s\S]*?)\]/g)].map((m) => m[1]);
  eq(keyframes.length, 1, '슬롯 이동을 짓는 애니메이션 호출이 하나 있다');
  ok(/translate:/.test(keyframes[0] ?? ''), '그 키프레임이 translate 채널을 쓴다');
  ok(!/transform:/.test(keyframes[0] ?? ''),
    '그 키프레임이 transform 을 건드리지 않는다 — 금테 확대·등장이 쥔 채널이다');
  // 파일 어디에나 있는 `ledgerMs` 호출을 물면 이 단정은 공허하다 — 같은 문자열이 유령 시효 계산에도
  // 있어 슬라이드 길이만 리터럴로 바꿔도 통과한다. 모집단을 그 호출의 옵션 객체로 좁힌다.
  const opts = src.match(/\.animate\(\s*\[[\s\S]*?\]\s*,\s*(\{[\s\S]*?\})\s*\)/)?.[1] ?? '';
  ok(opts, '그 호출의 옵션 객체를 실제로 떼어냈다');
  const dur = opts.match(/duration:\s*([A-Za-z_$][\w$]*)/)?.[1];
  ok(dur, `미끄러짐의 길이가 리터럴이 아니라 이름으로 온다 — ${opts.replace(/\s+/g, ' ')}`);
  ok(dur && new RegExp(`const\\s+${dur}\\s*=\\s*ledgerMs\\(\\s*'--slip-exit'\\s*\\)`).test(src),
    `그 이름이 시각 원장에서 온다 — ${dur}`);
  // 옛 자리를 레이아웃 좌표로만 재면 미끄러지는 도중의 재좁힘·되돌리기가 눈에 보이던 자리를 버린다.
  ok(/offsetLeft \+ \(Number\.parseFloat\(getComputedStyle\([^)]*\)\.translate\)/.test(src),
    '옛 자리는 진행 중인 미끄러짐의 잔여분을 함께 진다');
  // 부재 단정 — 인라인 쓰기는 CSS 가 쥔 채널을 JS 가 덮는 형태라 그 순간 금테 확대가 사라진다.
  deepEq(src.match(/\.style\.(transform|translate)\s*=/g) ?? [], [],
    '합성 채널을 인라인 대입으로 쓰지 않는다');
  deepEq(src.match(/setProperty\(\s*'(transform|translate)'/g) ?? [], [],
    '합성 채널을 setProperty 로도 쓰지 않는다');

  // ④ 회귀 — `isolation` 은 쌓임 문맥만 만들고 포함 블록은 만들지 않는다. 죽간 줄이 그 축을
  // 다시 물면 탈락 매의 좌표 기준이 매수 따라 움직이는 줄로 되돌아간다 (#138).
  const POSITIONED = /(^|[;{\s])position\s*:\s*(relative|absolute|fixed|sticky)/i;
  const CONTAINING = /(^|[;{\s])(transform|filter|backdrop-filter|will-change|contain)\s*:/i;
  const tabletsRules = rules.filter(([sel]) => /(^|[\s,>+~]|[\w\])])\.tablets(?![\w-])/.test(sel));
  ok(tabletsRules.length >= 2, `죽간 줄을 겨누는 규칙을 실제로 떼어냈다 — ${tabletsRules.length}건`);
  deepEq(tabletsRules.filter(([, b]) => POSITIONED.test(b) || CONTAINING.test(b)).map(([sel]) => sel), [],
    '죽간 줄이 포함 블록을 되찾지 않는다');
});

// ------------------------- 12-a-8. 이름·한자 병기 줄 — 간격은 부모가 짓는다 (#159)

suite('이름·한자 병기의 간격은 부모의 flex gap 이 짓는다 (#159)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const heads = (sel) => rules.filter(([s]) => s === sel).length;
  const body = (sel) => rules.find(([s]) => s === sel)?.[1] ?? null;

  // ① 짝 단정 — display 와 gap 은 함께여야 뜻을 갖는다. gap 만 남으면 인라인 상자라 무효고,
  // display 만 남으면 간격이 0 으로 되돌아간다 — 그것이 #159 의 결함 형태 그대로다.
  ok(body('.hj-line'), '.hj-line 규칙 블록을 실제로 떼어냈다');
  eq(heads('.hj-line'), 1, '.hj-line 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다');
  ok(/display:\s*flex/.test(body('.hj-line') ?? ''), '병기 줄이 flex 상자다');
  const gapDecl = body('.hj-line')?.match(/(^|[;{\s])gap:\s*(\d*\.?\d+)(px|rem|em)/);
  ok(Number(gapDecl?.[2]) > 0, `병기 줄이 0 아닌 간격을 짓는다 — gap=${gapDecl?.[2] ?? '없음'}${gapDecl?.[3] ?? ''}`);
  // 인라인 흐름은 넘치면 줄을 바꿨다 — nowrap 으로 두면 표찰이 사는 `.scene` 의 overflow:hidden 이
  // 그 초과분을 잘라내, 간격을 얻는 대신 이름·한자를 잃는다.
  ok(/flex-wrap:\s*wrap/.test(body('.hj-line') ?? ''), '병기 줄이 넘치면 잘리지 않고 줄을 바꾼다');
  ok(/(^|[;{\s])overflow:\s*hidden/.test(body('.scene') ?? ''),
    '표찰이 사는 무대가 실제로 초과분을 잘라낸다 — 위 단정의 모집단 앵커다');

  // ② 기각된 대안의 부재 단정 — `.hj` 가 자기 margin 으로 간격을 지면 부모 gap 을 이미 가진
  // 나머지 병기 자리에서 이중으로 붙는다. 모집단은 이름이 아니라 선택자 매칭이다.
  const hjRules = rules.filter(([sel]) => /(^|[\s,>+~]|[\w\])])\.hj(?![\w-])/.test(sel));
  ok(hjRules.length >= 2, `.hj 를 겨누는 규칙을 실제로 떼어냈다 — ${hjRules.length}건`);
  deepEq(hjRules.filter(([, b]) => /(^|[;{\s])margin(-[\w-]+)?:/.test(b))
    .map(([sel]) => sel), [], '.hj 가 자기 margin 으로 간격을 짓지 않는다');

  // ③ 표찰의 가운데는 두 축이 함께 진다 — `justify-content` 는 상자가 flex 일 때만 뜻을 갖고
  // 그 flex 는 화면 모듈의 클래스 부착에 달렸다. `text-align` 이 접힌 줄과 그 이탈을 함께 받는다.
  ok(body('.scene .foe-tag'), '상대 표찰 규칙 블록을 실제로 떼어냈다');
  ok(/justify-content:\s*center/.test(body('.scene .foe-tag') ?? ''), '표찰이 매를 가운데로 모은다');
  ok(/text-align:\s*center/.test(body('.scene .foe-tag') ?? ''),
    '표찰이 접힌 줄까지 가운데로 둔다 — 병기 줄 클래스가 떨어져도 남는 축이다');

  // ④ 부착 지점 — 화면 모듈은 DOM 을 만지므로 하네스가 import 하지 않는다(#152 핀과 같은 자리다).
  // 그래서 선언 원문으로 문다: 간격 0 이던 세 부모가 여전히 그 클래스를 지고 있는가.
  const srcOf = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 모집단을 파일이 아니라 함수 몸통으로 좁힌다 — 파일 전역 조회는 클래스가 결함 부모에서 장식
  // 노드로 옮겨 앉아도 통과한다(태그도 한자 호출도 그쪽에 함께 따라가므로).
  const fnBody = (src, name) => {
    const at = src.indexOf(`function ${name}(`);
    if (at < 0) return null;
    const rest = src.slice(at + 1);
    const end = rest.search(/\n(?:export )?function /);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const SITES = [
    ['../src/ui/screens/result.mjs', 'foeTag', 'div', '결과 상대 표찰'],
    ['../src/ui/screens/dispatch.mjs', 'finisherTell', 'p', '파견 예고 절초 줄'],
    ['../src/ui/screens/dispatch.mjs', 'renderPreview', 'h2', '파견 예고 제목 줄'],
  ];
  for (const [path, fn, tag, label] of SITES) {
    const scope = fnBody(srcOf(path), fn);
    ok(scope, `${fn}() 몸통을 실제로 떼어냈다`);
    const open = new RegExp(`el\\('${tag}', \\{ class: '([^']*)' \\}, \\[([^\\]]*)`).exec(scope ?? '');
    ok(open, `${label} 의 여는 선언을 실제로 떼어냈다`);
    ok((open?.[1] ?? '').split(/\s+/).includes('hj-line'),
      `${label} 이 병기 줄 클래스를 진다 — '${open?.[1]}'`);
    ok(/hanja\(/.test(open?.[2] ?? ''), `${label} 이 그 상자 안에서 한자를 곧바로 잇는다`);
  }
});


// ------------------------- 12-a-9. 엎드린 실루엣의 세로 기준 — 바닥이지 무대의 위가 아니다 (#161)

suite('쓰러진 사람은 접어 쓰는 무대의 바닥을 기준으로 앉는다 (#161)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const heads = (sel) => rules.filter(([s]) => s === sel).length;
  const body = (sel) => rules.find(([s]) => s === sel)?.[1] ?? null;
  const rootBlock = css.match(/^:root \{[\s\S]*?\n\}/m)?.[0];
  ok(rootBlock, ':root 블록을 실제로 떼어냈다');
  const px = (name) => Number(rootBlock?.match(new RegExp(`(^|[;{\\s])${name}:\\s*(\\d*\\.?\\d+)px`))?.[2]);

  // ① 두 집합 대조 — 화면이 눕히는 자세와 CSS 가 바닥 기준으로 되돌리는 자세가 같아야 한다.
  // 한쪽만 늘면 새 자세가 옛 좌표계에 홀로 남아 같은 결함이 그 자세에서만 되돌아온다.
  const resultSrc = readFileSync(new URL('../src/ui/screens/result.mjs', import.meta.url), 'utf8');
  // 자세 이름은 하네스가 아니라 화면이 정한다 — 여기에 접미사를 박으면 그 리터럴이 바뀔 때
  // 클래스가 CSS 양쪽에서 조용히 떨어져 나가는데도 아래 대조가 통과한다.
  const pose = resultSrc.match(/PRONE_ASSETS\.has\([^)]*\)[^}]*?pose:\s*'(\w+)'/)?.[1];
  ok(pose, 'result.mjs 가 눕히는 자세 리터럴을 실제로 지니고 있다');
  // 모집단은 완전 일치가 아니라 선택자 매칭이다 — 미디어 쿼리 안의 둘째 규칙이 캐스케이드로
  // 이기고도 첫 규칙만 검사되면 통과한다.
  const proneSel = new RegExp(`\\.fig\\.far\\.sil_\\w+_${pose}\\b`);
  const proneRules = rules.filter(([sel]) => proneSel.test(sel));
  eq(proneRules.length, 1, `엎드린 실루엣의 좌표 규칙이 하나뿐이다 — ${proneRules.length}건`);
  const proneRule = proneRules[0];
  const cssProne = [...(proneRule?.[0] ?? '')
    .matchAll(new RegExp(`\\.(sil_\\w+_${pose})\\b`, 'g'))].map((m) => m[1]).sort();
  const declared = resultSrc.match(/const PRONE_ASSETS = new Set\(\[([^\]]*)\]\)/);
  ok(declared, 'result.mjs 의 엎드림 에셋 집합 선언을 실제로 떼어냈다');
  const jsProne = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => `${m[1]}_${pose}`).sort();
  ok(jsProne.length >= 2, `눕는 자세가 실재한다 — ${jsProne.join(' · ')}`);
  deepEq(cssProne, jsProne, '눕히는 자세와 바닥 기준으로 되돌리는 자세가 같은 집합이다');
  // 그 클래스가 실제로 그림을 지고 있는가 — 자세 이름이 바뀌면 여기서 함께 터진다.
  deepEq(rules.filter(([sel, b]) => /background-image:/.test(b) && new RegExp(`_${pose}$`).test(sel))
    .map(([sel]) => sel.replace(/^\.fig\./, '')).sort(), jsProne,
  '눕는 자세마다 실루엣 그림 선언이 실재한다');

  // ② 양성 대조 — 되돌림이 겨누는 원 좌표(위 기준)가 실재해야 아래 단정이 공허하지 않다.
  ok(body('.scene .fig.far'), '원경 좌표 규칙 블록을 실제로 떼어냈다');
  eq(heads('.scene .fig.far'), 1, '.scene .fig.far 규칙 머리가 하나뿐이다 — 뒤에 온 재정의가 없다');
  ok(/(^|[;{\s])top:\s*var\(--fig-far-y\)/.test(body('.scene .fig.far') ?? ''),
    '원경의 기준은 여전히 무대의 위다 — 서 있는 사람은 그 자리를 쓴다');

  // ③ 되돌림 — 위 기준을 놓지 않으면 두 축이 함께 걸려 상자 높이가 무대에 눌린다. 그리고 선택자가
  // 원 규칙을 통째로 머리에 지므로 특이도가 언제나 이긴다 — 순서로 이기는 규칙은 재배치에 썩는다.
  ok((proneRule?.[0] ?? '').split(',').every((sel) => sel.trim().startsWith('.scene .fig.far.')),
    '엎드림 규칙이 원 규칙을 머리에 지고 좁힌다 — 특이도가 순서에 기대지 않는다');
  ok(/(^|[;{\s])top:\s*auto/.test(proneRule?.[1] ?? ''), '엎드린 쪽은 위 기준을 놓는다');
  ok(/(^|[;{\s])bottom:\s*var\(--fig-prone-y\)/.test(proneRule?.[1] ?? ''),
    '엎드린 쪽의 기준은 무대 바닥이다 — 무대를 접어도 몸이 바닥과 함께 오른다');

  // ④ 무대 초과 — 실루엣 상자는 납품 캔버스의 종횡비를 지므로 폭 하나가 높이를 정한다.
  // 접은 무대에서 바닥 간격과 그 높이의 합이 무대를 넘으면 몸의 위가 잘린다.
  const proneY = px('--fig-prone-y');
  const farW = px('--fig-far-w');
  const sceneH = px('--result-scene-h');
  const ratio = body('.fig')?.match(/aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);
  ok(ratio, '실루엣 상자의 종횡비 선언을 실제로 떼어냈다');
  ok([proneY, farW, sceneH].every(Number.isFinite),
    `원장에서 바닥 간격·원경 폭·접은 무대 높이를 실제로 읽었다 — ${proneY} / ${farW} / ${sceneH}`);
  const boxH = farW * Number(ratio?.[2]) / Number(ratio?.[1]);
  ok(proneY + boxH <= sceneH,
    `엎드린 상자가 접은 무대 안에 온전히 든다 — ${proneY} + ${boxH} ≤ ${sceneH}`);

  // ⑤ 표찰 회피 — 띠의 실제 높이는 폰트 메트릭이 정해 원장에 없으므로, 선언된 최대 글자 크기의
  // 2배를 그 상계로 잡는다. 표찰의 글자나 바닥 간격이 커지면 이 자리가 재실측을 요구한다.
  const tagRules = rules.filter(([sel]) => /(^|[\s,>+~])\.foe-tag\b/.test(sel));
  ok(tagRules.length >= 2, `표찰을 겨누는 규칙을 실제로 떼어냈다 — ${tagRules.length}건`);
  const tagBottom = Number(body('.scene .foe-tag')?.match(/(?:^|[;{\s])bottom:\s*(\d*\.?\d+)px/)?.[1]);
  const tagFont = Math.max(...tagRules
    .map(([, b]) => Number(b.match(/font-size:\s*(\d*\.?\d+)px/)?.[1]) || 0));
  ok(tagBottom > 0 && tagFont > 0,
    `표찰의 바닥 간격과 최대 글자 크기를 실제로 읽었다 — ${tagBottom}px / ${tagFont}px`);
  ok(proneY >= tagBottom + tagFont * 2,
    `엎드린 몸이 표찰 띠 위에서 끝난다 — 바닥 ${proneY}px ≥ ${tagBottom} + ${tagFont * 2}px`);
});


// ------------------------- 12-b. 결과 진입 1회 정산 · 판 원장 (#70 · REQ-871~873)

suite('판 원장 — 그 판의 판정 분포·성 변화·결정타 (REQ-872·873·708)', () => {
  const session = createSession();
  const challenger = challengerOfStage(1);
  // 첫 초식은 `createProgress` 가 이미 해금해 둔다 — 다시 배우면 그 자리에서 throw 다.
  const style = artStyles(ART)[0];

  /** 한 초의 판정 하나 — 화면·헤드리스가 지나는 `recordDuelVerdict` 와 같은 형태를 만든다. */
  const view = (grade, outcome = { over: false, win: null, by: null }) => ({
    verdict: { grade, dmgOut: 10, dmgIn: 0, opening: null },
    fire: { style },
    outcome,
    challenger,
  });

  beginDuel(session, challenger.id);
  deepEq(boutLedger(session).verdicts, {}, '진입이 원장을 비운다');
  eq(boutLedger(session).attempt, 1, '초회 대면의 회차가 실린다');

  recordDuelVerdict(session, view('advantage'));
  recordDuelVerdict(session, view('advantage'));
  recordDuelVerdict(session, view('clash'));
  // 판정 분포는 그 판의 초 수와 맞아야 한다 — 세션 전체 로그에서 세면 이전 판이 섞인다.
  deepEq(boutLedger(session).verdicts, { advantage: 2, clash: 1 }, '판정이 등급별로 쌓인다');
  eq(boutLedger(session).finisher, null, '아직 끝내지 않았으므로 결정타가 없다');

  const gains = boutLedger(session).gains;
  eq(gains.length, 1, '적립이 일어난 초식만 원장에 오른다');
  eq(gains[0].style, style.id, '오른 초식의 id');
  eq(gains[0].from, 1, '시작은 그 판의 첫 값이다');
  eq(gains[0].to, styleRank(session.progress, style.id), '끝은 지금 값이다');

  // 초 상한의 잔여 HP 비교승은 그 타격이 확정한 승리가 아니라 결정타가 아니다 (REQ-708).
  recordDuelVerdict(session, view('advantage', { over: true, win: true, by: 'exchanges' }));
  eq(boutLedger(session).finisher, null, '초 상한 비교승은 결정타로 세지 않는다');
  recordDuelVerdict(session, view('crush', { over: true, win: true, by: 'hp' }));
  eq(boutLedger(session).finisher, style.id, '상대를 쓰러뜨린 초가 결정타다');
  // 결과 표찰의 초 수는 이 도출에 기댄다 — 한 초에 판정 하나가 아니면 그 수가 조용히 어긋난다.
  eq(boutLedger(session).exchanges, 5, '초 수는 판정 분포의 합이다');

  // 회차는 승수에서 파생하므로 다음 대면을 재대련으로 만들려면 이 판의 승리를 먼저 정산한다.
  settleDuel(session, { win: true, stage: 1 });
  // 다음 판은 앞 판의 수를 물려받지 않는다 — 그것이 「이 판에서 번 것」의 정의다.
  beginDuel(session, challenger.id);
  deepEq(boutLedger(session).verdicts, {}, '다음 진입이 분포를 비운다');
  deepEq(boutLedger(session).gains, [], '다음 진입이 성 변화를 비운다');
  eq(boutLedger(session).finisher, null, '다음 진입이 결정타를 비운다');
  eq(boutLedger(session).attempt, 2, '재대련 회차가 실린다');

  // 수련의 적립은 판 밖의 일이라 결과 화면의 발광 칸이 되어서는 안 된다 (REQ-873).
  recordEffectiveSuccess(session, style.id, 'train');
  deepEq(boutLedger(session).gains, [], '판 밖의 수련 적립은 원장에 오르지 않는다');

  // 파견도 같은 원장을 쓴다 — 결과 화면이 대련·파견을 가르지 않는 근거다.
  const trained = createSession();
  trained.progress = masteredProgress;
  runTransmit(trained);
  beginMission(trained, { random: createSeededRandom(3) });
  const dstyle = artStyles(ART)[0];
  recordDispatchVerdict(trained, {
    verdict: { grade: 'crush', dmgOut: 10, dmgIn: 0, opening: null },
    fire: { style: dstyle },
    outcome: { over: true, win: true, by: 'hp' },
    challenger: DISPATCH_CHALLENGER,
  });
  const missionLedger = boutLedger(trained);
  deepEq(missionLedger.verdicts, { crush: 1 }, '파견 판정도 같은 원장에 쌓인다');
  eq(missionLedger.finisher, dstyle.id, '제자의 결정타도 같은 자리에 실린다');
  eq(missionLedger.attempt, 0, '임무에는 회차 축이 없다');

  // 유효 성공은 적립의 조건이지 결정타의 조건이 아니다 — 열세로 끝낸 판도 끝낸 초가 있다 (REQ-708).
  ok(!isEffectiveSuccess('disadvantage'), '열세는 유효 성공이 아니다');
  const lowGrade = createSession();
  lowGrade.progress = masteredProgress;
  runTransmit(lowGrade);
  dispatchWiring(lowGrade, { disciple: { arm() {}, tick: () => null } });
  recordDispatchVerdict(lowGrade, {
    verdict: { grade: 'disadvantage', dmgOut: 4, dmgIn: 12, opening: null },
    fire: { style: dstyle },
    outcome: { over: true, win: true, by: 'hp' },
    challenger: DISPATCH_CHALLENGER,
  });
  eq(boutLedger(lowGrade).finisher, dstyle.id, '적립되지 않는 등급으로 끝내도 결정타는 남는다');
  deepEq(boutLedger(lowGrade).gains, [], '그 초는 적립되지 않으므로 성 변화는 없다');
});

suite('결과 정산은 진입 1회 — 재렌더 멱등 (#70)', () => {
  /** 대련 한 판을 그 진입까지 세운다 — 정산이 실제로 무엇을 움직이는지 재는 기준선이다. */
  const duelSession = (stage) => {
    const session = createSession();
    session.progress = masteredProgress;
    beginDuel(session, challengerOfStage(stage).id);
    return session;
  };

  /**
   * 「두 번 렌더해도 한 번」과 「그 상태에서 실제로 돈다」를 한 자리에서 잰다 — 후자가 없으면
   * 정산이 통째로 빠진 반대 실패가 멱등 단정만으로는 green 으로 통과한다.
   */
  const settleTwice = (session, params) => {
    const before = { coins: session.coins, stage: session.stage, dispatchStage: session.dispatchStage };
    const first = settleResult(session, params);
    const moved = { coins: session.coins, stage: session.stage, dispatchStage: session.dispatchStage };
    const second = settleResult(session, params);
    return { before, first, moved, second, after: {
      coins: session.coins, stage: session.stage, dispatchStage: session.dispatchStage,
    } };
  };

  // ① 대련 승리 — 재화·차수가 오르고, 다시 그려도 두 번 오르지 않는다.
  {
    const session = duelSession(1);
    const params = { kind: 'duel', win: true, stage: 1 };
    const r = settleTwice(session, params);
    eq(r.moved.coins - r.before.coins, BALANCE.reward.duelWin, '대련 승리가 실제로 재화를 준다');
    eq(r.moved.stage, r.before.stage + 1, '대련 승리가 실제로 차수를 전진시킨다');
    deepEq(r.after, r.moved, '두 번째 렌더는 세션을 움직이지 않는다');
    ok(r.second === r.first, '같은 진입은 같은 정산 결과를 되돌린다');
    eq(session.duelWins[challengerOfStage(1).id], 1, '도전자 승수가 한 번만 오른다');
    eq(r.first.rematch, false, '초회 대면은 재대련이 아니다');
  }

  // ② 대련 패배 — 무손실이지만 정산은 돈다 (성·판정 분포는 그대로 보여야 한다).
  {
    const session = duelSession(1);
    const params = { kind: 'duel', win: false, stage: 1 };
    const r = settleTwice(session, params);
    eq(r.first.reward, 0, '패배는 무보상이다 (REQ-209)');
    deepEq(r.moved, r.before, '패배는 세션을 움직이지 않는다');
    deepEq(r.after, r.before, '패배의 재렌더도 마찬가지다');
    ok(r.second === r.first, '패배도 같은 정산 결과를 되돌린다');
  }

  // ③ 재대련 승리 — 승수는 오르되 재화는 주지 않는다 (REQ-734·877).
  {
    const session = duelSession(1);
    settleResult(session, { kind: 'duel', win: true, stage: 1 });
    beginDuel(session, challengerOfStage(1).id);
    const coinsBefore = session.coins;
    const params = { kind: 'duel', win: true, stage: 1 };
    const r = settleTwice(session, params);
    eq(r.first.rematch, true, '두 번째 대면은 재대련이다');
    eq(r.first.reward, 0, '재대련 승리는 재화를 주지 않는다');
    eq(session.coins, coinsBefore, '재화가 그대로다');
    eq(session.duelWins[challengerOfStage(1).id], 2, '재대련 승수가 한 번만 오른다');
    ok(r.second === r.first, '재대련도 같은 정산 결과를 되돌린다');
  }

  // ④ 파견 완수 — 재화·다음 임무가 열리고, 재렌더가 그것을 두 번 하지 않는다.
  {
    const session = createSession();
    session.progress = masteredProgress;
    runTransmit(session);
    beginMission(session, { random: createSeededRandom(5) });
    const params = { kind: 'dispatch', win: true };
    const r = settleTwice(session, params);
    eq(r.moved.coins - r.before.coins, BALANCE.reward.dispatchWin, '파견 완수가 실제로 재화를 준다');
    eq(r.moved.dispatchStage, r.before.dispatchStage + 1, '파견 완수가 실제로 다음 차수를 연다');
    deepEq(r.after, r.moved, '파견의 재렌더도 세션을 움직이지 않는다');
    ok(r.second === r.first, '파견도 같은 정산 결과를 되돌린다');
    // `cycle_done` 은 kill (d) 의 종점이라 재렌더가 그것을 두 번 찍으면 판독 구간이 갈라진다.
    const done = session.log.entries.filter((e) => e.event === 'cycle' && e.phase === 'cycle_done');
    eq(done.length, 1, '파견 종점 로그가 한 번만 찍힌다');
  }

  // ⑤ 진입 파라미터가 다르면 다른 판이다 — 메모가 판을 가로질러 정산을 삼키면 그것이 반대 실패다.
  {
    const session = duelSession(1);
    settleResult(session, { kind: 'duel', win: true, stage: 1 });
    const coinsAfterFirst = session.coins;
    beginDuel(session, challengerOfStage(2).id);
    settleResult(session, { kind: 'duel', win: true, stage: 2 });
    eq(session.coins, coinsAfterFirst + BALANCE.reward.duelWin, '새 진입은 새로 정산한다');
    eq(session.stage, 3, '새 진입의 차수 전진도 실제로 일어난다');
  }

  // ⑥ 메모는 진입 파라미터가 아니라 **그 판**에 묶인다 — 파라미터를 물려 쓰는 관용이 이미 있어
  //    객체 신원만 보면 다음 판의 정산이 앞 판의 메모에 조용히 삼켜진다.
  {
    const session = duelSession(1);
    const params = { kind: 'duel', win: true, stage: 1 };
    settleResult(session, params);
    const coinsAfterFirst = session.coins;
    beginDuel(session, challengerOfStage(1).id);
    settleResult(session, params);
    eq(session.coins, coinsAfterFirst, '재대련이라 재화는 그대로지만');
    eq(session.duelWins[challengerOfStage(1).id], 2, '같은 파라미터를 물려 써도 새 판은 새로 정산된다');
  }

  // 정산 스냅샷은 그 판의 원장을 함께 싣는다 — 결과 화면이 로그를 다시 세지 않는 근거다.
  {
    const session = duelSession(1);
    const snapshot = settleResult(session, { kind: 'duel', win: true, stage: 1 });
    deepEq(Object.keys(snapshot).sort(),
      ['attempt', 'cleared', 'exchanges', 'finisher', 'gains', 'kind', 'rematch', 'reward', 'unlocked', 'verdicts', 'win'],
      '정산 스냅샷이 내는 필드 집합');
  }
});

suite('파견의 판 경계는 임무 확정이 아니라 그 판의 시작이다 (REQ-872·873)', () => {
  const session = createSession();
  session.progress = masteredProgress;
  runTransmit(session);
  const style = artStyles(ART)[0];

  // ① 예고 진입 — 임무가 확정된다. 이 시점은 아직 싸움이 아니다.
  const mission = currentMission(session, { random: createSeededRandom(7) });
  ok(mission, '예고에서 임무가 확정된다');

  // ② 물러나기 → 대련 한 판. 그 판정·성 변화가 원장에 쌓인다.
  beginDuel(session, challengerOfStage(1).id);
  recordDuelVerdict(session, {
    verdict: { grade: 'crush', dmgOut: 10, dmgIn: 0, opening: 'foe' },
    fire: { style },
    outcome: { over: false, win: null, by: null },
    challenger: challengerOfStage(1),
  });
  ok(boutLedger(session).verdicts.crush > 0, '대련분이 원장에 쌓였다');

  // ③ 파견 재진입 — 임무는 차수가 같아 재사용되므로 `beginMission` 이 돌지 않는다.
  eq(currentMission(session, { random: createSeededRandom(7) }), mission, '같은 차수의 임무가 재사용된다');
  // 판을 여는 것은 배선이다 — 여기서 비워지지 않으면 대련분이 파견 결과 화면에 그대로 실린다.
  dispatchWiring(session, { disciple: { arm() {}, tick: () => null } });
  deepEq(boutLedger(session).verdicts, {}, '파견의 판이 앞선 대련분을 물려받지 않는다');
  deepEq(boutLedger(session).gains, [], '앞선 대련의 성 변화도 물려받지 않는다');
  eq(boutLedger(session).finisher, null, '앞선 대련의 결정타도 물려받지 않는다');
});

suite('전수도 진입 1회 (#70 과 같은 축 · REQ-761)', () => {
  const session = createSession();
  session.progress = masteredProgress;
  ok(canTransmitNow(session), '전수 조건이 섰다');
  const ranksOf = () => artStyles(ART).map((s) => discipleStyleRank(session.disciple, ART, s.id));

  const transmits = () => session.log.entries.filter((e) => e.event === 'transmit').length;
  eq(enterTransmit(session), true, '조건이 선 진입은 전수를 실행한다');
  eq(transmits(), 1, '전수 로그가 한 번 남는다');
  // 제자가 성을 올린 뒤 재렌더가 전수를 다시 돌리면 그 성이 1성으로 되감긴다.
  accrueDiscipleRank(session, artStyles(ART)[0].id);
  const ranks = ranksOf();

  eq(enterTransmit(session), false, '재렌더는 다시 전수하지 않는다');
  eq(transmits(), 1, '전수 로그도 늘지 않는다');
  deepEq(ranksOf(), ranks, '제자의 성이 두 번 초기화되지 않는다');

  // 멱등을 지는 것은 진입 메모가 아니라 세션 상태다 — 다른 세션은 자기 조건으로 판정한다.
  const other = createSession();
  other.progress = masteredProgress;
  eq(enterTransmit(other), true, '다른 세션은 그 세션의 조건으로 전수한다');
  // 조건이 서지 않은 세션에서는 아무것도 하지 않는다 — 던지지 않는 것이 화면 진입의 계약이다.
  eq(enterTransmit(createSession()), false, '전수 조건이 서지 않으면 실행하지 않는다');
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
  deepEq(BALANCE.hp, { user: 100, disciple: 100, 'A-1': 30, 'A-2': 45, 'A-3': 80, 'A-4': 90, B: 80 }, 'BALANCE.hp');
  deepEq(BALANCE.challengerRank, { 'A-1': 1, 'A-2': 2, 'A-3': 3, 'A-4': 4, B: 2 }, 'BALANCE.challengerRank (REQ-722·733)');
  deepEq(BALANCE.rematch, { rankGain: 1, rankCap: 3 }, 'BALANCE.rematch (REQ-734 누적·상한)');
  deepEq(BALANCE.reversalDecay, { perRank: 0.075, pierceFloor: 0.4 }, 'BALANCE.reversalDecay (REQ-771)');
  deepEq(BALANCE.discipleTrain, { secondsPerRank: 1800 }, 'BALANCE.discipleTrain (REQ-753 방치 루프 길이)');
  deepEq(BALANCE.mission, { unlockRank: 5, foeCount: 3, rankStep: 1 }, 'BALANCE.mission (REQ-742·743)');
  deepEq(BALANCE.killReadout, { minManualWindows: 20 }, 'BALANCE.killReadout (REQ-793 표본 하한)');
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
  // 속성 표시 규약이 빠지면 `attrMark` 가 맨몸 TypeError 로 죽는다 — 같은 키 집합이어야 한다.
  deepEq(Object.keys(ATTR_VIEW).sort(), Object.keys(ATTRS).sort(),
    '속성 표시 규약이 3속성 전부를 덮는다');
  // juice 배정 등급의 오타는 에러 없이 흔들림만 지운다 — 등급 이름임을 여기서 못박는다 (REQ-815).
  deepEq([...EXTREME_GRADES].sort(), ['crush', 'reversal'],
    '흔들림·히트스톱이 극단 2등급에만 배정된다');
  ok([...EXTREME_GRADES].every((g) => g in BALANCE.grades), '극단 2등급이 판정표의 등급 이름이다');

  // 표시 클래스의 규칙이 원장에서 사라지면 크기·위치·색이 조용히 폴백으로 대체된다 (REQ-814).
  const ledger = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const { cls } of [...Object.values(GRADE_VIEW), TRAIN_DONE_VIEW]) {
    ok(ledger.includes(`.verdict-pop.${cls} `), `원장에 .verdict-pop.${cls} 규칙이 있다`);
  }
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
  // 값 지문이 rev 에 묶여 있으므로(#54) 변형마다 rev 를 다시 찍는다 — 안 찍으면 모든 케이스에
  // rev 오류가 하나씩 덧붙어 「그 변형이 무엇을 잡았는가」가 흐려진다.
  const restamp = (raw) => {
    const { rev: version, ...rest } = raw;
    raw.rev = `${String(version).split('/')[0]}/${valueDigest(rest)}`;
    return raw;
  };
  const throwsWith = (mutate, needle, label) => {
    const raw = clone();
    mutate(raw);
    restamp(raw);
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

  throwsWith((r) => { delete r.rankMax; }, 'rankMax: 필드 누락', '필드 누락');
  throwsWith((r) => { r.telegraphMs = '1000'; }, 'telegraphMs: "1000" 는 0 이상의 정수가 아니다', '타입 불일치');
  throwsWith((r) => { r.grades.clash.formula = 'pctt'; }, 'grades.clash.formula: "pctt" 는 ["pct","clash"] 밖', 'formula enum 밖');
  throwsWith((r) => { r.grades.struck.order = 4; }, 'grades.*.order', 'order 중복 (0..5 순열 아님)');
  throwsWith((r) => { r.grades.crush.opning = null; }, 'grades.crush.opning: 등급 스키마에 없는 필드', '등급 객체 안의 오타 키 (#54)');
  throwsWith((r) => { delete r.hp['A-3']; }, 'hp: 키 "A-3" 누락 (CHALLENGERS 와 1:1)', 'hp 도전자 키 누락');
  throwsWith((r) => { r.bot.reactionMs = [650, 450]; }, 'bot.reactionMs: [650,450] 는 [최소, 최대] 순서가 뒤집혔다', 'bot 배열 역순');
  throwsWith((r) => { delete r.damageByLen['5']; }, 'damageByLen: 초식 길이 5 의 피해가 없다', 'damageByLen 이 초식 길이를 못 덮음');
  // 사운드 매핑 (REQ-920·924) — 「매핑 없는 사건이 조용히 무음으로 지나가지 않는다」의 기계 층.
  throwsWith((r) => { delete r.audio.key; }, 'audio: cue "key" 누락', '사운드 cue 누락');
  throwsWith((r) => { r.audio.key = 'ding'; }, 'audio.key: "ding" 는 sfx_·bgm_ 로 시작하는 사운드 id 가 아니다', '사운드 id 꼴 아님');
  throwsWith((r) => { delete r.audio.verdict.crush; }, 'audio.verdict: 판정 계열 키', '판정 계열이 6단을 못 덮음');
  throwsWith((r) => { r.audio.extra = 'sfx_key'; }, 'audio.extra: 사운드 매핑에 없는 cue', '매핑에 없는 cue');
  throwsWith((r) => { r.nonesuch = 1; }, 'nonesuch: 스키마에 없는 필드', '스키마 밖 필드');

  // 창안자는 표시 전용이라 값이 비어도 아무것도 죽지 않는다 (REQ-891) — 그 무음을 로드 시점에
  // 죽이는 것이 `validateStyleContent` 이고, 정본이 콘텐츠 테이블이라 문면의 출처도 그쪽이다.
  // 입력을 인자로 받으므로 모듈 전역 STYLES 를 변형하지 않는다.
  const styleClone = () => STYLES.map((st) => ({ ...st, founder: { ...st.founder } }));
  const contentThrows = (mutate, needle, label) => {
    const styles = styleClone();
    mutate(styles[0]);
    let message = null;
    try {
      validateStyleContent(styles);
    } catch (err) {
      message = err.message;
    }
    ok(message !== null, `${label} — throw 한다`);
    ok(message !== null && message.startsWith('초식 콘텐츠 불량 — src/balance.mjs'),
      `${label} — 콘텐츠 테이블 경로가 문면에 실린다`);
    ok(message !== null && message.includes(needle), `${label} — 문면에 ${needle} 가 실린다 (실제: ${message})`);
  };
  contentThrows((st) => { st.founder = { name: '', hanja: '雲虛子' }; },
    'STYLES.yuun-bo.founder.name: "" 는 비어 있지 않은 문자열이 아니다', '창안자 이름 공백');
  contentThrows((st) => { delete st.founder.hanja; },
    'STYLES.yuun-bo.founder.hanja: undefined 는 비어 있지 않은 문자열이 아니다', '창안자 한자 누락');
  contentThrows((st) => { st.founder.nickname = '운객'; },
    'STYLES.yuun-bo.founder.nickname: 창안자 스키마에 없는 필드', '창안자 스키마 밖 필드');
  contentThrows((st) => { st.founder = null; },
    'STYLES.yuun-bo.founder: null 는 창안자 객체가 아니다', '창안자 객체 아님');
  ok(STYLES.every((st) => st.founder.name && st.founder.hanja), '기성 4종의 창안자 값이 전부 확정돼 있다');
  ok(STYLES.every((st) => st.founder.name !== '운객'), '플레이스홀더 「운객」이 남아 있지 않다 (REQ-891)');
  throwsWith((r) => { delete r.challengerRank['A-1']; }, 'challengerRank: 키 "A-1" 누락', '도전자 성 키 누락');
  throwsWith((r) => { delete r.reward.dispatchWin; }, 'reward: 키 "dispatchWin" 누락', '보상 키 누락');
  throwsWith((r) => { delete r.hintDelayMs.duel; }, 'hintDelayMs: 키 "duel" 누락', '힌트 지연 키 누락');

  // 폐기 8키 부활 — 미지 필드 문면이 아니라 폐기를 지목해야 잔존 참조 사고를 그 자리에서 읽는다 (#64).
  for (const key of RETIRED_KEYS) {
    throwsWith((r) => { r[key] = 1; }, `${key}: 성 축 재설계로 폐기된 필드`, `폐기 키 ${key} 부활`);
  }

  // 값 범위·정수성 (#54) — 「숫자이기만 하면」 통과하던 자리다.
  throwsWith((r) => { r.windowBaseMs = -2600; }, 'windowBaseMs: -2600 는 1 이상의 정수가 아니다', '음수 응수 창');
  throwsWith((r) => { r.openingWindowPenalty = 1.4; }, 'openingWindowPenalty: 1.4 는 0 이상 1 미만의 비율이 아니다', '창 벌점이 1 을 넘음');
  throwsWith((r) => { r.bot.missRate = 5; }, 'bot.missRate: 5 는 0~1 비율이 아니다', '확률이 1 을 넘음');
  throwsWith((r) => { r.rankLadder.bands[0].cost = 0; }, 'rankLadder.bands[0].cost: 0 는 1 이상의 정수가 아니다', '계단 비용 0');
  throwsWith((r) => { r.powerBase = 0; }, 'powerBase: 0 는 양수가 아니다', '내공 기저 0');
  throwsWith((r) => { r.hp['A-1'] = -30; }, 'hp.A-1: -30 는 1 이상의 정수가 아니다', '음수 HP');
  throwsWith((r) => { r.slots = 2.5; }, 'slots: 2.5 는 1 이상의 정수가 아니다', '비정수 슬롯 수');

  // 성 축 상호관계 (#54 · REQ-711·713) — 값 하나가 계단 사슬을 깨는 자리.
  throwsWith((r) => { r.rankGate.unlock = 2; }, 'rankGate.unlock: 2 가 rankGate.equip 2 보다 크지 않다', '해금 ≤ 장착');
  throwsWith((r) => { r.rankGate.oneTap = 4; }, 'rankGate.oneTap: 4 가 rankGate.unlock 5 보다 크지 않다', '원터치 ≤ 해금');
  throwsWith((r) => { r.rankGate.oneTap = 9; }, 'rankGate.oneTap: 9 가 수련 적립 상한 7 를 넘는다', '원터치 > 수련 상한');
  throwsWith((r) => { r.rankLadder.bands[1].maxRank = 5; }, 'rankLadder.bands[1].maxRank: 5 가 직전 구간 상한 7 보다 크지 않다', '구간 상한 역전');
  throwsWith((r) => { r.rankLadder.finishRank = 12; }, 'rankLadder.finishRank: 12 가 적립 상한 10 의 다음 계단이 아니다', '결정타 계단이 적립 상한과 이어지지 않음');
  throwsWith((r) => { r.discipleRankMax = 13; }, 'discipleRankMax: 13 가 성 상한 12 를 넘는다', '제자 상한 > 성 상한');
  throwsWith((r) => { r.challengerRank['A-1'] = 13; }, 'challengerRank.A-1: 13 가 성 상한 12 를 넘는다', '도전자 성 > 성 상한');

  // 관통 하한 도달 가능성 (REQ-771) — 계수를 내리면 하한이 사표가 되므로 로드 시점에 죽는다.
  throwsWith((r) => { r.reversalDecay.perRank = 0.05; },
    'reversalDecay.pierceFloor: A-4 무대의 최대 성 차 8 로는 하한 0.4 에 닿지 못한다', '관통 하한 사표');
  throwsWith((r) => { r.reversalDecay.pierceFloor = 1; },
    'reversalDecay.pierceFloor: 1 는 0 초과 1 미만의 관통 하한이 아니다', '하한 1 = 감쇠 없음');
  throwsWith((r) => { r.reversalDecay.pierceFloor = 0; },
    'reversalDecay.pierceFloor: 0 는 0 초과 1 미만의 관통 하한이 아니다', '하한 0 = 절초 무해');
  // 감쇠를 끄는 것(계수 0)은 튜닝 선택지라 통과해야 한다 — 하한이 쓰일 자리 자체가 없다.
  eq(validateBalance(restamp((() => { const r = clone(); r.reversalDecay.perRank = 0; return r; })())).values.reversalDecay.perRank,
    0, '역파 감쇠 off (perRank 0) 는 JSON 만으로 표현된다');
  // 재대련 강화 off 도 같은 축이다 — 「튜닝은 JSON 만 고치면 된다」가 이 두 항에서도 성립한다.
  for (const key of ['rankGain', 'rankCap']) {
    eq(validateBalance(restamp((() => { const r = clone(); r.rematch[key] = 0; return r; })())).values.rematch[key],
      0, `재대련 ${key} 0 (강화 off) 은 JSON 만으로 표현된다`);
  }
  throwsWith((r) => { r.rematch.rankCap = BALANCE.rankMax; },
    'rematch.rankCap: 최고 도전자 성 4 에 12 를 더하면 성 상한 12 를 넘는다', '재대련 상한이 성 상한을 넘김');

  // 임무 축 (REQ-742·743) — 잠금은 도달 가능한 성을 요구해야 잠금이지 봉인이 아니다.
  // 잠금이 봉인이 되는 경계는 제자 성 상한이 아니라 **수련으로 닿는 성**이다 — 그 위는 파견뿐인데
  // 그 파견이 잠겨 있어, 8~10 을 요구하면 B-2 가 영원히 열리지 않는다.
  throwsWith((r) => { r.mission.unlockRank = trainAccrualCap() + 1; },
    `mission.unlockRank: ${trainAccrualCap() + 1} 가 수련 적립 상한 ${trainAccrualCap()} 를 넘어 잠금이 영구 봉인이 된다`,
    'B-2 잠금 기준이 수련 상한을 넘김');
  eq(validateBalance(restamp((() => { const r = clone(); r.mission.unlockRank = trainAccrualCap(); return r; })())).values.mission.unlockRank,
    trainAccrualCap(), '수련으로 닿는 성까지는 잠금 기준으로 쓸 수 있다');
  throwsWith((r) => { r.mission.foeCount = FOE_STYLES.length + 1; },
    `mission.foeCount: ${FOE_STYLES.length + 1} 가 적 초식 아키타입 ${FOE_STYLES.length} 종의 1~전량 범위 밖이다`,
    '임무 조합이 아키타입 풀보다 큼');
  throwsWith((r) => { delete r.discipleTrain.secondsPerRank; },
    'discipleTrain: 키 "secondsPerRank" 누락', '제자 수련 시간 키 누락');
  throwsWith((r) => { delete r.killReadout.minManualWindows; },
    'killReadout: 키 "minManualWindows" 누락', '수동 창 표본 하한 키 누락');
  // 임무 난이도 곡선 off (성 상승 0) 는 튜닝 선택지라 통과해야 한다.
  eq(validateBalance(restamp((() => { const r = clone(); r.mission.rankStep = 0; return r; })())).values.mission.rankStep,
    0, '임무 난이도 곡선 off (rankStep 0) 는 JSON 만으로 표현된다');

  // rev ↔ 값 결합 (#54) — 값만 고치고 rev 를 그대로 두면 로그 지문이 옛 판본을 달고 나간다.
  const stale = clone();
  stale.telegraphMs = 900;
  let staleMessage = null;
  try { validateBalance(stale); } catch (err) { staleMessage = err.message; }
  const { rev: _staleRev, ...staleValues } = stale;
  ok(staleMessage !== null && staleMessage.includes(`rev: 값 지문이 "${valueDigest(staleValues)}"`),
    `값을 고치고 rev 를 두면 죽는다 (실제: ${staleMessage})`);
  ok(staleMessage !== null && staleMessage.includes(`"${BALANCE_REV.split('/')[0]}/${valueDigest(staleValues)}" 로 갱신하라`),
    '문면이 그대로 붙여 넣을 rev 를 준다');
  eq(validateBalance(restamp(clone())).rev, BALANCE_REV, '지문을 다시 찍으면 통과한다');
  // rev 축의 두 변형은 restamp 를 태우면 그 자리가 덮이므로 직접 던진다.
  throws(() => validateBalance({ ...clone(), rev: '' }), 'rev 공백은 throw', '비어 있지 않은 판본 문자열');
  const noDigest = clone();
  [noDigest.rev] = BALANCE_REV.split('/');
  throws(() => validateBalance(noDigest), '지문 없는 rev 는 throw', '값 지문 8자리');

  // 오류는 전건 수집 후 한 번에 보고한다 — 첫 건에서 멈추면 고칠 때마다 재실행이 필요하다.
  const many = restamp((() => { const r = clone(); delete r.slots; r.grades.clash.formula = 'pctt'; return r; })());
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

// ---------------------------- 15. 사운드 매핑 · 프레임 예산 (REQ-914·915·920·924)

suite('사운드 매핑 (REQ-920·924)', () => {
  // 판정 계열은 6단 전부를 덮어야 한다 — 한 등급이라도 비면 그 판정이 무음으로 지나간다.
  deepEq(Object.keys(BALANCE.audio.verdict).slice().sort(),
    Object.keys(BALANCE.grades).slice().sort(), '판정 매핑이 6단 집합과 같다');
  deepEq([...new Set(Object.values(BALANCE.audio.verdict))].sort(),
    ['sfx_break', 'sfx_clash', 'sfx_hit'], '3계열로 접힌다');
  eq(BALANCE.audio.verdict.crush, 'sfx_break', '완파 = 유리 극단');
  eq(BALANCE.audio.verdict.reversal, BALANCE.audio.verdict.struck, '역파·피격이 같은 불리 계열');
  eq(BALANCE.audio.verdict.advantage, BALANCE.audio.verdict.disadvantage, '우세·열세가 같은 중립 교차');

  // 사건 이름은 코드가 분기하는 값이라 그 집합이 pin 이다 — 늘리면 이 줄이 먼저 red 다.
  deepEq(Object.values(CUE), ['key', 'ignore', 'reset', 'fire', 'confirm', 'rankUp', 'transmit'],
    '소리가 붙는 사건 7종');
  // 납품 id 는 파일 이름의 줄기이기도 하다 — 경로 표를 따로 두지 않는 것이 그 계약이다.
  for (const [cue, id] of Object.entries(BALANCE.audio)) {
    if (cue === 'verdict') continue;
    ok(/^(sfx|bgm)_[a-z0-9_]+$/.test(id), `audio.${cue} 는 사운드 id 꼴이다 (${id})`);
  }
  // 꼴이 맞아도 파일이 없으면 그 사건은 콘솔 경고 하나 뒤 **영구 무음**이다 — 서체 커버리지
  // 게이트와 같은 축으로, 납품 누락·id 오타를 출하 전에 여기서 문다.
  const soundIds = [...new Set([
    ...Object.entries(BALANCE.audio).filter(([cue]) => cue !== 'verdict').map(([, id]) => id),
    ...Object.values(BALANCE.audio.verdict),
  ])].sort();
  eq(soundIds.length, 7, '납품 사운드 7종 (sfx 6 + bgm 1)');
  for (const id of soundIds) {
    ok(existsSync(new URL(`../assets/audio/${id}.ogg`, import.meta.url)), `assets/audio/${id}.ogg 실재`);
  }

});

suite('프레임 예산 (REQ-914·915)', () => {
  const budget = createFrameBudget({ minSamples: 4 });
  deepEq(budget.scenes(), [], '표본이 없으면 말할 장면도 없다');
  eq(budget.p95('verdict'), null, '표본이 모자라면 p95 는 침묵한다');
  eq(budget.fps('parallax'), null, '표본이 모자라면 fps 도 침묵한다');

  for (const ms of [16, 16, 17, 40]) budget.sample('verdict', ms);
  deepEq(budget.scenes(), ['verdict'], '표본이 찬 장면만 보고된다');
  eq(budget.p95('verdict'), 40, 'p95 는 최악 프레임을 잡는다 (4표본의 95백분위 = 4번째)');
  eq(budget.dropped('verdict'), 1, '25ms 를 넘긴 프레임이 유실로 센다');

  // 배경 탭 복귀의 초 단위 간격은 렌더 비용이 아니라 정지 시간이라 표본이 아니다.
  budget.sample('verdict', 5000);
  budget.sample('verdict', 0);
  budget.sample('verdict', -3);
  eq(budget.dropped('verdict'), 1, '정지·비정상 간격은 표본에 들지 않는다');

  for (let i = 0; i < 10; i += 1) budget.sample('parallax', 25);
  eq(Math.round(budget.fps('parallax')), 40, '평균 25ms = 40fps');
  ok(budget.fps('parallax') < BALANCE.parallaxMinFps, '임계 미만이면 패럴랙스를 끈다');
  for (let i = 0; i < 60; i += 1) budget.sample('parallax', 16);
  ok(budget.fps('parallax') > BALANCE.parallaxMinFps,
    '최근 창만 보므로 초반의 느린 프레임이 남은 세션을 끌어내리지 않는다');

  budget.reset();
  deepEq(budget.scenes(), [], '화면 전이는 원장을 비운다 — 화면별 표본이 섞이면 축이 무너진다');
});

// ------------------------------------------------------------------ 결과

// suite() 가 예외를 삼키므로, 하한이 없으면 스위트가 통째로 건너뛰어도 실패 1건으로만 보인다.
const MIN_CHECKS = 4600;
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
