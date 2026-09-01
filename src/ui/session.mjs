// 세션 상태 — 상태기계가 화면 사이로 들고 다니는 유일한 가변 덩어리. 영속화는 없다:
// 프로토 판정은 단일 세션이고, 잔존 세이브는 kill (a)·(d) 측정을 진행 중 상태로 오염시킨다.

import { ART_SETS, BALANCE, BALANCE_REV, CHALLENGERS, STYLES } from '../balance.mjs';
import { createLogBuffer, validate } from '../log.mjs';
import {
  accrueDiscipleStyle, applyDiscipleTraining, applyEffectiveSuccess, applyOutcome, artStyles,
  canEquipRank, canTransmit, createDisciple, createProgress, discipleStyleRank, discipleStyles,
  discipleTrainMsPerRank, foeRankOf, isEffectiveSuccess, isMissionUnlocked, ladderBandAt, learn,
  missionFoeRank, missionFoeSet, missionLockRank, missionShortfall, rematchFoeRank, setStyleRank,
  styleById, styleRank, trainHitsToNext, transmit,
} from '../core.mjs';

/** 내보낸 로그의 판독 계약 이름 — `tests/kill-readout.mjs` 가 이 값으로 파일을 받아들인다. */
export const EXPORT_SCHEMA = 'grandmaster-dojo/log-export@1';

/**
 * 판독기가 로그 밖에서 끌어다 쓰는 밸런스 값 — 창 길이·유효 성공 절단선.
 * 내보낸 뒤 이 값들이 튜닝되면 옛 로그가 조용히 다른 수로 읽히므로 지문을 함께 싣는다.
 */
