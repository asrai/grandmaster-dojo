// 전수 장면 (REQ-860~866·761) — 이 게임이 파는 사제 관계가 화면에 나타나는 유일한 자리다.
// 사부의 시범과 제자의 따라 하기로 연출하므로 무대는 아레나(대치)가 아니라 도장 안이고,
// 완료는 제자의 팔 각도가 사부와 나란해지는 전이 하나로 말한다 — 스프라이트 시트가 아니라
// 몸통·팔을 나눠 납품받은 실루엣과 회전 각도 하나가 그것을 진다.

import { ARROW } from '../../balance.mjs';
import { artStyles, discipleStyleRank } from '../../core.mjs';
import { composeScreen, el } from '../dom.mjs';
import { stageBand } from '../band.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { STAIR_TONE, rankStair } from '../components/rank-stair.mjs';
import { SFX } from '../audio.mjs';
import {
  ART_HANJA, ART_ID, ART_NAME, enterTransmit, rankOfStyle,
} from '../session.mjs';

/**
 * 연출 시간은 원장이 진다 — 시범을 보는 시간과 팔이 맞아떨어지는 시간이 한 연출의 두 구간이라
 * 이 모듈은 그 이름만 부른다 (REQ-861).
 */
const followDelayMs = () => parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--tm-follow-delay'),
) || 0;

/**
 * 몸통·팔이 분리 납품된 실루엣 (spec § 아트 계약) — 팔만 별개 그룹이라 각도 하나로 시범과
 * 따라 하기가 갈린다. `.arm` 의 회전값은 원장이 지고 이 모듈은 자세 클래스만 갈아 끼운다.
 */
const figure = (id, cls) => el('div', { class: `fig ${cls}`, 'aria-hidden': 'true' }, [
  el('i', { class: `part body ${id}_body` }),
  el('i', { class: `part arm ${id}_arm` }),
]);

/**
 * 이관 행 (REQ-864) — 두 컬럼 diff 가 아니라 초식마다 한 줄이다. 위가 이름과 두 성, 아래가
 * 시퀀스와 제자 계단이라, 건너간 것이 무엇이고 제자가 어디서 시작하는지가 한 줄에서 닫힌다.
 * @param {?number} discipleRank 전수 전에는 null — 그 자리를 「아직 없다」로 비운다
 */
function transferRow(style, masterRank, discipleRank) {
  return el('div', { class: 'mv', style: `--attr:${attrTone(style.attr)}` }, [
    el('div', { class: 'mv-top' }, [
      attrMark(style.attr),
      el('span', { class: 'nm', text: style.name }),
      hanja(style.hanja),
      el('span', { class: 'rk' }, [
        el('span', { class: 'from', text: `${masterRank}성` }),
        el('span', { class: 'arrow', text: '→' }),
        el('span', { class: 'to', text: discipleRank === null ? '—' : `${discipleRank}성` }),
      ]),
    ]),
    el('div', { class: 'mv-bot' }, [
      el('span', { class: 'seq' }, style.seq.map((dir) => el('i', { text: ARROW[dir] }))),
      rankStair({ rank: discipleRank ?? 0, tone: STAIR_TONE.TRANSFERRED }),
    ]),
  ]);
}

/**
 * 무공 인장 (REQ-862·863) — 화면에서 **유일하게** 빛나는 것이고, 세로 조판이라 아래 목록이
 * 그 부속으로 읽힌다. 건너가는 단위가 초식 4개가 아니라 무공 하나이기 때문이다 (REQ-761).
 */
const sigil = () => el('div', { class: 'sigil' }, [
  el('span', { class: 'kr', text: ART_NAME }),
  hanja(ART_HANJA, { stacked: true }),
]);

export function renderTransmit(ctx) {
  const { session } = ctx;
  const mastered = artStyles(ART_ID);
  // 사부의 성은 초식마다 다르므로 행마다 그 초식의 값을 읽는다 (REQ-864).
  const masterRanks = Object.fromEntries(mastered.map((s) => [s.id, rankOfStyle(session, s.id)]));
  // 무공이 건너가는 것은 진입 1회이고 연출은 그 사실의 표현이다 — 렌더는 세션을 움직이지 않는다.
  enterTransmit(session);
  const discipleRanks = Object.fromEntries(
    mastered.map((s) => [s.id, discipleStyleRank(session.disciple, ART_ID, s.id)]),
  );

  const master = figure('sil_master_demo', 'master');
  const pupil = figure('sil_disciple_follow', 'pupil following');
  const rows = el('div', { class: 'moves' });
  // 연출의 첫 프레임은 「아직 익히지 못했다」 — 제자의 성 자리가 비어 있어야 전이가 성립한다.
  const paintRows = (learned) => {
    rows.replaceChildren(...mastered.map((style) => transferRow(
      style, masterRanks[style.id], learned ? discipleRanks[style.id] : null,
    )));
  };
  paintRows(false);

  // 연출 중에도 바닥은 비지 않는다 — 빈 바닥은 의도와 무관하게 결손으로 읽힌다 (REQ-865).
  const action = el('button', { class: 'primary weak', text: '건너뛰기' });

  composeScreen(ctx, {
    top: stageBand({ onLeave: () => ctx.go('dojo'), cap: '전수', name: ART_NAME, hanja: ART_HANJA }),
    body: [
      el('div', { class: 'hall transmit' }, [
        el('div', { class: 'layer floor' }),
        el('div', { class: 'layer mist' }),
        el('div', { class: 'backlight master', 'aria-hidden': 'true' }),
        el('div', { class: 'backlight pupil', 'aria-hidden': 'true' }),
        master,
        pupil,
        el('div', { class: 'layer vignette' }),
        el('div', { class: 'ground', 'aria-hidden': 'true' }),
        sigil(),
      ]),
      // 목록이 뒤늦게 도착하므로, 그 도착을 낭독으로도 알 수 있어야 전이가 화면 밖에서도 성립한다.
      el('section', { class: 'transfer', 'aria-live': 'polite' }, [rows]),
    ],
    bottom: el('div', { class: 'acts' }, [action]),
    padded: false,
  });

  /** 연출의 종점 — 건너뛰기와 자연 종료가 같은 자리로 모인다. 세션은 이미 진입에서 움직였다. */
  let learned = false;
  let timer = 0;
  function land() {
    if (learned) return;
    learned = true;
    clearTimeout(timer);
    SFX.transmit();
    // 팔이 사부와 나란해지는 것이 「익혔다」의 전부다 (REQ-861).
    pupil.classList.remove('following');
    paintRows(true);
    action.className = 'primary';
    action.textContent = '도장으로';
  }
  // 바닥의 버튼은 자리를 지키고 뜻만 바뀐다 — 연출 중에는 건너뛰기, 완료 후에는 출구다 (REQ-865).
  action.addEventListener('click', () => (learned ? ctx.go('dojo') : land()));

  timer = setTimeout(land, followDelayMs());
  return () => clearTimeout(timer);
}
