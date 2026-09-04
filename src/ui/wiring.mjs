// 계측 배선 (#11) — 「어떤 hook 이 무엇을 로깅·성장시키는가」의 유일한 자리.
// 헤드리스 사이클이 그대로 import 하므로 DOM 은 여기 들어올 수 없고, 호출부는 계측 위에
// 자기 렌더·구동을 얹는다 (`createMatch` 를 쓰는 두 축은 `composeHooks`, 수련은 직접 호출)
// — 방향이 반대가 되면 두 배선이 다시 갈라진다.

import { responseWindowMs, styleById } from '../core.mjs';
import {
  beginBout, beginDuel, beginTrainVisit, claimBoutResult, discipleRanks, equippedStyles, logEvent,
  logTimeout, missionLockRankOf, noteLogViolation, recordDispatchVerdict, recordDuelVerdict,
  recordEffectiveSuccess,
} from './session.mjs';

/**
 * 계측 배선 위에 화면 렌더·구동 hook 을 얹는다. 같은 이름이 덮어쓰기가 아니라 연결이라,
 * 화면이 계측을 조용히 잃는 경로가 구조적으로 없다.
 * @param {object} wiring 계측 hook 묶음
 * @param {object} [overlay] 호출부 고유 hook — 계측 인자 **뒤에** 계측 반환값을 하나 더 받으므로,
 *   계측 hook 의 인자 수를 늘리면 얹은 쪽의 마지막 인자도 함께 옮겨야 한다.
 *   호출부로 나가는 반환값은 계측 쪽 것이다 — 얹은 hook 은 그 값을 갈아끼우지 못한다.
 */
export function composeHooks(wiring, overlay = {}) {
  const names = [...new Set([...Object.keys(wiring), ...Object.keys(overlay)])];
  return Object.fromEntries(names.map((name) => [name, (...args) => {
    const measured = wiring[name]?.(...args);
    // 상속 멤버가 hook 으로 불리지 않도록 own key 로만 얹는다.
    if (Object.hasOwn(overlay, name)) overlay[name](...args, measured);
    return measured;
  }]));
}

/**
 * 수련 배선 (REQ-703·715) — 창을 여는 지점과 완주 지점 둘뿐이라 `createMatch` hook 이 아니다.
 * 방문 계수는 배선을 만드는 그 자리에서 초기화한다 — 화면과 헤드리스가 같은 리듬을 쓴다.
 * @param {object} p.input 후보 필터 입력기
 * @param {boolean} [p.blind] 감춘 초인가 — 기본값은 실전과 같은 원장이고, `createMatch` 와 같은
 *   규약으로 주입을 열어 둔 것은 예고 모드 갈래의 동반 복원이 하네스에 닿아야 하기 때문이다 (#247)
 */
export function trainWiring(session, { styleId, input, blind }) {
  const style = styleById(styleId);
  beginTrainVisit(session, styleId);
  return {
    /** 창 길이는 열 때마다 다시 잰다 — 무대 밖에서 바꾼 접근성 설정이 다음 시도부터 반영된다. */
    onArm() {
      input.arm();
      // 연습이 실전을 준비시키려면 같은 좌표의 게이지가 같은 속도로 비어야 한다 (REQ-308·840).
      return responseWindowMs(style.seq.length, { accessibility: session.accessibility, blind });
    },
    onFire: () => recordEffectiveSuccess(session, style.id, 'train'),
  };
}

/**
 * 파견 결과 기록 (REQ-744) — 진입이 아니라 종료에서 찍는 것은 스키마가 승패를 함께 지기 때문이고,
 * 구간의 시작점은 `cycle{phase}` 가 이미 진다. B-1 무패 보장·B-2 잠금·조합별 승패가 한 항목에서 갈린다.
 * @param {object} p.mission 실제로 싸운 그 임무 — 여기서 다시 도출하면 싸운 적 없는 조합이 기록될 수 있다.
 */
export function logDispatchResult(session, { mission, win }) {
  return logDispatchOutcome(session, mission, win ? 'win' : 'loss');
}

