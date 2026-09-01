// 판정·성장·전수·제자 선택의 순수 함수 층 (spec REQ-202~205·701~708·711~715·721~723).
// 상태는 전부 인자로만 오간다 — 이 모듈은 DOM 도 저장소도 알지 못해 헤드리스로 회귀된다.

import {
  ART_SETS, ATTRS, BALANCE, CHALLENGERS, DISCIPLE, FOE_STYLES, STYLES,
} from './balance.mjs';

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
const STYLE_BY_ID = byId(STYLES);
const FOE_STYLE_BY_ID = byId(FOE_STYLES);
const ART_BY_ID = byId(ART_SETS);
const CHALLENGER_BY_ID = byId(CHALLENGERS);

export const styleById = (id) => STYLE_BY_ID.get(id) ?? null;
export const foeStyleById = (id) => FOE_STYLE_BY_ID.get(id) ?? null;
export const artById = (id) => ART_BY_ID.get(id) ?? null;
export const challengerById = (id) => CHALLENGER_BY_ID.get(id) ?? null;

/**
 * 무공에 속한 초식 (REQ-502) — 무공 정의의 목록이 원본이고, 전수 복사와 적립 게이트가 같은
 * 이 자리를 읽는다. 초식 단위로 갈라진 목록이 두 벌 생기면 둘 중 하나가 조용히 낡는다.
 */
export function artStyles(setId) {
  const art = artById(setId);
  if (!art) throw new Error(`알 수 없는 무공: ${setId}`);
  return art.styles.map((id) => {
    const style = styleById(id);
    if (!style) throw new Error(`무공에 미존재 초식: ${setId} → ${id}`);
    return style;
  });
}

/** 도전자가 보유한 절초 (없으면 null) — 역파 판정과 제자 회피의 입력. */
export function finisherOf(challenger) {
  const found = challenger.styles.map(foeStyleById).find((s) => s && s.finisher);
  return found ?? null;
}

// ---------------------------------------------------------------- 데이터 무결성

/** 한 초식의 시퀀스가 다른 초식의 접두어이면 발동 조건이 성립하지 않는다 (REQ-113·505). */
export function assertPrefixFree(styles) {
  const rows = styles.map((s) => ({ id: s.id, key: s.seq.join('') }));
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows.length; j += 1) {
      if (i === j) continue;
      const [a, b] = [rows[i], rows[j]];
      if (b.key.startsWith(a.key)) {
        throw new Error(`prefix-free 위반: ${a.id}(${a.key}) 가 ${b.id}(${b.key}) 의 접두어`);
      }
    }
  }
  return true;
}

/** 파해는 초식 1:1 — 한 초식을 두 초식이 파하면 완파 판정이 비결정적이 된다 (REQ-505). */
export function assertCounterIntegrity(styles, universe = styles) {
  const ids = new Set(universe.map((s) => s.id));
  const counteredBy = new Map();
  for (const s of styles) {
    if (!s.counters) continue;
    if (!ids.has(s.counters)) throw new Error(`파해 대상 미존재: ${s.id} → ${s.counters}`);
    if (s.counters === s.id) throw new Error(`파해 자기 참조: ${s.id}`);
    if (counteredBy.has(s.counters)) {
      throw new Error(`파해 1:1 위반: ${s.counters} 를 ${counteredBy.get(s.counters)} 와 ${s.id} 가 함께 파한다`);
    }
    counteredBy.set(s.counters, s.id);
  }
  return true;
}

// ------------------------------------------------------------------ 한 수의 산술

/** 응수 창 (REQ-201). `len` = 그 수에 노출된 초식 길이 — 실전은 상대 예고, 수련은 자기 초식. */
export function responseWindowMs(len, { selfOpen = false, accessibility = BALANCE.accessibilityWindow } = {}) {
  let ms = BALANCE.windowBaseMs + BALANCE.windowStepMs * (len - BALANCE.windowBaseLen);
  if (selfOpen) ms *= 1 - BALANCE.openingWindowPenalty;
  if (accessibility) ms *= BALANCE.accessibilityWindowMult;
  return Math.round(ms);
}

