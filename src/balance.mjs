// 밸런스 파라미터 + 데이터 테이블. 튜닝은 이 파일의 값만 바꾼다 — 판정·성장 로직은
// src/core.mjs 의 순수 함수에만 있고 수치를 갖지 않는다 (spec REQ-205·501~503·606).

/** 속성 삼각 — 쾌 > 강 > 정 > 쾌. `beats` 가 삼각의 유일한 표현이다. */
export const ATTRS = {
  fast: { id: 'fast', label: '쾌', hanja: '快', beats: 'hard' },
  hard: { id: 'hard', label: '강', hanja: '剛', beats: 'fine' },
  fine: { id: 'fine', label: '정', hanja: '精', beats: 'fast' },
};

/** 시퀀스 원소 → 표시용 화살표. */
export const ARROW = { U: '↑', D: '↓', L: '←', R: '→' };

export const BALANCE = {
  // 한 수의 타임라인 (REQ-201·204·210)
  telegraphMs: 1000,
  windowBaseMs: 2600,
  windowStepMs: 500,
  windowBaseLen: 3,
  openingWindowPenalty: 0.4,
  accessibilityWindowMult: 1.3,
  accessibilityWindow: false,
  resolveMs: 500,
  maxExchanges: 12,

  // 피해 (REQ-203)
  damageByLen: { 3: 10, 4: 14, 5: 20 },
  powerBase: 1,
  powerPerRank: 0.05,
  initiativeBase: 1,
  initiativePerRatio: 0.3,
  clashK: 0.5,

  // 6단 판정표 (REQ-202) — `order` 가 등급 서열이고, 유효 성공은 그 서열의 절단선이다.
  grades: {
    crush:        { order: 0, label: '완파', formula: 'pct',   outPct: 1,   inPct: 0,   opening: 'foe' },
    advantage:    { order: 1, label: '우세', formula: 'pct',   outPct: 0.6, inPct: 0.2, opening: null },
    clash:        { order: 2, label: '상쇄', formula: 'clash', outPct: null, inPct: null, opening: null },
    disadvantage: { order: 3, label: '열세', formula: 'pct',   outPct: 0.2, inPct: 0.6, opening: null },
    reversal:     { order: 4, label: '역파', formula: 'pct',   outPct: 0,   inPct: 1,   opening: 'self' },
    struck:       { order: 5, label: '피격', formula: 'pct',   outPct: 0,   inPct: 1,   opening: null },
  },
  effectiveSuccessMaxOrder: 2,

  // 숙련·성·슬롯 (REQ-301~305)
  trainGraduateHits: 3,
  masteryTrainPct: 30,
  masteryFullPct: 100,
  hintDelayMs: { duel: 500, train: 0 },
  threshold: { 'yuun-bo': 4, 'jeok-un': 4, 'haeng-un': 5, 'pa-un': 5 },
  rankPtsPerStyle: { 'yuun-bo': 1, 'jeok-un': 2, 'haeng-un': 3, 'pa-un': 4 },
  rankStep: 3,
  rankStepMult: { 11: 2, 12: 4 },
  rankMax: 12,
  slots: 3,
  equipMasteryPct: 30,

  // 제자 (REQ-401·402)
  discipleStartRank: 1,
  discipleRankMax: 10,
  discipleFireRatio: 0.6,

  // 노출·재화·입력 (REQ-206·604 · REQ-101)
  winColorHintExchanges: Infinity,
  simEfficiency: 0.1,
  buttonHitPx: 56,
  reward: { duelWin: 30, dispatchWin: 50 },

  // HP·내공 시드 — 도전자 키는 CHALLENGERS.id 와 1:1 (REQ-506 게이트가 하향 조정한다)
  hp: { user: 100, disciple: 100, 'A-1': 40, 'A-2': 55, 'A-3': 70, B: 80 },
  challengerPower: { A: 1, B: 1.1 },
};

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
