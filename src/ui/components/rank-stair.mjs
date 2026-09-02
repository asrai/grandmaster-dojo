// 성(成) 계단 (REQ-817·818) — S2 도장·S3 수련·S5 전수·S6 결과가 이 한 컴포넌트를 공유한다.
// 12칸 눈금 · 지난 칸 금 충전 · 현재 칸 부분 채움 · 8성 벽 · 11·12칸 형태 부호화가 여기 한 곳에만
// 있어야, 화면마다 계단이 조금씩 다른 규칙으로 갈라지지 않는다.

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
 * @param {object} p
 * @param {number} p.rank 현재 성
 * @param {number} [p.progress] 다음 칸의 부분 채움 비율 (0~1)
 * @param {number} [p.gained] 이번 판에 오른 칸 수 — 그만큼의 최근 칸이 발광한다 (REQ-818)
 * @returns {HTMLElement} `.steps` 노드
 */
export function rankStair({ rank, progress = 0, gained = 0 }) {
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
  return el('div', { class: 'steps' }, steps);
}
