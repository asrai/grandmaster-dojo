// 도장 (REQ-707·711·713·715) — 배우기 · 수련 · 장착 · 전수 · 대련/파견 진입.

import { BALANCE, STYLES } from '../../balance.mjs';
import {
  artById, canLearn, discipleStyleRank, discipleStyles, ladderBandAt, styleById, trainAccrualCap,
} from '../../core.mjs';
import { arrowRow, attrMark, clear, composeScreen, el, tipAnchor, topBand } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, beatenChallengers, canDiscipleTrain, canDispatch,
  canEquip, canTransmitNow, challengerOfStage, consumeTooltip, designateDiscipleTraining,
  discipleTrainProgress, duelAttemptOf, equip, learnStyle, missionLockRankOf, pickTooltip,
  rematchBonusOf, settleDiscipleTraining, simulateTraining, unequip,
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
      onclick: () => ctx.go('duelPreview', { stage: session.stage }),
    },
    {
      id: 'transmit', text: '전수',
      sub: `제자에게 ${ART_NAME}을`,
      lockedSub: session.transmitted ? '전수 완료' : `전 초식 ${artById(ART_ID).transmitRank}성 필요`,
      disabled: !canTransmitNow(session),
      onclick: () => ctx.go('transmit'),
    },
    {
      // 차수 잠금은 여기서 막지 않는다 — 부족 초식 표시가 예고 화면에 있어, 닫으면 그 안내에 닿을 수 없다.
      id: 'dispatch', text: '파견',
      sub: canDispatch(session)
        ? `${DISPATCH_CHALLENGER.name} B-${session.dispatchStage}`
        : `B-${session.dispatchStage} 잠김 — 전 초식 ${missionLockRankOf(session)}성`,
      lockedSub: '전수 후 열린다',
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

/**
 * 재대련 항목 (REQ-734) — 이긴 도전자를 다시 칠 수 있다는 것과 그 대가를 같은 자리에서 읽힌다.
 * 회차·강화를 숨기면 「왜 갑자기 안 이기지」가 되고, 무보상을 숨기면 파밍을 끊는 근거가 사라진다.
 */
function rematchCard(ctx) {
  const { session } = ctx;
  const beaten = beatenChallengers(session);
  if (!beaten.length) return null;
  return el('section', { class: 'card' }, [
    el('h2', { text: '재대련' }),
    el('p', { class: 'dim', text: `이긴 도전자는 다시 칠 수 있다 — 대면마다 상대가 한 성씩(+${BALANCE.rematch.rankCap} 까지) 여물고 재화는 나오지 않는다.` }),
    el('div', { class: 'rows' }, beaten.map((c) => {
      const bonus = rematchBonusOf(session, c.id);
      return el('div', { class: 'row' }, [
        el('div', { class: 'row-head' }, [
          el('div', { class: 'row-name' }, [
            el('b', { text: `${c.name} ${c.stage}차` }),
            el('span', { class: 'tag', text: `${duelAttemptOf(session, c.id)}번째 대면` }),
            el('span', { class: 'tag', text: bonus > 0 ? `강화 +${bonus}` : '강화 없음' }),
          ]),
          el('button', {
            class: 'small', text: '재대련', disabled: !session.slots.some(Boolean),
            onclick: () => ctx.go('duelPreview', { stage: c.stage }),
          }),
        ]),
      ]);
    })),
  ]);
}

const trainLeftLabel = (leftMs) => {
  const minutes = Math.ceil(leftMs / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 남음` : `${minutes}분 남음`;
};

/**
 * 제자 카드 (REQ-751·752) — 수련 지정 · 진척 막대 1 · 초식별 성 4 를 한 카드에 나란히 둔다.
 * 전용 화면으로 가르지 않는 것이 결정이다: 어느 초식이 뒤처졌는지는 넷을 붙여 놓아야 보이고,
 * 그 비교가 곧 지정의 근거다.
 */
function discipleCard(ctx, bar) {
  const { session } = ctx;
  const styles = discipleStyles(session.disciple, ART_ID);
  if (!styles.length) {
    return el('section', { class: 'card' }, [
      el('h2', { text: '제자' }),
      el('p', { class: 'dim', text: `아직 전수한 무공이 없다 — 전 초식을 ${artById(ART_ID).transmitRank}성으로 깨달으면 전수할 수 있다.` }),
    ]);
  }
  const progress = discipleTrainProgress(session);
  return el('section', { class: 'card' }, [
    el('h2', { text: '제자' }),
    el('p', {}, [el('b', { text: ART_NAME })]),
    el('div', { class: 'rows' }, styles.map((s) => {
      const rank = discipleStyleRank(session.disciple, ART_ID, s.id);
      const designated = progress?.styleId === s.id;
      return el('div', { class: `row${designated ? ' open' : ''}`, style: `--attr:${ATTR_VIEW[s.attr].color}` }, [
        el('div', { class: 'row-head' }, [
          el('div', { class: 'row-name' }, [
            attrMark(s.attr),
            el('b', { text: s.name }),
            el('span', { class: 'tag', text: `${rank}성` }),
            designated ? el('span', { class: 'tag', text: '수련 중' }) : null,
          ]),
          el('button', {
            class: 'small', text: designated ? '수련 중' : '수련',
            // 8성 벽 위는 파견 전용이라 지정 자체가 열리지 않는다 (REQ-706).
            disabled: designated || !canDiscipleTrain(session, s.id),
            onclick: () => { designateDiscipleTraining(session, s.id); ctx.go('dojo'); },
          }),
        ]),
      ]);
    })),
    // 막대는 하나다 — 지정이 배타적이라 두 개가 동시에 차오르는 상태가 규칙에 없다.
    progress ? el('div', { class: 'meter-line' }, [bar]) : el('p', {
      class: 'dim',
      text: `초식을 지정해 걸어 두면 사부가 다른 일을 하는 동안에도 성이 오른다 (1성당 ${Math.round(BALANCE.discipleTrain.secondsPerRank / 60)}분, ${trainAccrualCap()}성까지).`,
    }),
  ].filter(Boolean));
}

/**
 * 걸어 둔 수련은 화면 전이와 무관하게 흐르므로 (REQ-752) 도장에 머무는 동안 막대만 따로 민다.
 * 성이 실제로 오른 순간에는 초식별 성 표시도 함께 낡으므로 그때만 화면을 다시 그린다.
 */
function trackDiscipleTraining(ctx, bar) {
  const timer = setInterval(() => {
    const before = discipleTrainProgress(ctx.session);
    settleDiscipleTraining(ctx.session);
    const after = discipleTrainProgress(ctx.session);
    if (!before || !after || before.rank !== after.rank || before.styleId !== after.styleId) {
      // 사용자 조작 없이 도는 재렌더라, 포커스를 되돌리지 않으면 30분마다 예고 없이 자리를 잃는다.
      const focused = document.activeElement?.id;
      ctx.go('dojo');
      if (focused) document.getElementById(focused)?.focus();
      return;
    }
    paintTrainBar(bar, after);
  }, 1000);
  return () => clearInterval(timer);
}

function paintTrainBar(bar, progress) {
  clear(bar).append(
    el('div', { class: 'meter' }, [el('i', { style: `width:${progress.ratio * 100}%` })]),
    el('span', { class: 'dim', text: ` ${styleById(progress.styleId).name} ${progress.rank}성 → ${progress.rank + 1}성 · ${trainLeftLabel(progress.leftMs)}` }),
  );
}

/** 스크롤 흐름 밖의 바닥 밴드 — 주요 액션이 진입 첫 화면에서 엄지 도달 범위 안에 상시 노출된다. */
function bandNode(ctx, actions, target) {
  return el('nav', { class: 'bottom-band', 'aria-label': '주요 행동' }, [
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
      // 압축이 걸어 둔 제자 성까지 올리므로 상단 표시만으로는 카드의 배지·잠금이 낡은 채 남는다.
      onclick: () => { simulateTraining(ctx.session); ctx.go('dojo'); },
    }),
  ]);
}

export function renderDojo(ctx) {
  const { session, root } = ctx;

  const rowActions = STYLES.map((s) => styleActions(ctx, s));
  const band = bandActions(ctx);
  // 후보를 버튼과 같은 서술자에서 뽑으므로 `disabled` 술어가 두 벌로 갈리지 않는다 (#15).
  const target = pickTooltip(session.tooltip, [...rowActions.flat(), ...band]
    .filter((a) => tipRank(a.id) >= 0)
    .sort((a, b) => tipRank(a.id) - tipRank(b.id)));
  const guidedRow = rowStyleId(target?.id);
  const openId = openRowOf(session, guidedRow);

  const bar = el('div', { class: 'train-bar' });
  const top = topBand(session, ART_NAME);
  ctx.ownTop(top.paint);
  composeScreen(root, {
    top: top.node,
    // 재대련 카드는 이긴 도전자가 생기기 전까지 없다 — `append(null)` 은 "null" 텍스트 노드가 된다.
    body: [
      el('section', { class: 'card' }, [
        el('h2', { text: `${ART_NAME} ${artById(ART_ID).hanja}` }),
        el('div', { class: 'rows' }, STYLES.map((s, i) => styleRow(ctx, s, rowActions[i], target, guidedRow, s.id === openId))),
        session.slots.some(Boolean) ? null : el('p', {
          class: 'dim', text: `초식을 수련해 ${BALANCE.rankGate.equip}성에 닿으면 실전 슬롯에 자동으로 장착된다.`,
        }),
      ]),
      rematchCard(ctx),
      discipleCard(ctx, bar),
    ],
    bottom: bandNode(ctx, band, target),
  });

  const progress = discipleTrainProgress(session);
  if (!progress) return undefined;
  paintTrainBar(bar, progress);
  return trackDiscipleTraining(ctx, bar);
}
