// 속성 표시 (REQ-112·819·911) — 색과 형태를 함께 쓰는 것이 현행의 유일한 접근성 성공 자산이라
// 축을 줄이지 않는다. 색은 원장 토큰의 이름으로만 들어온다 (REQ-810).
// 도형(▲●■)은 **뜻 모를 기호로 먼저 읽히므로** 접근성 트리에서 빼고, 같은 자리에 속성 이름을
// 텍스트 대체로 세운다 (#48) — 시각 축은 그대로 셋이고 낭독 축만 이름으로 갈린다.

import { el } from '../dom.mjs';
import { ATTR_VIEW, attrLabel } from '../theme.mjs';

/**
 * @param {string} attrId `fast`·`hard`·`fine`
 * @param {object} [p]
 * @param {string} [p.size] 크기 변형 클래스 (`big`)
 * @param {boolean} [p.silent] 속성 이름이 바로 옆에 이미 글자로 있는 자리 — 텍스트 대체를
 *   함께 두면 낭독기가 같은 말을 두 번 읽는다
 */
export function attrMark(attrId, { size = '', silent = false } = {}) {
  const view = viewOf(attrId);
  return el('span', { class: `mark ${size}`.trim(), style: `color:${view.color}` }, [
    el('i', { class: 'glyph', text: view.shape, 'aria-hidden': 'true' }),
    silent ? null : el('span', { class: 'sr-only', text: attrLabel(attrId) }),
  ]);
}

/** 죽간·행의 색띠에 꽂는 속성 색 — 호출부가 인라인 `--attr` 로 넘긴다. */
export const attrTone = (attrId) => viewOf(attrId).color;

// 표시 규약이 빠진 속성은 형태 없는 빈 표식으로 그려지므로, 그 자리에서 터뜨린다.
function viewOf(attrId) {
  const view = ATTR_VIEW[attrId];
  if (!view) throw new Error(`표시 규약이 없는 속성: ${attrId}`);
  return view;
}
