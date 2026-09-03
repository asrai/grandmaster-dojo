// 전수 장면 (REQ-860~867·761) — 이 게임이 파는 사제 관계가 화면에 나타나는 유일한 자리다.
// 사부의 시범과 제자의 따라 하기로 연출하므로 무대는 아레나(대치)가 아니라 도장 안이고,
// 완료는 두 팔이 대기 자세로 멈추는 것으로 말한다 — 스프라이트 시트가 아니라 몸통·팔을 나눠
// 납품받은 실루엣과 회전 각도 하나가 그것을 진다.

import { ARROW } from '../../balance.mjs';
import { artStyles, discipleStyleRank } from '../../core.mjs';
import { composeScreen, el, ledgerMs } from '../dom.mjs';
import { stageBand } from '../band.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { STAIR_TONE, rankStair } from '../components/rank-stair.mjs';
import { CUE, play } from '../audio.mjs';
import {
  ART_HANJA, ART_ID, ART_NAME, enterTransmit, rankOfStyle,
} from '../session.mjs';

/**
 * 몸통·팔이 분리 납품된 실루엣 (spec § 아트 계약) — 팔만 별개 그룹이라 각도 하나로 손짓이
 * 성립한다. `.arm` 의 회전값은 원장이 지고 이 모듈은 손짓의 시작과 정지만 갈아 끼운다.
 */
const figure = (id, cls) => el('div', { class: `fig ${cls}`, 'aria-hidden': 'true' }, [
  el('i', { class: `part body ${id}_body` }),
  el('i', { class: `part arm ${id}_arm` }),
]);

/**
 * 이관 행 (REQ-864) — 두 컬럼 diff 가 아니라 초식마다 한 줄이다. 위가 이름과 두 성, 아래가
 * 시퀀스와 제자 계단이라, 건너간 것이 무엇이고 제자가 어디서 시작하는지가 한 줄에서 닫힌다.
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
        el('span', { class: 'to', text: `${discipleRank}성` }),
      ]),
    ]),
    el('div', { class: 'mv-bot' }, [
      el('span', { class: 'seq' }, style.seq.map((dir) => el('i', { text: ARROW[dir] }))),
      rankStair({ rank: discipleRank, tone: STAIR_TONE.TRANSFERRED }),
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

  const master = figure('sil_master_demo', 'master');
  const pupil = figure('sil_disciple_follow', 'pupil');
  // 회차 수는 초식 수라 원장이 알 수 없다 — 데이터에서 파생한 값이 여기서 CSS 로 건너간다 (REQ-761).
  const hall = el('div', { class: 'hall transmit', style: `--tm-waves:${mastered.length}` }, [
    el('div', { class: 'layer floor' }),
    el('div', { class: 'layer mist' }),
    el('div', { class: 'backlight master', 'aria-hidden': 'true' }),
    el('div', { class: 'backlight pupil', 'aria-hidden': 'true' }),
    master,
    pupil,
    el('div', { class: 'layer vignette' }),
    el('div', { class: 'ground', 'aria-hidden': 'true' }),
    sigil(),
  ]);
  const rows = el('div', { class: 'moves' });
  let shown = 0;
  // 제자의 성은 전수가 실행된 뒤에야 존재하므로 행을 붙이는 그 시점에 읽는다 (REQ-761).
  const appendRow = (arriving) => {
    const style = mastered[shown];
    shown += 1;
    const row = transferRow(style, masterRanks[style.id], discipleStyleRank(session.disciple, ART_ID, style.id));
    if (arriving) row.classList.add('arrive');
    rows.append(row);
  };

  // 바닥은 단계마다 뜻만 바뀌고 자리는 지킨다 — 빈 바닥은 결손으로 읽힌다 (REQ-865).
  const action = el('button', { class: 'primary', text: '전수하기' });

  let phase = 'before';
  let timer = 0;
  let rowTimer = 0;
  // 무공은 한 번만 건너간다 (#70) — 이미 받은 제자에게는 연출이 아니라 그 결과만 연다. 마운트
  // 전에 끝내야 도착을 알리는 `aria-live` 가 도착하지 않은 4행을 낭독하지 않는다.
  if (session.transmitted) settle();

  composeScreen(ctx, {
    top: stageBand({ onLeave: () => ctx.go('dojo'), cap: '전수', name: ART_NAME, hanja: ART_HANJA }),
    body: [
      hall,
      // 목록이 뒤늦게 도착하므로, 그 도착을 낭독으로도 알 수 있어야 전이가 화면 밖에서도 성립한다.
      el('section', { class: 'transfer', 'aria-live': 'polite' }, [rows]),
    ],
    bottom: el('div', { class: 'acts' }, [action]),
    padded: false,
  });

  /** 연출의 결과 상태 — 건너뛰기·자연 종료·전수 뒤 재진입이 같은 자리로 모인다. */
  function settle() {
    phase = 'after';
    clearTimeout(timer);
    clearTimeout(rowTimer);
    while (shown < mastered.length) appendRow(false);
    action.className = 'primary';
    action.textContent = '도장으로';
  }
  /** 정보가 닫히는 시점 — 제자의 마지막 손짓은 여기서 반 박자 더 흐르다 스스로 멈춘다. */
  function land() {
    if (phase === 'after') return;
    settle();
    play(CUE.TRANSMIT);
  }
  /** 건너뛰기는 꼬리까지 걷어낸다 — 손짓이 남아 있으면 조작 가능해진 화면이 아직 연출로 읽힌다. */
  function skip() {
    land();
    hall.classList.remove('waving');
  }
  /** 유저가 이 버튼을 누른 순간이 전수의 실행이다 — 화면 진입이 아니라 (REQ-761). */
  function begin() {
    if (!enterTransmit(session)) return;
    phase = 'during';
    hall.classList.add('waving');
    action.className = 'primary weak';
    action.textContent = '건너뛰기';
    const cycle = ledgerMs('--tm-cycle-ms');
    // 행이 도착하는 순간은 제자가 그 초식을 잡기 시작하는 순간이다 — 그래서 지연만큼 늦다.
    const beat = () => {
      appendRow(true);
      if (shown < mastered.length) rowTimer = setTimeout(beat, cycle);
    };
    rowTimer = setTimeout(beat, ledgerMs('--tm-echo-delay'));
    // 연출 길이는 초식 수가 정한다 — 사부의 마지막 손짓이 끝나는 자리에서 정보가 닫힌다.
    timer = setTimeout(land, cycle * mastered.length);
  }
  action.addEventListener('click', () => {
    if (phase === 'before') begin();
    else if (phase === 'during') skip();
    else ctx.go('dojo');
  });

  return () => {
    clearTimeout(timer);
    clearTimeout(rowTimer);
  };
}