/** 내공 N (REQ-203·721) — 입력은 무공이 아니라 그 초식의 성이다. */
export const powerOf = (rank) => BALANCE.powerBase + BALANCE.powerPerRank * rank;

/**
 * 도전자 성 (REQ-722) — 도전자별 성 1개가 그 도전자의 전 초식에 걸린다.
 * 미등록 id 를 접으면 `powerOf(undefined)` 가 NaN 으로 흘러 응수 창 안에서야 죽는다.
 */
export function foeRankOf(challengerId) {
  const rank = BALANCE.challengerRank[challengerId];
  if (rank === undefined) throw new Error(`도전자 성이 없다: ${challengerId}`);
  return rank;
}

/**
 * 도전자 내공 — 재대련 강화가 **없는** 초회 대면의 값이다. 실전 경로는 강화가 실린
 * `foeRank` 를 `createMatch` 로 받으므로, 이 export 는 그 파생 관계를 대조하는 하네스의 자리다.
 */
export const foePowerOf = (challengerId) => powerOf(foeRankOf(challengerId));

/**
 * 재대련 강화 성 (REQ-734) — 이긴 횟수만큼 +1 씩 오르되 상한이 있다. 상한은 편의 파라미터가
 * 아니라 도달 가능성 불변식이다: 파운현월의 **파해** 완파 무대가 A-4 뿐이라, 무한 누적은 A-4
 * 반복 실패가 그 초식의 12성 주 경로를 닫는 상태를 만든다 (빈틈 완파 경로는 남는다 — 하네스
 * 「빈틈 완파도 12성 자격이다」 단정).
 * @param {number} baseRank 그 도전자의 초회 성
 * @param {number} priorWins 그 도전자를 이미 이긴 횟수 (초회 대면은 0)
 */
export function rematchFoeRank(baseRank, priorWins) {
  if (!Number.isInteger(priorWins) || priorWins < 0) throw new Error(`재대련 승수가 0 이상의 정수가 아니다: ${priorWins}`);
  const bonus = Math.min(BALANCE.rematch.rankCap, BALANCE.rematch.rankGain * priorWins);
  return Math.min(BALANCE.rankMax, baseRank + bonus);
}

/**
 * 역파 피격 감쇠 계수 (REQ-771) — 내 초식이 상대보다 여문 만큼 덜 아프되 관통 하한 아래로는
 * 내려가지 않는다. 하한의 목적은 「절초는 무서워야 한다」 하나이고 난이도 손잡이가 아니다.
 */
export function reversalDecayFactor(selfRank, foeRank) {
  const { perRank, pierceFloor } = BALANCE.reversalDecay;
  return Math.max(pierceFloor, 1 - perRank * Math.max(0, selfRank - foeRank));
}

/** 선기 배수 — `r` = 응수 창 잔여 비율 (REQ-203). */
export const initiativeOf = (r) => BALANCE.initiativeBase + BALANCE.initiativePerRatio * r;

/** 판정 ≥ 상쇄 = 유효 성공 — 성 적립의 유일한 단위다 (REQ-703). */
export const isEffectiveSuccess = (grade) => BALANCE.grades[grade].order <= BALANCE.effectiveSuccessMaxOrder;

function gradeOf({ selfStyle, foeStyle, foeOpen }) {
  if (!selfStyle) return 'struck';
  if (foeOpen) return 'crush';
  // 예고가 없는데 빈틈도 아니면 판정 근거가 없다 — 완파로 접으면 id 오타가 공짜 완파가 된다.
  if (!foeStyle) throw new Error('상대 빈틈이 아닌 수에 상대 초식이 없다');
  if (selfStyle.counters === foeStyle.id) return 'crush';
  if (foeStyle.finisher && foeStyle.counters === selfStyle.id) return 'reversal';
  if (ATTRS[selfStyle.attr].beats === foeStyle.attr) return 'advantage';
  if (ATTRS[foeStyle.attr].beats === selfStyle.attr) return 'disadvantage';
  return 'clash';
}

