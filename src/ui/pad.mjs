// 입력 패드 — 4방향 버튼·키보드·트레일을 한 곳에서 소유하고, 죽간은 `tablets.mjs` 에 맡긴다.
// 어떤 화면이 붙어 있든 방향은 `input.press()` 한 경로로만 흐른다 (REQ-101).
// 마크업을 스스로 만들어 `node` 로 내놓으므로, 하단부에 이것을 둘지는 화면이 정한다 (REQ-801).

import { ARROW, BALANCE } from '../balance.mjs';
import { isOneTapRank } from '../core.mjs';
import { arrowRow, clear, el, shake } from './dom.mjs';
import { createTablets } from './tablets.mjs';
import { attrTone } from './components/attr-mark.mjs';
import { CUE, play } from './audio.mjs';

const KEYMAP = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
};
const RESET_KEYS = new Set([' ', 'Spacebar', 'Escape']);
const DIRS = [['U', '위', '↑'], ['L', '왼쪽', '←'], ['D', '아래', '↓'], ['R', '오른쪽', '→']];

export function createPad() {
  // 진행형 후보 색은 전폭 발광 띠 하나로만 말한다 — 「지금 내 색」이 화면에서 가장 큰 피드백이고,
  // 속성의 형태 축과 후보 수는 죽간이 이미 진다 (REQ-828).
  const colorEl = el('div', { class: 'pad-color none' });
  const tablets = createTablets({ soloEmphasis: true });
  const seqEl = el('div', { class: 'pad-trail' });
  const undoBtn = el('button', {
    class: 'undo', 'aria-label': '되돌리기', title: '되돌리기 (Space)',
  }, [
    // 아이콘은 파일 경로가 아니라 id 로 온다 — 경로는 index.html 의 `icon-<id>` 표에만 있다 (REQ-931).
    el('span', { class: 'icon icon-reset', 'aria-hidden': 'true' }),
  ]);
  const dirButtons = new Map(DIRS.map(([dir, label, glyph]) => [
    dir, el('button', { class: 'key', 'data-dir': dir, 'aria-label': label, text: glyph }),
  ]));
  // 죽간이 한 매뿐인 화면은 그 옆이 비므로, 화면이 자기 곁판을 그 자리에 꽂는다 (REQ-843·844).
  const slipRow = el('div', { class: 'slip-row' }, [tablets.node]);
  const root = el('footer', { class: 'pad' }, [
    colorEl,
    slipRow,
    seqEl,
    // 오조작 비용이 정반대인 두 조작을 한 flex 행에 묶지 않는다 — 되돌리기는 십자 밖 우측 끝에
    // 별개 그룹으로 선다 (REQ-829).
    el('div', { class: 'keys' }, [el('div', { class: 'cross' }, [...dirButtons.values()]), undoBtn]),
  ]);
  let active = null;
  let aside = null;
  let structureSig = null;
  let arrowsFor = null;
  let botOwned = false;
  let fromBot = false;

  /** 응수 창 밖에서는 패드가 자리를 지키되 입력을 받지 않는다 — 사라지면 엄지가 초마다 자리를 잃는다. */
  const accepting = () => Boolean(active) && (active.accepting ? active.accepting() : true);
  /** 봇이 도는 동안 사람 손이 섞이면 그 표본이 누구의 것인지 로그로 가를 수 없다 (REQ-603). */
  const locked = () => botOwned && !fromBot;

  function press(dir, device) {
    if (!accepting() || locked()) return;
    const result = active.input.press(dir, device);
    const button = dirButtons.get(dir);
    if (result.accepted) {
      play(CUE.KEY);
      button?.classList.add('down');
      setTimeout(() => button?.classList.remove('down'), 90);
    } else {
      play(CUE.IGNORE);
      shake(button ?? root);
      shake(seqEl.firstChild ?? root);
      active.onIgnore?.();
    }
    render();
    if (result.fired) active.onFire(result.fired);
  }

  function reset() {
    if (!accepting() || locked()) return;
    // 발동 직후의 창은 열려 있어도 입력기가 잠겨 있다 — 그 누름에 소리를 내면 손과 화면이 갈린다.
    if (!active.input.reset()) return;
    play(CUE.RESET);
    render();
  }

  /** 시간 축(힌트 점등)만 갱신한다 — 매 프레임 노드를 새로 만들면 점등 애니메이션이 0% 에서 다시 시작한다. */
  function paintArrows(style) {
    if (!style) { clear(seqEl); arrowsFor = null; return; }
    const done = active.input.buffer.length;
    const revealed = active.input.revealed(style);
    if (arrowsFor !== style.id) {
      clear(seqEl).appendChild(arrowRow(style.seq, done, revealed));
      arrowsFor = style.id;
      return;
    }
    const items = seqEl.firstChild.children;
    style.seq.forEach((dir, i) => {
      const cls = i < done ? 'on' : i < revealed ? 'hint' : 'dim';
      if (items[i].className === cls) return;
      items[i].className = cls;
      items[i].textContent = i < revealed ? ARROW[dir] : '·';
    });
  }

  function renderStructure(top) {
    const { input } = active;

    colorEl.className = `pad-color${top ? '' : ' none'}`;
    // 띠의 색만 바꾼다 — 발광은 원장이 `currentColor` 로 파생하므로 여기 수치가 없다.
    colorEl.style.color = top ? attrTone(top.attr) : '';

    tablets.render(input.candidates.map((style) => {
      const rank = active.rankOf(style);
      const oneTap = isOneTapRank(rank);
      return {
        style,
        // 속성과 성이 한 쌍으로 위력을 정하므로 죽간 한 매가 둘을 함께 진다 (REQ-721·827).
        rank,
        mods: [style === top ? 'top' : '', oneTap ? 'onetap' : ''].filter(Boolean).join(' '),
        tags: oneTap ? ['원터치'] : [],
        title: style.gugyeol.join(' '),
        onTap: () => {
          if (!accepting() || locked()) return;
          const fired = input.tap(style);
          if (!fired) return;
          render();
          active.onFire(fired);
        },
      };
    }));
    undoBtn.classList.toggle('urge', input.ignores >= BALANCE.ignoreHighlightAt);
  }

  function render() {
    if (!active) return;
    const { input } = active;
    const top = input.top();
    root.classList.toggle('idle', !accepting());
    root.classList.toggle('bot', botOwned);
    // 구조가 그대로면 노드를 건드리지 않는다 — 재생성은 클릭 타깃과 스크롤 위치까지 매 프레임 날린다.
    // 성은 대련 도중에도 오르므로(REQ-721) 후보 목록과 함께 지문에 든다 — 빠지면 배지가 굳는다.
    const sig = [
      input.candidates.map((s) => `${s.id}:${active.rankOf(s)}`).join(','), top ? top.id : '',
      input.buffer.length, input.ignores >= BALANCE.ignoreHighlightAt,
    ].join('|');
    if (sig !== structureSig) {
      structureSig = sig;
      renderStructure(top);
    }
    paintArrows(top);
  }

  function onKeyDown(event) {
    // 오토리핏은 손이 친 키가 아니다 — 그대로 흘리면 `ignore_rate` 와 후보 좁힘이 함께 오염된다.
    if (event.repeat || !accepting()) return;
    if (RESET_KEYS.has(event.key)) {
      // 포커스가 버튼에 있으면 Space 는 그 버튼의 활성화 키다.
      if (event.target && event.target.tagName === 'BUTTON') return;
      event.preventDefault();
      reset();
      return;
    }
    const dir = KEYMAP[event.key];
    if (!dir) return;
    event.preventDefault();
    press(dir, 'keyboard');
  }

  window.addEventListener('keydown', onKeyDown);
  undoBtn.addEventListener('click', reset);
  for (const [dir, button] of dirButtons) {
    button.addEventListener('click', () => press(dir, 'button'));
  }

  return {
    /** 화면이 자기 하단부에 꽂는 노드 — 꽂지 않은 화면에는 패드가 존재하지 않는다. */
    node: root,

    /** 죽간 금테 확대가 뜬 시각 — 판정 대기가 이 값을 읽는다 (REQ-826). */
    onlyShownAt: () => tablets.onlyShownAt(),

    /**
     * 봇 v2 의 손 (REQ-605) — 사람 입력과 완전히 같은 경로를 지난다.
     * 창이 닫혀 있으면 `peek()` 가 null 이라 봇은 그 사이 아무것도 두드리지 않는다.
     */
    bot: {
      own(on) { botOwned = on; render(); },
      peek: () => (accepting()
        ? { input: active.input, foeStyle: active.foeStyle?.() ?? null, foeOpen: active.foeOpen?.() ?? false }
        : null),
      press(dir, device) { fromBot = true; try { press(dir, device); } finally { fromBot = false; } },
      reset() { fromBot = true; try { reset(); } finally { fromBot = false; } },
    },

    /**
     * @param {object} consumer
     * @param {HTMLElement} [consumer.aside] 죽간 옆에 세울 곁판 — 후보 필터가 없는 화면의 자리다
     * @returns {void}
     */
    attach(consumer) {
      active = consumer;
      aside?.remove();
      aside = consumer.aside ?? null;
      if (aside) slipRow.appendChild(aside);
      structureSig = null;
      arrowsFor = null;
      render();
    },
    /** 소비자 파생 표시만 되돌린다 — 봇 점유는 화면을 넘어 이어지므로 여기서 끄지 않는다. */
    detach() {
      active = null;
      aside?.remove();
      aside = null;
      structureSig = null;
      arrowsFor = null;
      root.classList.remove('idle');
      tablets.clear();
      clear(seqEl);
      colorEl.className = 'pad-color none';
      colorEl.style.color = '';
      undoBtn.classList.remove('urge');
    },
    render,
  };
}
