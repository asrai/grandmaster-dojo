// 도장 (REQ-707·711·713·715) — 배우기 · 수련 · 장착 · 전수 · 대련/파견 진입.

import { BALANCE, STYLES } from '../../balance.mjs';
import {
  artById, canLearn, discipleStyleRank, discipleStyles, ladderBandAt,
} from '../../core.mjs';
import { arrowRow, attrMark, clear, el, tipAnchor } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, canEquip, canTransmitNow,
  challengerOfStage, consumeTooltip, equip, learnStyle, pickTooltip, simulateTraining, unequip,
} from '../session.mjs';

const rankLabel = (rank) => (rank >= BALANCE.rankMax ? `${rank}성 · 완벽히 깨달음` : `${rank}성`);

/** 계단마다 무엇이 필요한지 — 규칙이 눈금에서 읽히지 않으면 성이 왜 멈췄는지 알 수 없다 (REQ-707). */
const STEP_MARK = { [BALANCE.rankLadder.finishRank]: '결정타 필요', [BALANCE.rankLadder.crushRank]: '완파 필요' };

/**
 * 유도 툴팁 문구표 (#15) — 키는 액션 id 의 접두사이고, 배열 순서가 곧 안내 우선순위(1사이클의
 * 진행 순서)다. 여기 등록하는 것이 곧 「그 버튼을 안내 대상으로 삼는다」는 선언이라, 안내할
 * 이유가 없는 버튼(해제 · 수련 시뮬)은 등록하지 않는 것으로 후보에서 빠진다.
 */