/**
 * 6단 판정 + 피해 정수 + 다음 수 빈틈 (REQ-202~204).
 * @param {object} p
 * @param {?object} p.selfStyle 창 안에 완주한 내 초식 (미완주 = null)
 * @param {?object} p.foeStyle  상대 예고 초식 (상대 빈틈이면 무의미)
 * @param {number} p.selfRank   그 초식의 성 (REQ-721)
 * @param {number} p.foeRank    상대 성 — 내공의 출처이자 역파 감쇠의 기준이다 (REQ-722·771)
 * @param {number} [p.foePower] 상대 내공. 기본값이 `foeRank` 파생이라 명시하지 않는 한 갈리지 않는다
 * @param {number} [p.r]        발동 시점의 창 잔여 비율
 * @param {boolean} [p.foeOpen] 이 수가 상대 빈틈인가
 */
export function judge({
  selfStyle, foeStyle = null, selfRank, foeRank, foePower = powerOf(foeRank), r = 0, foeOpen = false,
}) {
  if (!(r >= 0 && r <= 1)) throw new Error(`선기 잔여 비율이 0~1 밖: ${r}`);
  // 음수·비정수는 내공을 뒤집어 피해를 회복으로 만든다 — 유한성만으로는 못 막는다.
  if (!Number.isInteger(selfRank) || selfRank < 1) throw new Error(`성이 1 이상의 정수가 아니다: ${selfRank}`);
  if (!Number.isInteger(foeRank) || foeRank < 1) throw new Error(`상대 성이 1 이상의 정수가 아니다: ${foeRank}`);
  if (!Number.isFinite(foePower) || foePower <= 0) throw new Error(`상대 내공이 양수가 아니다: ${foePower}`);
  const grade = gradeOf({ selfStyle, foeStyle, foeOpen });
  const rule = BALANCE.grades[grade];
  const selfPower = powerOf(selfRank);
  const selfD = selfStyle ? selfStyle.d : 0;
  // 상대 빈틈에는 상대가 초식을 내지 않으므로 받는 피해의 근거가 없다.
  const foeD = foeStyle && !foeOpen ? foeStyle.d : 0;

  let out;
  let incoming;
  if (rule.formula === 'clash') {
    out = Math.max(0, selfPower - foePower) * selfD * BALANCE.clashK * initiativeOf(r);
    incoming = Math.max(0, foePower - selfPower) * foeD * BALANCE.clashK;
  } else {
    out = selfD * selfPower * initiativeOf(r) * rule.outPct;
    incoming = foeD * foePower * rule.inPct;
    // 감쇠는 피해량 축이라 등급·빈틈은 그대로다 — 여기서 등급이 흔들리면 감쇠를 잘못 꽂은 것이다.
    if (grade === 'reversal') incoming *= reversalDecayFactor(selfRank, foeRank);
  }

  return {
    grade,
    dmgOut: Math.round(out),
    dmgIn: Math.round(incoming),
    // 빈틈은 1수 지속·중첩 없음 — 빈틈 중의 완파 취급이 다시 빈틈을 열면 연환이 끝나지 않는다.
    opening: foeOpen ? null : rule.opening,
  };
}

/**
 * 대련 종료 판정 (REQ-201) — HP 소진, 아니면 수 상한에서 잔여 HP 비교.
 * 최대 HP 가 서로 달라도 비율이 아니라 절대값으로 비교한다 — 비율은 최대 HP 가 낮은
 * 도전자를 구조적으로 유리하게 만들어 REQ-506 이 지키려는 첫 파견 승리를 뒤집는다.
 * @returns {{over: boolean, win: ?boolean, by: ?('hp'|'exchanges')}}
 */
export function resolveMatch({ selfHp, foeHp, exchanges, maxExchanges = BALANCE.maxExchanges }) {
  // 교차 판정이라 양쪽이 같은 수에 소진될 수 있다 — 그 수를 낸 쪽의 승으로 본다.
  if (foeHp <= 0) return { over: true, win: true, by: 'hp' };
  if (selfHp <= 0) return { over: true, win: false, by: 'hp' };
  // 동률은 도전자 쪽 판정승 — 수 상한까지 갔으면 앞선 쪽만 이긴다.
  if (exchanges >= maxExchanges) return { over: true, win: selfHp > foeHp, by: 'exchanges' };
  return { over: false, win: null, by: null };
}

// ------------------------------------------------------------------ 성 (成) 축

