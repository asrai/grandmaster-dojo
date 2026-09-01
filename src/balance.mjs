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
  { id: 'A-4', group: 'A', name: '월영문 문도', hanja: '月影門徒', mode: 'duel', stage: 4, styles: ['alpha', 'gamma', 'delta'] },
  { id: 'B',   group: 'B', name: '월영문', hanja: '月影門', mode: 'dispatch', stage: 1, styles: ['alpha', 'gamma', 'delta'] },
];

// ------------------------------------------------------- 수치 정본 로더 (#45)

const SOURCE = 'src/balance.data.json';

/**
 * 수치 정본의 형(型) 표 — 값은 JSON 이 지고 이 표는 필드 집합과 의미 제약만 진다.
 * JSON 은 주석을 실을 수 없으므로 값 옆에 있던 사유는 이 표와 아래 검증기가 대신 진다:
 * `winColorHintExchanges` 는 프로토 상시(∞) 지만 Infinity 가 JSON 왕복에서 null 이 되므로
 * 유한 상한을 쓰고, `bot.misHitRate` 는 spec 미지정분이라 없으면 선행 게이트가 공허해진다.
 * 토큰은 `NUM_RULES` 의 키(스칼라) · `map:<규칙>`(값이 전부 그 규칙인 map) · 전용 검사기 이름이다.
 */
const SHAPE = {
  telegraphMs: 'int+', windowBaseMs: 'int1+', windowStepMs: 'int+', windowBaseLen: 'int1+',
  openingWindowPenalty: 'ratio<1', accessibilityWindowMult: 'pos', accessibilityWindow: 'bool',
  resolveMs: 'int+', maxExchanges: 'int1+',
  damageByLen: 'map:int1+', powerBase: 'pos', powerPerRank: 'nonneg',
  initiativeBase: 'pos', initiativePerRatio: 'nonneg', clashK: 'pos',
  grades: 'grades', effectiveSuccessMaxOrder: 'int+',
  trainGraduateHits: 'int1+',
  hintDelayMs: 'map:int+', ignoreHighlightAt: 'int1+',
  rankLadder: 'rankLadder', rankGate: 'map:int1+', rankMax: 'int1+', slots: 'int1+',
  discipleStartRank: 'int1+', discipleRankMax: 'int1+', discipleFireRatio: 'ratio',
  discipleTrain: 'map:int1+', mission: 'map:int+', killReadout: 'map:int1+',
  winColorHintExchanges: 'int1+', simEfficiency: 'pos', simTrainSeconds: 'int1+', buttonHitPx: 'int1+',
  reward: 'map:int+', bot: 'bot', hp: 'map:int1+', challengerRank: 'map:int1+',
  rematch: 'map:int+', reversalDecay: 'reversalDecay',
};

/**
 * 성 축 재설계(#64)가 폐기한 키 — 부재를 이름으로 확인한다. 미지 필드 검사만으로도 죽지만
 * 그 문면은 오타와 구분되지 않고, 잔존 참조 하나가 `undefined` 로 수식을 오염시키는 것이
 * 이 축의 실패 모드라 문면이 폐기를 지목해야 한다.
 */
const RETIRED = [
  'masteryTrainPct', 'masteryFullPct', 'threshold', 'rankPtsPerStyle',
  'rankStep', 'rankStepMult', 'equipMasteryPct', 'challengerPower',
];

/** 의미 제약 — 「숫자이기만 하면 통과」가 튜닝 오타를 조용히 게임 규칙으로 만든다 (#54). */
const NUM_RULES = {
  num: { test: (v) => isNum(v), why: '유한 수가 아니다' },
  nonneg: { test: (v) => isNum(v) && v >= 0, why: '0 이상의 유한 수가 아니다' },
  pos: { test: (v) => isNum(v) && v > 0, why: '양수가 아니다' },
  ratio: { test: (v) => isNum(v) && v >= 0 && v <= 1, why: '0~1 비율이 아니다' },
  'ratio<1': { test: (v) => isNum(v) && v >= 0 && v < 1, why: '0 이상 1 미만의 비율이 아니다' },
  'int+': { test: (v) => Number.isInteger(v) && v >= 0, why: '0 이상의 정수가 아니다' },
  'int1+': { test: (v) => Number.isInteger(v) && v >= 1, why: '1 이상의 정수가 아니다' },
};

