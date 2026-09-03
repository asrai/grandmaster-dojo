// S7 도전자 선택 (REQ-880~887·894) — 목록 위 / 브리핑 아래의 2단. 고르기와 준비하기가 화면
// 전환으로 갈리면 왕복 잡무가 되므로, 목록만 스크롤하고 브리핑과 「대련 시작」은 바닥에 고정한다
// (REQ-881). 목록의 원본은 `session.mjs` 의 `challengerRoster` 하나이고 브리핑이 그 항을 그대로 받는다.

import { BALANCE } from '../../balance.mjs';
import { REVEAL_TIER, styleById } from '../../core.mjs';
import { clear, composeScreen, el, topBand } from '../dom.mjs';
import { particle } from '../theme.mjs';
import { hanja } from '../components/hanja.mjs';
import { counterPairOf, foeChips, foeStyleCards, revealedStyles, revealNotice } from '../components/foe-view.mjs';
import { styleStrip } from '../components/style-strip.mjs';
import { ART_NAME, challengerRoster, rankOfStyle } from '../session.mjs';

/** 대면 상태 (REQ-887) — 이미 이긴 상대는 회색 보통 굵기이고 주사색은 쓰지 않는다 (REQ-811). */
function rowState(entry) {
  const beaten = !entry.firstEncounter;
  return el('span', { class: `state ${beaten ? 'beat' : 'now'}` }, [
    el('span', { class: 't', text: beaten ? `${entry.attempt}번째 대면` : '첫 대면' }),
    el('span', {
      class: 's',
      text: beaten
        ? (entry.bonus > 0 ? `재화 없음 · 강화 +${entry.bonus}` : '재화 없음')
        : `재화 +${BALANCE.reward.duelWin}`,
    }),
  ]);
}

/** 첫 대면 안내 (REQ-882) — 브리핑이 설 자리에 「왜 없는가」가 대신 선다. */
const unknownNotice = () => el('div', { class: 'unknown' }, [
  el('span', { class: 't', text: '겪어본 적 없는 상대다' }),
  el('span', { class: 's', text: '상대 초식은 한 번 겨뤄봐야 알 수 있다 — 답은 다음 대면에, 슬롯은 도장에서 바꾼다' }),
]);

/**
 * 슬롯 경고 (REQ-886) — 「무엇이 없는지」가 아니라 「없으면 무슨 일이 나는지」다. 파해가 공개된
 * 대면에서만 주사색이 서고, 도장에서 슬롯을 바꿔 돌아오면 금색 확인으로 바뀐다 (REQ-736).
 */
function slotWarning(session, entry) {
  // 빈 슬롯을 먼저 본다 — 「대련 시작」을 잠근 술어가 그것이라, 절초 경고에 가리면 비활성 사유가 화면에서 사라진다.
  if (!session.slots.some(Boolean)) return { cls: 'risk', text: '슬롯이 비어 있다 — 낼 초식이 없으면 매 초 피격이다, 도장에서 장착한다' };
  const counter = counterPairOf(entry);
  if (counter) {
    const { name } = counter.answer;
    const equipped = session.slots.includes(counter.answer.id);
    return {
      cls: equipped ? 'ok' : 'risk',
      text: equipped
        ? `${name}${particle(name, '이', '가')} 슬롯에 들어왔다 — 절초를 받아칠 수 있다`
        : `${name}${particle(name, '이', '가')} 빠져 있다 — 절초에 역파를 맞는다, 도장에서 해제하고 장착한다`,
    };
  }
  if (entry.tier === REVEAL_TIER.RUMOR) {
    return { cls: '', text: '절초가 있다 — 파해를 모르니 폭이 넓은 편성으로 들어간다' };
  }
  return null;
}