/**
 * 그 성에서 다음 계단으로 오르는 적립 구간 (REQ-702). 적립 상한 위(11·12성)는 점수가 아니라
 * 결정타·완파가 여는 계단이라 구간이 없다.
 */
export const ladderBandAt = (rank) => BALANCE.rankLadder.bands.find((b) => rank < b.maxRank) ?? null;

/** 성 상태 하나 — 사부 초식과 제자 초식이 같은 규칙으로 오르므로 형(型)도 하나다 (REQ-705). */
export const createRankState = (rank = 1) => ({ rank, pts: 0 });

/** 그 성에서 다음 계단까지 남은 수련 완주 횟수 (수련이 무효인 구간이면 null). */
export function trainHitsToNext({ rank, pts }) {
  const band = ladderBandAt(rank);
  if (!band || !band.train) return null;
  return Math.ceil((band.cost - pts) / BALANCE.rankLadder.gain.train);
}

/**
 * 유효 성공 1회를 성 축에 적립한다 (REQ-702·703·706).
 * @param {{rank: number, pts: number}} state
 * @param {'train'|'duel'} mode 수련 완주가 `train` · 대련·파견의 유효 성공이 `duel`
 * @param {number} [max] 그 주체의 성 상한 (사부 12 · 제자 10)
 * @returns {{state: object, from: number, to: number, wall: boolean}}
 *   `wall` = 수련 적립이 무효인 구간에 든 수련 (8성 벽 — REQ-706)
 */
export function accrueRank(state, { mode, max = BALANCE.rankMax }) {
  if (mode !== 'train' && mode !== 'duel') throw new Error(`알 수 없는 적립 모드: ${mode}`);
  const still = { state, from: state.rank, to: state.rank, wall: false };
  const band = state.rank < max ? ladderBandAt(state.rank) : null;
  if (!band) return still;
  if (mode === 'train' && !band.train) return { ...still, wall: true };
  const pts = state.pts + BALANCE.rankLadder.gain[mode];
  if (pts < band.cost) return { ...still, state: { rank: state.rank, pts } };
  // 넘친 적립은 이월한다 — 버리면 수련 두 번을 쌓아 둔 손이 대련 한 번에 그 둘을 잃는다.
  return { state: { rank: state.rank + 1, pts: pts - band.cost }, from: state.rank, to: state.rank + 1, wall: false };
}

/**
 * 결정타·완파가 여는 계단 (REQ-704) — 순차·비소급이고 한 수는 최대 1계단이다.
 * 두 사건을 각각 적용하지 않고 한 번에 판정하는 것이 그 「최대 1계단」의 자리다: 10성의
 * 완파 결정타를 따로 흘리면 11성을 거쳐 12성까지 두 계단이 오른다.
 * @returns {{state: object, from: number, to: number, via: ?('finish'|'crush')}}
 */
export function promoteByOutcome(state, { finish = false, crush = false, max = BALANCE.rankMax } = {}) {
  const { finishRank, crushRank } = BALANCE.rankLadder;
  const still = { state, from: state.rank, to: state.rank, via: null };
  const step = (to, via) => ({ state: { rank: to, pts: 0 }, from: state.rank, to, via });
  if (finish && state.rank === finishRank - 1 && finishRank <= max) return step(finishRank, 'finish');
  if (crush && state.rank === crushRank - 1 && crushRank <= max) return step(crushRank, 'crush');
  return still;
}

/** 초식 진행도 (REQ-701) — 성이 곧 숙련이라 초식마다 게이지가 하나다. `learned` 기본값 = 각 무공의 1식. */
export function createProgress() {
  const styles = {};
  for (const s of STYLES) styles[s.id] = { learned: s.order === 1, ...createRankState() };
  return { styles };
}

export const styleRank = (progress, styleId) => progress.styles[styleId].rank;

/** 실전 장착 자격 (REQ-713) — 성 계단 하나가 곧 손의 권한이다. */
export const canEquipRank = (rank) => rank >= BALANCE.rankGate.equip;

/** 원터치 자격 (REQ-713) — 딜레이드 힌트가 걷히는 지점과 같다 (REQ-712). */
export const isOneTapRank = (rank) => rank >= BALANCE.rankGate.oneTap;

