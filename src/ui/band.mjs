// 무대 띠 (REQ-820·840·897) — 3단의 첫 칸(`--band-h`)을 쓰는 실전 화면(대련·수련·파견)이 공유한다.
// 도장 계열의 2줄 띠(`dom.mjs` 의 `topBand`)와는 높이도 싣는 것도 다르고, 한자 병기를 지느라
// `components/hanja.mjs` 를 쓰므로 그쪽에 두면 순환 import 가 된다.

import { el } from './dom.mjs';
import { hanja } from './components/hanja.mjs';

/**
 * @param {object} p
 * @param {Function} p.onLeave 물러나기 — 띠를 쓰는 화면의 좌측 첫 자리다 (REQ-897)
 * @param {string} p.name 이 화면이 마주한 대상 (도전자·초식)
 * @param {?string} [p.hanja]
 * @param {?string} [p.cap] 이름 앞의 갈래 표기 — 상대가 아닌 것을 이름 자리에 세우는 화면만 쓴다
 * @param {?string} [p.seal] 주사 낙관 (REQ-811)
 * @param {?{value: () => number, unit: string}} [p.count] 우측 계수 — `paint` 가 매번 다시 읽는다
 * @returns {{node: HTMLElement, paint: () => void}} `ctx.ownTop` 이 받는 번들
 */
export function stageBand({ onLeave, name, hanja: hj = null, cap = null, seal = null, count = null }) {
  const countEl = count ? el('b', { class: 'exch-n' }) : null;
  const node = el('header', { class: 'stage-band' }, [
    el('button', { class: 'leave', text: '←', 'aria-label': '물러나기', onclick: onLeave }),
    el('div', { class: 'stage-name' }, [
      cap ? el('span', { class: 'cap', text: cap }) : null,
      el('b', { text: name }),
      hj ? hanja(hj) : null,
    ]),
    seal ? el('span', { class: 'seal', text: seal }) : null,
    count ? el('span', { class: 'exch' }, [countEl, el('span', { class: 'exch-u', text: count.unit })]) : null,
  ]);
  const paint = () => { if (countEl) countEl.textContent = String(count.value()); };
  paint();
  return { node, paint };
}
