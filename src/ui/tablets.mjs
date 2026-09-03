// 죽간 렌더러 (REQ-805) — 십자 키패드에서 분리돼 있어, 키패드가 없는 화면(S4 파견 관전)도
// 죽간만 장착할 수 있다. 매수 자체가 「후보가 좁혀졌다」의 표현이라 매수에 따라 폭이 자라고,
// 탈락한 매는 즉시 지우지 않고 가라앉힌다 (REQ-824·825). 어느 매가 어느 상태인지는
// `tablet-state.mjs` 가 정하고 이 모듈은 그것을 DOM 으로 옮기기만 한다.

import { clear, el, ledgerMs } from './dom.mjs';
import { attrMark, attrTone } from './components/attr-mark.mjs';
import { hanja } from './components/hanja.mjs';
import { TABLET, tabletStates } from './tablet-state.mjs';
import { CUE, play } from './audio.mjs';

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
 * @param {boolean} [p.soloEmphasis] 이 줄이 **후보 필터의 결과**인지 — 필터인 줄에서만 1매가
 *   「확정」이라 금테와 최소 표시 시간을 얻는다. 파견 관전의 죽간은 손으로 고르는 지시 목록이지
 *   시퀀스가 좁힌 후보가 아니므로, 매수가 같아도 확정이라는 어휘가 성립하지 않는다 (REQ-824·826).
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
    ghost.slip.node.remove();
  }

  /**
   * 탈락한 매를 흐름 밖으로 떼어낸다 — 남겨 두면 살아남은 매가 새 폭 계단으로 자랄 때 줄이
   * 통째로 넘쳐 금테 매가 중앙에서 밀린다. 떼기 전에 잰 좌표를 그대로 박아 제자리에서 가라앉는다.
   * @param {{id: string, slip: object, left: number, width: number}[]} leaving 잰 값과 함께 넘어온 매
   */
  function sink(leaving) {
    for (const { id, slip, left, width } of leaving) {
      live.delete(id);
      sinking.set(id, { slip, at: performance.now() });
      slip.node.style.left = `${left}px`;
      slip.node.style.width = `${width}px`;
      slip.node.className = 'slip out';
      slip.node.addEventListener('animationend', (e) => {
        // 자식의 애니메이션 종료도 여기까지 올라오므로 자기 것만 받는다.
        if (e.target === slip.node) bury(id);
      });
    }
  }

  return {
    node,
    /** @param {object[]} items `{style, rank?, mods?, tags?, title?, onTap?}` 목록 */
    render(items) {
      const next = items.map((item) => item.style.id);
      const byId = new Map(items.map((item) => [item.style.id, item]));
      const states = tabletStates(drawn, next);

      // 가라앉기와 미끄러짐은 같은 길이를 쓴다.
      const exitMs = ledgerMs('--slip-exit');
      // 배경 탭에서는 `animationend` 가 오지 않는다 — 시효가 지난 유령은 렌더가 함께 걷어 낸다.
      const stale = performance.now() - exitMs;
      for (const [id, ghost] of [...sinking]) if (ghost.at <= stale) bury(id);

      // 새 매를 그리기 전에 잰다 — 뒤에 재면 폭 계단이 이미 바뀌어 옛 자리를 알 수 없다.
      // 살아남는 매의 옛 자리도 같은 패스에서 잡는다 — 슬롯을 갈아타는 이동이 FLIP 의 출발점이다 (#152).
      // 아직 미끄러지는 중이면 눈에 보이는 자리는 레이아웃 좌표가 아니라 그 잔여분만큼 옛 자리 쪽이다.
      const before = new Map([...live].map(([id, slip]) => [id,
        slip.node.offsetLeft + (Number.parseFloat(getComputedStyle(slip.node).translate) || 0)]));
      sink(states
        .filter(({ id, state }) => state === TABLET.EXIT && live.has(id))
        .map(({ id }) => {
          const slip = live.get(id);
          return { id, slip, left: slip.node.offsetLeft, width: slip.node.offsetWidth };
        }));

      for (const { id, state } of states) {
        if (state === TABLET.EXIT) continue;
        bury(id);
        // 파견 관전의 1매는 확정이 아니므로 금테를 주지 않는다 — 상태 계산은 같고 표현만 갈린다.
        const shown = state === TABLET.ONLY && !soloEmphasis ? TABLET.HOLD : state;
        const slip = live.get(id) ?? createSlip(byId.get(id));
        slip.paint(byId.get(id), shown);
        live.set(id, slip);
      }
      // 이미 그 순서면 손대지 않는다 — 재삽입은 가라앉는 중인 매를 확정 매 앞으로 밀어 올려
      // 금테가 옆으로 튀게 만든다. 어긋났을 때만 옮긴다(`appendChild` 는 이동이라 노드가 유지된다).
      const want = states.map(({ id }) => (live.get(id) ?? sinking.get(id)?.slip)?.node).filter(Boolean);
      const have = [...node.children].filter((child) => want.includes(child));
      if (have.length !== want.length || have.some((child, i) => child !== want[i])) {
        for (const slip of want) node.appendChild(slip);
      }
      // 폭은 매수가 정한다 — 좁혀짐의 계단은 원장이 갖고 여기는 그 매수만 건넨다 (REQ-824).
      node.dataset.n = String(next.length);
      drawn = next;

      // flex 슬롯의 위치는 전이 대상이 아니라, 옛 자리로 되돌린 뒤 풀어 미끄러짐을 짓는다 (#152).
      // 개별 속성 `translate` 채널만 쓴다 — `transform` 은 `.slip.only` · `slip-in` 이 계속 쓴다.
      for (const [id, from] of before) {
        const slip = live.get(id);
        if (!slip) continue;
        const dx = from - slip.node.offsetLeft;
        if (dx !== 0) {
          slip.node.animate([{ translate: `${dx}px 0` }, { translate: '0px 0' }],
            { duration: exitMs, easing: 'ease' });
        }
      }

      const confirmed = soloEmphasis && next.length === 1;
      // 확정 연출이 얼마나 오래 보였는지는 판정 대기의 입력이라 그 시각을 여기서 잡는다 (REQ-826).
      if (!confirmed) onlyAt = null;
      else if (onlyAt === null) {
        onlyAt = performance.now();
        // 확정음은 금테 확대와 **같은 순간**이라, 그 전이를 잡는 이 자리 말고는 붙을 데가 없다 (REQ-923).
        play(CUE.CONFIRM);
      }
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