/** 순차 해금 (REQ-711) — 직전 식이 해금 성에 닿아야 다음 식을 배울 수 있다 (원터치 성이 아니다). */
export function canLearn(progress, styleId) {
  const style = styleById(styleId);
  if (!style || progress.styles[styleId].learned) return false;
  const prev = STYLES.find((s) => s.set === style.set && s.order === style.order - 1);
  if (!prev) return true;
  return styleRank(progress, prev.id) >= BALANCE.rankGate.unlock;
}

export function learn(progress, styleId) {
  if (!canLearn(progress, styleId)) throw new Error(`해금되지 않은 초식: ${styleId}`);
  return {
    ...progress,
    styles: { ...progress.styles, [styleId]: { ...progress.styles[styleId], learned: true } },
  };
}

/**
 * 성 직접 주입 (REQ-781) — 개발자 치트 전용이라 적립 규칙을 우회한다. 학습 표시를 함께 켜는
 * 것은 「성이 있는데 배우지 않은 초식」이라는 상태가 규칙 어디에도 없기 때문이다.
 */
export function setStyleRank(progress, styleId, rank) {
  if (!styleById(styleId)) throw new Error(`알 수 없는 초식: ${styleId}`);
  if (!Number.isInteger(rank) || rank < 1 || rank > BALANCE.rankMax) {
    throw new Error(`주입 성이 1~${BALANCE.rankMax} 정수가 아니다: ${rank}`);
  }
  return {
    ...progress,
    styles: { ...progress.styles, [styleId]: { learned: true, rank, pts: 0 } },
  };
}

const withStyleState = (progress, styleId, state) => ({
  ...progress,
  styles: { ...progress.styles, [styleId]: { ...progress.styles[styleId], ...state } },
});

function unlockChange(progress, next, style) {
  const nextStyle = STYLES.find((s) => s.set === style.set && s.order === style.order + 1);
  if (!nextStyle || canLearn(progress, nextStyle.id) || !canLearn(next, nextStyle.id)) return null;
  return { style: nextStyle.id, prev_style_rank: styleRank(next, style.id) };
}

function assertAccruable(progress, styleId) {
  const style = styleById(styleId);
  if (!style) throw new Error(`알 수 없는 초식: ${styleId}`);
  if (!progress.styles[styleId].learned) throw new Error(`학습하지 않은 초식에 적립: ${styleId}`);
  return style;
}

/**
 * 유효 성공 1회를 적립하고 변화분을 함께 돌려준다 (REQ-702·703·706·711).
 * `changes` 는 통합 로그의 rank/rank_wall/unlock 이벤트와 1:1 이다.
 * @param {'train'|'duel'} mode 수련 완주도 적립 단위다 (REQ-715)
 */
export function applyEffectiveSuccess(progress, styleId, { mode }) {
  const style = assertAccruable(progress, styleId);
  const { state, from, to, wall } = accrueRank(progress.styles[styleId], { mode });
  const next = withStyleState(progress, styleId, state);
  const changes = {};
  if (wall) changes.wall = { style: styleId, at_rank: from, attempted: 'train' };
  if (to !== from) changes.rank = { style: styleId, from, to, via: mode };
  const unlock = unlockChange(progress, next, style);
  if (unlock) changes.unlock = unlock;
  return { progress: next, changes };
}

/** 결정타·완파의 계단 적용 (REQ-704) — 적립과 달리 그 수의 판정 결과가 곧 자격이다. */
export function applyOutcome(progress, styleId, { finish = false, crush = false }) {
  const style = assertAccruable(progress, styleId);
  const { state, from, to, via } = promoteByOutcome(progress.styles[styleId], { finish, crush });
  if (!via) return { progress, changes: {} };
  const next = withStyleState(progress, styleId, state);
  const changes = { rank: { style: styleId, from, to, via } };
  const unlock = unlockChange(progress, next, style);
  if (unlock) changes.unlock = unlock;
  return { progress: next, changes };
}

// ----------------------------------------------------------------- 전수 · 제자

export const createDisciple = () => ({ level: DISCIPLE.level, arts: {} });