export const balanceDigest = () => ({
  rev: BALANCE_REV,
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

/**
 * @param {object} [opts] `now` 는 `t_ms` 와 제자 수련 경과의 공통 출처 — 헤드리스 봇은 가상
 *   시계를 주고, 그것이 방치 루프를 실시간 대기 없이 회귀시키는 유일한 축이다 (REQ-605·751).
 */
export function createSession({ now = () => Date.now() } = {}) {
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
    // 도전자별 승수 — 재대련 강화·무보상·`attempt_n` 이 전부 이 한 수에서 파생된다 (REQ-734).
    duelWins: {},
    accessibility: BALANCE.accessibilityWindow,
    accessibilityToggles: 0,
    accessibilityAtDone: null,
    label: '문하생',
    transmitted: false,
    tooltip: createTooltipState(),
    // 한 방문에 채우는 수련 창 수 — 누적이 아니라 방문 단위라야 도장↔수련 왕복이 리듬이 된다.
    trainVisit: { styleId: null, hits: 0 },
    now,
    // 제자 수련은 상태기계를 점유하지 않는다 (REQ-752) — 시계만 들고 있어 사부의 화면 전이를 막지 않는다.
    discipleTrain: { styleId: null, sinceMs: now(), carryMs: {} },
    masterActivity: 'dojo',
    // 파견 차수 — 1 = B-1 고정 상대, 2 부터 랜덤 임무 + 하드 잠금 (REQ-741·742).
    dispatchStage: 1,
    mission: null,
    cheat: createCheatState(),
    botRunning: false,
  };
}

/**
 * 화면 전이의 계측 지점 — `cycle{phase}` 의 유일한 출처이자, 걸어 둔 제자 수련이 「사부가 그동안
 * 무엇을 했는가」로 귀속되는 경계다 (REQ-754). 정산이 활동 갱신보다 먼저인 것이 그 귀속이다.
 */
export function enterPhase(session, phase) {
  settleDiscipleTraining(session);
  session.masterActivity = phase;
  logEvent(session, 'cycle', { phase });
}

export const logEvent = (session, event, fields) => session.log.log(event, fields);

/** 도장 유도 툴팁 상태 (#15) — `locked` 가 null 인 것이 「첫 렌더」의 표식이다. */
export const createTooltipState = () => ({ locked: null, target: null, announced: [] });

/**
 * 우선순위 순 후보에서 안내 대상 하나를 고르고 잠금 스냅샷을 갱신한다. 첫 렌더는 최초 진입
 * 유도(`start`), 그 뒤로는 직전 렌더에서 잠겨 있다가 풀린 버튼의 고지(`unlocked`)이며, 둘 다
 * 없으면 직전 안내가 그 대상이 눌릴 수 있는 동안 남는다 — 다른 화면을 한 번 다녀왔다고
 * 안내가 사라지면 그 자리에서 다시 헤매게 된다.
 * @param {{id: string, disabled: boolean, kind?: string}[]} candidates 우선순위 오름차순
 */
export function pickTooltip(state, candidates) {
  const wasLocked = state.locked;
  state.locked = candidates.filter((c) => c.disabled).map((c) => c.id);

  const fresh = candidates.find((c) => !c.disabled && !state.announced.includes(c.id)
    && (wasLocked === null || wasLocked.includes(c.id)));
  if (fresh) {
    // 안내는 버튼마다 1회다 — 장착·해제로 잠금이 오가도 같은 말풍선이 다시 뜨지 않는다.
    state.announced.push(fresh.id);
    state.target = { id: fresh.id, kind: wasLocked === null ? 'start' : 'unlocked' };
  }
  // 다시 잠기거나 사라진 대상은 그 축이 이미 소비된 것이라 안내를 남겨 둘 이유가 없다.
  if (state.target && !candidates.some((c) => c.id === state.target.id && !c.disabled)) state.target = null;
  return state.target;
}

/** 안내한 버튼을 누른 순간 — 그 안내는 역할을 다했으므로 다음 렌더부터 사라진다. */
export function consumeTooltip(state, id) {
  if (state.target?.id === id) state.target = null;
}

export const rankOfStyle = (session, styleId) => styleRank(session.progress, styleId);
export const equippedStyles = (session) => session.slots.filter(Boolean).map(styleById);
export const canEquip = (session, styleId) => canEquipRank(rankOfStyle(session, styleId));
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

// ------------------------------------------------------- 재대련 (REQ-734)

/** 그 도전자를 이미 이긴 횟수 — 초회 대면은 0 이라 강화도 무보상도 걸리지 않는다. */
export const duelWinsOf = (session, challengerId) => session.duelWins[challengerId] ?? 0;

/**
 * 몇 번째 대면인가 — 초회 1, 재대련부터 2·3·4… (`rematch.attempt_n` 의 정의). 승수에서 파생하므로
 * 중단·패배 후 재진입은 **같은 서수를 다시 낸다**: 항목 수가 진입 수이고 서수의 최댓값이 중단 지점이다.
 */
export const duelAttemptOf = (session, challengerId) => duelWinsOf(session, challengerId) + 1;

export const isRematch = (session, challengerId) => duelWinsOf(session, challengerId) > 0;

/** 그 대면의 도전자 성 — 재대련 강화가 실린 값이고 대련 루프·예고 화면이 같은 자리를 읽는다. */
export const duelFoeRank = (session, challengerId) =>
  rematchFoeRank(foeRankOf(challengerId), duelWinsOf(session, challengerId));

/** 그 대면에 실린 강화량 — 예고 화면과 도장 재대련 카드가 같은 수를 말하게 하는 한 자리. */
export const rematchBonusOf = (session, challengerId) =>
  duelFoeRank(session, challengerId) - foeRankOf(challengerId);

/** 이미 이긴 도전자 목록 — 도장 재대련 항목의 원본 (REQ-734). */
export const beatenChallengers = (session) => DUEL_STAGES.filter((c) => isRematch(session, c.id));

/**
 * 대련 진입 (REQ-734) — 그 대면의 성을 확정하고 재대련이면 그것을 로그에 남긴다.
 * 진입에서 찍는 것은 `attempt_n` 이 「몇 번째에 그만두는가」의 지표라, 승패로 걸러지면
 * 마지막 회차(대개 포기한 그 판)가 통째로 빠지기 때문이다.
 */
export function beginDuel(session, challengerId) {
  const foeRank = duelFoeRank(session, challengerId);
  const attemptN = duelAttemptOf(session, challengerId);
  if (attemptN > 1) {
    logEvent(session, 'rematch', { challenger: challengerId, foe_rank: foeRank, attempt_n: attemptN });
  }
  return { foeRank, attemptN };
}

/**
 * @param {?string} [challenger] 그 교체가 일어난 도전자 예고 화면의 도전자 — 「A-4 를 앞두고
 *   진짜 슬롯 판단을 했는가」가 REQ-736 의 지표라 장소가 곧 그 판별자다. null 은 예고 화면 **밖**
 *   전부다 (도장 교체 · 적립이 부르는 `autoEquip`), 그 둘을 다시 가르는 것은 이 필드의 몫이 아니다.
 */
export function equip(session, styleId, slotIdx, { challenger = null } = {}) {
  if (!canEquip(session, styleId)) return false;
  const at = slotIdx ?? session.slots.indexOf(null);
  if (at < 0 || at >= session.slots.length) return false;
  const replaced = session.slots[at];
  if (replaced) logEvent(session, 'slot', { action: 'unequip', styleId: replaced, challenger });
  session.slots[at] = styleId;
  logEvent(session, 'slot', { action: 'equip', styleId, challenger });
  return true;
}

export function unequip(session, slotIdx, { challenger = null } = {}) {
  const styleId = session.slots[slotIdx];
  if (!styleId) return false;
  session.slots[slotIdx] = null;
  logEvent(session, 'slot', { action: 'unequip', styleId, challenger });
  return true;
}

/**
 * 빈 슬롯 자동 채움 (REQ-714) — 자리 양보는 폐지다. 입문 소멸로 「덜 찬 초식에 자리를 준다」는
 * 근거가 사라졌고, 자동 교체는 슬롯 3·초식 4 가 만드는 선택을 대신 해 버린다.
 */
export function autoEquip(session) {
  for (const style of STYLES) {
    if (session.slots.includes(style.id)) continue;
    if (!session.progress.styles[style.id].learned) continue;
    if (!canEquip(session, style.id)) continue;
    if (!session.slots.includes(null)) continue;
    equip(session, style.id);
  }
}

export function learnStyle(session, styleId) {
  session.progress = learn(session.progress, styleId);
  autoEquip(session);
}

/** 사부의 성 변화분을 통합 로그로 흘린다 — 적립과 계단이 같은 자리를 쓴다 (REQ-702·704·706·711). */
function emitMasterChanges(session, changes) {
  if (changes.wall) logEvent(session, 'rank_wall', { actor: 'master', ...changes.wall });
  if (changes.rank) logEvent(session, 'rank', { actor: 'master', ...changes.rank });
  if (changes.unlock) logEvent(session, 'unlock', changes.unlock);
  autoEquip(session);
  return changes;
}

/** 유효 성공 1회 적립 (REQ-702·703) — 수련 방문 계수도 이 한 자리를 지난다. */
export function recordEffectiveSuccess(session, styleId, mode) {
  const { progress, changes } = applyEffectiveSuccess(session.progress, styleId, { mode });
  session.progress = progress;
  if (mode === 'train' && session.trainVisit.styleId === styleId) session.trainVisit.hits += 1;
  return emitMasterChanges(session, changes);
}

/** 결정타·완파가 여는 계단 (REQ-704) — 적립이 멈춘 10성 위는 이 경로로만 오른다. */
export function recordOutcomeRank(session, styleId, outcome) {
  const { progress, changes } = applyOutcome(session.progress, styleId, outcome);
  session.progress = progress;
  return emitMasterChanges(session, changes);
}

/** 제자도 같은 사다리를 타되 상한이 10 이다 (REQ-705) — 11·12성은 자동 전투가 하지 않는 판단이다. */
export function accrueDiscipleRank(session, styleId, { via = 'mission' } = {}) {
  const result = accrueDiscipleStyle(session.disciple, ART_ID, styleId, { mode: 'duel' });
  session.disciple = result.disciple;
  if (result.to === null || result.to === result.from) return null;
  logEvent(session, 'rank', { actor: 'disciple', style: styleId, from: result.from, to: result.to, via });
  return { from: result.from, to: result.to };
}

// ------------------------------------------------- 제자 수련 (REQ-751~754·706)

/** 지정 초식에 지금까지 걸린 시간 — 지정을 옮겨도 이전 초식의 미완분이 남는다. */
function trainElapsedMs(session) {
  const { styleId, sinceMs, carryMs } = session.discipleTrain;
  if (!styleId) return 0;
  return (carryMs[styleId] ?? 0) + Math.max(0, session.now() - sinceMs);
}

/** 수련이 성을 올릴 수 있는 초식인가 (REQ-706) — 8성 벽 위는 파견 전용이라 지정 자체가 열리지 않는다. */
export function canDiscipleTrain(session, styleId) {
  const rank = discipleStyleRank(session.disciple, ART_ID, styleId);
  if (rank === null || rank >= BALANCE.discipleRankMax) return false;
  const band = ladderBandAt(rank);
  return Boolean(band && band.train);
}

/**
 * 걸어 둔 시간을 성으로 정산한다 (REQ-751·754). 상태기계를 점유하지 않으므로 이 함수는 화면
 * 전이·렌더 어디서 불려도 같은 값을 내야 한다 — 그래서 소비한 시간만 지우고 나머지를 이월한다.
 */
export function settleDiscipleTraining(session) {
  const timer = session.discipleTrain;
  const styleId = timer.styleId;
  if (!styleId) return null;
  const result = applyDiscipleTraining(session.disciple, ART_ID, styleId, trainElapsedMs(session));
  session.disciple = result.disciple;
  timer.carryMs[styleId] = result.restMs;
  timer.sinceMs = session.now();
  if (result.to > result.from) {
    logEvent(session, 'disciple_train', {
      style: styleId,
      from: result.from,
      to: result.to,
      elapsed_ms: result.consumedMs,
      master_activity: session.masterActivity,
    });
    logEvent(session, 'rank', {
      actor: 'disciple', style: styleId, from: result.from, to: result.to, via: 'train',
    });
  }
  // 벽에 닿으면 지정을 놓는다 — 더 걸어도 무효인 시간을 계속 태우면 8성 벽이 유저를 파견으로 밀지 못한다.
  if (result.wall) {
    logEvent(session, 'rank_wall', {
      actor: 'disciple', style: styleId, at_rank: result.to, attempted: 'train',
    });
    timer.styleId = null;
    timer.carryMs[styleId] = 0;
  }
  return result;
}

/**
 * 수련시킬 초식 지정 (REQ-751) — 파견(자동 전투)이 주지 못하는 초식별 성장 통제권이 이 한 자리다.
 * 지정을 옮겨도 이전 초식의 미완 시간은 남는다: 옮기는 것이 손해가 되면 통제권은 이름만 남는다.
 */
export function designateDiscipleTraining(session, styleId) {
  if (!canDiscipleTrain(session, styleId)) return false;
  settleDiscipleTraining(session);
  session.discipleTrain.styleId = styleId;
  session.discipleTrain.sinceMs = session.now();
  return true;
}

/** 진척 막대 1개의 입력 (REQ-752) — 지정 초식의 다음 계단까지 채워진 비율. */
export function discipleTrainProgress(session) {
  const styleId = session.discipleTrain.styleId;
  if (!styleId) return null;
  const per = discipleTrainMsPerRank();
  const elapsed = trainElapsedMs(session);
  return {
    styleId,
    rank: discipleStyleRank(session.disciple, ART_ID, styleId),
    ratio: Math.min(1, elapsed / per),
    leftMs: Math.max(0, per - elapsed),
  };
}

/**
 * 시간 주입 (REQ-753) — 걸어 둔 시각을 그만큼 앞당긴다. 방치 축을 압축해 **보여 주는** 자리이자
 * 하네스가 시계를 가속하는 자리이며, 1성당 시간(게임 수치) 자체는 건드리지 않는다.
 */
export function advanceDiscipleTraining(session, ms) {
  session.discipleTrain.sinceMs -= Math.max(0, ms);
  return settleDiscipleTraining(session);
}

// ------------------------------------------------------- 임무 (REQ-741~744)

/** 그 파견 시점의 제자 초식별 성 — 랜덤 조합별 승패는 성과 함께 봐야 분리 식별이 된다 (REQ-744). */
export const discipleRanks = (session) => Object.fromEntries(discipleStyles(session.disciple, ART_ID)
  .map((s) => [s.id, discipleStyleRank(session.disciple, ART_ID, s.id)]));

/** 그 차수가 요구하는 최소 성 (B-1 은 null) — 화면의 잠금 표시와 로그가 같은 자리를 읽는다. */
export const missionLockRankOf = (session) => missionLockRank(session.dispatchStage);

/** 권장 성에 못 미치는 제자 초식 — 하드 잠금이 이유를 대는 자리다 (REQ-743). */
export const missionShortfallOf = (session) =>
  missionShortfall(session.disciple, ART_ID, session.dispatchStage);

/** 파견 진입 자격 — 전수 전에는 제자가 없고, B-2 부터는 전 초식 최소 성이 잠금을 쥔다. */
export const canDispatch = (session) => session.transmitted
  && isMissionUnlocked(session.disciple, ART_ID, session.dispatchStage);

/**
 * 그 차수의 임무를 확정한다 (REQ-741·742) — B-1 만 고정 상대이고, B-2 부터는 아키타입 풀에서
 * 매 임무 새로 뽑아 눌러앉기를 구조로 막는다. 난이도는 성으로만 오른다 (파견 무대는 하나다).
 */
export function beginMission(session, { random = Math.random } = {}) {
  const stage = session.dispatchStage;
  const foeSet = stage <= 1 ? DISPATCH_CHALLENGER.styles.slice() : missionFoeSet(random);
  session.mission = {
    stage,
    label: `B-${stage}`,
    foeSet,
    foeRank: missionFoeRank(stage, foeRankOf(DISPATCH_CHALLENGER.id)),
    challenger: { ...DISPATCH_CHALLENGER, styles: foeSet },
  };
  return session.mission;
}

/**
 * 진행 중인 임무 — 조합은 **한 판에 한 번** 확정된다. 화면 진입마다 다시 굴리면 예고↔도장 왕복이
 * 공짜 리롤이 되어, 눌러앉기를 막으려던 랜덤이 가장 쉬운 조합에 눌러앉는 경로가 된다.
 */
export function currentMission(session, options = {}) {
  const mission = session.mission;
  return mission && mission.stage === session.dispatchStage ? mission : beginMission(session, options);
}

/** 수련 방문 시작 (REQ-715) — 방문 계수의 유일한 초기화 지점. */
export function beginTrainVisit(session, styleId) {
  session.trainVisit = { styleId, hits: 0 };
}

export const trainVisitDone = (session) => session.trainVisit.hits >= BALANCE.trainGraduateHits;

/** 이 초식의 다음 계단까지 남은 수련 완주 수 — 수련 화면의 진척 표시가 읽는다. */
export const trainHitsLeft = (session, styleId) => trainHitsToNext(session.progress.styles[styleId]);

export function addCoins(session, delta, reason) {
  session.coins += delta;
  logEvent(session, 'coins', { delta, reason });
}

/** 수련 시뮬 (REQ-604) — 방치 축을 1시간분 재화로 압축해 보여 준다. 소비처는 없다 (M2+). */
export function simulateTraining(session, seconds = BALANCE.simTrainSeconds) {
  const delta = Math.round(BALANCE.simEfficiency * seconds);
  addCoins(session, delta, 'train_sim');
  // 같은 압축이 걸어 둔 제자 수련에도 걸린다 (REQ-753) — 평가자는 실제로 방치할 수 없으므로
  // 방치 축의 결과를 이 버튼으로 본다. 1성당 시간을 줄이는 것과는 반대 방향의 해소다.
  advanceDiscipleTraining(session, seconds * 1000);
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

/**
 * 한 수의 판정을 로그와 성장에 함께 반영한다 — 대련 화면과 헤드리스 봇이 이 한 자리를 공유한다.
 *
 * **계단을 적립보다 먼저 판정하는 것이 REQ-704 의 「한 수 최대 1계단」이다.** 두 판정은 그 수의
 * *같은* 성을 봐야 하고, 계단은 적립이 멈춘 성(10·11)에서만 열리므로 순서를 그렇게 두면 둘 중
 * 하나만 발화하는 것이 구조로 보장된다. 반대로 두면 적립이 9→10 을 만든 뒤 결정타가 그 10 을
 * 보고 11 을 열어 한 수에 두 계단이 오른다.
 */
export function recordDuelVerdict(session, view) {
  logVerdict(session, view.verdict, 'user');
  if (!view.fire) return null;
  const styleId = view.fire.style.id;
  // 수 상한의 잔여 HP 비교승은 그 타격이 확정한 승리가 아니다 — 결정타는 상대를 쓰러뜨린 수뿐이다.
  const finish = view.outcome?.win === true && view.outcome.by === 'hp';
  if (finish) logFinish(session, view, styleId);
  const promoted = recordOutcomeRank(session, styleId, {
    finish, crush: view.verdict.grade === 'crush',
  });
  const accrued = isEffectiveSuccess(view.verdict.grade)
    ? recordEffectiveSuccess(session, styleId, 'duel') : null;
  return promoted.rank ? promoted : accrued;
}

/**
 * 결정타 기록 (REQ-708) — 어느 초식이 끝냈는지의 인과를 남긴다. `intended` 는 그 수가 11성
 * 계단을 노리던 초식에 떨어졌는가다: 결정타의 통제 불가는 의도된 난이도이고 재는 것은 배분이다.
 */
function logFinish(session, view, styleId) {
  logEvent(session, 'finish', {
    style: styleId,
    challenger: view.challenger.id,
    intended: rankOfStyle(session, styleId) === BALANCE.rankLadder.finishRank - 1,
  });
}

/** 파견 쪽 짝 — 제자는 같은 사다리를 상한 10성으로 탄다 (REQ-705). */
export function recordDispatchVerdict(session, view) {
  logVerdict(session, view.verdict, 'disciple');
  if (!view.fire || !isEffectiveSuccess(view.verdict.grade)) return null;
  return accrueDiscipleRank(session, view.fire.style.id);
}

// ---------------------------------------------------------- 개발자 치트 (REQ-781~783)

export const createCheatState = () => ({ enabled: false, used: false });

/**
 * 치트 패널 노출 토글 (REQ-781·783). 봇이 도는 동안은 켜지지 않는다 — 페이스 표본에 주입이
 * 섞이면 그 회차가 무엇을 잰 것인지 로그로 가를 수 없다.
 */
export function setCheatEnabled(session, enabled) {
  session.cheat.enabled = Boolean(enabled) && !session.botRunning;
  return session.cheat.enabled;
}

/** 봇 구동 상태 — 치트 강제 off 의 근거이자 유일한 전환 지점이다 (REQ-783). */
export function setBotRunning(session, running) {
  session.botRunning = Boolean(running);
  if (session.botRunning) session.cheat.enabled = false;
}

/**
 * 치트 주입 (REQ-781·782) — 세션에 지워지지 않는 플래그를 남긴다. 주입은 축적을 건너뛰므로
 * 그 세션은 balance-log 회차와 kill (b)(c)(d) 표본에서 통째로 빠진다.
 * @param {() => void} mutate 세션 상태를 실제로 바꾸는 일 — 플래그를 먼저 세우는 것은 「바꿨는데
 *   표식이 없다」가 REQ-782 의 구멍이기 때문이다 (반대 방향의 헛플래그는 표본 하나를 더 뺄 뿐이다)
 */
export function applyCheat(session, action, mutate) {
  if (!session.cheat.enabled) return false;
  session.cheat.used = true;
  logEvent(session, 'cheat', { action, session_flagged: true });
  mutate();
  return true;
}

/** 주입 가능한 성인지 — 화면이 던지는 값을 먼저 거른다 (핸들러 밖으로 새는 throw 는 무음 실패다). */
export const isInjectableRank = (rank) => Number.isInteger(rank) && rank >= 1 && rank <= BALANCE.rankMax;

/** 초식 성 직접 주입 — 전수 직전 등 임의 시점에서 플레이를 시작하기 위한 개발·QA 경로다. */
export function cheatSetStyleRank(session, styleId, rank) {
  if (!isInjectableRank(rank)) return false;
  return applyCheat(session, `rank:${styleId}=${rank}`, () => {
    session.progress = setStyleRank(session.progress, styleId, rank);
    autoEquip(session);
  });
}

export const isCheatFlagged = (session) => session.cheat.used;

/**
 * 대련 결과 정산 (REQ-209·604·734) — 문구는 화면이 만들고 여기서는 상태만 움직인다.
 * 재대련 승리에 재화를 주지 않는 것이 파밍 루프를 끊는 자리다 — 성 +1 은 난이도로 막고
 * 무보상은 동기로 막아, 둘 중 하나만으로는 「더 캘까」가 계속 이득으로 남는다.
 */
export function settleDuel(session, { win, stage }) {
  if (!win) return { reward: 0, unlocked: null, cleared: false, rematch: false };
  const challengerId = challengerOfStage(stage).id;
  const rematch = isRematch(session, challengerId);
  session.duelWins[challengerId] = duelWinsOf(session, challengerId) + 1;
  if (!rematch) addCoins(session, BALANCE.reward.duelWin, 'duel_win');
  return {
    reward: rematch ? 0 : BALANCE.reward.duelWin,
    unlocked: advanceStage(session, stage),
    cleared: isLastStage(stage),
    rematch,
  };
}

/** 파견 결과 정산 (REQ-406·604). `cycle_done` 이 kill (d) 의 종점이라 승패와 무관하게 찍힌다. */
export function settleDispatch(session, { win }) {
  if (win) addCoins(session, BALANCE.reward.dispatchWin, 'dispatch_win');
  logEvent(session, 'cycle', { phase: 'cycle_done' });
  // 판독기는 첫 사이클만 세므로 그 종점의 상태를 통째로 붙잡는다 — 이후 화면의 전환은 그 사이클을 오염시키지 않는다.
  session.accessibilityAtDone ??= { on: session.accessibility, toggles: session.accessibilityToggles };
  // 이긴 차수만 다음 임무를 연다 — 패배가 차수를 밀면 하드 잠금이 실패를 통과 경로로 만든다.
  if (win && session.mission?.stage === session.dispatchStage) session.dispatchStage += 1;
  // 임무는 한 판에 소비된다 — 남겨 두면 다음 진입이 지난 차수의 조합으로 싸운다.
  session.mission = null;
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
    accessibility: session.accessibilityAtDone?.on ?? session.accessibility,
    accessibility_toggles: session.accessibilityAtDone?.toggles ?? session.accessibilityToggles,
    balance: balanceDigest(),
    // 주입 세션은 축적을 건너뛴 표본이라 판독기가 회차에서 통째로 빼야 한다 (REQ-782).
    cheat_flagged: isCheatFlagged(session),
    log_violations: session.logViolations.map((v) => ({ ...v })),
    entries: session.log.entries.map((e) => ({ ...e })),
  };
}

export const canTransmitNow = (session) => canTransmit(session.progress, ART_ID, session.disciple);

export function runTransmit(session) {
  session.disciple = transmit(session.progress, session.disciple, ART_ID);
  session.transmitted = true;
  session.label = '고수';
  // 초식별 성을 함께 남긴다 — 전수 단위가 무공이어도 제자가 받는 것은 초식마다의 좌표다 (REQ-761·791).
  logEvent(session, 'transmit', {
    art: ART_ID,
    styles: artStyles(ART_ID).map((s) => ({ id: s.id, rank: discipleStyleRank(session.disciple, ART_ID, s.id) })),
  });
}
