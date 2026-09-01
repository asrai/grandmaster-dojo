// 입력 패드 — 4방향 버튼·키보드·후보 아이콘·버퍼 줄을 한 곳에서 소유한다.
// 어떤 화면이 붙어 있든 방향은 `input.press()` 한 경로로만 흐른다 (REQ-101).

import { ARROW, BALANCE } from '../balance.mjs';
import { isOneTapRank } from '../core.mjs';
import { $, arrowRow, attrMark, clear, el, shake } from './dom.mjs';
import { ATTR_VIEW, attrLabel } from './theme.mjs';
import { SFX } from './audio.mjs';

const KEYMAP = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
};
const RESET_KEYS = new Set([' ', 'Spacebar', 'Escape']);

export function createPad() {
  const root = $('pad');
  const colorEl = $('padColor');
  const candidatesEl = $('candidates');
  const seqEl = $('seq');
  const resetBtn = $('resetBtn');
  const dirButtons = new Map(
    [...root.querySelectorAll('[data-dir]')].map((b) => [b.dataset.dir, b]),
  );
  let active = null;
  let structureSig = null;
  let arrowsFor = null;
  let botOwned = false;
  let fromBot = false;

  /** 응수 창 밖에서는 패드가 자리를 지키되 입력을 받지 않는다 — 사라지면 엄지가 매 수 자리를 잃는다. */
  const accepting = () => Boolean(active) && (active.accepting ? active.accepting() : true);
  /** 봇이 도는 동안 사람 손이 섞이면 그 표본이 누구의 것인지 로그로 가를 수 없다 (REQ-603). */
  const locked = () => botOwned && !fromBot;

  function press(dir, device) {
    if (!accepting() || locked()) return;
    const result = active.input.press(dir, device);
    const button = dirButtons.get(dir);
    if (result.accepted) {
      SFX.key();
      button?.classList.add('down');
      setTimeout(() => button?.classList.remove('down'), 90);
    } else {
      SFX.ignore();
      shake(button ?? root);
      shake(seqEl.firstChild ?? root);
      active.onIgnore?.();
    }
    render();
    if (result.fired) active.onFire(result.fired);
  }

  function reset() {
    if (!accepting() || locked()) return;
    active.input.reset();
    SFX.reset();
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
    const solo = input.candidates.length === 1;

    colorEl.className = `pad-color${top ? '' : ' none'}`;
    clear(colorEl);
    if (top) {
      colorEl.style.color = ATTR_VIEW[top.attr].color;
      colorEl.append(
        attrMark(top.attr, { size: 'big' }),
        el('b', { text: attrLabel(top.attr) }),
        el('span', { class: 'pad-name', text: solo ? top.name : `후보 ${input.candidates.length}` }),
      );
    }

    clear(candidatesEl).className = solo ? 'candidates solo' : 'candidates';
    for (const style of input.candidates) {
      const oneTap = isOneTapRank(active.rankOf(style));
      candidatesEl.appendChild(el('button', {
        class: `cand${style === top ? ' top' : ''}${oneTap ? ' onetap' : ''}`,
        style: `--attr:${ATTR_VIEW[style.attr].color}`,
        title: style.gugyeol,
        onclick: () => {
          if (!accepting() || locked()) return;
          const fired = input.tap(style);
          if (!fired) return;
          render();
          active.onFire(fired);
        },
      }, [
        attrMark(style.attr),
        el('span', { class: 'cand-name', text: style.name }),
        oneTap ? el('span', { class: 'tag', text: '원터치' }) : null,
      ]));
    }
    resetBtn.classList.toggle('urge', input.ignores >= BALANCE.ignoreHighlightAt);
  }

  function render() {
    if (!active) return;
    const { input } = active;
    const top = input.top();
    root.classList.toggle('idle', !accepting());
    root.classList.toggle('bot', botOwned);
    // 구조가 그대로면 노드를 건드리지 않는다 — 재생성은 클릭 타깃과 스크롤 위치까지 매 프레임 날린다.
    const sig = [
      input.candidates.map((s) => s.id).join(','), top ? top.id : '',
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
  resetBtn.addEventListener('click', reset);
  for (const [dir, button] of dirButtons) {
    button.addEventListener('click', () => press(dir, 'button'));
  }

  return {
    /**
     * 봇 v2 의 손 (REQ-605) — 사람 입력과 완전히 같은 경로를 지난다.
     * 창이 닫혀 있으면 `peek()` 가 null 이라 봇은 그 사이 아무것도 두드리지 않는다.
     */
    bot: {
      own(on) { botOwned = on; render(); },
      peek: () => (accepting() ? { input: active.input, foeStyle: active.foeStyle?.() ?? null } : null),
      press(dir, device) { fromBot = true; try { press(dir, device); } finally { fromBot = false; } },
      reset() { fromBot = true; try { reset(); } finally { fromBot = false; } },
    },

    /** @param {{input: object, rankOf: Function, onFire: Function, onIgnore?: Function}} consumer */
    attach(consumer) {
      active = consumer;
      structureSig = null;
      arrowsFor = null;
      root.classList.remove('detached');
      render();
    },
    detach() {
      active = null;
      structureSig = null;
      arrowsFor = null;
      root.classList.add('detached');
      root.classList.remove('idle');
      clear(candidatesEl);
      clear(seqEl);
      clear(colorEl);
      resetBtn.classList.remove('urge');
    },
    render,
  };
}
