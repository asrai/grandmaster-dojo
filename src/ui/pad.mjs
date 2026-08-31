// 입력 패드 — 4방향 버튼·키보드·후보 아이콘·버퍼 줄을 한 곳에서 소유한다.
// 어떤 화면이 붙어 있든 방향은 `input.press()` 한 경로로만 흐른다 (REQ-101).

import { BALANCE } from '../balance.mjs';
import { $, arrowRow, attrMark, clear, el, shake } from './dom.mjs';
import { ATTR_VIEW, attrLabel } from './theme.mjs';
import { SFX } from './audio.mjs';

const KEYMAP = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
};
const RESET_KEYS = new Set([' ', 'Spacebar', 'Escape']);
const IGNORE_HIGHLIGHT_AT = 3;

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

  /** 응수 창 밖에서는 패드가 자리를 지키되 입력을 받지 않는다 — 사라지면 엄지가 매 수 자리를 잃는다. */
  const accepting = () => Boolean(active) && (active.accepting ? active.accepting() : true);

  function press(dir, device) {
    if (!accepting()) return;
    const result = active.input.press(dir, device);
    const button = dirButtons.get(dir);
    if (result.accepted) {
      SFX.key();
      button?.classList.add('down');
      setTimeout(() => button?.classList.remove('down'), 90);
    } else {
      SFX.ignore();
      shake(button ?? root);
      active.onIgnore?.();
    }
    render();
    if (result.fired) active.onFire(result.fired);
  }

  function reset() {
    if (!accepting()) return;
    active.input.reset();
    SFX.reset();
    render();
  }

  function render() {
    if (!active) return;
    const { input } = active;
    const top = input.top();
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

    root.classList.toggle('idle', !accepting());
    clear(candidatesEl).className = solo ? 'candidates solo' : 'candidates';
    for (const style of input.candidates) {
      const full = active.masteryOf(style) >= BALANCE.masteryFullPct;
      candidatesEl.appendChild(el('button', {
        class: `cand${style === top ? ' top' : ''}${full ? ' onetap' : ''}`,
        style: `--attr:${ATTR_VIEW[style.attr].color}`,
        title: style.gugyeol,
        onclick: () => {
          if (!accepting()) return;
          const fired = input.tap(style);
          if (!fired) return;
          SFX.fire();
          render();
          active.onFire(fired);
        },
      }, [
        attrMark(style.attr),
        el('span', { class: 'cand-name', text: style.name }),
        full ? el('span', { class: 'tag', text: '원터치' }) : null,
      ]));
    }

    clear(seqEl);
    if (top) seqEl.appendChild(arrowRow(top.seq, input.buffer.length, input.revealed(top)));
    resetBtn.classList.toggle('urge', input.ignores >= IGNORE_HIGHLIGHT_AT);
  }

  function onKeyDown(event) {
    if (!accepting()) return;
    if (RESET_KEYS.has(event.key)) { event.preventDefault(); reset(); return; }
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
    /** @param {{input: object, masteryOf: Function, onFire: Function, onIgnore?: Function}} consumer */
    attach(consumer) {
      active = consumer;
      root.hidden = false;
      render();
    },
    detach() {
      active = null;
      root.hidden = true;
      root.classList.remove('idle');
      clear(candidatesEl);
      clear(seqEl);
      clear(colorEl);
      resetBtn.classList.remove('urge');
    },
    render,
  };
}