/** 제자 초식의 성 — 전수받지 않은 무공은 성 자체가 없다. */
export const discipleStyleRank = (disciple, setId, styleId) =>
  (disciple.arts[setId]?.styles[styleId]?.rank ?? null);

export const discipleStyles = (disciple, setId) =>
  (disciple.arts[setId] ? Object.keys(disciple.arts[setId].styles).map(styleById) : []);

/** 전수 조건 — 무공의 전 초식이 전수 성에 닿고 제자 무공 슬롯에 여유가 있을 것. */
export function canTransmit(progress, setId, disciple) {
  const art = artById(setId);
  if (!art) return false;
  if (!artStyles(setId).every((s) => styleRank(progress, s.id) >= art.transmitRank)) return false;
  if (setId in disciple.arts) return false;
  return Object.keys(disciple.arts).length < DISCIPLE.artSlots;
}

/** 전수 = 복사. 사부의 progress 는 인자 그대로 남고 제자만 새로 만들어진다. */
export function transmit(progress, disciple, setId) {
  if (!canTransmit(progress, setId, disciple)) throw new Error(`전수 조건 미충족: ${setId}`);
  // 전수의 최소 단위는 초식이 아니라 무공이다 — 전 초식이 전수 성이라 「사부가 학습한 것만
  // 고른다」는 필터가 성립할 상태 자체가 없다.
  const styles = {};
  for (const s of artStyles(setId)) styles[s.id] = createRankState(BALANCE.discipleStartRank);
  return { ...disciple, arts: { ...disciple.arts, [setId]: { styles } } };
}

/** 제자 초식 성 적립 (REQ-705) — 사부와 같은 사다리를 상한 10성으로 탄다. */
export function accrueDiscipleStyle(disciple, setId, styleId, { mode = 'duel' } = {}) {
  const art = disciple.arts[setId];
  if (!art || !art.styles[styleId]) return { disciple, from: null, to: null, wall: false };
  const result = accrueRank(art.styles[styleId], { mode, max: BALANCE.discipleRankMax });
  const next = {
    ...disciple,
    arts: {
      ...disciple.arts,
      [setId]: { ...art, styles: { ...art.styles, [styleId]: result.state } },
    },
  };
  return { disciple: next, from: result.from, to: result.to, wall: result.wall };
}

/**
 * 제자 초식 자동 선택 (REQ-403) — 우세 → 상쇄 → 잔여, 예고된 절초의 파해 대상은 제외.
 * @param {object} p
 * @param {object[]} p.styles    제자 보유 초식 (배열 순서 = 슬롯 순)
 * @param {?object} [p.foeStyle] 예고된 상대 초식 (상대 빈틈이면 null)
 * @param {(style: object) => number} [p.rankOf]
 */
export function selectDiscipleStyle({ styles, foeStyle = null, rankOf: rankFn = () => 0 }) {
  if (!styles.length) return null;
  // 역파는 절초가 실제로 예고된 수에만 성립하므로, 다른 수의 배제는 이득 없이 완파만 버린다.
  const avoidId = foeStyle && foeStyle.finisher ? foeStyle.counters : null;
  const kept = styles.filter((s) => s.id !== avoidId);
  // 전부 배제되면 낼 초식이 없어지므로 역파를 감수한다.
  const pool = kept.length ? kept : styles;
  const bySlot = (a, b) => pool.indexOf(a) - pool.indexOf(b);
  const byRank = (a, b) => rankFn(b) - rankFn(a) || bySlot(a, b);

  // 상대 빈틈에는 속성 비교의 상대가 없고 아무 완주나 완파 취급이라 위력만 남는다.
  if (!foeStyle) return pool.slice().sort((a, b) => b.d - a.d || byRank(a, b))[0];

  const beats = pool.filter((s) => ATTRS[s.attr].beats === foeStyle.attr);
  if (beats.length) return beats.sort(byRank)[0];
  const same = pool.filter((s) => s.attr === foeStyle.attr);
  if (same.length) return same.sort(byRank)[0];
  return pool.slice().sort(byRank)[0];
}

const ALL_STYLES = [...STYLES, ...FOE_STYLES];
assertPrefixFree(STYLES);
assertCounterIntegrity(ALL_STYLES);
