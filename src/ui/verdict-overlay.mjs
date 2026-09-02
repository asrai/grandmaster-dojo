// 판정 표시 — 시각 층과 낭독 층이 갈린다 (REQ-806·807). 시각 오버레이는 아레나 좌표계 안에 살아
// 화면과 함께 생성·파괴되고, 낭독 리전은 스테이지 직속 상주라 화면 전환에도 침묵하지 않는다.

import { BALANCE } from '../balance.mjs';
import { $, clear, el } from './dom.mjs';
import { hanja } from './components/hanja.mjs';
import { EXTREME_GRADES, GRADE_VIEW, gradeLabel } from './theme.mjs';

// 같은 판정이 연달아 오면 문자열이 그대로라 리전이 변경을 못 보고 낭독이 접힌다 — 보이지 않는
// 표식을 번갈아 붙여 매 판정이 새 문면이 되게 한다.
let announceFlip = false;

function announce(text) {
  const region = $('live');
  if (!region) return;
  announceFlip = !announceFlip;
  region.textContent = announceFlip ? text : `${text}\u200B`;
}

/**
 * 히트스톱 + 흔들림 (REQ-815·816) — 스테이지가 아니라 그 안의 셸에 건다. 재생 길이는 원장이
 * 정하므로 여기에는 시각이 없고, 클래스를 떼는 시점만 애니메이션 종료가 알려 준다.
 */
function punch() {
  const shell = $('shell');
  shell.classList.remove('punch');
  // 클래스를 뗐다 붙이는 것만으로는 같은 애니메이션이 처음부터 재생되지 않는다.
  void shell.offsetWidth;
  shell.classList.add('punch');
  const done = (e) => {
    // 판정 팝의 종료도 여기까지 올라오므로, 셸 자신의 것만 받는다.
    if (e.target !== shell) return;
    shell.classList.remove('punch');
    shell.removeEventListener('animationend', done);
  };
  shell.addEventListener('animationend', done);
}

/**
 * 시각 오버레이 — 호출부가 `node` 를 자기 아레나에 넣는다. 화면이 파괴되면 이 층만 함께 죽고,
 * 낭독은 스테이지 직속 리전이 계속 진다 (REQ-807).
 * @returns {{node: HTMLElement, show: Function, showGrade: Function, hide: () => void}}
 */
export function createVerdictOverlay() {
  // 마크는 라벨의 시각적 중복 표현이라, 낭독은 리전 한 곳으로만 나간다.
  const node = el('div', { class: 'verdict-overlay', 'aria-hidden': 'true' });

  /** 매번 새 노드로 갈아끼운다 — 방금 삽입된 노드는 클래스 재부착 없이도 애니메이션을 처음부터 재생한다. */
  function show({ mark = null, label, cls }) {
    // 다음 예고가 열리는 순간(resolveMs 뒤)에는 이미 사라져 있어야 두 판정이 겹쳐 읽히지 않는다.
    const style = `animation-duration:${BALANCE.resolveMs}ms`;
    clear(node).appendChild(el('div', { class: `verdict-pop ${cls}`, style }, [
      // 한자는 한글 위에 얹히는 낙관이라, 마크가 없는 호출자에게는 그 자리도 없다 (REQ-813 · #46).
      mark ? hanja(mark) : null,
      el('span', { class: 'verdict-label', text: label }),
    ]));
    announce(label);
  }

  return {
    node,
    show,
    showGrade(grade) {
      const view = GRADE_VIEW[grade];
      // 표시 규약이 빠진 등급은 조용히 빈 판정으로 그려지므로, 그 자리에서 터뜨린다.
      if (!view) throw new Error(`표시 규약이 없는 등급: ${grade}`);
      // 셸이 먼저 서야 판정 팝이 삽입되는 순간부터 히트스톱만큼 늦게 뜬다.
      if (EXTREME_GRADES.has(grade)) punch();
      show({ mark: view.mark, label: gradeLabel(grade), cls: view.cls });
    },
    /** 화면 teardown·다음 예고가 부르는 자리 — 남겨 두면 판정이 다음 예고 위에 겹쳐 남는다. */
    hide() { clear(node); },
  };
}
