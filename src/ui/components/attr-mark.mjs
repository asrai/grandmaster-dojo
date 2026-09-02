// 속성 표시 (REQ-112·819) — 색과 형태를 함께 쓰는 것이 현행의 유일한 접근성 성공 자산이라
// 축을 줄이지 않는다. 색은 원장 토큰의 이름으로만 들어온다 (REQ-810).

import { el } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';

/**
 * @param {string} attrId `fast`·`hard`·`fine`
 * @param {object} [p]
 * @param {string} [p.size] 크기 변형 클래스 (`big`)
 */
export function attrMark(attrId, { size = '' } = {}) {
  const view = viewOf(attrId);
  return el('span', { class: `mark ${size}`.trim(), text: view.shape, style: `color:${view.color}` });
}

/** 죽간·행의 색띠에 꽂는 속성 색 — 호출부가 인라인 `--attr` 로 넘긴다. */
export const attrTone = (attrId) => viewOf(attrId).color;

// 표시 규약이 빠진 속성은 형태 없는 빈 표식으로 그려지므로, 그 자리에서 터뜨린다.
function viewOf(attrId) {
  const view = ATTR_VIEW[attrId];
  if (!view) throw new Error(`표시 규약이 없는 속성: ${attrId}`);
  return view;
}
