// 도장 (REQ-707·711·713·715·830~837) — 배우기 · 수련 · 장착 · 전수 · 대련/파견 진입.
// 홈은 「지금 무엇을 할 수 있나」의 요약이라 도전자 정보는 S7 `select.mjs` 가 진다 (REQ-834).

import { BALANCE, STYLES } from '../../balance.mjs';
import {
  artById, canLearn, discipleStyleRank, discipleStyles, ladderBandAt, styleById, trainAccrualCap,
} from '../../core.mjs';
import { clear, composeScreen, el, tipAnchor, topBand } from '../dom.mjs';
import { particle } from '../theme.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { rankStair } from '../components/rank-stair.mjs';
import {
  ART_ID, ART_NAME, canDiscipleTrain, canDispatch, canEquip, canTransmitNow,
  challengerOfStage, consumeTooltip, designateDiscipleTraining, discipleTrainProgress, equip,
  learnStyle, missionLockRankOf, missionShortfallOf, pickTooltip, settleDiscipleTraining,
  simulateTraining, unequip,
} from '../session.mjs';

// 만성도 「N성」 하나뿐이다 — 배지가 폭을 양보해야 4자 초식명·한자가 한 줄에 서고,
// 「완벽히 깨달음」은 도달하는 순간의 대련 토스트가 진다 (#139).
const rankLabel = (rank) => `${rank}성`;

/** 순차 해금에서 이 초식 다음에 오는 식 — 계단 안내가 「무엇이 열리는가」를 이름으로 댄다. */
const heirOf = (style) => STYLES.find((s) => s.set === style.set && s.order === style.order + 1) ?? null;

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

/**
 * 도장 정경 (REQ-837) — 제자의 **존재·정서**가 서는 자리다. 조작과 수치는 제자 블록이 지므로
 * 여기서는 실루엣이 늘었다는 사실 하나만 말한다 (REQ-833).
 */
function sceneBanner(session) {
  const progress = discipleTrainProgress(session);
  return el('div', { class: 'dojo-banner' }, [
    el('div', { class: 'layer floor', 'aria-hidden': 'true' }),
    el('div', { class: 'fig master sil_master_dojo', 'aria-hidden': 'true' }),
    session.transmitted ? el('div', { class: 'fig pupil sil_disciple_dojo', 'aria-hidden': 'true' }) : null,
    el('div', { class: 'layer vignette', 'aria-hidden': 'true' }),
    el('div', { class: 'plaque' }, [el('b', { text: '도장' }), hanja('道場')]),
    session.transmitted
      ? el('div', { class: 'pupil-tag' }, [
        el('span', { class: 'dim', text: '제자' }),
        el('b', { text: progress ? '수련 중' : '대기' }),
      ])
      : null,
  ]);
}

/**
 * 다음 계단에서 무엇이 열리는가 (REQ-707·830) — 적립 수단이 구간마다 바뀌는 규칙이 게이지 밖
 * 설명문에만 있으면 화면은 다시 숫자만 남는다. 계단 값은 전부 `BALANCE` 에서 온다.
 * @returns {{text: string, wall: boolean}} `wall` 은 수련이 끊기는 계단이라 주사색을 받는다 (REQ-811)
 */
function nextStepNote(style, rank) {
  const { equip: equipRank, unlock, oneTap } = BALANCE.rankGate;
  const { finishRank, crushRank } = BALANCE.rankLadder;
  const wall = trainAccrualCap() + 1;
  const next = rank + 1;
  const heir = heirOf(style);
  const opens = next === crushRank ? '이 초식으로 완파 1회'
    : next === finishRank ? '이 초식으로 결정타 1회'
      : next === wall ? '수련은 여기까지, 대련으로만'
        : next === oneTap ? '원터치가 열린다'
          : next === equipRank ? '실전에 장착할 수 있다'
            : next === unlock && heir ? `${heir.name}${particle(heir.name, '이', '가')} 열린다`
              : ladderBandAt(rank)?.train ? '수련·대련' : '대련 유효 성공';
  return { text: `다음 ${next}성 — ${opens}`, wall: next === wall };
}

/**
 * 초식 성 게이지 (REQ-707·817·830) — 계단 자체는 공유 컴포넌트가 그리고, 여기서는 그 옆에
 * 성 배지와 다음 계단 안내를 붙인다.
 */