/** 6단 판정표의 구조 축 — 등급 id 집합과 수식 분기 키는 튜닝 대상이 아니라 코드가 분기하는 값이다. */
const GRADE_IDS = ['crush', 'advantage', 'clash', 'disadvantage', 'reversal', 'struck'];
const GRADE_FIELDS = ['order', 'label', 'formula', 'outPct', 'inPct', 'opening'];
const GRADE_FORMULAS = ['pct', 'clash'];
const GRADE_OPENINGS = [null, 'foe', 'self'];
const BOT_RANGES = ['reactionMs', 'keyMs', 'navMs'];
const BOT_RATIOS = ['missRate', 'misHitRate'];
const LADDER_BAND_FIELDS = ['maxRank', 'cost', 'train'];

/** 소비처가 키로 직접 인덱싱하는 map — 키가 빠지면 값이 undefined 로 흘러 수식이 조용히 NaN 이 된다. */
const REQUIRED_MAP_KEYS = {
  hintDelayMs: ['duel', 'train'],
  reward: ['duelWin', 'dispatchWin'],
  rankGate: ['equip', 'unlock', 'oneTap'],
  rematch: ['rankGain', 'rankCap'],
  discipleTrain: ['secondsPerRank'],
  mission: ['unlockRank', 'foeCount', 'rankStep'],
  killReadout: ['minManualWindows'],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v) ?? String(v);
const setEq = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

function checkNum(path, value, rule, bad) {
  if (!NUM_RULES[rule].test(value)) bad(path, `${show(value)} 는 ${NUM_RULES[rule].why}`);
}

function checkNumMap(path, value, rule, bad) {
  if (!isPlain(value)) return bad(path, `${show(value)} 는 map 이 아니다`);
  for (const [k, v] of Object.entries(value)) checkNum(`${path}.${k}`, v, rule, bad);
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
    // 최상위와 같은 비대칭 금지 — 오타 키가 살아남으면 그 등급의 규칙이 조용히 기본값으로 돈다 (#54).
    for (const k of Object.keys(g)) if (!GRADE_FIELDS.includes(k)) bad(`grades.${id}.${k}`, '등급 스키마에 없는 필드');
    if (typeof g.label !== 'string' || g.label === '') bad(`grades.${id}.label`, `${show(g.label)} 는 표시 문자열이 아니다`);
    if (!GRADE_FORMULAS.includes(g.formula)) bad(`grades.${id}.formula`, `${show(g.formula)} 는 ${show(GRADE_FORMULAS)} 밖`);
    if (!GRADE_OPENINGS.includes(g.opening)) bad(`grades.${id}.opening`, `${show(g.opening)} 는 ${show(GRADE_OPENINGS)} 밖`);
    for (const key of ['outPct', 'inPct']) {
      if (g[key] !== null) checkNum(`grades.${id}.${key}`, g[key], 'ratio', bad);
    }
    if (!Number.isInteger(g.order) || g.order < 0) bad(`grades.${id}.order`, `${show(g.order)} 는 0 이상의 정수가 아니다`);
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
    else for (const [i, v] of r.entries()) checkNum(`bot.${key}[${i}]`, v, 'nonneg', bad);
  }
  for (const key of BOT_RATIOS) checkNum(`bot.${key}`, value[key], 'ratio', bad);
  checkNum('bot.pollMs', value.pollMs, 'int1+', bad);
  return undefined;
}

/**
 * 성 계단 사다리 (REQ-702) — 적립 3단 구조를 그대로 담는 표. `bands` 는 점수 적립으로 오르는
 * 구간이고 `finishRank`·`crushRank` 는 결정타·완파가 여는 계단이라 비용이 아니라 사건이다.
 */
