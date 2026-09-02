// 판정 표시 — 시각 층과 낭독 층이 갈린다 (REQ-806·807). 시각 오버레이는 아레나 좌표계 안에 살아
// 화면과 함께 생성·파괴되고, 낭독 리전은 스테이지 직속 상주라 화면 전환에도 침묵하지 않는다.

import { BALANCE } from '../balance.mjs';
import { $, el } from './dom.mjs';
import { hanja } from './components/hanja.mjs';
import { EXTREME_GRADES, GRADE_VIEW, gradeLabel } from './theme.mjs';

// 같은 판정이 연달아 오면 문자열이 그대로라 리전이 변경을 못 보고 낭독이 접힌다 — 보이지 않는
// 표식을 번갈아 붙여 매 판정이 새 문면이 되게 한다.
let announceFlip = false;

/** 연출 시간의 값은 원장(`:root`)이 갖고 JS 는 이름만 부른다 — 시각 토큰이 코드로 복사되지 않는다. */
const tokenMs = (name) => parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue(name),
) || 0;

function announce(text) {
  const region = $('live');
  if (!region) return;
  announceFlip = !announceFlip;
  region.textContent = announceFlip ? text : `${text}\u200B`;
}

/**
 * 흔들림 (REQ-815·816) — 스테이지가 아니라 그 안의 셸에 건다. 재생 길이는 원장이 정하므로
 * 여기에는 시각이 없고, 클래스를 떼는 시점만 애니메이션 종료가 알려 준다.
 */
function shakeShell() {
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
 * @param {object} [p]
 * @param {() => ?number} [p.heldSince] 죽간 금테 확대가 뜬 시각 — 마지막 키가 「후보 1개 도달」과
 *   「시퀀스 완주」를 겸하면 확정 연출이 한 프레임도 안 보이므로, 이 값이 있으면 최소 표시 시간을
 *   채울 때까지 판정을 미룬다 (REQ-826). 넘기지 않는 화면은 대기가 늘 0 인 화면이다.
 * @returns {{node: HTMLElement, show: Function, showGrade: Function, announce: (text: string) => void,
 *   hide: () => void}}
 */
export function createVerdictOverlay({ heldSince = () => null } = {}) {
  // 상주 노드 3장 — 화면과 함께 한 번 서고 그 뒤로는 클래스·문면만 갈린다 (REQ-913).
  // 판정마다 새로 만들면 그 생성·레이아웃이 하필 판정 프레임에 겹친다.
  const scrim = el('div', { class: 'vscrim' });
  const markEl = hanja('');
  const labelEl = el('span', { class: 'verdict-label' });
  const pop = el('div', { class: 'verdict-pop' }, [markEl, labelEl]);
  // 마크는 라벨의 시각적 중복 표현이라, 낭독은 리전 한 곳으로만 나간다.
  const node = el('div', { class: 'verdict-overlay', 'aria-hidden': 'true' }, [scrim, pop]);
  let waiting = 0;
  /** 아직 낭독되지 않은 대기 판정의 문면 — 시각이 자리를 잃어도 이것만은 남겨야 한다 (REQ-807). */
  let unspoken = null;

  /** 확정 연출이 아직 빚진 시간 — 이미 충분히 보였거나 확정 상태가 아니면 0 이다. */
  function owedMs() {
    const since = heldSince();
    if (since == null) return 0;
    return Math.max(0, tokenMs('--only-hold') - (performance.now() - since));
  }

  /** 상주 노드의 문면·등급을 갈아 끼우고 재생을 처음부터 다시 건다. */
  function show({ mark = null, label, cls, punched = false, deferMs = 0 }) {
    // 다음 예고가 열리는 순간(resolveMs 뒤)에는 이미 사라져 있어야 두 판정이 겹쳐 읽히지 않는다.
    // 대기·히트스톱은 이 길이를 늘리지 않고 그 안에서 시작을 미룬다 — 대기분은 여기서, 히트스톱은
    // 원장의 `.verdict-pop.punched` 가 뺀다. 둘의 합이 재생을 남기는 것은 부팅 단정이 문다.
    pop.style.setProperty('--vd-dur', `${BALANCE.resolveMs - deferMs}ms`);
    // 한자는 한글 위에 얹히는 낙관이라, 마크가 없는 호출자에게는 그 자리도 없다 (REQ-813 · #46).
    markEl.textContent = mark ?? '';
    markEl.hidden = !mark;
    labelEl.textContent = label;
    pop.className = `verdict-pop ${cls}${punched ? ' punched' : ''}`;
    // 같은 노드를 다시 쓰므로 클래스를 뗐다 붙이는 것만으로는 재생이 처음부터 돌지 않는다.
    node.classList.remove('on');
    void node.offsetWidth;
    node.classList.add('on');
    announce(label);
  }

  return {
    node,
    show,
    /**
     * 시각 없이 낭독만 (REQ-807 · #51) — 시각 표시를 두지 않기로 한 사건(수련 실패)도 비시각
     * 사용자에게는 관측되어야 하므로, 두 층 중 낭독만 따로 열어 둔다.
     */
    announce,
    /**
     * @param {string} grade 6단 판정 등급
     * @param {object} [p]
     * @param {() => void} [p.onShow] 판정이 실제로 화면에 뜨는 순간 — 대기가 걸리면 그만큼
     *   늦게 불린다. 소리처럼 흔들림·글자와 한 덩어리로 읽혀야 하는 것이 여기로 온다.
     */
    showGrade(grade, { onShow = null } = {}) {
      const view = GRADE_VIEW[grade];
      // 표시 규약이 빠진 등급은 조용히 빈 판정으로 그려지므로, 그 자리에서 터뜨린다.
      if (!view) throw new Error(`표시 규약이 없는 등급: ${grade}`);
      const extreme = EXTREME_GRADES.has(grade);
      // 앞선 대기가 남아 있으면 두 판정이 겹쳐 뜬다.
      clearTimeout(waiting);
      const deferMs = owedMs();
      const paint = () => {
        waiting = 0;
        unspoken = null;
        if (extreme) shakeShell();
        show({ mark: view.mark, label: gradeLabel(grade), cls: view.cls, punched: extreme, deferMs });
        onShow?.();
      };
      if (deferMs <= 0) { paint(); return; }
      unspoken = gradeLabel(grade);
      waiting = setTimeout(paint, deferMs);
    },
    /** 화면 teardown·다음 예고가 부르는 자리 — 남겨 두면 판정이 다음 예고 위에 겹쳐 남는다. */
    hide() {
      // 대기 중인 판정이 살아남으면 다음 예고 위에 뒤늦게 뜬다.
      clearTimeout(waiting);
      waiting = 0;
      // 시계가 튀어(백그라운드 복귀) 대기가 통째로 넘어간 초에도 판정이 있었다는 사실은 남긴다 —
      // 자리를 내주는 것은 시각 층뿐이고 낭독은 유실되지 않는다 (REQ-807).
      if (unspoken !== null) { announce(unspoken); unspoken = null; }
      node.classList.remove('on');
    },
  };
}
