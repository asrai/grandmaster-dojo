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

/** 구결 한 구절이 방향 한 개다 (REQ-841) — 수가 어긋나면 점등이 시퀀스와 다른 것을 가리킨다. */
export function assertGugyeol(styles) {
  for (const s of styles) {
    if (s.gugyeol.length !== s.seq.length) {
      throw new Error(`구결 구절 수 불일치: ${s.id} — 구결 ${s.gugyeol.length} · 시퀀스 ${s.seq.length}`);
    }
    if (s.gugyeol.some((verse) => !String(verse).trim())) throw new Error(`빈 구결 구절: ${s.id}`);
  }
  return true;
}

/**
 * 한 무공은 세 속성을 다 갖는다 (REQ-403) — 제자는 **무공 단위로** 통째 물려받으므로, 한 권이라도
 * 빠진 속성이 있으면 그 제자에게는 우세도 상쇄도 낼 수 없는 예고가 생긴다. 그래서 검사 모집단은
 * 전 초식 합집합이 아니라 무공 하나다.
 */
export function assertAttrCoverage(styles) {
  const held = new Set(styles.map((s) => s.attr));
  const missing = Object.keys(ATTRS).filter((id) => !held.has(id));
  if (missing.length) throw new Error(`무공이 덮지 못한 속성: ${missing.join(' · ')}`);
  return true;
}

// ------------------------------------------------------------------ 한 초의 산술

/** 응수 창 (REQ-201). `len` = 그 초에 노출된 초식 길이 — 실전은 상대 예고, 수련은 자기 초식. */
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
 * 첫 대면인가 (REQ-894) — 절초 공개 수위를 가르는 술어다 (REQ-732 개정: 첫 대면은 존재만,
 * 재대련부터 이름 + 파해 대상). 대면 이력의 대리 지표는 **승수**이고 패배는 세지 않는다 —
 * REQ-734 가 이미 누적하는 값이라 `seen` 같은 별도 플래그를 두지 않는다.
 * @param {number} priorWins 그 도전자를 이미 이긴 횟수
 */
export function isFirstEncounter(priorWins) {
  if (!Number.isInteger(priorWins) || priorWins < 0) throw new Error(`첫 대면 판별의 재대련 승수가 0 이상의 정수가 아니다: ${priorWins}`);
  return priorWins === 0;
}

/**
 * 도전자가 세우는 초식과 그 절초의 파해 대상 (REQ-884) — 예고·브리핑이 둘을 **이름으로** 읽으므로
 * 결손은 화면에서 익명 TypeError 로만 드러난다. `assertCounterIntegrity` 는 `counters` 가 있는
 * 초식만 검사하므로 「절초인데 파해 대상이 없다」는 그 그물을 그대로 빠져나간다.
 */
export function assertChallengerStyles(challengers) {
  for (const c of challengers) {
    for (const id of c.styles) {
      if (!foeStyleById(id)) throw new Error(`도전자 미존재 초식: ${c.id} → ${id}`);
    }
    const finisher = finisherOf(c);
    if (finisher && !styleById(finisher.counters)) {
      throw new Error(`절초의 파해 대상 미존재: ${c.id} → ${finisher.id}`);
    }
  }
  return true;
}

/**
 * 절초 공개의 3층 (REQ-882~884·894) — 화면이 이 이름을 참조하고 문구표(`theme.mjs` 의
 * `REVEAL_VIEW`)가 층마다 한 줄을 갖는다. 층이 늘면 그 표의 빈자리가 부팅 때 드러난다.
 * 「이름」과 「파해」가 한 층에 함께 도착하는 것이 REQ-884 의 결정이라 층은 셋이다.
 */
export const REVEAL_TIER = {
  NONE: 'none',        /* 절초를 쓰지 않는 도전자 — 가르칠 답이 없다 */
  RUMOR: 'rumor',      /* 첫 대면 — 존재만 소문으로 (REQ-883) */
  COUNTER: 'counter',  /* 재대련 — 이름과 파해 대상 (REQ-884) */
};

/**
 * 그 대면에서 절초를 어디까지 공개하는가 (REQ-882~884) — S7 의 목록 행과 브리핑이 같은
 * 층을 읽어야 예고가 함정이 되지 않는다 (REQ-835).
 * @param {object} challenger
 * @param {boolean} firstEncounter `isFirstEncounter` 의 결과 — 회차 0 이 곧 첫 대면이다 (REQ-894)
 */
