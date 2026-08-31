// 세션 상태 — 상태기계가 화면 사이로 들고 다니는 유일한 가변 덩어리. 영속화는 없다:
// 프로토 판정은 단일 세션이고, 잔존 세이브는 kill (a)·(d) 측정을 진행 중 상태로 오염시킨다.

import { ART_SETS, BALANCE, CHALLENGERS, STYLES } from '../balance.mjs';
import { createLogBuffer, validate } from '../log.mjs';
import {
  applyEffectiveSuccess, canTransmit, createDisciple, createProgress, discipleRankOf,
  isEffectiveSuccess, learn, masteryPct, rankForPts, rankOf, styleById, transmit,
} from '../core.mjs';

/** 내보낸 로그의 판독 계약 이름 — `tests/kill-readout.mjs` 가 이 값으로 파일을 받아들인다. */
export const EXPORT_SCHEMA = 'grandmaster-dojo/log-export@1';

/**
 * 판독기가 로그 밖에서 끌어다 쓰는 밸런스 값 — 창 길이·유효 성공 절단선.
 * 내보낸 뒤 이 값들이 튜닝되면 옛 로그가 조용히 다른 수로 읽히므로 지문을 함께 싣는다.
 */
export const balanceDigest = () => ({
  windowBaseMs: BALANCE.windowBaseMs,
  windowStepMs: BALANCE.windowStepMs,
  windowBaseLen: BALANCE.windowBaseLen,
  accessibilityWindowMult: BALANCE.accessibilityWindowMult,
  effectiveSuccessMaxOrder: BALANCE.effectiveSuccessMaxOrder,
});

/** 프로토의 비급은 1권뿐이라 무공 축의 모든 조회가 이 id 로 수렴한다. */
export const ART_ID = ART_SETS[0].id;
export const ART_NAME = ART_SETS[0].name;
export const DUEL_STAGES = CHALLENGERS.filter((c) => c.mode === 'duel')
  .slice().sort((a, b) => a.stage - b.stage);
export const DISPATCH_CHALLENGER = CHALLENGERS.find((c) => c.mode === 'dispatch');

/**
 * 플레이 경로 로그 싱크. 적재는 비엄격이라 어떤 위반도 게임을 멈추지 않고(필드 오타 하나가
 * 이벤트 핸들러 안의 throw 가 되면 그 수에서 시연이 정지한다), 검증은 여기서 돌려 위반이
 * 무음으로 지나가지 않게 한다. 검증되지 않는 쓰기 경로는 노출하지 않는다.
 */
function createPlayLog(violations, now) {
  const buffer = createLogBuffer({ strict: false, now });
  return {
    entries: buffer.entries,
    serialize: buffer.serialize,
    clear: () => { buffer.clear(); violations.length = 0; },
    log(event, fields = {}) {
      try {
        validate(event, fields);
      } catch (err) {
        violations.push({ event, reason: err.message });
        console.warn(`[로그 스키마] ${err.message}`);
      }
      return buffer.log(event, fields);
    },
  };
}

/** @param {object} [opts] `now` 는 `t_ms` 의 출처 — 헤드리스 봇은 가상 시계를 준다 (REQ-605). */
export function createSession({ now } = {}) {
  // 위반은 게임을 멈추지 않되 여기 쌓여, 로그 내보내기가 결손을 그대로 실어 나르지 않는다.
  const logViolations = [];
  return {
    log: createPlayLog(logViolations, now),
    logViolations,
    progress: createProgress(),
    disciple: createDisciple(),
    slots: Array.from({ length: BALANCE.slots }, () => null),
    coins: 0,
    stage: 1,
    accessibility: BALANCE.accessibilityWindow,
    accessibilityToggles: 0,
    accessibilityTogglesAtDone: null,
    label: '문하생',
    transmitted: false,
  };
}

export const logEvent = (session, event, fields) => session.log.log(event, fields);

