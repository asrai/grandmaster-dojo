// 콘텐츠 테이블 + 수치 정본(src/balance.data.json) 로더. 튜닝은 JSON 만 고치면 되고, 판정·성장
// 로직은 src/core.mjs 의 순수 함수에만 있어 수치를 갖지 않는다 (spec REQ-205·501~503·606).

import data from './balance.data.json' with { type: 'json' };

/** 속성 삼각 — 쾌 > 강 > 정 > 쾌. `beats` 가 삼각의 유일한 표현이다. */
export const ATTRS = {
  fast: { id: 'fast', label: '쾌', hanja: '快', beats: 'hard' },
  hard: { id: 'hard', label: '강', hanja: '剛', beats: 'fine' },
  fine: { id: 'fine', label: '정', hanja: '精', beats: 'fast' },
};

/** 시퀀스 원소 → 표시용 화살표. */
export const ARROW = { U: '↑', D: '↓', L: '←', R: '→' };

/**
 * 유운검법 4식 (REQ-501). 첫 키 `↓` 공유 + 2번째 키 분기 = prefix-free.
 * `counters` = 이 초식이 파하는 상대 초식 — 유저·도전자 양 테이블에서 같은 방향이다.
 */
export const STYLES = [
  {
    id: 'yuun-bo', set: 'yuun-geom', order: 1,
    name: '유운보', hanja: '流雲步', attr: 'fast',
    seq: ['D', 'R', 'U'], d: 10, counters: 'alpha',
    gugyeol: '무거운 것이 내려오거든 맞서지 말고 앞질러 흘려라',
  },
  {
    id: 'jeok-un', set: 'yuun-geom', order: 2,
    name: '적운압정', hanja: '積雲壓頂', attr: 'hard',
    seq: ['D', 'L', 'R'], d: 10, counters: 'beta',
    gugyeol: '기교를 부리는 손은 쌓인 구름의 무게로 눌러라',
  },
  {
    id: 'haeng-un', set: 'yuun-geom', order: 3,
    name: '행운유수', hanja: '行雲流水', attr: 'fine',
    seq: ['D', 'U', 'R', 'L'], d: 14, counters: 'gamma',
    gugyeol: '빠른 것은 막지 말고 흐름을 읽어 흘려보내라',
  },
  {
    id: 'pa-un', set: 'yuun-geom', order: 4,
    name: '파운현월', hanja: '破雲見月', attr: 'fast',
    seq: ['D', 'D', 'R', 'L', 'U'], d: 20, counters: 'delta',
    gugyeol: '끝을 내려는 한 수, 구름을 갈라 달을 드러내라',
  },
];

/** 무공 (REQ-502). `transmitRank` = 전수 조건. */
export const ART_SETS = [
  {
    id: 'yuun-geom', name: '유운검법', hanja: '流雲劍法',
    styles: ['yuun-bo', 'jeok-un', 'haeng-un', 'pa-un'], transmitRank: 12,
  },
];

/** 제자 (REQ-401·502). 성 map 은 런타임 상태라 여기 없다. */
export const DISCIPLE = { level: 1, artSlots: 1 };

/**
 * 도전자 초식 (REQ-503). 유저가 입력하지 않으므로 시퀀스가 없고 `len` 만 갖는다.
 * 절초만 `counters` 를 갖고, 그것이 역파의 유일한 발생원이다.
 */
export const FOE_STYLES = [
  { id: 'alpha', name: '벽산도', hanja: '劈山刀', attr: 'hard', len: 3, d: 10, finisher: false, counters: null },
  { id: 'beta',  name: '세류검', hanja: '細柳劍', attr: 'fine', len: 4, d: 14, finisher: false, counters: null },
  { id: 'gamma', name: '질풍각', hanja: '疾風脚', attr: 'fast', len: 4, d: 14, finisher: false, counters: null },
  { id: 'delta', name: '월영자', hanja: '月影刺', attr: 'fine', len: 5, d: 20, finisher: true,  counters: 'yuun-bo' },
];

/** 도전자 (REQ-503). `styles` 순서 = 수마다 순환하는 예고 순서. */
export const CHALLENGERS = [
  { id: 'A-1', group: 'A', name: '떠돌이 무인', hanja: '流浪武人', mode: 'duel', stage: 1, styles: ['alpha'] },
  { id: 'A-2', group: 'A', name: '떠돌이 무인', hanja: '流浪武人', mode: 'duel', stage: 2, styles: ['alpha', 'beta'] },
  { id: 'A-3', group: 'A', name: '떠돌이 무인', hanja: '流浪武人', mode: 'duel', stage: 3, styles: ['alpha', 'beta', 'gamma'] },
  { id: 'B',   group: 'B', name: '월영문', hanja: '月影門', mode: 'dispatch', stage: 1, styles: ['alpha', 'gamma', 'delta'] },
];

