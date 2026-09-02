// 전수 장면 (REQ-307·309) — 12성 초식들에서 제자 카드로 같은 아이콘이 옮겨 켜지는 순간이
// 재미 가설의 구조적 증거라, 화면 전환이 아니라 한 화면 안의 연출로 둔다.

import { BALANCE } from '../../balance.mjs';
import { artStyles, discipleStyleRank, discipleStyles, styleRank } from '../../core.mjs';
import { attrMark, clear, composeScreen, el, topBand } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { ART_ID, ART_NAME, runTransmit } from '../session.mjs';

const icons = (styles, cls) => el('div', { class: 'icons' }, styles.map((s) => el('div', {
  class: `cand ${cls}`, style: `--attr:${ATTR_VIEW[s.attr].color}`,
}, [attrMark(s.attr), el('span', { class: 'cand-name', text: s.name })])));

// 제자 칸은 한 화면 안에서 전수 전 → 후로 갈아 끼워지므로, 두 시점을 같은 모양으로 떠 둔다 (#36).
const discipleView = (disciple) => ({
  styles: discipleStyles(disciple, ART_ID),
  rankOf: (styleId) => discipleStyleRank(disciple, ART_ID, styleId),
});

function paintDisciple(side, { styles, rankOf }) {
  clear(side);
  // 이 무공을 아직 받지 않은 제자에게는 초식도 성도 없다 — 빈 칸이 곧 「전수 전」이다.
  const head = styles.length ? `제자 — 전 초식 ${rankOf(styles[0].id)}성` : '제자';
  side.append(el('h2', { text: head }), icons(styles, 'lit'));
}

export function renderTransmit(ctx) {
  const { session, root } = ctx;
  // 전수 조건이 전 초식 전수 성이라 어느 초식을 읽어도 같은 값이다.
  const masterRank = Math.min(...artStyles(ART_ID).map((s) => styleRank(session.progress, s.id)));
  // 연출의 첫 프레임이 "전수 전" 이어야 옮겨 갔다는 전이가 성립한다 — 세션이 바뀌기 전에 뜬다.
  const before = discipleView(session.disciple);
  runTransmit(session);
  const after = discipleView(session.disciple);
  SFX.transmit();

  // 사부·제자가 같은 무공 정의를 읽는다 — 전수 단위가 초식이 아니라 무공이라는 뜻이다 (#38).
  const mastered = artStyles(ART_ID);
  // 목록이 뒤늦게 도착하므로, 그 도착을 낭독으로도 알 수 있어야 전이가 화면 밖에서도 성립한다.
  const discipleSide = el('div', { class: 'side dark', 'aria-live': 'polite' });
  paintDisciple(discipleSide, before);

  composeScreen(ctx, {
    top: topBand(session, ART_NAME),
    body: el('section', { class: 'card transmit' }, [
    el('p', {}, [el('span', {
      class: 'badge max',
      text: masterRank >= BALANCE.rankMax ? `${ART_NAME} — 완벽히 깨달음` : `${ART_NAME} 전 초식 ${masterRank}성`,
    })]),
    el('div', { class: 'sides' }, [
      el('div', { class: 'side' }, [
        el('h2', { text: `사부 — 전 초식 ${masterRank}성` }),
        icons(mastered, 'lit'),
        el('p', { class: 'dim', text: '무공은 사부에게 그대로 남는다 — 전수는 복사다.' }),
      ]),
      discipleSide,
    ]),
    el('p', { class: 'dim', text: '단계가 문하생에서 고수로 올랐다.' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ]) });

  // 사부 쪽이 먼저 켜지고 제자 쪽이 뒤따라 켜져야 "옮겨 갔다" 로 읽힌다.
  const arriveTimer = setTimeout(() => {
    paintDisciple(discipleSide, after);
    discipleSide.classList.add('arrived');
  }, 400);
  return () => clearTimeout(arriveTimer);
}