const TIPS = [
  ['train', '초식을 반복해 성을 올린다'],
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

// 초식 줄의 액션 id 만 `<종류>:<초식 id>` 꼴이라, 이 분해가 곧 「밴드 액션인가 줄 액션인가」다.
const rowStyleId = (id) => (String(id).includes(':') ? String(id).split(':')[1] : null);

// 재렌더가 누른 버튼 노드를 파기하므로, 포커스를 되돌리려면 같은 줄의 토글을 id 로 다시 찾아야 한다.
const rowToggleId = (styleId) => `row-toggle-${styleId}`;

/**
 * 사용자가 고른 펼침 행 — `row: null` 은 전부 접음이고, `against` 는 그 선택을 한 시점의 안내 대상 행이다.
 * 세션이 아니라 모듈에 두는 것은 이것이 순수 뷰 상태라, 로그 내보내기 payload 에 실려서는 안 되기 때문이다.
 */
let chosen = null;

/**
 * 초식 성 게이지 (REQ-707) — 연속 막대에 계단 눈금 12 를 얹고 성 숫자는 배지로 병기한다.
 * 11·12 눈금만 표식이 다른 것은 그 둘이 적립이 아니라 결정타·완파로 열리기 때문이다.
 */
function rankGauge(session, style) {
  const { rank, pts } = session.progress.styles[style.id];
  const band = ladderBandAt(rank);
  const filled = band ? Math.round((pts / band.cost) * 100) : 0;
  const ticks = Array.from({ length: BALANCE.rankMax }, (_, i) => {
    const at = i + 1;
    const mark = STEP_MARK[at];
    return el('i', {
      class: `tick${at <= rank ? ' lit' : ''}${mark ? ' gate' : ''}`,
      title: mark ? `${at}성 — ${mark}` : `${at}성`,
    });
  });
  const need = band ? null : STEP_MARK[rank + 1] ?? null;
  return el('div', { class: 'rank-gauge' }, [
    el('div', { class: 'meter' }, [el('i', { style: `width:${filled}%` })]),
    el('div', { class: 'ticks' }, ticks),
    el('span', {
      class: `badge${rank >= BALANCE.rankMax ? ' max' : ''}`, text: rankLabel(rank),
    }),
    need ? el('span', { class: 'dim', text: ` 다음 계단 — ${need}` }) : null,
  ]);
}

/**
 * 펼칠 행 하나 — 세로 예산이 초식 4행을 다 펼칠 만큼 넓지 않아 아코디언으로 접는다 (#37).
 * 사용자의 선택은 안내가 같은 행에 머무는 동안만 유지된다 — 안내가 다른 행으로 옮겨가면 그쪽이
 * 다시 열려, 도장에 들어올 때마다 지목된 행에 안내와 상세가 함께 있다.
 */
function openRowOf(session, guidedRow) {
  if (chosen && chosen.against === guidedRow) return chosen.row;
  return guidedRow ?? session.slots.find(Boolean) ?? STYLES[0].id;
}

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

/**
 * 바닥 밴드의 액션 서술자 — 초식 줄과 같은 형태라 두 갈래를 한 안내 후보 목록으로 합칠 수 있다.
 * 라벨은 동사만 남기고 대상·잠금 사유는 `sub`/`lockedSub` 로 갈라, 세 버튼이 393px 폭에 한 줄로 선다.
 */
function bandActions(ctx) {
  const { session } = ctx;
  const stage = challengerOfStage(session.stage);
  return [
    {
      id: 'duel', text: '대련',
      sub: `${stage.name} ${stage.stage}차`, lockedSub: '장착 필요',
      disabled: !session.slots.some(Boolean),
      onclick: () => ctx.go('duel', { stage: session.stage }),
    },
    {
      id: 'transmit', text: '전수',
      sub: `제자에게 ${ART_NAME}을`,
      lockedSub: session.transmitted ? '전수 완료' : `전 초식 ${artById(ART_ID).transmitRank}성 필요`,
      disabled: !canTransmitNow(session),
      onclick: () => ctx.go('transmit'),
    },
    {
      id: 'dispatch', text: '파견',
      sub: DISPATCH_CHALLENGER.name, lockedSub: '전수 후 열린다',
      disabled: !session.transmitted,
      onclick: () => ctx.go('preview'),
    },
  ];
}

/** 서술자 → 버튼. 안내 대상이면 툴팁 앵커로 감싸고, 그 버튼을 누르는 순간 안내를 소비한다. */
function actionButton(ctx, action, target) {
  const button = el('button', {
    class: action.class ?? '',
    disabled: action.disabled,
    text: action.text,
    onclick: () => { consumeTooltip(ctx.session.tooltip, action.id); action.onclick(); },
  });
  return target?.id === action.id
    ? tipAnchor(button, tipText(action.id, target.kind), TIP_ID)
    : button;
}

function styleRow(ctx, style, actions, target, guidedRow, open) {
  const { session } = ctx;
  const learned = session.progress.styles[style.id].learned;
  const slotIdx = session.slots.indexOf(style.id);

  return el('div', { class: `row${learned ? '' : ' locked'}${open ? ' open' : ''}`, style: `--attr:${ATTR_VIEW[style.attr].color}` }, [
    el('div', { class: 'row-head' }, [
      el('button', {
        id: rowToggleId(style.id), class: 'row-name', 'aria-expanded': String(open),
        onclick: () => {
          chosen = { row: open ? null : style.id, against: guidedRow };
          ctx.go('dojo');
          document.getElementById(rowToggleId(style.id))?.focus();
        },
      }, [
        attrMark(style.attr),
        el('b', { text: style.name }),
        el('span', { class: 'hanja', text: style.hanja }),
        slotIdx >= 0 ? el('span', { class: 'tag', text: `슬롯 ${slotIdx + 1}` }) : null,
      ]),
      ...actions.map((a) => actionButton(ctx, a, target)),
    ]),
    open ? arrowRow(style.seq, 0, learned ? style.seq.length : 0) : null,
    learned ? rankGauge(session, style)
      : el('div', { class: 'meter-line' }, [
        el('span', { class: 'dim', text: `미해금 — 직전 초식 ${BALANCE.rankGate.unlock}성에서 열린다` }),
      ]),
  ]);
}

function discipleCard(session) {
  const styles = discipleStyles(session.disciple, ART_ID);
  return el('section', { class: 'card' }, [
    el('h2', { text: '제자' }),
    styles.length === 0
      ? el('p', { class: 'dim', text: `아직 전수한 무공이 없다 — 전 초식을 ${artById(ART_ID).transmitRank}성으로 깨달으면 전수할 수 있다.` })
      : el('div', {}, [
        el('p', {}, [el('b', { text: ART_NAME })]),
        el('div', { class: 'icons' }, styles.map((s) => el('span', {
          class: 'cand mini', style: `--attr:${ATTR_VIEW[s.attr].color}`,
        }, [
          attrMark(s.attr),
          el('span', { class: 'cand-name', text: s.name }),
          el('span', { class: 'tag', text: `${discipleStyleRank(session.disciple, ART_ID, s.id)}성` }),
        ]))),
      ]),
  ]);
}

/** 스크롤 흐름 밖의 바닥 밴드 — 주요 액션이 진입 첫 화면에서 엄지 도달 범위 안에 상시 노출된다. */
function renderBand(ctx, actions, target) {
  clear(ctx.band).append(
    el('div', { class: 'band-actions' }, actions.map((a) => {
      const sub = a.disabled ? a.lockedSub : a.sub;
      // 칸 폭이 무대의 1/3 이라 부제가 잘릴 수 있고, 잘린 문자열에 닿을 다른 경로가 없다.
      return el('div', { class: 'band-cell' }, [
        actionButton(ctx, a, target),
        el('span', { class: 'band-sub', title: sub, text: sub }),
      ]);
    })),
    // 평가자는 실제로 방치할 수 없으므로 1시간을 버튼 하나로 압축해 보여 준다 (REQ-604).
    el('button', {
      class: 'small ghost band-sim',
      text: `1시간 수련 시뮬 — +${Math.round(BALANCE.simEfficiency * BALANCE.simTrainSeconds)} 元`,
      onclick: () => { simulateTraining(ctx.session); ctx.refreshTop(); },
    }),
  );
}

export function renderDojo(ctx) {
  const { session, root } = ctx;
  ctx.pad.detach();
  clear(root);

  const rowActions = STYLES.map((s) => styleActions(ctx, s));
  const band = bandActions(ctx);
  // 후보를 버튼과 같은 서술자에서 뽑으므로 `disabled` 술어가 두 벌로 갈리지 않는다 (#15).
  const target = pickTooltip(session.tooltip, [...rowActions.flat(), ...band]
    .filter((a) => tipRank(a.id) >= 0)
    .sort((a, b) => tipRank(a.id) - tipRank(b.id)));
  const guidedRow = rowStyleId(target?.id);
  const openId = openRowOf(session, guidedRow);

  root.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `${ART_NAME} ${artById(ART_ID).hanja}` }),
      el('div', { class: 'rows' }, STYLES.map((s, i) => styleRow(ctx, s, rowActions[i], target, guidedRow, s.id === openId))),
      session.slots.some(Boolean) ? null : el('p', {
        class: 'dim', text: `초식을 수련해 ${BALANCE.rankGate.equip}성에 닿으면 실전 슬롯에 자동으로 장착된다.`,
      }),
    ]),
    discipleCard(session),
  );
  renderBand(ctx, band, target);
}