export const masteryOf = (session, styleId) => masteryPct(session.progress, styleId);
export const artRank = (session) => rankOf(session.progress, ART_ID);
export const equippedStyles = (session) => session.slots.filter(Boolean).map(styleById);
export const canEquip = (session, styleId) => masteryOf(session, styleId) >= BALANCE.equipMasteryPct;
export const challengerOfStage = (stage) => DUEL_STAGES[stage - 1];
export const isLastStage = (stage) => stage >= DUEL_STAGES.length;

/**
 * 대련 승리로 차수를 전진시키고 새로 해금된 도전자를 돌려준다 (없으면 null).
 * 최고 차수는 그 자리에 머문다 — 재진입이 막히면 남은 성 성장 경로가 통째로 닫힌다.
 */
export function advanceStage(session, clearedStage) {
  if (clearedStage !== session.stage || isLastStage(session.stage)) return null;
  session.stage += 1;
  return challengerOfStage(session.stage);
}

export function equip(session, styleId, slotIdx) {
  if (!canEquip(session, styleId)) return false;
  const at = slotIdx ?? session.slots.indexOf(null);
  if (at < 0 || at >= session.slots.length) return false;
  const replaced = session.slots[at];
  if (replaced) logEvent(session, 'slot', { action: 'unequip', styleId: replaced });
  session.slots[at] = styleId;
  logEvent(session, 'slot', { action: 'equip', styleId });
  return true;
}

export function unequip(session, slotIdx) {
  const styleId = session.slots[slotIdx];
  if (!styleId) return false;
  session.slots[slotIdx] = null;
  logEvent(session, 'slot', { action: 'unequip', styleId });
  return true;
}

/** 빈 슬롯 채우기에는 선택이 없다 — 선택은 4식 해금으로 4 > 3 이 될 때 처음 생긴다 (REQ-305). */
export function autoEquip(session) {
  for (const style of STYLES) {
    if (session.slots.includes(style.id)) continue;
    if (!session.progress.styles[style.id].learned) continue;
    if (!canEquip(session, style.id)) continue;
    if (!session.slots.includes(null)) return;
    equip(session, style.id);
  }
}

export function learnStyle(session, styleId) {
  session.progress = learn(session.progress, styleId);
  autoEquip(session);
}

/** 유효 성공 1회 적립 + 그 변화분을 통합 로그로 흘린다 (REQ-301~304). */
export function recordEffectiveSuccess(session, styleId, mode) {
  const { progress, changes } = applyEffectiveSuccess(session.progress, styleId, { mode });
  session.progress = progress;
  if (changes.mastery) logEvent(session, 'mastery', changes.mastery);
  if (changes.rank) logEvent(session, 'rank', changes.rank);
  if (changes.unlock) logEvent(session, 'unlock', changes.unlock);
  autoEquip(session);
  return changes;
}

/** 제자도 같은 성 포인트 룰로 오르되 상한이 10 이다 (REQ-401) — 12성은 유저만의 증표다. */
export function accrueDiscipleRank(session, styleId) {
  const art = session.disciple.arts[ART_ID];
  if (!art) return null;
  const from = discipleRankOf(session.disciple, ART_ID);
  art.rankPts += BALANCE.rankPtsPerStyle[styleId];
  const to = rankForPts(art.rankPts, { max: BALANCE.discipleRankMax });
  if (to === from) return null;
  logEvent(session, 'rank', { style_set: ART_ID, from, to, pts: art.rankPts });
  return { from, to };
}

export function addCoins(session, delta, reason) {
  session.coins += delta;
  logEvent(session, 'coins', { delta, reason });
}

/** 수련 시뮬 (REQ-604) — 방치 축을 1시간분 재화로 압축해 보여 준다. 소비처는 없다 (M2+). */
export function simulateTraining(session, seconds = BALANCE.simTrainSeconds) {
  const delta = Math.round(BALANCE.simEfficiency * seconds);
  addCoins(session, delta, 'train_sim');
  return delta;
}

/** 개인별 pass/fail 모집단 분리자 (REQ-603) — 로그 하나가 누구의 손인지 여기서만 알 수 있다. */
export function logSessionMeta(session, { testerRole = 'self', device = 'keyboard' } = {}) {
  logEvent(session, 'session', { tester_role: testerRole, device });
}

