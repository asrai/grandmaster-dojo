// 판정 표시 (#40) — 수련·실전·파견이 같은 연출을 쓰고, 스테이지 위에 떠서 레이아웃을 점유하지 않는다.

import { BALANCE } from '../balance.mjs';
import { $, clear, el } from './dom.mjs';
import { GRADE_VIEW, gradeLabel } from './theme.mjs';

const host = () => $('verdictOverlay');

/** 매번 새 노드로 갈아끼운다 — 방금 삽입된 노드는 클래스 재부착 없이도 애니메이션을 처음부터 재생한다. */
export function showVerdict({ mark, label, color }) {
  // 다음 예고가 열리는 순간(resolveMs 뒤)에는 이미 사라져 있어야 두 판정이 겹쳐 읽히지 않는다.
  const css = `color:${color}; animation-duration:${BALANCE.resolveMs}ms`;
  // 마크는 등급 표시 전용이라 등급 없는 호출자에겐 없다 — 그때 라벨이 화면을 이끄는 크기를 진다 (#46).
  const parts = mark
    // 마크는 라벨의 시각적 중복 표현이라, 라이브 리전이 같은 판정을 두 번 읽지 않게 감춘다.
    ? [el('b', { class: 'verdict-mark', text: mark, 'aria-hidden': 'true' }),
      el('span', { class: 'verdict-label', text: label })]
    : [el('span', { class: 'verdict-label lead', text: label })];
  clear(host()).appendChild(el('div', { class: 'verdict-pop', style: css }, parts));
}

export function showGradeVerdict(grade) {
  const view = GRADE_VIEW[grade];
  // 표시 규약이 빠진 등급은 조용히 빈 판정으로 그려지므로, 그 자리에서 터뜨린다.
  if (!view) throw new Error(`표시 규약이 없는 등급: ${grade}`);
  showVerdict({ ...view, label: gradeLabel(grade) });
}

/** 화면 teardown·다음 예고가 부르는 자리 — 남겨 두면 판정이 다음 화면 위에 겹쳐 남는다. */
export function hideVerdict() {
  clear(host());
}