export function finisherRevealTier(challenger, firstEncounter) {
  if (typeof firstEncounter !== 'boolean') throw new Error(`첫 대면 여부가 불리언이 아니다: ${firstEncounter}`);
  if (!finisherOf(challenger)) return REVEAL_TIER.NONE;
  return firstEncounter ? REVEAL_TIER.RUMOR : REVEAL_TIER.COUNTER;
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
  if (!foeStyle) throw new Error('상대 빈틈이 아닌 초에 상대 초식이 없다');
  if (selfStyle.counters === foeStyle.id) return 'crush';
  if (foeStyle.finisher && foeStyle.counters === selfStyle.id) return 'reversal';
  if (ATTRS[selfStyle.attr].beats === foeStyle.attr) return 'advantage';
  if (ATTRS[foeStyle.attr].beats === selfStyle.attr) return 'disadvantage';
  return 'clash';
}

/**
 * 6단 판정 + 피해 정수 + 다음 초 빈틈 (REQ-202~204).
 * @param {object} p
 * @param {?object} p.selfStyle 창 안에 완주한 내 초식 (미완주 = null)
 * @param {?object} p.foeStyle  상대 예고 초식 (상대 빈틈이면 무의미)
 * @param {number} p.selfRank   그 초식의 성 (REQ-721)
 * @param {number} p.foeRank    상대 성 — 내공의 출처이자 역파 감쇠의 기준이다 (REQ-722·771)
 * @param {number} [p.foePower] 상대 내공. 기본값이 `foeRank` 파생이라 명시하지 않는 한 갈리지 않는다
 * @param {number} [p.r]        발동 시점의 창 잔여 비율
 * @param {boolean} [p.foeOpen] 이 초가 상대 빈틈인가
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
    // 빈틈은 한 초만 지속·중첩 없음 — 빈틈 중의 완파 취급이 다시 빈틈을 열면 연환이 끝나지 않는다.
    opening: foeOpen ? null : rule.opening,
  };
}

/**
 * 대련 종료 판정 (REQ-201) — HP 소진, 아니면 초 상한에서 잔여 HP 비교.
 * 최대 HP 가 서로 달라도 비율이 아니라 절대값으로 비교한다 — 비율은 최대 HP 가 낮은
 * 도전자를 구조적으로 유리하게 만들어 REQ-506 이 지키려는 첫 파견 승리를 뒤집는다.
 * @returns {{over: boolean, win: ?boolean, by: ?('hp'|'exchanges')}}
 */
