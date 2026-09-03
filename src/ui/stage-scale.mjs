// 무대 배율 산식 (REQ-802) — 논리 해상도를 상자에 축소로만 맞춘다. CSS 에 두면 길이비를 수로
// 바꾸는 우회가 필요하고 그 우회가 엔진마다 갈리므로(#187), 나눗셈을 아는 이 층이 값을 낸다.

/**
 * 상자 안에 무대를 앉히는 배율. 확대는 하지 않으므로 상한은 1 이다.
 *
 * @param {{w: number, h: number}} box 무대를 담는 상자의 실측 크기(px)
 * @param {{w: number, h: number}} stage 무대의 논리 크기(px) — 변형 전 레이아웃 크기다
 * @returns {number} `0 < k <= 1`
 */
export function stageScale(box, stage) {
  const k = Math.min(box.w / stage.w, box.h / stage.h, 1);
  // 레이아웃 전이거나 상자가 접힌 순간에는 비율이 0·음수·NaN 으로 나온다. 그 값이 그대로
  // `scale()` 에 들어가면 무대가 사라지거나 점대칭으로 뒤집히므로, 배율 없음으로 접는다.
  return Number.isFinite(k) && k > 0 ? k : 1;
}