function checkLadder(value, bad) {
  if (!isPlain(value)) return bad('rankLadder', `${show(value)} 는 map 이 아니다`);
  for (const key of ['train', 'duel']) checkNum(`rankLadder.gain.${key}`, value.gain?.[key], 'int1+', bad);
  if (!Array.isArray(value.bands) || value.bands.length === 0) {
    return bad('rankLadder.bands', `${show(value.bands)} 는 비어 있지 않은 배열이 아니다`);
  }
  let prev = 0;
  for (const [i, band] of value.bands.entries()) {
    const at = `rankLadder.bands[${i}]`;
    if (!isPlain(band)) { bad(at, `${show(band)} 는 구간 객체가 아니다`); continue; }
    for (const k of Object.keys(band)) if (!LADDER_BAND_FIELDS.includes(k)) bad(`${at}.${k}`, '구간 스키마에 없는 필드');
    checkNum(`${at}.maxRank`, band.maxRank, 'int1+', bad);
    checkNum(`${at}.cost`, band.cost, 'int1+', bad);
    if (typeof band.train !== 'boolean') bad(`${at}.train`, `${show(band.train)} 는 불리언이 아니다`);
    if (Number.isInteger(band.maxRank)) {
      if (band.maxRank <= prev) bad(`${at}.maxRank`, `${band.maxRank} 가 직전 구간 상한 ${prev} 보다 크지 않다`);
      prev = band.maxRank;
    }
  }
  for (const key of ['finishRank', 'crushRank']) checkNum(`rankLadder.${key}`, value[key], 'int1+', bad);
  return undefined;
}

/**
 * 역파 감쇠 (REQ-771) — 하한이 0 이면 성 차 하나가 절초를 무해하게 만들고, 1 이면 감쇠 자체가
 * 없는 것과 같다. 「절초는 무서워야 한다」가 이 두 끝을 다 배제하는 유일한 근거다.
 */
function checkReversalDecay(value, bad) {
  if (!isPlain(value)) return bad('reversalDecay', `${show(value)} 는 map 이 아니다`);
  checkNum('reversalDecay.perRank', value.perRank, 'ratio', bad);
  const floor = value.pierceFloor;
  if (!isNum(floor) || !(floor > 0) || !(floor < 1)) {
    bad('reversalDecay.pierceFloor', `${show(floor)} 는 0 초과 1 미만의 관통 하한이 아니다`);
  }
  return undefined;
}

/** 성 축 상수 사이의 순서 — 값 하나가 이 사슬을 깨면 계단이 서로를 건너뛴다 (REQ-711·713, #54). */
function checkRankOrder(values, bad) {
  const ladder = values.rankLadder;
  const gate = values.rankGate;
  if (!isPlain(ladder) || !Array.isArray(ladder.bands) || !isPlain(gate)) return;
  const trainCap = ladder.bands.filter((b) => b?.train).reduce((m, b) => Math.max(m, b.maxRank ?? 0), 0);
  const accrualMax = ladder.bands.reduce((m, b) => Math.max(m, b?.maxRank ?? 0), 0);
  const chain = [
    ['rankGate.equip', gate.equip], ['rankGate.unlock', gate.unlock], ['rankGate.oneTap', gate.oneTap],
  ];
  for (let i = 1; i < chain.length; i += 1) {
    const [prevName, prevValue] = chain[i - 1];
    const [name, value] = chain[i];
    if (isNum(prevValue) && isNum(value) && !(prevValue < value)) {
      bad(name, `${value} 가 ${prevName} ${prevValue} 보다 크지 않다 (장착 < 해금 < 원터치)`);
    }
  }
  // 원터치가 수련 상한을 넘으면 수련만으로는 결코 원터치에 닿지 못한다 — 8성 벽의 의도 밖이다.
  if (isNum(gate.oneTap) && gate.oneTap > trainCap) {
    bad('rankGate.oneTap', `${gate.oneTap} 가 수련 적립 상한 ${trainCap} 를 넘는다`);
  }
  if (isNum(ladder.finishRank) && ladder.finishRank !== accrualMax + 1) {
    bad('rankLadder.finishRank', `${ladder.finishRank} 가 적립 상한 ${accrualMax} 의 다음 계단이 아니다`);
  }
  if (isNum(ladder.crushRank) && ladder.crushRank !== ladder.finishRank + 1) {
    bad('rankLadder.crushRank', `${ladder.crushRank} 가 ${ladder.finishRank} 의 다음 계단이 아니다`);
  }
  if (isNum(ladder.crushRank) && isNum(values.rankMax) && ladder.crushRank !== values.rankMax) {
    bad('rankLadder.crushRank', `${ladder.crushRank} 가 성 상한 ${values.rankMax} 와 다르다`);
  }
  if (isNum(values.discipleRankMax) && isNum(values.rankMax) && values.discipleRankMax > values.rankMax) {
    bad('discipleRankMax', `${values.discipleRankMax} 가 성 상한 ${values.rankMax} 를 넘는다`);
  }
  if (isNum(values.discipleStartRank) && isNum(values.discipleRankMax)
    && values.discipleStartRank > values.discipleRankMax) {
    bad('discipleStartRank', `${values.discipleStartRank} 가 제자 성 상한 ${values.discipleRankMax} 를 넘는다`);
  }
  // 재대련 강화가 성 상한을 넘으면 `powerOf` 가 규칙 밖의 내공을 내고 도달 가능성 불변식이 흐려진다 (REQ-734).
  const cap = values.rematch?.rankCap;
  const topFoe = isPlain(values.challengerRank)
    ? Object.values(values.challengerRank).reduce((m, v) => Math.max(m, isNum(v) ? v : 0), 0) : 0;
  if (isNum(cap) && isNum(values.rankMax) && topFoe + cap > values.rankMax) {
    bad('rematch.rankCap', `최고 도전자 성 ${topFoe} 에 ${cap} 를 더하면 성 상한 ${values.rankMax} 를 넘는다`);
  }
  checkMission(values, bad);
}