export function resolveMatch({ selfHp, foeHp, exchanges, maxExchanges = BALANCE.maxExchanges }) {
  // 교차 판정이라 양쪽이 같은 초에 소진될 수 있다 — 그 초를 낸 쪽의 승으로 본다.
  if (foeHp <= 0) return { over: true, win: true, by: 'hp' };
  if (selfHp <= 0) return { over: true, win: false, by: 'hp' };
  // 동률은 도전자 쪽 판정승 — 초 상한까지 갔으면 앞선 쪽만 이긴다.
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
 * 다음 계단까지의 수련 완주 진척 (REQ-845) — 칸 수는 그 계단의 비용이 정하므로 성마다 달라질 수
 * 있다. 화면이 3 을 상수로 갖고 있으면 비용을 튜닝한 순간 계단이 거짓말을 한다.
 * @returns {?{done: number, total: number}} 수련이 무효인 구간이면 null
 */
export function trainVisitSpan({ rank, pts }) {
  const left = trainHitsToNext({ rank, pts });
  if (left === null) return null;
  const total = Math.ceil(ladderBandAt(rank).cost / BALANCE.rankLadder.gain.train);
  return { done: Math.max(0, total - left), total };
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
 * 결정타·완파가 여는 계단 (REQ-704) — 순차·비소급이고 한 초는 최대 1계단이다.
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

/** 결정타·완파의 계단 적용 (REQ-704) — 적립과 달리 그 초의 판정 결과가 곧 자격이다. */
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

// ------------------------------------------------------------ 임무 (REQ-742·743)

/**
 * 제자의 전 초식 최소 성 (REQ-743) — 잠금을 쥐는 것은 평균이 아니라 뒤처진 초식이다.
 * 평균이면 한 초식을 방치한 채 나머지로 평균을 채우는 경로가 남고, 그것이 수련 지정과 어긋난다.
 */
export function discipleMinRank(disciple, setId) {
  const styles = discipleStyles(disciple, setId);
  if (!styles.length) return null;
  return Math.min(...styles.map((s) => discipleStyleRank(disciple, setId, s.id)));
}

/** B-1 은 잠금이 없다 (REQ-741) — 전수 직후의 통쾌함이 지연 없이 오는 것이 무패 보장의 목적이다. */
export const missionLockRank = (stage) => (stage <= 1 ? null : BALANCE.mission.unlockRank);

/** 권장 성에 못 미치는 초식 — 하드 잠금이 「무엇이 모자란가」를 화면에서 대는 자리다 (REQ-743). */
export function missionShortfall(disciple, setId, stage) {
  const need = missionLockRank(stage);
  if (need === null) return [];
  return discipleStyles(disciple, setId)
    .filter((s) => discipleStyleRank(disciple, setId, s.id) < need)
    .map((s) => ({ id: s.id, name: s.name, rank: discipleStyleRank(disciple, setId, s.id) }));
}

export function isMissionUnlocked(disciple, setId, stage) {
  const need = missionLockRank(stage);
  if (need === null) return true;
  const min = discipleMinRank(disciple, setId);
  return min !== null && min >= need;
}

/**
 * 임무 도전자 성 (REQ-742) — 뽑힌 도전자의 초회 성을 base 로 차수 계단이 얹힌다.
 * 난이도의 몸통은 그 도전자의 HP·초식 수가 지고 성은 그 위의 보정이다 (#217 실측).
 */
export const missionFoeRank = (stage, baseRank) =>
  Math.min(BALANCE.rankMax, baseRank + BALANCE.mission.rankStep * (stage - 1));

/**
 * 이긴 도전자 중 하나 (REQ-742) — 모집단이 비면 null 이라 호출부가 폴백을 고른다.
 * 주입 난수가 유일한 입력이라 시드를 고정하면 같은 상대가 재현된다.
 */
export function pickMissionFoe(pool, random = Math.random) {
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// -------------------------------------------------- 제자 수련 (REQ-751~754·706)

/** 수련만으로 닿을 수 있는 성 — 원터치 계단(`rankGate.oneTap`)과는 다른 축이라 그 상수를 대신 쓰면 튜닝에서 갈린다. */
export const trainAccrualCap = () =>
  BALANCE.rankLadder.bands.filter((b) => b.train).reduce((m, b) => Math.max(m, b.maxRank), 0);

/** 제자 수련 1성당 실경과 — 방치 루프의 길이 자체가 검증 대상이라 분 단위로 줄이지 않는다 (REQ-753). */
export const discipleTrainMsPerRank = () => BALANCE.discipleTrain.secondsPerRank * 1000;

/**
 * 걸어 둔 시간이 여는 계단 (REQ-751·753·706) — 수련이 무효인 구간에 닿으면 거기서 멈춘다.
 * 상한(제자 10성)은 벽이 아니다: 오를 계단 자체가 없는 것과 수련만 거부되는 것은 다른 사건이다.
 * @returns {{steps: number, restMs: number, wall: boolean}} `wall` = 남은 시간이 그 계단에서 무효였다
 */
export function discipleTrainSteps(rank, elapsedMs, { max = BALANCE.discipleRankMax } = {}) {
  const per = discipleTrainMsPerRank();
  let at = rank;
  let rest = Math.max(0, elapsedMs);
  let steps = 0;
  while (rest >= per) {
    const band = at < max ? ladderBandAt(at) : null;
    if (!band) return { steps, restMs: rest, wall: false };
    if (!band.train) return { steps, restMs: rest, wall: true };
    at += 1;
    steps += 1;
    rest -= per;
  }
  return { steps, restMs: rest, wall: false };
}

/**
 * 지정 초식에 걸어 둔 시간을 성으로 바꾼다 (REQ-751·754). 지정하지 않은 초식은 움직이지 않는 것이
 * 「어느 초식이 뒤처졌는지」를 유저가 통제한다는 뜻이다.
 * 파견 적립분(`pts`)은 그대로 남긴다 — 시간축 상승이 실전 적립을 대신 소모하면 두 축이 서로를 갉는다.
 * @returns {{disciple: object, from: ?number, to: ?number, consumedMs: number, restMs: number, wall: boolean}}
 */
export function applyDiscipleTraining(disciple, setId, styleId, elapsedMs) {
  const state = disciple.arts[setId]?.styles[styleId] ?? null;
  if (!state) return { disciple, from: null, to: null, consumedMs: 0, restMs: 0, wall: false };
  const { steps, restMs, wall } = discipleTrainSteps(state.rank, elapsedMs);
  const to = state.rank + steps;
  const art = disciple.arts[setId];
  const next = steps === 0 ? disciple : {
    ...disciple,
    arts: {
      ...disciple.arts,
      [setId]: { ...art, styles: { ...art.styles, [styleId]: { rank: to, pts: state.pts } } },
    },
  };
  return {
    disciple: next, from: state.rank, to, consumedMs: Math.max(0, elapsedMs) - restMs, restMs, wall,
  };
}

/**
 * 제자가 그 초식을 고른 이유 (REQ-853) — 관전 화면의 문구가 이 값에 매핑되므로, 계열이 늘면
 * 매핑이 빈 자리를 즉시 드러낸다. 화면 밖(대련 봇의 후보 필터)에서도 같은 값이 나온다.
 */
export const SELECT_REASON = {
  ADVANTAGE: 'advantage',
  CLASH: 'clash',
  AVOID_REVERSAL: 'avoid-reversal',
};

/**
 * 제자 초식 자동 선택 (REQ-403·853) — 우세 → 상쇄 → 잔여, 예고된 절초의 파해 대상은 제외.
 * 이유를 함께 내는 것은 관전의 콘텐츠가 결과가 아니라 판단이기 때문이다 (REQ-852).
 * @param {object} p
 * @param {object[]} p.styles    제자 보유 초식 (배열 순서 = 슬롯 순)
 * @param {?object} [p.foeStyle] 예고된 상대 초식 (상대 빈틈이면 null)
 * @param {(style: object) => number} [p.rankOf]
 * @returns {?{style: object, reason: string}} 보유 초식이 없으면 null
 */
export function selectDiscipleStyle({ styles, foeStyle = null, rankOf: rankFn = () => 0 }) {
  if (!styles.length) return null;
  // 역파는 절초가 실제로 예고된 초에만 성립하므로, 다른 초의 배제는 이득 없이 완파만 버린다.
  const avoidId = foeStyle && foeStyle.finisher ? foeStyle.counters : null;
  const kept = styles.filter((s) => s.id !== avoidId);
  // 전부 배제되면 낼 초식이 없어지므로 역파를 감수한다.
  const pool = kept.length ? kept : styles;
  const excluded = kept.length > 0 && kept.length !== styles.length;

  /** 정렬 기준은 넘어온 목록에 매인다 — 다른 목록의 인덱스를 쓰면 밖의 초식이 -1 로 앞선다. */
  const pick = (from) => {
    const bySlot = (a, b) => from.indexOf(a) - from.indexOf(b);
    const byRank = (a, b) => rankFn(b) - rankFn(a) || bySlot(a, b);
    // 상대 빈틈에는 속성 비교의 상대가 없고 아무 완주나 완파 취급이라 위력만 남는다 — 어떤
    // 완주든 완파라 최대 위력을 고르는 것이 곧 우세를 고르는 것이다.
    if (!foeStyle) return { style: from.slice().sort((a, b) => b.d - a.d || byRank(a, b))[0], reason: SELECT_REASON.ADVANTAGE };
    const beats = from.filter((s) => ATTRS[s.attr].beats === foeStyle.attr);
    if (beats.length) return { style: beats.sort(byRank)[0], reason: SELECT_REASON.ADVANTAGE };
    const same = from.filter((s) => s.attr === foeStyle.attr);
    if (same.length) return { style: same.sort(byRank)[0], reason: SELECT_REASON.CLASH };
    // 잔여(열세)도 상쇄 계열로 접는다 — 배제되는 초식은 한 개인데 우세군과 상쇄군은 서로 다른
    // 속성이라 둘 중 하나는 반드시 남으므로, 제자의 전 초식을 넘기는 파견에서는 이 갈래가 서지
    // 않는다 (무공이 세 속성을 덮는 것은 `assertAttrCoverage` 가 문다). 후보가 이미 좁혀진
    // 대련 봇만 여기 닿고 그쪽은 이유를 읽지 않는다.
    return { style: from.slice().sort(byRank)[0], reason: SELECT_REASON.CLASH };
  };

  const chosen = pick(pool);
  // 배제가 실제로 선택을 바꿨을 때만 회피다 — 어차피 고르지 않았을 초식을 뺀 것은 회피가 아니다.
  if (excluded && pick(styles).style !== chosen.style) {
    return { style: chosen.style, reason: SELECT_REASON.AVOID_REVERSAL };
  }
  return chosen;
}

const ALL_STYLES = [...STYLES, ...FOE_STYLES];
assertPrefixFree(STYLES);
assertCounterIntegrity(ALL_STYLES);
assertChallengerStyles(CHALLENGERS);
assertGugyeol(STYLES);
for (const art of ART_SETS) assertAttrCoverage(artStyles(art.id));
