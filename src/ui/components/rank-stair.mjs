// 성(成) 계단 (REQ-817·818) — 계단을 화면마다 다시 짜면 같은 규칙이 화면 수만큼 갈라지므로,
// 성을 그리는 모든 화면이 이 한 컴포넌트를 통과한다.

import { BALANCE } from '../../balance.mjs';
import { trainAccrualCap } from '../../core.mjs';
import { el } from '../dom.mjs';

/** 수련이 끊기고 실전만 남는 경계 칸 (REQ-706) — 벽의 위치는 적립 구간표가 정하는 값이다. */
const wallStep = () => trainAccrualCap() + 1;

/** 적립이 아니라 결정타·완파로 열리는 두 칸 (REQ-707) — 그 사실을 형태로 말한다. */
const STEP_SHAPE = {
  [BALANCE.rankLadder.finishRank]: 'finish',
  [BALANCE.rankLadder.crushRank]: 'crush',
};

/**
 * 계단의 색 축 (REQ-864) — 가르는 것은 「누구의 성인가」가 아니라 **전수 이관 행에서 건너간 값과
 * 새로 시작하는 값**이다. 그래서 결과 화면의 오른 성은 대련·파견 모두 금이고(그 화면의 금은
 * 「이 판에서 번 것」의 색이다), 청은 이관 행의 제자 칸에만 선다.
 * 값은 원장이 지고 여기서는 토큰 **이름**만 고른다.
 */
export const STAIR_TONE = { GAINED: 'gained', TRANSFERRED: 'transferred' };

/**
 * @param {object} p
 * @param {number} p.rank 현재 성
 * @param {number} [p.progress] 다음 칸의 부분 채움 비율 (0~1)
 * @param {number} [p.gained] 이번 판에 오른 칸 수 — 그만큼의 최근 칸이 발광한다 (REQ-818)
 * @param {string} [p.tone] `STAIR_TONE` 중 하나 — 생략하면 「번 값」의 금이다
 * @returns {HTMLElement} `.steps` 노드
 */
export function rankStair({ rank, progress = 0, gained = 0, tone = STAIR_TONE.GAINED }) {
  const wall = wallStep();
  const glowFrom = rank - gained + 1;
  const steps = Array.from({ length: BALANCE.rankMax }, (_, i) => {
    const at = i + 1;
    const lit = at <= rank;
    const shape = STEP_SHAPE[at];
    const cls = ['st', lit ? 'on' : '', lit && at >= glowFrom ? 'gain' : '', at === wall ? 'wall' : '']
      .filter(Boolean).join(' ');
    const width = lit ? 100 : at === rank + 1 ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : 0;
    return el('span', { class: cls, title: `${at}성` }, [
      el('i', { class: 'fill', style: `width:${width}%` }),
      shape ? el('i', { class: `mk ${shape}`, 'aria-hidden': 'true' }) : null,
    ]);
  });
  return el('div', { class: `steps tone-${tone}` }, steps);
}

/**
 * 수련 회차 계단 (REQ-845) — 성 계단과 같은 칸 조판을 쓰되 세는 것이 성이 아니라 그 성까지의
 * 완주 횟수다. 칸 수는 `trainVisitSpan` 이 정하므로 화면이 3 을 상수로 갖지 않는다 (REQ-702).
 * @param {object} p
 * @param {number} p.done 채운 칸
 * @param {number} p.total 칸 수
 * @returns {HTMLElement} `.steps.visits` 노드
 */
export function visitStair({ done, total }) {
  const steps = Array.from({ length: total }, (_, i) => el('span', {
    class: `st${i < done ? ' on' : ''}`,
  }, [el('i', { class: 'fill', style: `width:${i < done ? 100 : 0}%` })]));
  return el('div', { class: 'steps visits' }, steps);
}
