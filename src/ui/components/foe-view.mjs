// 도전자 공개 조각 (REQ-882~885·887) — S7 의 목록 행과 브리핑이 **같은 공개 층**을 보여야
// 예고가 함정이 되지 않으므로 (REQ-835), 층에서 화면으로 가는 번역을 여기 한 벌만 둔다.
// 소비처가 S7 하나여도 `components/` 에 두는 것은, 화면끼리 직접 import 하는 방향을 열지 않기 위해서다.
// 층 자체를 정하는 것은 `session.mjs` 의 `challengerEntry` 이고 문구는 `theme.mjs` 가 진다.

import { REVEAL_TIER, foeStyleById, styleById } from '../../core.mjs';
import { el } from '../dom.mjs';
import { REVEAL_VIEW, attrLabel } from '../theme.mjs';
import { attrMark, attrTone } from './attr-mark.mjs';
import { hanja } from './hanja.mjs';

/** 그 대면에 공개된 상대 초식 — 첫 대면은 목록에서도 브리핑에서도 비어 있다 (REQ-882). */
export const revealedStyles = (entry) =>
  (entry.firstEncounter ? [] : entry.challenger.styles.map(foeStyleById));

/** 절초와 그 파해 대상 — 공개 층이 `COUNTER` 일 때만 존재한다 (REQ-884). */
export function counterPairOf(entry) {
  if (entry.tier !== REVEAL_TIER.COUNTER) return null;
  const finisher = entry.challenger.styles.map(foeStyleById).find((s) => s && s.finisher);
  return { finisher, answer: styleById(finisher.counters) };
}

/**
 * 속성 칩 줄 (REQ-882·883·887) — 도전자 성은 어디에도 숫자로 뜨지 않으므로, 난이도 신호는
 * 목록 순서와 절초 유무 둘뿐이다. 첫 대면은 속성이 「미상」으로 접히고 절초만 존재로 남는다.
 */
export function foeChips(entry) {
  const chips = revealedStyles(entry).map((foe) => el('span', { class: 'at', style: `--attr:${attrTone(foe.attr)}` }, [
    attrMark(foe.attr, { silent: true }),
    el('span', { text: attrLabel(foe.attr) }),
  ]));
  if (!chips.length) chips.push(el('span', { class: 'at unseen', text: '미상' }));
  if (entry.tier !== REVEAL_TIER.NONE) chips.push(el('span', { class: 'at ult', text: '절초' }));
  return el('div', { class: 'attrs' }, chips);
}

/** 상대 초식 카드 (REQ-884) — 절초는 금테와 태그로 갈린다. 첫 대면에는 카드 자체가 없다. */
export const foeStyleCards = (entry) => el('div', { class: 'foe-styles' }, revealedStyles(entry).map((foe) => el('div', {
  class: `fs${foe.finisher ? ' ult' : ''}`, style: `--attr:${attrTone(foe.attr)}`,
}, [
  el('span', { class: 'n', text: foe.name }),
  hanja(foe.hanja),
  foe.finisher ? el('span', { class: 'tag', text: '절초' }) : null,
])));

/**
 * 절초 공개 한 줄 — 어느 층인지만 고르고, 그 층에서 무엇을 말하는지는 `REVEAL_VIEW` 가 안다.
 * 첫 대면의 `NONE` 만 침묵한다: 「절초가 없다」도 겪어 봐야 아는 사실이라, 첫 대면 안내와 나란히
 * 세우면 한 화면이 「모른다」와 「없다고 안다」를 함께 말한다 (REQ-882).
 * @returns {?HTMLElement} 침묵하는 자리는 첫 대면 안내가 이미 채운다
 */
export function revealNotice(entry) {
  if (entry.tier === REVEAL_TIER.NONE && entry.firstEncounter) return null;
  const view = REVEAL_VIEW[entry.tier];
  const parts = counterPairOf(entry) ?? {};
  return el('p', { class: `tell ${view.cls}`.trim() }, [
    el('b', { text: view.title(parts) }),
    el('span', { text: ` — ${view.note(parts)}` }),
  ]);
}
