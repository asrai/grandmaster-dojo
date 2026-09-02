// 한자 보조 병기 (REQ-813) — 한글이 주 표기이고 한자는 그 옆·아래의 보조라, 화면에 한자 단독
// 표기는 존재하지 않는다. 모든 한자가 이 헬퍼를 지나 `.hj` 한 클래스로만 렌더되므로
// 「한자 전면 제거」가 규칙 하나의 변경으로 닫힌다.

import { el } from '../dom.mjs';

/**
 * @param {string} text 한자 문자열
 * @param {object} [p]
 * @param {boolean} [p.stacked] 한글 우측 세로열로 세울지 — 기본은 옆·아래 가로 병기다 (REQ-827·863)
 */
export function hanja(text, { stacked = false } = {}) {
  return el('span', { class: `hj${stacked ? ' stacked' : ''}`, text });
}