// ------------------------------------------------------- 수치 정본 로더 (#45)

const SOURCE = 'src/balance.data.json';

/**
 * 수치 정본의 형(型) 표 — 값은 JSON 이 지고 이 표는 필드 집합과 타입만 진다.
 * JSON 은 주석을 실을 수 없으므로 값 옆에 있던 사유는 이 표와 아래 검증기가 대신 진다:
 * `winColorHintExchanges` 는 프로토 상시(∞) 지만 Infinity 가 JSON 왕복에서 null 이 되므로
 * 유한 상한을 쓰고, `bot.misHitRate` 는 spec 미지정분이라 없으면 선행 게이트가 공허해진다.
 * 종류: `num` 유한 수 · `bool` 불리언 · `numMap` 값이 전부 유한 수인 map · 나머지는 전용 검사기.
 */
const SHAPE = {
  telegraphMs: 'num', windowBaseMs: 'num', windowStepMs: 'num', windowBaseLen: 'num',
  openingWindowPenalty: 'num', accessibilityWindowMult: 'num', accessibilityWindow: 'bool',
  resolveMs: 'num', maxExchanges: 'num',
  damageByLen: 'numMap', powerBase: 'num', powerPerRank: 'num',
  initiativeBase: 'num', initiativePerRatio: 'num', clashK: 'num',
  grades: 'grades', effectiveSuccessMaxOrder: 'num',
  trainGraduateHits: 'num', masteryTrainPct: 'num', masteryFullPct: 'num',
  hintDelayMs: 'numMap', ignoreHighlightAt: 'num',
  threshold: 'numMap', rankPtsPerStyle: 'numMap', rankStep: 'num', rankStepMult: 'numMap',
  rankMax: 'num', slots: 'num', equipMasteryPct: 'num',
  discipleStartRank: 'num', discipleRankMax: 'num', discipleFireRatio: 'num',
  winColorHintExchanges: 'num', simEfficiency: 'num', simTrainSeconds: 'num', buttonHitPx: 'num',
  reward: 'numMap', bot: 'bot', hp: 'numMap', challengerPower: 'numMap',
};

/** 6단 판정표의 구조 축 — 등급 id 집합과 수식 분기 키는 튜닝 대상이 아니라 코드가 분기하는 값이다. */
const GRADE_IDS = ['crush', 'advantage', 'clash', 'disadvantage', 'reversal', 'struck'];
const GRADE_FORMULAS = ['pct', 'clash'];
const GRADE_OPENINGS = [null, 'foe', 'self'];
const BOT_RANGES = ['reactionMs', 'keyMs', 'navMs'];
const BOT_SCALARS = ['missRate', 'misHitRate', 'pollMs'];

/** 소비처가 키로 직접 인덱싱하는 map — 키가 빠지면 값이 undefined 로 흘러 수식이 조용히 NaN 이 된다. */
const REQUIRED_MAP_KEYS = {
  hintDelayMs: ['duel', 'train'],
  reward: ['duelWin', 'dispatchWin'],
  challengerPower: [...new Set(CHALLENGERS.map((c) => c.group))],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v) ?? String(v);
const setEq = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

function checkNumMap(path, value, bad) {
  if (!isPlain(value)) return bad(path, `${show(value)} 는 map 이 아니다`);
  for (const [k, v] of Object.entries(value)) if (!isNum(v)) bad(`${path}.${k}`, `${show(v)} 는 유한 수가 아니다`);
  for (const k of REQUIRED_MAP_KEYS[path] ?? []) if (!(k in value)) bad(path, `키 ${show(k)} 누락`);
  return undefined;
}

function checkGrades(value, bad) {
  if (!isPlain(value)) return bad('grades', `${show(value)} 는 map 이 아니다`);
  const ids = Object.keys(value);
  if (!setEq(ids.slice().sort(), GRADE_IDS.slice().sort())) {
    bad('grades', `등급 키 ${show(ids)} 가 6단 ${show(GRADE_IDS)} 와 다르다`);
  }
  const orders = [];
  for (const [id, g] of Object.entries(value)) {
    if (!isPlain(g)) { bad(`grades.${id}`, `${show(g)} 는 등급 객체가 아니다`); continue; }
    if (typeof g.label !== 'string' || g.label === '') bad(`grades.${id}.label`, `${show(g.label)} 는 표시 문자열이 아니다`);
    if (!GRADE_FORMULAS.includes(g.formula)) bad(`grades.${id}.formula`, `${show(g.formula)} 는 ${show(GRADE_FORMULAS)} 밖`);
    if (!GRADE_OPENINGS.includes(g.opening)) bad(`grades.${id}.opening`, `${show(g.opening)} 는 ${show(GRADE_OPENINGS)} 밖`);
    for (const key of ['outPct', 'inPct']) {
      if (g[key] !== null && !isNum(g[key])) bad(`grades.${id}.${key}`, `${show(g[key])} 는 수도 null 도 아니다`);
    }
    if (!isNum(g.order)) bad(`grades.${id}.order`, `${show(g.order)} 는 유한 수가 아니다`);
    else orders.push(g.order);
  }
  const expected = GRADE_IDS.map((_, i) => i);
  if (orders.length === GRADE_IDS.length && !setEq(orders.slice().sort((a, b) => a - b), expected)) {
    bad('grades.*.order', `서열 ${show(orders.slice().sort((a, b) => a - b))} 가 ${show(expected)} 의 순열이 아니다`);
  }
  return undefined;
}