/**
 * 파견 관전 중도 이탈 (REQ-744) — 그 초까지의 판정·성 적립은 이미 로그에 남으므로 결과 항목만
 * 보완한다. 이탈과 패배가 결과값으로 갈려야 승률의 분자가 흔들리지 않고, 재진입은 새 판이다.
 */
export function logDispatchAbort(session, { mission }) {
  return logDispatchOutcome(session, mission, 'abort');
}

/** 판이 아직 결과를 내지 않았을 때만 남긴다 — 두 번째 결과 항목이 곧 판독 분모의 부풀림이다. */
function logDispatchOutcome(session, mission, result) {
  if (!claimBoutResult(session)) {
    // 이탈의 거부는 설계된 침묵이지만 승패의 거부는 끝난 판이 분모에서 사라진 것이라 뜻이 반대다.
    if (result !== 'abort') noteLogViolation(session, 'dispatch', `결과가 이미 실린 판의 ${result}`);
    return null;
  }
  return logEvent(session, 'dispatch', {
    stage: mission.label,
    // 상대별 승패를 가르는 축 (REQ-744) — 「N차」는 임무의 서수라 상대를 식별하지 못한다.
    challenger: mission.challenger.id,
    foe_set: mission.foeSet.slice(),
    disciple_ranks: { ...mission.ranks },
    locked_until: missionLockRankOf(session),
    result,
  });
}

/**
 * 대련 진입 기록 (REQ-734) — 그 대면의 도전자 성과 재대련 회차가 여기서 확정된다.
 * 파견 쪽 짝과 같은 자리라, 화면과 헤드리스가 재대련을 서로 다르게 세는 경로가 없다.
 */
export const logDuelStart = (session, challenger) => beginDuel(session, challenger.id);

/** 대련 배선 (REQ-201·206~211) — 유저의 손이 치는 창의 계측. */
export function duelWiring(session, { input }) {
  return {
    // 초가 바뀔 때 직전 초의 버퍼·후보가 남으면 이미 낸 초식이 아직 걸린 것처럼 읽힌다.
    onExchange: () => input.arm(equippedStyles(session)),
    // 대련 중 자동 장착된 초식이 그 창부터 후보에 든다 — 슬롯 로그와 화면이 갈리지 않는다.
    // 감추는 초에는 두 시점이 겹쳐 같은 초에 두 번 불리지만, 무장은 멱등이라 결과가 같다.
    onWindow: () => input.arm(equippedStyles(session)),
    onTimeout: () => logTimeout(session, input),
    onVerdict: (view) => recordDuelVerdict(session, view),
  };
}

/**
 * 파견 배선 (REQ-403~407) — 손을 놓고 보는 창이라 계측이 곧 제자의 실행 시점이다.
 * @param {object} p.disciple `createDiscipleHand` 의 손
 * @param {() => ?object} [p.instructed] 그 초의 지시 초식 — 관전만 하는 호출부는 주지 않는다.
 *   그 초 한정이라 호출부가 `onExchange` 에서 비워야 한다 (안 비우면 직전 초의 지시가 이어진다).
 */
export function dispatchWiring(session, { disciple, instructed = () => null }) {
  // 파견의 판은 여기서 열린다 — 임무는 차수가 같은 동안 재사용되므로 그 확정 시점은 판이 아니다.
  beginBout(session);
  // 투입된 성도 판마다 다시 뜬다 — 재진입 사이에 정산된 제자 수련이 그 판의 귀속에 들어와야
  // 「어느 조합을 어느 성으로 이겼는가」가 실제와 맞는다 (REQ-744).
  if (session.mission) session.mission.ranks = discipleRanks(session);
  return {
    onExchange: () => disciple.arm(),
    // 지시는 그 초 한정이라 매 프레임 현재 값을 다시 읽는다.
    onTick: (view) => disciple.tick(view, instructed()),
    onVerdict: (view) => recordDispatchVerdict(session, view),
  };
}
