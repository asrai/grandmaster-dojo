// 죽간 렌더러 (REQ-805) — 십자 키패드에서 분리돼 있어, 키패드가 없는 화면(S4 파견 관전)도
// 죽간만 장착할 수 있다. 매수 자체가 「후보가 좁혀졌다」의 표현이라 매수에 따라 폭이 자라고,
// 탈락한 매는 즉시 지우지 않고 가라앉힌다 (REQ-824·825). 어느 매가 어느 상태인지는
// `tablet-state.mjs` 가 정하고 이 모듈은 그것을 DOM 으로 옮기기만 한다.

import { clear, el } from './dom.mjs';
import { attrMark, attrTone } from './components/attr-mark.mjs';
import { hanja } from './components/hanja.mjs';
import { TABLET, tabletStates } from './tablet-state.mjs';

/**
 * 죽간 매 하나 — 속성 기호·성 배지·초식명·한자 세로열이 한 매 안에 함께 선다. 속성과 성이
 * 한 쌍으로 위력을 정하므로(REQ-721) 둘을 갈라 두지 않는다 (REQ-827).
 * @param {object} item `render` 가 받는 서술자
 * @returns {{node: HTMLElement, paint: (item: object, state: string) => void}}
 */
function createSlip(item) {
  const { style, onTap } = item;
  // 핸들러를 상태마다 다시 걸면 매를 새로 만들지 않는 의미가 없다 — 최신 서술자만 갈아 끼운다.
  let current = item;
  const rankEl = el('b', { class: 'slip-rank' });
  const tagsEl = el('span', { class: 'slip-tags' });
  const node = el(onTap ? 'button' : 'div', { class: 'slip' }, [
    el('span', { class: 'slip-head' }, [attrMark(style.attr), rankEl]),
    el('span', { class: 'slip-body' }, [
      el('span', { class: 'slip-name', text: style.name }),
      hanja(style.hanja, { stacked: true }),
    ]),
    tagsEl,
  ]);
  if (onTap) node.addEventListener('click', () => current.onTap?.());

  return {
    node,
    paint(next, state) {
      current = next;
      node.className = ['slip', state, next.mods].filter(Boolean).join(' ');
      node.setAttribute('style', `--attr:${attrTone(style.attr)}`);
      if (next.title) node.title = next.title;
      // 지시·선택 상태가 테두리와 꼬리표에만 있으면 낭독으로는 토글인지조차 읽히지 않는다.
      if (onTap) node.setAttribute('aria-pressed', String((next.mods ?? '').includes('picked')));
      rankEl.textContent = next.rank == null ? '' : `${next.rank}성`;
      clear(tagsEl);
      for (const text of next.tags ?? []) tagsEl.appendChild(el('span', { class: 'tag', text }));
    },
  };
}

/**
 * 장착 가능한 죽간 줄 — 호출부가 `node` 를 자기 트리에 넣고 `render` 로 매를 갈아 끼운다.
 * @param {object} [p]
 * @param {boolean} [p.soloEmphasis] 1매를 「확정」으로 그릴지 — 「후보가 좁혀졌다」가 참인
 *   호출부만 켠다. 파견 관전의 1매는 좁혀진 결과가 아니라 제자가 아는 초식이 하나뿐이라는
 *   뜻이라, 그 화면에서는 금테도 최소 표시 시간도 성립하지 않는다 (REQ-824·826).
 * @returns {{node: HTMLElement, render: (items: object[]) => void, clear: () => void,
 *   onlyShownAt: () => ?number}}
 */
export function createTablets({ soloEmphasis = false } = {}) {
  const node = el('div', { class: 'tablets' });
  /** 화면에 살아 있는 매 — 상태가 바뀌어도 노드를 그대로 쓴다 (REQ-825 전량 재생성 금지). */
  const live = new Map();
  /** 가라앉는 중인 매 — 전이가 끝나야 사라지므로 살아 있는 매와 다른 목록에 있다. */
  const sinking = new Map();
  let drawn = [];
  let onlyAt = null;

  /** 가라앉기가 끝났거나 같은 초식이 되살아난 순간 — 남기면 같은 매가 두 벌 보인다. */
  function bury(id) {
    const ghost = sinking.get(id);
    if (!ghost) return;
    sinking.delete(id);
    ghost.node.remove();
  }

  return {
    node,
    /** @param {object[]} items `{style, rank?, mods?, tags?, title?, onTap?}` 목록 */
    render(items) {
      const next = items.map((item) => item.style.id);
      const byId = new Map(items.map((item) => [item.style.id, item]));
      const states = tabletStates(drawn, next);

      for (const { id, state } of states) {
        if (state === TABLET.EXIT) {
          const going = live.get(id);
          if (!going) continue;
          live.delete(id);
          sinking.set(id, going);
          going.node.className = 'slip out';
          going.node.addEventListener('animationend', () => bury(id), { once: true });
          continue;
        }
        bury(id);
        // 파견 관전의 1매는 확정이 아니므로 금테를 주지 않는다 — 상태 계산은 같고 표현만 갈린다.
        const shown = state === TABLET.ONLY && !soloEmphasis ? TABLET.HOLD : state;
        const slip = live.get(id) ?? createSlip(byId.get(id));
        slip.paint(byId.get(id), shown);
        live.set(id, slip);
      }
      // 살아남은 매와 가라앉는 매를 한 순서로 다시 꽂는다 — `appendChild` 는 이동이라 노드가 유지된다.
      for (const { id } of states) {
        const slip = live.get(id) ?? sinking.get(id);
        if (slip) node.appendChild(slip.node);
      }
      // 폭은 매수가 정한다 — 4매 84 → 2매 132 → 1매 172 의 계단이 원장에 있다 (REQ-824).
      node.dataset.n = String(next.length);
      drawn = next;

      const confirmed = soloEmphasis && next.length === 1;
      // 확정 연출이 얼마나 오래 보였는지는 판정 대기의 입력이라 그 시각을 여기서 잡는다 (REQ-826).
      if (!confirmed) onlyAt = null;
      else if (onlyAt === null) onlyAt = performance.now();
    },
    clear() {
      for (const id of [...sinking.keys()]) bury(id);
      live.clear();
      drawn = [];
      onlyAt = null;
      clear(node);
      delete node.dataset.n;
    },
    /** 금테 확대가 화면에 뜬 시각 — 확정 상태가 아니면 `null` (REQ-826). */
    onlyShownAt: () => onlyAt,
  };
}