function checkBot(value, bad) {
  if (!isPlain(value)) return bad('bot', `${show(value)} 는 map 이 아니다`);
  for (const key of BOT_RANGES) {
    const r = value[key];
    if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) bad(`bot.${key}`, `${show(r)} 는 [최소, 최대] 두 수가 아니다`);
    else if (r[0] > r[1]) bad(`bot.${key}`, `${show(r)} 는 [최소, 최대] 순서가 뒤집혔다`);
  }
  for (const key of BOT_SCALARS) if (!isNum(value[key])) bad(`bot.${key}`, `${show(value[key])} 는 유한 수가 아니다`);
  return undefined;
}

/** 콘텐츠 테이블과의 결합 — 이 세 축이 어긋나면 화면·판정이 조용히 빈 값을 읽는다. */
function checkContentJoins(values, bad) {
  const hpKeys = ['user', 'disciple', ...CHALLENGERS.map((c) => c.id)];
  if (isPlain(values.hp)) {
    for (const k of hpKeys) if (!(k in values.hp)) bad('hp', `키 ${show(k)} 누락 (CHALLENGERS 와 1:1)`);
    for (const k of Object.keys(values.hp)) if (!hpKeys.includes(k)) bad('hp', `키 ${show(k)} 는 CHALLENGERS 에 없다`);
  }
  if (isPlain(values.damageByLen)) {
    for (const len of new Set(STYLES.map((s) => s.seq.length))) {
      if (!(String(len) in values.damageByLen)) bad('damageByLen', `초식 길이 ${len} 의 피해가 없다`);
    }
  }
  const styleIds = STYLES.map((s) => s.id).sort();
  for (const key of ['threshold', 'rankPtsPerStyle']) {
    if (!isPlain(values[key])) continue;
    if (!setEq(Object.keys(values[key]).sort(), styleIds)) {
      bad(key, `키 ${show(Object.keys(values[key]))} 가 초식 id ${show(styleIds)} 와 다르다`);
    }
  }
}

/**
 * 수치 정본 검증기 — 오류를 전건 모아 한 번에 throw 한다 (폴백 없음: 잘못된 값으로 도는 것보다
 * 로드 시점에 죽는 편이 「값을 바꿨는데 안 바뀐다」를 막는다).
 * @returns {{ rev: string, values: object }}
 */
export function validateBalance(raw) {
  const errors = [];
  const bad = (path, message) => { errors.push(`${path}: ${message}`); };

  if (!isPlain(raw)) {
    throw new Error(`밸런스 데이터 불량 — ${SOURCE} 1건:\n  (root): ${show(raw)} 는 객체가 아니다`);
  }
  const { rev, ...values } = raw;
  if (typeof rev !== 'string' || rev.trim() === '') bad('rev', `${show(rev)} 는 비어 있지 않은 판본 문자열이 아니다`);

  for (const [key, kind] of Object.entries(SHAPE)) {
    if (!(key in values)) { bad(key, '필드 누락'); continue; }
    const v = values[key];
    if (kind === 'num' && !isNum(v)) bad(key, `${show(v)} 는 유한 수가 아니다`);
    else if (kind === 'bool' && typeof v !== 'boolean') bad(key, `${show(v)} 는 불리언이 아니다`);
    else if (kind === 'numMap') checkNumMap(key, v, bad);
    else if (kind === 'grades') checkGrades(v, bad);
    else if (kind === 'bot') checkBot(v, bad);
  }
  for (const key of Object.keys(values)) if (!(key in SHAPE)) bad(key, '스키마에 없는 필드');

  checkContentJoins(values, bad);

  if (errors.length > 0) {
    throw new Error(`밸런스 데이터 불량 — ${SOURCE} ${errors.length}건:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  }
  return { rev, values };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

const loaded = validateBalance(data);

/** 실험 변형 지문 — 내보낸 로그의 밸런스 digest 에 실려 회차 귀속을 가능하게 한다. */
export const BALANCE_REV = loaded.rev;
export const BALANCE = deepFreeze(loaded.values);
