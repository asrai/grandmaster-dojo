// 판정·성장·전수·제자 선택의 순수 함수 층 (spec REQ-202~205·301~304·307·401~403·505).
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

/** 내공 N (REQ-203). */
export const powerOf = (rank) => BALANCE.powerBase + BALANCE.powerPerRank * rank;

/** 선기 배수 — `r` = 응수 창 잔여 비율 (REQ-203). */
export const initiativeOf = (r) => BALANCE.initiativeBase + BALANCE.initiativePerRatio * r;

/** 판정 ≥ 상쇄 = 유효 성공, 숙련 threshold 와 성 포인트의 공통 적립 단위 (REQ-302). */
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
 * @param {number} p.selfRank   내 무공의 성
 * @param {number} [p.foePower] 도전자 내공 시드
 * @param {number} [p.r]        발동 시점의 창 잔여 비율
 * @param {boolean} [p.foeOpen] 이 수가 상대 빈틈인가
 */
export function judge({ selfStyle, foeStyle = null, selfRank, foePower = 1, r = 0, foeOpen = false }) {
  if (!(r >= 0 && r <= 1)) throw new Error(`선기 잔여 비율이 0~1 밖: ${r}`);
  // 음수·비정수는 내공을 뒤집어 피해를 회복으로 만든다 — 유한성만으로는 못 막는다.
  if (!Number.isInteger(selfRank) || selfRank < 1) throw new Error(`성이 1 이상의 정수가 아니다: ${selfRank}`);
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

// -------------------------------------------------------------------- 숙련 · 성

/** 초식 진행도 0 상태. `learned` 기본값 = 각 무공의 1식. */
export function createProgress() {
  const styles = {};
  for (const s of STYLES) styles[s.id] = { learned: s.order === 1, trainHits: 0, duelHits: 0 };
  const arts = {};
  for (const a of ART_SETS) arts[a.id] = { rankPts: 0 };
  return { styles, arts };
}

/** 숙련도 % (REQ-301) — 수련 졸업분 + 실전 유효 성공 누적분. */
export function masteryPct(progress, styleId) {
  const p = progress.styles[styleId];
  const trainPart = Math.min(p.trainHits, BALANCE.trainGraduateHits) / BALANCE.trainGraduateHits
    * BALANCE.masteryTrainPct;
  const threshold = BALANCE.threshold[styleId];
  const duelPart = Math.min(p.duelHits, threshold) / threshold
    * (BALANCE.masteryFullPct - BALANCE.masteryTrainPct);
  return Math.round(trainPart + duelPart);
}

/** 성 포인트 → 성 (REQ-304). 상한 밖 성은 `rankStepMult` 가 없으므로 균등 계단이다. */
export function rankForPts(pts, { max = BALANCE.rankMax } = {}) {
  let rank = 1;
  let spent = 0;
  while (rank < max) {
    const cost = BALANCE.rankStep * (BALANCE.rankStepMult[rank + 1] ?? 1);
    if (pts < spent + cost) break;
    spent += cost;
    rank += 1;
  }
  return rank;
}

/** 그 성에 도달하는 데 드는 누적 포인트. */
export function ptsForRank(rank, { max = BALANCE.rankMax } = {}) {
  let pts = 0;
  for (let r = 2; r <= Math.min(rank, max); r += 1) {
    pts += BALANCE.rankStep * (BALANCE.rankStepMult[r] ?? 1);
  }
  return pts;
}

/**
 * 입문 완료 (REQ-310) — 무공의 전 초식이 숙련 100%. 성 포인트 적립의 선행 조건이므로,
 * 배우지 않은 초식이 하나라도 남아 있는 동안 그 무공은 성 1 에 머문다 (#38).
 */
export const isInitiated = (progress, setId) =>
  artStyles(setId).every((s) => masteryPct(progress, s.id) >= BALANCE.masteryFullPct);

/** 입문 전 무공의 성 포인트는 없는 것과 같다 — 성 조회가 포인트를 읽는 유일한 경로다. */
export const rankPtsOf = (progress, setId) =>
  (isInitiated(progress, setId) ? progress.arts[setId].rankPts : 0);

export const rankOf = (progress, setId, { max = BALANCE.rankMax } = {}) =>
  rankForPts(rankPtsOf(progress, setId), { max });

/** 순차 해금 (REQ-303) — 직전 식이 숙련 100% 여야 다음 식을 배울 수 있다. */
export function canLearn(progress, styleId) {
  const style = styleById(styleId);
  if (!style || progress.styles[styleId].learned) return false;
  const prev = STYLES.find((s) => s.set === style.set && s.order === style.order - 1);
  if (!prev) return true;
  return masteryPct(progress, prev.id) >= BALANCE.masteryFullPct;
}

export function learn(progress, styleId) {
  if (!canLearn(progress, styleId)) throw new Error(`해금되지 않은 초식: ${styleId}`);
  return {
    ...progress,
    styles: { ...progress.styles, [styleId]: { ...progress.styles[styleId], learned: true } },
  };
}

/**
 * 유효 성공 1회를 적립하고 변화분을 함께 돌려준다 (REQ-301·302·303·304).
 * `changes` 는 통합 로그의 mastery/rank/unlock 이벤트와 1:1 이다.
 * @param {'train'|'duel'} mode 수련 성공도 유효 성공이다 (REQ-302)
 */
export function applyEffectiveSuccess(progress, styleId, { mode }) {
  if (mode !== 'train' && mode !== 'duel') throw new Error(`알 수 없는 적립 모드: ${mode}`);
  const style = styleById(styleId);
  if (!style) throw new Error(`알 수 없는 초식: ${styleId}`);
  if (!progress.styles[styleId].learned) throw new Error(`학습하지 않은 초식에 적립: ${styleId}`);

  const setId = style.set;
  const initiated = isInitiated(progress, setId);
  const before = {
    mastery: masteryPct(progress, styleId),
    rank: rankOf(progress, setId),
    pts: rankPtsOf(progress, setId),
  };
  const hits = progress.styles[styleId];
  const next = {
    ...progress,
    styles: {
      ...progress.styles,
      [styleId]: {
        ...hits,
        trainHits: hits.trainHits + (mode === 'train' ? 1 : 0),
        duelHits: hits.duelHits + (mode === 'duel' ? 1 : 0),
      },
    },
    arts: {
      ...progress.arts,
      // 입문 전 발동이 성 축에 남기는 것은 없다 — 그 구간의 보상은 숙련이고, 성은 그 뒤에 열린다.
      [setId]: {
        ...progress.arts[setId],
        rankPts: progress.arts[setId].rankPts + (initiated ? BALANCE.rankPtsPerStyle[styleId] : 0),
      },
    },
  };

  const after = { mastery: masteryPct(next, styleId), rank: rankOf(next, setId), pts: rankPtsOf(next, setId) };
  const changes = {};
  if (after.mastery !== before.mastery) changes.mastery = { styleId, from: before.mastery, to: after.mastery };
  // 개방 그 자체는 적립이 아니다 — 이 수가 성 게이지를 열고, 다음 유효 성공부터 쌓인다.
  if (!initiated && isInitiated(next, setId)) changes.initiate = { style_set: setId };
  if (after.rank !== before.rank) {
    changes.rank = { style_set: setId, from: before.rank, to: after.rank, pts: after.pts };
  }
  const nextStyle = STYLES.find((s) => s.set === setId && s.order === style.order + 1);
  if (nextStyle && !canLearn(progress, nextStyle.id) && canLearn(next, nextStyle.id)) {
    changes.unlock = { styleId: nextStyle.id };
  }
  return { progress: next, changes };
}

// ----------------------------------------------------------------- 전수 · 제자

export const createDisciple = () => ({ level: DISCIPLE.level, arts: {} });

export const discipleRankOf = (disciple, setId) =>
  (disciple.arts[setId] ? rankForPts(disciple.arts[setId].rankPts, { max: BALANCE.discipleRankMax }) : null);

export const discipleStyles = (disciple, setId) =>
  (disciple.arts[setId] ? disciple.arts[setId].styles.map(styleById) : []);

/** 전수 조건 (REQ-307) — 무공이 전수 성에 닿고 제자 무공 슬롯에 여유가 있을 것. */
export function canTransmit(progress, setId, disciple) {
  const art = artById(setId);
  if (!art) return false;
  if (rankOf(progress, setId) < art.transmitRank) return false;
  if (setId in disciple.arts) return false;
  return Object.keys(disciple.arts).length < DISCIPLE.artSlots;
}

/** 전수 = 복사 (REQ-307). 사부의 progress 는 인자 그대로 남고 제자만 새로 만들어진다. */
export function transmit(progress, disciple, setId) {
  if (!canTransmit(progress, setId, disciple)) throw new Error(`전수 조건 미충족: ${setId}`);
  // 전수의 최소 단위는 초식이 아니라 무공이다 — 12성이 전 초식 숙련 100% 를 함의하므로
  // 「사부가 학습한 것만 고른다」는 필터가 성립할 상태 자체가 없다 (#38).
  const styles = artStyles(setId).map((s) => s.id);
  return {
    ...disciple,
    arts: { ...disciple.arts, [setId]: { rankPts: 0, styles } },
  };
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