/**
 * 임무 축 (REQ-742·743) — B-2 하드 잠금은 「도달할 수 있는 성」을 요구해야 잠금이지 봉인이 아니고,
 * 아키타입 풀보다 큰 `foeSet` 은 중복 없는 조합 자체가 성립하지 않는다.
 */
function checkMission(values, bad) {
  const mission = values.mission;
  if (!isPlain(mission)) return;
  if (isNum(mission.unlockRank) && isNum(values.discipleRankMax) && mission.unlockRank > values.discipleRankMax) {
    bad('mission.unlockRank', `${mission.unlockRank} 가 제자 성 상한 ${values.discipleRankMax} 를 넘어 잠금이 영구 봉인이 된다`);
  }
  if (isNum(mission.foeCount) && (mission.foeCount < 1 || mission.foeCount > FOE_STYLES.length)) {
    bad('mission.foeCount', `${mission.foeCount} 가 적 초식 아키타입 ${FOE_STYLES.length} 종의 1~전량 범위 밖이다`);
  }
}

/**
 * 관통 하한의 도달 가능성 (REQ-771) — 역파는 절초 보유 도전자에게서만 나므로 그 무대의 최대
 * 성 차가 감쇠의 정의역 상계다. 하한이 그보다 뒤에서 물리면 하한은 사표(死表)가 되어
 * 「절초는 무서워야 한다」를 지키는 장치가 아무것도 없다.
 */
function checkReversalReach(values, bad) {
  const decay = values.reversalDecay;
  if (!isPlain(decay) || !isNum(decay.perRank) || !isNum(decay.pierceFloor)) return;
  // 계수 0 은 감쇠를 끈 상태라 하한이 쓰일 자리 자체가 없다.
  if (decay.perRank === 0) return;
  const bindAt = Math.ceil((1 - decay.pierceFloor) / decay.perRank);
  for (const c of CHALLENGERS) {
    if (!c.styles.some((id) => FOE_STYLES.find((f) => f.id === id)?.finisher)) continue;
    const selfMax = c.mode === 'duel' ? values.rankMax : values.discipleRankMax;
    const spread = selfMax - (values.challengerRank?.[c.id] ?? 0);
    if (isNum(selfMax) && bindAt > spread) {
      bad('reversalDecay.pierceFloor', `${c.id} 무대의 최대 성 차 ${spread} 로는 하한 ${decay.pierceFloor} 에 닿지 못한다`
        + ` (성 차 ${bindAt} 필요) — perRank 를 ${((1 - decay.pierceFloor) / spread).toFixed(4)} 이상으로 올려라`);
    }
  }
}

