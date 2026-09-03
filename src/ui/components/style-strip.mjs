// 세로 죽간 카드 스트립 (REQ-886·888) — 대련 죽간과 `.slip` 을 클래스째 공유하는 표시 전용 줄이라
// 죽간 조판을 바꾸면 이 스트립도 함께 움직인다. S7 「내 슬롯」과 파견 예고 「제자 초식」이 같은
// 규격이어야 브리핑이 화면마다 다시 배우는 것이 되지 않으므로, 조판을 여기 한 벌만 둔다.

import { el } from '../dom.mjs';
import { hanja } from './hanja.mjs';

/**
 * @param {object} p
 * @param {{style: ?object, rank: ?number}[]} p.items 빈 칸은 `style: null` 로 들어온다
 * @param {string} p.label 낭독 이름 — 같은 규격의 스트립이 화면마다 무엇을 담는지 갈리는 자리다
 * @param {?string} [p.tone] 성 배지의 주인을 가르는 수식자 (`disciple` = 제자 성)
 */
export const styleStrip = ({ items, label, tone = null }) => el('div', {
  // 카드가 표시 전용이라 스트립 안에 포커스 받을 것이 없다 — 이 상자가 탭 정지점을 지지 않으면
  // 칸이 넘친 순간 키보드로 뒤쪽 카드에 닿는 경로가 사라진다 (REQ-911).
  class: `slots${tone ? ` ${tone}` : ''}`, role: 'list', 'aria-label': label, tabindex: '0',
}, items.map(({ style, rank }) => el('div', { class: `slip${style ? '' : ' empty'}`, role: 'listitem' }, [
  el('span', { class: 'slip-head' }, [
    el('b', { class: 'slip-rank', text: rank == null ? '' : `${rank}성` }),
  ]),
  el('span', { class: 'slip-body' }, [
    el('span', { class: 'slip-name', text: style ? style.name : '빈 슬롯' }),
    style ? hanja(style.hanja, { stacked: true }) : null,
  ]),
])));
