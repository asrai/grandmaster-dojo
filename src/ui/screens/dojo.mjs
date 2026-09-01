// 도장 (REQ-303·305·306·308) — 배우기 · 수련 · 장착 · 전수 · 대련/파견 진입.

import { BALANCE, STYLES } from '../../balance.mjs';
import { artById, canLearn, discipleRankOf, discipleStyles } from '../../core.mjs';
import { arrowRow, attrMark, clear, el, tipAnchor } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, artRank, canEquip, canTransmitNow,
  challengerOfStage, consumeTooltip, equip, learnStyle, masteryOf, pickTooltip, simulateTraining,
  unequip,
} from '../session.mjs';

const rankLabel = (rank) => (rank >= BALANCE.rankMax ? `${rank}성 · 완벽히 깨달음` : `${rank}성`);

/**
 * 유도 툴팁 문구표 (#15) — 키는 액션 id 의 접두사이고, 배열 순서가 곧 안내 우선순위(1사이클의
 * 진행 순서)다. 여기 등록하는 것이 곧 「그 버튼을 안내 대상으로 삼는다」는 선언이라, 안내할
 * 이유가 없는 버튼(해제 · 수련 시뮬)은 등록하지 않는 것으로 후보에서 빠진다.
 */
const TIPS = [
  ['train', '초식을 반복해 숙련을 올린다'],
  ['equip', '실전 슬롯에 장착한다'],
  ['learn', '다음 초식을 배운다'],
  ['duel', '사부와 대련한다'],
  ['transmit', '제자에게 전수한다'],
  ['dispatch', '제자를 파견한다'],
];
const TIP_LEAD = { start: '여기서 시작', unlocked: '지금 열렸다' };
// 한 번에 하나만 뜨므로 문서에 유일한 id 를 쓴다 — 버튼의 `aria-describedby` 가 이것을 가리킨다.
const TIP_ID = 'dojo-tip';
const tipRank = (id) => TIPS.findIndex(([kind]) => kind === String(id).split(':')[0]);
const tipText = (id, lead) => `${TIP_LEAD[lead]} — ${TIPS[tipRank(id)][1]}`;

/**
 * 초식 줄의 액션 서술자 — `disabled` 술어를 여기 한 곳에서만 계산해 버튼과 툴팁 후보가 같은
 * 값을 읽게 한다. 안내 후보인지는 id 접두사가 `TIPS` 에 있는지로 갈린다.
 */
function styleActions(ctx, style) {
  const { session } = ctx;
  const slotIdx = session.slots.indexOf(style.id);

  if (!session.progress.styles[style.id].learned) {
    return [{
      id: `learn:${style.id}`, class: 'small', text: '배우기',
      disabled: !canLearn(session.progress, style.id),
      onclick: () => { learnStyle(session, style.id); ctx.go('dojo'); },
    }];
  }

  const actions = [{
    id: `train:${style.id}`, class: 'small', text: '수련', disabled: false,
    onclick: () => ctx.go('train', { styleId: style.id }),
  }];
  if (slotIdx >= 0) {
    actions.push({
      id: `unequip:${style.id}`, class: 'small ghost', text: '해제', disabled: false,
      onclick: () => { unequip(session, slotIdx); ctx.go('dojo'); },
    });
  } else {
    actions.push({
      id: `equip:${style.id}`, class: 'small ghost', text: '장착',
      disabled: !canEquip(session, style.id) || !session.slots.includes(null),
      onclick: () => { equip(session, style.id); ctx.go('dojo'); },
    });
  }
  return actions;
}

/** 화면 하단 카드의 액션 서술자 — 초식 줄과 같은 형태라 두 갈래를 한 목록으로 합칠 수 있다. */
function cardActions(ctx) {
  const { session } = ctx;
  const stage = challengerOfStage(session.stage);
  return [
    {
      id: 'duel', class: 'primary',
      text: `사부 대련 — ${stage.name} ${stage.stage}차`,
      disabled: !session.slots.some(Boolean),
      onclick: () => ctx.go('duel', { stage: session.stage }),
    },
    {
      id: 'transmit', class: 'primary',
      text: `전수 — 제자에게 ${ART_NAME}을`,
      disabled: !canTransmitNow(session),
      onclick: () => ctx.go('transmit'),
    },
    {
      id: 'dispatch', class: 'primary',
      text: `파견 — ${DISPATCH_CHALLENGER.name}`,
      disabled: !session.transmitted,
      onclick: () => ctx.go('preview'),
    },
    // 평가자는 실제로 방치할 수 없으므로 1시간을 버튼 하나로 압축해 보여 준다 (REQ-604).
    {
      id: 'trainSim', class: 'small ghost', disabled: false,
      text: `1시간 수련 시뮬 — +${Math.round(BALANCE.simEfficiency * BALANCE.simTrainSeconds)} 元`,
      onclick: () => { simulateTraining(session); ctx.refreshTop(); },
    },
  ];
}

