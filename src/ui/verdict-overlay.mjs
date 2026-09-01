// 판정 표시 (#40) — 수련·실전·파견이 같은 연출을 쓰고, 스테이지 위에 떠서 레이아웃을 점유하지 않는다.

import { $, clear, el } from './dom.mjs';
import { GRADE_VIEW, gradeLabel } from './theme.mjs';

const host = () => $('verdictOverlay');

/** 매번 새 노드로 갈아끼운다 — 방금 삽입된 노드는 클래스 재부착 없이도 애니메이션을 처음부터 재생한다. */
export function showVerdict({ mark, label, color }) {
  clear(host()).appendChild(el('div', { class: 'verdict-pop', style: `color:${color}` }, [
    el('b', { class: 'verdict-mark', text: mark }),
    el('span', { class: 'verdict-label', text: label }),
  ]));
}

export const showGradeVerdict = (grade) => showVerdict({ ...GRADE_VIEW[grade], label: gradeLabel(grade) });

/** 화면 teardown·다음 예고가 부르는 자리 — 남겨 두면 판정이 다음 화면 위에 겹쳐 남는다. */
export function hideVerdict() {
  clear(host());
}
