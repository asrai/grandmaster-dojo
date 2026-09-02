// 죽간 상태 계산 (REQ-824·825) — 개수 변화가 곧 「후보가 좁혀진다」의 표현이라, 매를 전량
// 재생성하는 대신 매 하나하나가 어느 상태로 넘어가는지를 여기서 정한다. DOM 을 모르므로
// 화면 없이도 전이를 검사할 수 있고, 그것이 이 모듈이 `tablets.mjs` 와 갈라져 있는 이유다.

/** 죽간 한 매가 가질 수 있는 상태 — `only` 는 「후보 1개 도달」이라 hold·enter 를 덮는다. */
export const TABLET = { ENTER: 'enter', HOLD: 'hold', EXIT: 'exit', ONLY: 'only' };

/**
 * @param {string[]} prev 직전 렌더의 후보 id (전이가 끝나 사라진 매는 이미 빠져 있다)
 * @param {string[]} next 이번 렌더의 후보 id — 그리는 순서이기도 하다
 * @returns {{id: string, state: string}[]} 탈락한 매가 자기가 있던 자리에 끼워진 그리기 순서
 */
export function tabletStates(prev, next) {
  // 1매 = 확정이라 그 매는 남은 후보가 아니라 「확정」으로 그려진다 (REQ-824).
  const only = next.length === 1;
  const kept = new Set(prev);
  const draw = next.map((id) => ({
    id,
    state: only ? TABLET.ONLY : kept.has(id) ? TABLET.HOLD : TABLET.ENTER,
  }));

  // 탈락한 매를 목록 끝으로 몰면 살아남은 매가 그 자리를 건너뛰며 미끄러진다 — 가라앉는 동안은
  // 자기 자리를 지켜야 「좁혀지는 과정」이 보인다 (REQ-825).
  const alive = new Set(next);
  prev.forEach((id, at) => {
    if (alive.has(id)) return;
    draw.splice(Math.min(at, draw.length), 0, { id, state: TABLET.EXIT });
  });
  return draw;
}