/** `opening` 이 스키마의 `state` 자리 — grade 만으로는 빈틈 발생률을 역산할 수 없다. */
export function logVerdict(session, verdict, who) {
  logEvent(session, 'verdict', {
    grade: verdict.grade,
    dmg_out: verdict.dmgOut,
    dmg_in: verdict.dmgIn,
    state: verdict.opening,
    who,
  });
}

/** kill (b) 완주율의 분모 — 창을 넘긴 수는 `fire` 와 같은 자리에서 세어야 짝이 맞는다. */
export function logTimeout(session, input) {
  logEvent(session, 'timeout', { styleTop: input.top()?.id ?? null, buffer_len: input.buffer.length });
}

/** 한 수의 판정을 로그와 성장에 함께 반영한다 — 대련 화면과 헤드리스 봇이 이 한 자리를 공유한다. */
export function recordDuelVerdict(session, view) {
  logVerdict(session, view.verdict, 'user');
  if (!view.fire || !isEffectiveSuccess(view.verdict.grade)) return null;
  return recordEffectiveSuccess(session, view.fire.style.id, 'duel');
}

/** 파견 쪽 짝 — 제자는 숙련이 없고 성 포인트만 오른다 (REQ-401). */
export function recordDispatchVerdict(session, view) {
  logVerdict(session, view.verdict, 'disciple');
  if (!view.fire || !isEffectiveSuccess(view.verdict.grade)) return null;
  return accrueDiscipleRank(session, view.fire.style.id);
}

/** 대련 결과 정산 (REQ-209·604) — 문구는 화면이 만들고 여기서는 상태만 움직인다. */
export function settleDuel(session, { win, stage }) {
  if (!win) return { reward: 0, unlocked: null, cleared: false };
  addCoins(session, BALANCE.reward.duelWin, 'duel_win');
  return {
    reward: BALANCE.reward.duelWin,
    unlocked: advanceStage(session, stage),
    cleared: isLastStage(stage),
  };
}

/** 파견 결과 정산 (REQ-406·604). `cycle_done` 이 kill (d) 의 종점이라 승패와 무관하게 찍힌다. */
export function settleDispatch(session, { win }) {
  if (win) addCoins(session, BALANCE.reward.dispatchWin, 'dispatch_win');
  logEvent(session, 'cycle', { phase: 'cycle_done' });
  // 판독기는 첫 사이클만 세므로 그 종점의 값을 붙잡는다 — 이후 화면의 전환은 그 사이클을 오염시키지 않는다.
  session.accessibilityTogglesAtDone ??= session.accessibilityToggles;
  return { reward: win ? BALANCE.reward.dispatchWin : 0 };
}

/**
 * 내보내기 페이로드 (REQ-602). 스키마 위반을 함께 실어, 결손 로그가 kill 산식의
 * 입력으로 조용히 쓰이지 않게 한다 — 판독기는 이 배열이 비어야 통과시킨다.
 */
export function exportPayload(session, { exportedAt = new Date().toISOString() } = {}) {
  return {
    schema: EXPORT_SCHEMA,
    exported_at: exportedAt,
    coins: session.coins,
    // 접근성 창 ×1.3 은 완주율과 `tail_ms` 를 직접 움직이므로, 켠 로그와 끈 로그는 다른 모집단이다.
    accessibility: session.accessibility,
    accessibility_toggles: session.accessibilityTogglesAtDone ?? session.accessibilityToggles,
    balance: balanceDigest(),
    log_violations: session.logViolations.map((v) => ({ ...v })),
    entries: session.log.entries.map((e) => ({ ...e })),
  };
}

export const canTransmitNow = (session) => canTransmit(session.progress, ART_ID, session.disciple);

export function runTransmit(session) {
  session.disciple = transmit(session.progress, session.disciple, ART_ID);
  session.transmitted = true;
  session.label = '고수';
  logEvent(session, 'transmit', { style_set: ART_ID });
}