function rankGauge(session, style) {
  const { rank, pts } = session.progress.styles[style.id];
  const band = ladderBandAt(rank);
  const note = nextStepNote(style, rank);
  return [
    el('div', { class: 'rank-gauge' }, [
      el('span', { class: 'badge', text: rankLabel(rank) }),
      rankStair({ rank, progress: band ? pts / band.cost : 0 }),
    ]),
    el('p', { class: `rank-next${note.wall ? ' wall' : ''}`, text: note.text }),
  ];
}

/**
 * 초식 줄의 액션 서술자 — `disabled` 술어를 여기 한 곳에서만 계산해 버튼과 툴팁 후보가 같은
 * 값을 읽게 한다. 안내 후보인지는 id 접두사가 `TIPS` 에 있는지로 갈린다.
 */
function styleActions(ctx, style) {
  const { session } = ctx;
  const { learned, rank } = session.progress.styles[style.id];
  const slotIdx = session.slots.indexOf(style.id);

  if (!learned) {
    return [{
      id: `learn:${style.id}`, class: 'small', text: '배우기',
      disabled: !canLearn(session.progress, style.id),
      onclick: () => { learnStyle(session, style.id); ctx.go('dojo'); },
    }];
  }

  // 만성은 더 오를 곳이 없어 수련 버튼이 하는 일이 없다 — 자리만 먹는다 (REQ-831).
  const actions = rank >= BALANCE.rankMax ? [] : [{
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
  // 하드 잠금의 이유는 「어느 초식이 몇 성인가」다 — 권장 성만으로는 무엇을 올려야 할지 모른다 (REQ-836).
  const behind = missionShortfallOf(session)
    .slice().sort((a, b) => a.rank - b.rank)[0] ?? null;
  // 부제 문면과 자물쇠 술어가 같은 사실을 두 번 읽으면 갈릴 수 있다 — 전수 완료는 여기 한 번이다.
  const done = session.transmitted;
  return [
    {
      id: 'duel', text: '대련',
      sub: `${stage.name} ${stage.stage}차`, lockedSub: '장착 필요',
      disabled: !session.slots.some(Boolean),
      onclick: () => ctx.go('select', { stage: session.stage }),
    },
    {
      id: 'transmit', text: '전수',
      sub: `제자에게 ${ART_NAME}을`,
      lockedSub: done ? '전수 완료' : `전 초식 ${artById(ART_ID).transmitRank}성 필요`,
      disabled: !canTransmitNow(session),
      done,
      onclick: () => ctx.go('transmit'),
    },
    {
      // 차수 잠금은 여기서 막지 않는다 — 부족 초식 전량이 예고 화면에 있어, 닫으면 그 안내에 닿을 수 없다.
      id: 'dispatch', text: '파견',
      // 차수는 대련과 같은 「N차」로 부른다 — 스펙 식별자는 데이터·로그에만 남는다 (REQ-895·896).
      sub: canDispatch(session) || !behind
        ? `임무 ${session.dispatchStage}차`
        : `${behind.name} ${behind.rank}성 · 권장 ${missionLockRankOf(session)}성`,
      lockedSub: '전수 후 열린다',
      disabled: !session.transmitted,
      onclick: () => ctx.go('preview'),
    },
  ]
    // 잠김과 완료는 같은 비활성이지만 다른 사실이다 — 자물쇠는 아직 열 수 있는 것에만 붙는다 (#167).
    .map((a) => ({ ...a, locked: Boolean(a.disabled && !a.done) }));
}

/**
 * 액션 id 를 DOM id 로 (#133) — 재렌더 뒤 같은 액션을 다시 찾는 열쇠라, 서술자의 id 에서
 * 기계적으로 나와야 두 벌이 갈리지 않는다. `:` 를 펴는 것은 선택자로도 부를 수 있게 두기 위해서다.
 */
const actionDomId = (id) => `dojo-act-${String(id).replace(':', '-')}`;

/** 서술자 → 버튼. 안내 대상이면 툴팁 앵커로 감싸고, 그 버튼을 누르는 순간 안내를 소비한다. */
function actionButton(ctx, action, target) {
  const button = el('button', {
    id: actionDomId(action.id),
    class: `${action.class ?? ''}${action.locked ? ' locked' : ''}`.trim(),
    // 잠금은 상태이지 장식이 아니다 — 네이티브 `disabled` 가 포커스를 막고 `aria-disabled` 가
    // 그 사실을 낭독으로 말한다. 왜 잠겼는지는 밴드의 부제·행 안내가 따로 진다 (REQ-911·836).
    disabled: action.disabled,
    'aria-disabled': String(Boolean(action.disabled)),
    text: action.text,
    onclick: () => { consumeTooltip(ctx.session.tooltip, action.id); action.onclick(); },
  });
  return target?.id === action.id
    ? tipAnchor(button, tipText(action.id, target.kind), TIP_ID)
    : button;
}

/**
 * 초식 한 줄 — 만성·잠김 행은 게이지를 접고 배지만 머리줄에 남긴다 (REQ-831). 전부 금색이거나
 * 전부 빈 계단은 정보량이 0인데 세로를 행마다 먹고, 회수한 그 세로가 제자 블록의 자리다.
 */
function styleRow(ctx, style, actions, target) {
  const { session } = ctx;
  const { learned, rank } = session.progress.styles[style.id];
  const slotIdx = session.slots.indexOf(style.id);
  const mastered = rank >= BALANCE.rankMax;
  const folded = !learned || mastered;

  return el('div', {
    class: `row${learned ? '' : ' locked'}${mastered ? ' done' : ''}`,
    style: `--attr:${attrTone(style.attr)}`,
  }, [
    el('div', { class: 'row-head' }, [
      // 이름은 읽는 자리이지 누르는 자리가 아니다 — 행의 조작은 우측 액션 버튼이 전부 진다 (#165).
      el('div', { class: 'row-name' }, [
        attrMark(style.attr),
        el('b', { text: style.name }),
        hanja(style.hanja),
        folded ? el('span', { class: `badge${mastered ? ' max' : ''}`, text: learned ? rankLabel(rank) : '잠김' }) : null,
        slotIdx >= 0 ? el('span', { class: 'tag', text: `슬롯 ${slotIdx + 1}` }) : null,
      ]),
      ...actions.map((a) => actionButton(ctx, a, target)),
    ]),
    ...(folded ? [] : rankGauge(session, style)),
    // 만성은 더 오를 계단이 없어 안내할 것도 없다 — 잠김 행은 여는 조건이 곧 그 안내다.
    learned ? null : el('p', { class: 'rank-next', text: `직전 초식 ${BALANCE.rankGate.unlock}성에서 열린다` }),
  ]);
}

const trainLeftLabel = (leftMs) => {
  const minutes = Math.ceil(leftMs / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 남음` : `${minutes}분 남음`;
};

/**
 * 제자 블록 (REQ-751·752·833) — 수련 지정 · 진척 막대 · 남은 시간 · 초식별 성 4열.
 * 전용 화면으로 가르지 않는 것이 결정이다: 어느 초식이 뒤처졌는지는 넷을 붙여 놓아야 보이고,
 * 그 비교가 곧 지정의 근거다. 열 자체가 지정 버튼이라 판단과 조작이 같은 자리에서 끝난다.
 */
function pupilBlock(ctx, bar) {
  const { session } = ctx;
  const styles = discipleStyles(session.disciple, ART_ID);
  const head = el('div', { class: 'pb-head' }, [
    el('b', { class: 'ttl', text: '제자' }),
    hanja('弟子'),
    styles.length ? el('span', { class: 'dim', text: ART_NAME }) : null,
  ]);
  if (!styles.length) {
    return el('section', { class: 'pupil-block' }, [
      head,
      el('p', { class: 'dim', text: `아직 전수한 무공이 없다 — 전 초식을 ${artById(ART_ID).transmitRank}성으로 깨달으면 전수할 수 있다.` }),
    ]);
  }
  const progress = discipleTrainProgress(session);
  return el('section', { class: 'pupil-block' }, [
    head,
    // 막대는 하나다 — 지정이 배타적이라 두 개가 동시에 차오르는 상태가 규칙에 없다.
    progress ? bar : el('p', {
      class: 'dim',
      text: `초식을 지정해 걸어 두면 사부가 다른 일을 하는 동안에도 성이 오른다 (1성당 ${Math.round(BALANCE.discipleTrain.secondsPerRank / 60)}분, ${trainAccrualCap()}성까지).`,
    }),
    el('div', { class: 'pb-cols' }, styles.map((s) => {
      const rank = discipleStyleRank(session.disciple, ART_ID, s.id);
      const designated = progress?.styleId === s.id;
      return el('button', {
        // 권장 성에 못 미치는 열이 곧 파견을 잠근 초식이다 — 잠금 사유와 같은 축을 같은 색으로 (REQ-836).
        class: `pcol${designated ? ' training' : ''}${rank < BALANCE.mission.unlockRank ? ' low' : ''}`,
        style: `--attr:${attrTone(s.attr)}`,
        // 8성 벽 위는 파견 전용이라 지정 자체가 열리지 않는다 (REQ-706).
        disabled: designated || !canDiscipleTrain(session, s.id),
        'aria-disabled': String(designated || !canDiscipleTrain(session, s.id)),
        onclick: () => { designateDiscipleTraining(session, s.id); ctx.go('dojo'); },
      }, [
        el('span', { class: 'nm', text: s.name }),
        el('span', { class: 'rk', text: `${rank}성` }),
        designated ? el('span', { class: 'tag', text: '수련 중' }) : null,
      ]);
    })),
  ]);
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
      ctx.go('dojo');
      return;
    }
    paintTrainBar(bar, after);
  }, 1000);
  return () => clearInterval(timer);
}

function paintTrainBar(bar, progress) {
  clear(bar).append(
    el('span', { class: 'who' }, [el('span', { class: 'dim', text: '수련 중 ' }), el('b', { text: styleById(progress.styleId).name })]),
    el('span', { class: 'meter' }, [el('i', { style: `width:${progress.ratio * 100}%` })]),
    el('span', { class: 'left', text: trainLeftLabel(progress.leftMs) }),
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
      text: `1시간 수련 시뮬 — +${Math.round(BALANCE.simEfficiency * BALANCE.simTrainSeconds)} 냥`,
      // 압축이 걸어 둔 제자 성까지 올리므로 상단 표시만으로는 카드의 배지·잠금이 낡은 채 남는다.
      onclick: () => { simulateTraining(ctx.session); ctx.go('dojo'); },
    }),
  ]);
}

export function renderDojo(ctx) {
  const { session } = ctx;

  const rowActions = STYLES.map((s) => styleActions(ctx, s));
  const band = bandActions(ctx);
  // 후보를 버튼과 같은 서술자에서 뽑으므로 `disabled` 술어가 두 벌로 갈리지 않는다 (#15).
  const target = pickTooltip(session.tooltip, [...rowActions.flat(), ...band]
    .filter((a) => tipRank(a.id) >= 0)
    .sort((a, b) => tipRank(a.id) - tipRank(b.id)));

  const bar = el('div', { class: 'pb-train' });
  composeScreen(ctx, {
    top: topBand(session, ART_NAME, { label: () => session.label }),
    body: [
      sceneBanner(session),
      // 목록을 감싼 카드는 목록을 또 하나의 패널로 만든다 — 머리글 한 줄로 대체한다 (REQ-832).
      el('div', { class: 'body-flow' }, [
        el('div', { class: 'art-head' }, [
          el('b', { class: 'kr', text: ART_NAME }),
          hanja(artById(ART_ID).hanja),
        ]),
        el('div', { class: 'rows' }, STYLES.map((s, i) => styleRow(ctx, s, rowActions[i], target))),
        session.slots.some(Boolean) ? null : el('p', {
          class: 'dim', text: `초식을 수련해 ${BALANCE.rankGate.equip}성에 닿으면 실전 슬롯에 자동으로 장착된다.`,
        }),
        pupilBlock(ctx, bar),
      ].filter(Boolean)),
    ],
    bottom: bandNode(ctx, band, target),
    // 정경은 풀블리드 배너라 본문 여백이 붙으면 좌우가 잘린다 — 여백은 아래 흐름이 각자 진다 (REQ-802·837).
    padded: false,
  });

  const progress = discipleTrainProgress(session);
  if (!progress) return undefined;
  paintTrainBar(bar, progress);
  return trackDiscipleTraining(ctx, bar);
}