export function renderSelect(ctx) {
  const { session, params } = ctx;
  const roster = challengerRoster(session);
  // 도장 밴드가 차수를 지목해 들어오므로 그 지목이 곧 선택이고, 목록 밖이면 가장 최근에 열린 차수로 떨어진다.
  const asked = roster.findIndex((e) => e.challenger.stage === params.stage);
  let pickedFoe = asked < 0 ? roster.length - 1 : asked;

  // 한 줄만 고를 수 있는 목록이라 그룹이 아니라 radio 그룹이다 (REQ-911) — 「몇 중 몇 번째를
  // 골랐는가」가 낭독으로 나온다. 역할은 거동을 주지 않으므로 방향키 순회는 아래에서 직접 진다.
  const listEl = el('div', { class: 'list', role: 'radiogroup', 'aria-label': '도전자' });
  const briefEl = el('div', { class: 'brief' });
  const entry = () => roster[pickedFoe];
  // 재렌더가 누른 버튼 노드를 파기하므로, 포커스를 되돌리려면 같은 자리를 id 로 다시 찾아야 한다.
  // `composeScreen` 을 거치지 않는 부분 갱신이라 조립의 포커스 계약 밖이다 — 그 일반해로 존치한다 (#133).
  function repaint(paint, focusId = document.activeElement?.id) {
    paint();
    if (focusId) document.getElementById(focusId)?.focus();
  }

  const foeId = (stage) => `select-foe-${stage}`;

  /**
   * radio 그룹의 탭 정지점은 고른 하나뿐이라(roving tabindex) 나머지 행에 닿는 경로가 방향키다.
   * 이것이 없으면 키보드 사용자는 지금 고른 도전자 말고 아무도 고를 수 없다 (REQ-911).
   */
  function onListKey(event) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
      ?? (event.key === 'Home' ? -roster.length : event.key === 'End' ? roster.length : 0);
    if (!step) return;
    event.preventDefault();
    pickedFoe = Math.max(0, Math.min(roster.length - 1, pickedFoe + step));
    // 라디오 그룹은 이동이 곧 선택이라, 브리핑도 그 자리에서 따라간다.
    repaint(paintList, foeId(roster[pickedFoe].challenger.stage));
    paintBrief();
  }

  function paintList() {
    clear(listEl);
    roster.forEach((row, i) => {
      const { challenger } = row;
      listEl.appendChild(el('button', {
        id: foeId(challenger.stage),
        class: `foe${i === pickedFoe ? ' on' : ''}`,
        role: 'radio', 'aria-checked': String(i === pickedFoe),
        // 고르지 않은 행은 탭 순회에서 빠진다 — radio 그룹의 탭 정지점은 고른 하나다.
        tabindex: i === pickedFoe ? '0' : '-1',
        onclick: () => { pickedFoe = i; repaint(paintList); paintBrief(); },
        onkeydown: onListKey,
      }, [
        el('span', { class: 'id' }, [
          el('span', { class: 'nm' }, [el('b', { text: challenger.name }), hanja(challenger.hanja)]),
          foeChips(row),
        ]),
        rowState(row),
      ]));
    });
  }

  /**
   * 슬롯 표시 (REQ-886) — 표시 전용이다. 장착·해제의 자리는 도장 행 버튼 하나뿐이라(REQ-736)
   * 여기서 또 바꾸게 하면 「어느 칸을 비울지 → 무엇을 넣을지」가 이 화면에 얹힌다.
   * 대련 죽간과 같은 세로 카드를 좌우 스크롤로 세워, 칸이 늘어도 규격이 그대로다 (REQ-824).
   */
  function slotStrip() {
    return styleStrip({
      label: '내 슬롯',
      items: session.slots.map((styleId) => {
        const style = styleId ? styleById(styleId) : null;
        return { style, rank: style ? rankOfStyle(session, style.id) : null };
      }),
    });
  }

  function paintBrief() {
    const row = entry();
    const warn = slotWarning(session, row);
    clear(briefEl).append(...[
      row.firstEncounter ? unknownNotice() : el('span', { class: 'cap', text: '상대 초식' }),
      row.firstEncounter ? null : foeStyleCards(revealedStyles(row)),
      revealNotice(row),
      el('span', { class: 'cap', text: '내 슬롯' }),
      slotStrip(),
      warn ? el('p', { class: `warn ${warn.cls}`.trim(), text: warn.text }) : null,
      el('button', {
        class: 'go', text: row.firstEncounter ? '대련 시작' : '재대련 시작',
        // 잠긴 버튼은 포커스를 받지 않고, 왜 잠겼는지는 바로 위 경고 줄이 진다 (REQ-911·886).
        disabled: !session.slots.some(Boolean),
        'aria-disabled': String(!session.slots.some(Boolean)),
        onclick: () => ctx.go('duel', { stage: row.challenger.stage }),
      }),
    ].filter(Boolean));
  }

  paintList();
  paintBrief();
  composeScreen(ctx, {
    // 띠 제목은 시안 E1-2 원장이라 `SCREEN.select.label`(로그·낭독 원장)의 「도전자 선택」과 일부러 다르다 (#211).
    top: topBand(session, ART_NAME, { label: () => '대련', onLeave: () => ctx.go('dojo') }),
    body: listEl,
    // 브리핑은 스크롤 흐름 밖이라 목록이 길어져도 「대련 시작」이 늘 바닥에 있다 (REQ-881).
    bottom: briefEl,
    padded: false,
  });
}
