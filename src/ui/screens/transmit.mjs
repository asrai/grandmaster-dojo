// 전수 장면 (REQ-307·309) — 12성 배지에서 제자 카드로 같은 무공 아이콘이 옮겨 켜지는 순간이
// 재미 가설의 구조적 증거라, 화면 전환이 아니라 한 화면 안의 연출로 둔다.

import { BALANCE, STYLES } from '../../balance.mjs';
import { discipleRankOf, discipleStyles } from '../../core.mjs';
import { attrMark, clear, el } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { ART_ID, artRank, runTransmit } from '../session.mjs';

const icons = (styles, cls) => el('div', { class: 'icons' }, styles.map((s) => el('div', {
  class: `cand ${cls}`, style: `--attr:${ATTR_VIEW[s.attr].color}`,
}, [attrMark(s.attr), el('span', { class: 'cand-name', text: s.name })])));

export function renderTransmit(ctx) {
  const { session, root } = ctx;
  const masterRank = artRank(session);
  runTransmit(session);
  ctx.refreshTop();
  SFX.transmit();

  const learned = STYLES.filter((s) => s.set === ART_ID && session.progress.styles[s.id].learned);
  const discipleSide = el('div', { class: 'side dark' }, [
    el('h2', { text: `제자 — ${discipleRankOf(session.disciple, ART_ID)}성` }),
    icons(discipleStyles(session.disciple, ART_ID), 'lit'),
  ]);

  ctx.pad.detach();
  clear(root);
  root.append(el('section', { class: 'card transmit' }, [
    el('p', {}, [el('span', {
      class: 'badge max',
      text: masterRank >= BALANCE.rankMax ? '유운검법 — 완벽히 깨달음' : `유운검법 ${masterRank}성`,
    })]),
    el('div', { class: 'sides' }, [
      el('div', { class: 'side' }, [
        el('h2', { text: `사부 — ${masterRank}성` }),
        icons(learned, 'lit'),
        el('p', { class: 'dim', text: '무공은 사부에게 그대로 남는다 — 전수는 복사다.' }),
      ]),
      discipleSide,
    ]),
    el('p', { class: 'dim', text: '단계가 문하생에서 고수로 올랐다.' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ]));

  // 사부 쪽이 먼저 켜지고 제자 쪽이 뒤따라 켜져야 "옮겨 갔다" 로 읽힌다.
  requestAnimationFrame(() => setTimeout(() => discipleSide.classList.add('arrived'), 400));
}
