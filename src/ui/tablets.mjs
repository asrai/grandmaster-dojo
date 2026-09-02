// 죽간 렌더러 (REQ-805) — 십자 키패드에서 분리돼 있어, 키패드가 없는 화면(S4 파견 관전)도
// 죽간만 장착할 수 있다. 매수 자체가 「후보가 좁혀졌다」의 표현이라 1매는 크게 그린다 (REQ-824).

import { attrMark, clear, el } from './dom.mjs';
import { ATTR_VIEW } from './theme.mjs';

/**
 * 죽간 매 하나.
 * @param {object} p
 * @param {object} p.style 초식 — `attr`·`name` 을 읽는다
 * @param {string} [p.mods] 상태 클래스 (`top`·`picked`·`flash`·`mini` 등)
 * @param {string[]} [p.tags] 이름 옆 꼬리표
 * @param {string} [p.title] 툴팁 (구결)
 * @param {Function} [p.onTap] 탭 처리 — 없으면 버튼이 아니라 표시 전용 죽간이다
 */
function tablet({ style, mods = '', tags = [], title = null, onTap = null }) {
  const attrs = {
    class: `cand${mods ? ` ${mods}` : ''}`,
    style: `--attr:${ATTR_VIEW[style.attr].color}`,
    title,
  };
  if (onTap) {
    attrs.onclick = onTap;
    // 지시·선택 상태가 테두리와 꼬리표에만 있으면 낭독으로는 토글인지조차 읽히지 않는다.
    attrs['aria-pressed'] = String(mods.includes('picked'));
  }
  return el(onTap ? 'button' : 'div', attrs, [
    attrMark(style.attr),
    el('span', { class: 'cand-name', text: style.name }),
    ...tags.map((text) => el('span', { class: 'tag', text })),
  ]);
}

/**
 * 장착 가능한 죽간 줄 — 호출부가 `node` 를 자기 트리에 넣고 `render` 로 매를 갈아 끼운다.
 * @param {object} [p]
 * @param {boolean} [p.soloEmphasis] 1매를 크게 그릴지 — 「후보가 좁혀졌다」가 참인 호출부만 켠다.
 *   파견 관전의 1매는 좁혀진 결과가 아니라 제자가 아는 초식이 하나뿐이라는 뜻이다 (REQ-824).
 * @returns {{node: HTMLElement, render: (items: object[]) => void, clear: () => void}}
 */
export function createTablets({ soloEmphasis = false } = {}) {
  const node = el('div', { class: 'tablets' });
  return {
    node,
    /** @param {object[]} items `tablet` 서술자 목록 */
    render(items) {
      // 1매 = 확정이라, 그 순간이 화면에서 가장 큰 사건이 되게 한다 (REQ-824).
      clear(node).className = `tablets${soloEmphasis && items.length === 1 ? ' solo' : ''}`;
      for (const item of items) node.appendChild(tablet(item));
    },
    clear() { clear(node); },
  };
}
