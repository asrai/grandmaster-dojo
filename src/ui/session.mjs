// 세션 상태 — 상태기계가 화면 사이로 들고 다니는 유일한 가변 덩어리. 영속화는 없다:
// 프로토 판정은 단일 세션이고, 잔존 세이브는 kill (a)·(d) 측정을 진행 중 상태로 오염시킨다.

import { ART_SETS, BALANCE, CHALLENGERS, STYLES } from '../balance.mjs';
import { createLogBuffer } from '../log.mjs';
import {
  applyEffectiveSuccess, canTransmit, createDisciple, createProgress, discipleRankOf,
  learn, masteryPct, rankForPts, rankOf, styleById, transmit,
} from '../core.mjs';

/** 프로토의 비급은 1권뿐이라 무공 축의 모든 조회가 이 id 로 수렴한다. */
export const ART_ID = ART_SETS[0].id;
export const DUEL_STAGES = CHALLENGERS.filter((c) => c.mode === 'duel')
  .slice().sort((a, b) => a.stage - b.stage);
export const DISPATCH_CHALLENGER = CHALLENGERS.find((c) => c.mode === 'dispatch');

export function createSession() {
  return {
    // 플레이 경로는 비엄격 — 필드 오타 하나가 이벤트 핸들러 안의 throw 로 게임을 멈추게 하면 안 된다.
    log: createLogBuffer({ strict: false }),
    progress: createProgress(),
    disciple: createDisciple(),
    slots: Array.from({ length: BALANCE.slots }, () => null),
    coins: 0,
    stage: 1,
    accessibility: BALANCE.accessibilityWindow,
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

export const canTransmitNow = (session) => canTransmit(session.progress, ART_ID, session.disciple);

export function runTransmit(session) {
  session.disciple = transmit(session.progress, session.disciple, ART_ID);
  session.transmitted = true;
  session.label = '고수';
  logEvent(session, 'transmit', { style_set: ART_ID });
}