/** 서술자 → 버튼. 안내 대상이면 툴팁 앵커로 감싸고, 그 버튼을 누르는 순간 안내를 소비한다. */
function actionButton(ctx, action, target) {
  const button = el('button', {
    class: action.class,
    disabled: action.disabled,
    text: action.text,
    onclick: () => { consumeTooltip(ctx.session.tooltip, action.id); action.onclick(); },
  });
  return target?.id === action.id
    ? tipAnchor(button, tipText(action.id, target.kind), TIP_ID)
    : button;
}

function styleRow(ctx, style, actions, target) {
  const { session } = ctx;
  const learned = session.progress.styles[style.id].learned;
  const mastery = masteryOf(session, style.id);
  const slotIdx = session.slots.indexOf(style.id);

  return el('div', { class: `row${learned ? '' : ' locked'}`, style: `--attr:${ATTR_VIEW[style.attr].color}` }, [
    el('div', { class: 'row-head' }, [
      attrMark(style.attr),
      el('b', { text: style.name }),
      el('span', { class: 'hanja', text: style.hanja }),
      slotIdx >= 0 ? el('span', { class: 'tag', text: `슬롯 ${slotIdx + 1}` }) : null,
    ]),
    arrowRow(style.seq, 0, learned ? style.seq.length : 0),
    el('div', { class: 'meter' }, [el('i', { style: `width:${mastery}%` })]),
    el('div', { class: 'row-foot' }, [
      el('span', { class: 'dim', text: learned ? `숙련 ${mastery}%` : '미해금' }),
      el('span', { class: 'dim', text: style.gugyeol }),
    ]),
    el('div', { class: 'row-actions' }, actions.map((a) => actionButton(ctx, a, target))),
  ]);
}

function discipleCard(session) {
  const rank = discipleRankOf(session.disciple, ART_ID);
  const styles = discipleStyles(session.disciple, ART_ID);
  return el('section', { class: 'card' }, [
    el('h2', { text: '제자' }),
    rank === null
      ? el('p', { class: 'dim', text: '아직 전수한 무공이 없다 — 무공을 12성으로 깨달으면 전수할 수 있다.' })
      : el('div', {}, [
        el('p', {}, [el('b', { text: ART_NAME }), el('span', { class: 'badge', text: `${rank}성` })]),
        el('div', { class: 'icons' }, styles.map((s) => el('span', {
          class: 'cand mini', style: `--attr:${ATTR_VIEW[s.attr].color}`,
        }, [attrMark(s.attr), el('span', { class: 'cand-name', text: s.name })]))),
      ]),
  ]);
}

export function renderDojo(ctx) {
  const { session, root } = ctx;
  ctx.pad.detach();
  clear(root);

  const rank = artRank(session);
  const rowActions = STYLES.map((s) => styleActions(ctx, s));
  const card = cardActions(ctx);
  // 후보를 버튼과 같은 서술자에서 뽑으므로 `disabled` 술어가 두 벌로 갈리지 않는다 (#15).
  const target = pickTooltip(session.tooltip, [...rowActions.flat(), ...card]
    .filter((a) => tipRank(a.id) >= 0)
    .sort((a, b) => tipRank(a.id) - tipRank(b.id)));

  root.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `${ART_NAME} ${artById(ART_ID).hanja}` }),
      el('p', {}, [
        el('span', { class: `badge${rank >= BALANCE.rankMax ? ' max' : ''}`, text: rankLabel(rank) }),
        el('span', { class: 'dim', text: ` 성 포인트 ${session.progress.arts[ART_ID].rankPts}` }),
      ]),
      el('div', { class: 'rows' }, STYLES.map((s, i) => styleRow(ctx, s, rowActions[i], target))),
    ]),
    discipleCard(session),
    el('section', { class: 'card actions' }, [
      ...card.map((a) => actionButton(ctx, a, target)),
      session.slots.some(Boolean) ? null : el('p', {
        class: 'dim', text: '초식을 수련해 숙련 30% 를 넘기면 실전 슬롯에 자동으로 장착된다.',
      }),
    ]),
  );
}