/** 콘텐츠 테이블과의 결합 — 이 세 축이 어긋나면 화면·판정이 조용히 빈 값을 읽는다. */
function checkContentJoins(values, bad) {
  const challengerIds = CHALLENGERS.map((c) => c.id);
  const hpKeys = ['user', 'disciple', ...challengerIds];
  if (isPlain(values.hp)) {
    for (const k of hpKeys) if (!(k in values.hp)) bad('hp', `키 ${show(k)} 누락 (CHALLENGERS 와 1:1)`);
    for (const k of Object.keys(values.hp)) if (!hpKeys.includes(k)) bad('hp', `키 ${show(k)} 는 CHALLENGERS 에 없다`);
  }
  if (isPlain(values.challengerRank)) {
    for (const k of challengerIds) if (!(k in values.challengerRank)) bad('challengerRank', `키 ${show(k)} 누락 (CHALLENGERS 와 1:1)`);
    for (const k of Object.keys(values.challengerRank)) {
      if (!challengerIds.includes(k)) bad('challengerRank', `키 ${show(k)} 는 CHALLENGERS 에 없다`);
      else if (isNum(values.rankMax) && values.challengerRank[k] > values.rankMax) {
        bad(`challengerRank.${k}`, `${values.challengerRank[k]} 가 성 상한 ${values.rankMax} 를 넘는다`);
      }
    }
  }
  if (isPlain(values.damageByLen)) {
    for (const len of new Set(STYLES.map((s) => s.seq.length))) {
      if (!(String(len) in values.damageByLen)) bad('damageByLen', `초식 길이 ${len} 의 피해가 없다`);
    }
  }
}

/**
 * 값 지문 (#54) — `rev` 가 값 변경을 반드시 따라가게 하는 결합. 값만 고치고 `rev` 를 두면
 * 내보낸 로그의 지문이 옛 판본을 달고 나가 실험 회차 귀속이 조용히 틀리므로 로드 시점에 죽인다.
 * 키 순서에 무관하도록 정렬해 직렬화하고, 브라우저에서도 도는 FNV-1a 로 32bit 를 낸다.
 * 지문의 공급원은 로드 실패 문면이다 — 이 export 는 하네스가 그 문면을 대조하기 위한 자리다.
 */
export function valueDigest(values) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (isPlain(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    return v;
  };
  const text = JSON.stringify(canonical(values));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const REV_PATTERN = /^(.+)\/([0-9a-f]{8})$/;

function checkRev(rev, values, bad) {
  if (typeof rev !== 'string' || rev.trim() === '') {
    return bad('rev', `${show(rev)} 는 비어 있지 않은 판본 문자열이 아니다`);
  }
  const digest = valueDigest(values);
  const parsed = REV_PATTERN.exec(rev);
  if (!parsed) return bad('rev', `${show(rev)} 가 "<판본>/<값 지문 8자리>" 꼴이 아니다 — "${rev}/${digest}" 로 갱신하라`);
  if (parsed[2] !== digest) bad('rev', `값 지문이 ${show(digest)} 인데 rev 는 ${show(parsed[2])} 다 — "${parsed[1]}/${digest}" 로 갱신하라`);
  return undefined;
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
  checkRev(rev, values, bad);

  for (const [key, kind] of Object.entries(SHAPE)) {
    if (!(key in values)) { bad(key, '필드 누락'); continue; }
    const v = values[key];
    if (kind === 'bool') { if (typeof v !== 'boolean') bad(key, `${show(v)} 는 불리언이 아니다`); }
    else if (kind === 'grades') checkGrades(v, bad);
    else if (kind === 'bot') checkBot(v, bad);
    else if (kind === 'rankLadder') checkLadder(v, bad);
    else if (kind === 'reversalDecay') checkReversalDecay(v, bad);
    else if (kind.startsWith('map:')) checkNumMap(key, v, kind.slice(4), bad);
    else checkNum(key, v, kind, bad);
  }
  for (const key of Object.keys(values)) {
    if (RETIRED.includes(key)) bad(key, '성 축 재설계로 폐기된 필드 (#64)');
    else if (!(key in SHAPE)) bad(key, '스키마에 없는 필드');
  }

  checkRankOrder(values, bad);
  checkReversalReach(values, bad);
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
