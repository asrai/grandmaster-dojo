// S7 도전자 선택 (REQ-880~887·894) — 목록 위 / 브리핑 아래의 2단. 고르기와 준비하기가 화면
// 전환으로 갈리면 왕복 잡무가 되므로, 목록만 스크롤하고 브리핑과 「대련 시작」은 바닥에 고정한다
// (REQ-881). 목록의 원본은 `session.mjs` 의 `challengerRoster` 하나이고 홈 요약이 같은 것을 읽는다.

import { BALANCE, STYLES } from '../../balance.mjs';
import { REVEAL_TIER, styleById } from '../../core.mjs';
import { clear, composeScreen, el, topBand } from '../dom.mjs';
import { particle } from '../theme.mjs';
import { attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { counterPairOf, foeChips, foeStyleCards, revealNotice } from '../components/foe-view.mjs';
import {
  ART_NAME, canEquip, challengerRoster, equip, rankOfStyle,
} from '../session.mjs';

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
  el('span', { class: 's', text: '상대 초식과 절초는 한 번 겨뤄봐야 알 수 있다 — 슬롯은 지금 고르고, 답은 다음 대면에' }),
]);

/**
 * 슬롯 경고 (REQ-886) — 「무엇이 없는지」가 아니라 「없으면 무슨 일이 나는지」다. 파해가 공개된
 * 대면에서만 주사색이 서고, 교체가 그것을 금색 확인으로 바꾼다.
 */
function slotWarning(session, entry) {
  const counter = counterPairOf(entry);
  if (counter) {
    const { name } = counter.answer;
    const equipped = session.slots.includes(counter.answer.id);
    return {
      cls: equipped ? 'ok' : 'risk',
      text: equipped
        ? `${name}${particle(name, '이', '가')} 슬롯에 들어왔다 — 절초를 받아칠 수 있다`
        : `${name}${particle(name, '이', '가')} 빠져 있다 — 절초에 역파를 맞는다`,
    };
  }
  if (entry.tier === REVEAL_TIER.RUMOR) {
    return { cls: '', text: '절초가 있다 — 파해를 모르니 폭이 넓은 편성으로 들어간다' };
  }
  if (!session.slots.some(Boolean)) return { cls: 'risk', text: '슬롯이 비어 있다 — 낼 초식이 없으면 매 초 피격이다' };
  return null;
}

export function renderSelect(ctx) {
  const { session, params } = ctx;
  const roster = challengerRoster(session);
  // 진입 시 지목된 차수가 곧 선택이고, 없으면 가장 최근에 열린 차수다 (홈 요약과 같은 자리).
  let pickedFoe = Math.max(0, roster.findIndex((e) => e.challenger.stage === params.stage));
  // 슬롯을 먼저 고르고 후보를 고른다 — 두 번의 탭이 곧 「무엇을 빼고 무엇을 넣는가」다.
  let pickedSlot = Math.max(0, session.slots.indexOf(null));

  const listEl = el('div', { class: 'list', role: 'radiogroup', 'aria-label': '도전자' });
  const briefEl = el('div', { class: 'brief' });
  const entry = () => roster[pickedFoe];

  function paintList() {
    clear(listEl);
    roster.forEach((row, i) => {
      const { challenger } = row;
      listEl.appendChild(el('button', {
        class: `foe${i === pickedFoe ? ' on' : ''}`, role: 'radio', 'aria-checked': String(i === pickedFoe),
        onclick: () => { pickedFoe = i; paintList(); paintBrief(); },
      }, [
        el('span', { class: 'id' }, [
          el('span', { class: 'nm' }, [el('b', { text: challenger.name }), hanja(challenger.hanja)]),
          foeChips(row),
        ]),
        rowState(row),
      ]));
    });
  }

  /** 슬롯 3칸 + 벤치 (REQ-886) — 화면 전환 없이 그 자리에서 바뀌므로 갱신도 이 화면 안에서 닫힌다. */
  function slotBlock() {
    const slotsEl = el('div', { class: 'slots' }, session.slots.map((styleId, i) => {
      const style = styleId ? styleById(styleId) : null;
      return el('button', {
        class: `sl${style ? '' : ' empty'}${i === pickedSlot ? ' hit' : ''}`,
        style: `--attr:${style ? attrTone(style.attr) : 'var(--line)'}`,
        onclick: () => { pickedSlot = i; paintBrief(); },
      }, [
        el('span', { class: 'n', text: style ? style.name : '빈 슬롯' }),
        style ? hanja(style.hanja) : null,
        el('span', { class: 'r', text: style ? `${rankOfStyle(session, style.id)}성` : `슬롯 ${i + 1}` }),
      ]);
    }));
    const benched = STYLES.filter((s) => session.progress.styles[s.id].learned
      && !session.slots.includes(s.id) && canEquip(session, s.id));
    const benchEl = benched.length
      ? el('div', { class: 'bench' }, benched.map((style) => el('button', {
        class: 'sl bench-pick', style: `--attr:${attrTone(style.attr)}`,
        onclick: () => {
          equip(session, style.id, pickedSlot, { challenger: entry().challenger.id });
          paintBrief();
        },
      }, [
        el('span', { class: 'n', text: style.name }),
        el('span', { class: 'r', text: `${rankOfStyle(session, style.id)}성` }),
      ])))
      : el('p', { class: 'dim', text: '교체할 초식이 없다 — 장착 성에 닿은 초식이 전부 슬롯에 있다.' });
    return [slotsEl, benchEl];
  }

  function paintBrief() {
    const row = entry();
    const warn = slotWarning(session, row);
    clear(briefEl).append(...[
      row.firstEncounter ? unknownNotice() : el('span', { class: 'cap', text: '상대 초식' }),
      row.firstEncounter ? null : foeStyleCards(row),
      revealNotice(row),
      el('span', { class: 'cap', text: '내 슬롯 — 탭하면 바꾼다' }),
      ...slotBlock(),
      warn ? el('p', { class: `warn ${warn.cls}`.trim(), text: warn.text }) : null,
      el('button', {
        class: 'go', text: row.firstEncounter ? '대련 시작' : '재대련 시작',
        disabled: !session.slots.some(Boolean),
        onclick: () => ctx.go('duel', { stage: row.challenger.stage }),
      }),
    ].filter(Boolean));
  }

  paintList();
  paintBrief();
  composeScreen(ctx, {
    top: topBand(session, ART_NAME, { onLeave: () => ctx.go('dojo') }),
    body: listEl,
    // 브리핑은 스크롤 흐름 밖이라 목록이 길어져도 「대련 시작」이 늘 바닥에 있다 (REQ-881).
    bottom: briefEl,
    padded: false,
  });
}
