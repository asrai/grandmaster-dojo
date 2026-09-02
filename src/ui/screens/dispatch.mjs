// 도전자 예고 화면 + 파견 관전 (REQ-403~407·504·850~857). 2막의 본체는 손을 놓고 보는 것이라,
// 유저의 유일한 개입 수단은 그 초 한정의 지시 탭이다. 관전은 S1 아레나를 통째로 상속하고
// 아레나에 서는 사람만 갈아 끼우며(사부 → 제자), 손이 있던 하단 362px 은 십자 대신 제자의
// 판단으로 채운다 — 상속이 곧 서사다.

import { BALANCE } from '../../balance.mjs';
import { createDiscipleHand } from '../../bot.mjs';
import { discipleStyleRank, discipleStyles, finisherOf, foeStyleById } from '../../core.mjs';
import { clear, composeScreen, el, topBand } from '../dom.mjs';
import { stageBand } from '../band.mjs';
import { REASON_VIEW, attrLabel, winAttrOf } from '../theme.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { SFX } from '../audio.mjs';
import { SPOT, createArena } from '../arena.mjs';
import { createMatch } from '../match.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, canDispatch, currentMission,
  missionLockRankOf, missionShortfallOf,
} from '../session.mjs';
import { createTablets } from '../tablets.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, dispatchWiring, logDispatchResult } from '../wiring.mjs';

const styleIcon = (style, extra = '', rankTag = null) => el('div', {
  class: `cand${extra ? ` ${extra}` : ''}`, style: `--attr:${attrTone(style.attr)}`,
}, [
  attrMark(style.attr),
  el('span', { class: 'cand-name', text: style.name }),
  rankTag ? el('span', { class: 'tag', text: rankTag }) : null,
]);

/**
 * 절초 공개 (REQ-732·742) — 절초는 역파라는 특별 벌칙을 가진 유일한 초식이라 답을 미리 가르친다.
 * B-2 부터는 조합이 랜덤이라 절초가 없는 임무도 있고, 그때는 공개할 것 자체가 없다.
 */
function finisherTell(finisher) {
  if (!finisher) return el('p', { class: 'dim', text: '이번 임무에 절초는 없다 — 역파가 나올 자리가 없다.' });
  return el('div', {}, [
    el('div', { class: 'icons' }, [styleIcon(finisher, 'big-icon')]),
    el('p', {}, [
      el('b', { text: `절초 ${finisher.name}` }),
      hanja(finisher.hanja),
      el('span', { class: 'dim', text: ` · ${attrLabel(finisher.attr)} · ${finisher.len}수 · 이기는 색 ${attrLabel(winAttrOf(finisher.attr))}` }),
    ]),
  ]);
}

/**
 * 하드 잠금 표시 (REQ-743) — 버튼 비활성 + 권장 성 + **부족한 초식**. 확인 팝업이 아닌 것이 결정이다:
 * 팝업은 습관적으로 넘겨져 유저가 실패를 고를 경로를 남긴다.
 */
function lockNotice(need, shortfall) {
  // 전수 전에는 요구 성도 제자 초식도 없다 — 그 상태에 잠금 문구를 쓰면 「null 성이어야 한다」가 뜬다.
  if (need === null || !shortfall.length) {
    return el('div', { class: 'card lock' }, [
      el('p', {}, [el('b', { text: '아직 내보낼 제자가 없다 — 전수 후 열린다' })]),
    ]);
  }
  return el('div', { class: 'card lock' }, [
    el('p', {}, [el('b', { text: `임무 잠김 — 제자의 전 초식이 ${need}성이어야 한다` })]),
    el('p', { class: 'dim', text: `모자란 초식: ${shortfall.map((s) => `${s.name} ${s.rank}성`).join(' · ')}` }),
    el('p', { class: 'dim', text: '도장 제자 카드에서 그 초식을 지정해 수련시켜라.' }),
  ]);
}

/**
 * 임무 예고 (REQ-732·742·743). **잠긴 차수도 이 화면에 들어온다** — 부족 초식 표시가 하드 잠금의
 * 절반이라(팝업 대신 그것을 고른 것이 결정이다) 잠긴 동안 닿을 수 없으면 그 절반이 없는 것과 같다.
 */
export function renderPreview(ctx) {
  const { session, root } = ctx;
  const unlocked = canDispatch(session);
  // 잠긴 차수는 조합을 뽑지 않는다 — 나갈 수 없는 상대를 미리 굴리면 그 판이 무엇이었는지가 흐려진다.
  const mission = unlocked ? currentMission(session) : null;
  const challenger = mission ? mission.challenger : DISPATCH_CHALLENGER;

  composeScreen(ctx, {
    top: topBand(session, ART_NAME, { onLeave: () => ctx.go('dojo') }),
    body: el('section', { class: 'card' }, [
    // 차수는 대련과 같은 「N차」로 부른다 — 스펙 식별자(`B-n`)만 사라지고 데이터·로그에는 남는다 (REQ-895·896).
    el('h2', {}, [
      el('span', { text: `임무 ${session.dispatchStage}차 — ${challenger.name}` }),
      hanja(challenger.hanja),
    ]),
    el('p', {
      class: 'dim',
      text: session.dispatchStage <= 1
        ? '첫 임무는 고정 상대다 — 갓 전수받은 제자도 이긴다.'
        : '임무마다 상대 구성이 새로 짜인다 — 같은 자리에 눌러앉을 수 없다.',
    }),
    mission ? finisherTell(finisherOf(challenger)) : null,
    mission
      ? el('div', { class: 'icons' }, mission.foeSet.map((id) => styleIcon(foeStyleById(id), 'mini')))
      : lockNotice(missionLockRankOf(session), missionShortfallOf(session)),
    el('h2', { text: `제자 — ${ART_NAME}` }),
    el('div', { class: 'icons' }, discipleStyles(session.disciple, ART_ID).map((s) => styleIcon(s,
      '', `${discipleStyleRank(session.disciple, ART_ID, s.id)}성`))),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'primary', text: '파견 보내기', disabled: !unlocked, onclick: () => ctx.go('dispatch'),
      }),
    ]),
  ].filter(Boolean)) });
}

export function startDispatch(ctx) {
  const { session } = ctx;
  // 자격은 진입 함수가 진다 — 버튼 비활성은 표현일 뿐이라 그것만으로는 우회 경로가 닫히지 않는다 (REQ-743).
  if (!canDispatch(session)) return renderPreview(ctx);
  const mission = currentMission(session);
  const challenger = mission.challenger;
  const styles = discipleStyles(session.disciple, ART_ID);

  const verdict = createVerdictOverlay();
  // 아레나에 서는 사람만 바뀐다 — 좌표도 세간도 대련 그대로다 (REQ-850). 사부는 무대 밖 앞
  // 구석에서 잘린 뒷모습으로 지켜보고, 그 잘림이 카메라가 곧 사부의 시선임을 말한다 (REQ-854).
  const arena = createArena({
    figures: [
      { spot: SPOT.FAR, id: 'sil_challenger', pose: 'stance' },
      { spot: SPOT.NEAR, id: 'sil_disciple', pose: 'stance' },
    ],
    watcher: { id: 'sil_master', pose: 'watch' },
    bout: { [SPOT.FAR]: '적', [SPOT.NEAR]: '제자' },
  });
  arena.node.appendChild(verdict.node);

  let exchanges = 0;
  const band = stageBand({
    onLeave: () => ctx.go('dojo'),
    name: challenger.name,
    hanja: challenger.hanja,
    seal: `${session.dispatchStage}차`,
    count: { value: () => exchanges + 1, unit: '초째' },
  });

  // 관전 화면에는 십자 키패드가 없다 — 죽간만 따로 장착하는 경로다 (REQ-805·851).
  // 이 죽간은 손으로 고르는 지시 목록이지 시퀀스가 좁힌 후보가 아니라 확정이라는 어휘가 없다.
  const tablets = createTablets();
  const colorEl = el('div', { class: 'pad-color none' });
  const judgeNow = el('p', { class: 'judge-now' });
  const judgePrev = el('p', { class: 'judge-prev' });
  const deck = el('footer', { class: 'deck' }, [
    colorEl,
    el('div', { class: 'slip-row' }, [tablets.node]),
    // 관전의 콘텐츠는 결과가 아니라 제자의 판단 그 자체다 (REQ-852).
    el('div', { class: 'judge' }, [
      el('span', { class: 'judge-cap', text: '제자의 판단' }), judgeNow, judgePrev,
    ]),
    // 선택이라는 사실은 바닥에 조용히 있어야 관전을 재촉하지 않는다 (REQ-857 · REQ-407).
    el('div', { class: 'handoff' }, [
      el('span', { text: '죽간을 탭하면 ' }), el('b', { text: '이 초' }), el('span', { text: '만 지시한다' }),
    ]),
  ]);

  composeScreen(ctx, {
    top: band,
    body: arena.node,
    bottom: deck,
    // 아레나는 풀블리드 레이어라 여백이 붙으면 3단 고정이 어긋난다 (REQ-802·820).
    padded: false,
  });

  let instructed = null;
  let fired = false;
  let shown = null;
  let prevText = '';
  const disciple = createDiscipleHand({ session, styles, fire: (shot) => match.fire(shot) });

  /** 진행형 색 띠 — 이 초에 누가 정해졌는지가 없으면 색도 없다 (REQ-828). */
  const paintColor = (style) => {
    colorEl.className = `pad-color${style ? '' : ' none'}`;
    colorEl.style.color = style ? attrTone(style.attr) : '';
  };

  /**
   * 지시받은 초에는 제자가 판단하지 않았으므로 이유가 없다 — 그 사실을 문구로 갈라 적는다.
   * 이유 문구의 표는 원장(`theme.mjs`)이 지고 계열 누락은 부팅 단정이 문다 (REQ-853).
   */
  function showJudgement(judged) {
    const text = judged.byUser ? '지시를 따랐다' : REASON_VIEW[judged.reason];
    clear(judgeNow).append(
      el('span', { text: `${text} — ` }),
      el('b', { text: judged.style.name }),
      attrMark(judged.style.attr),
    );
    // 관전의 콘텐츠가 판단 그 자체라, 시각 층에만 두면 비시각 사용자에게는 관전이 통째로 빈다.
    verdict.announce(`${text} — ${judged.style.name}`);
    judgePrev.textContent = prevText ? `지난 초 · ${prevText}` : '';
    prevText = text;
  }

  function renderTablets(view) {
    // 그 초 예고의 파해를 제자가 보유하면 그 죽간만 금색으로 맥동해 지시를 유도한다 (강제 아님).
    const hintId = view.telegraphed
      ? styles.find((s) => s.counters === view.telegraphed.id)?.id ?? null
      : null;
    tablets.render(styles.map((style) => {
      // 유도는 지시 전까지의 예고라, 지시받았거나 이미 낸 초에는 멈춘다 (REQ-855).
      const beckons = !fired && style !== instructed && style.id === hintId;
      return {
      style,
      // 도장에서 키운 값이 싸우는 화면에서 읽혀야 수련의 보상이 닫힌다 (REQ-856).
      rank: discipleStyleRank(session.disciple, ART_ID, style.id),
      mods: [style === instructed ? 'picked' : '', beckons ? 'beckon' : ''].filter(Boolean).join(' '),
      // 지시도 유도도 색·맥동만으로 두면 색각 이상과 낭독 양쪽에서 사라진다.
      tags: [style === instructed ? '지시' : null, beckons ? '파해' : null].filter(Boolean),
      onTap: () => {
        if (fired) return;
        instructed = style;
        paintColor(style);
        renderTablets(view);
      },
      };
    }));
  }

  const renderHp = (view) => {
    arena.setVital(SPOT.FAR, view.foeHp, view.foeHpMax);
    arena.setVital(SPOT.NEAR, view.selfHp, view.selfHpMax);
  };

  const match = createMatch({
    challenger,
    foeRank: mission.foeRank,
    selfHpMax: BALANCE.hp.disciple,
    rankOf: (style) => discipleStyleRank(session.disciple, ART_ID, style.id),
    openLen: () => Math.max(...styles.map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    hooks: composeHooks(dispatchWiring(session, { disciple, instructed: () => instructed }), {
      onTelegraph(view) {
        instructed = null;
        fired = false;
        shown = view;
        verdict.hide();
        arena.setWindow(1);
        paintColor(null);
        judgeNow.textContent = '고르는 중';
        arena.showTelegraph(view, '빈틈! — 제자가 연환을 잇는다');
        renderHp(view);
        renderTablets(view);
        exchanges = view.exchange;
        ctx.refreshTop();
      },
      onTick(view, executed) {
        arena.setWindow(view.ratio);
        if (!executed || fired) return;
        fired = true;
        showJudgement(executed);
        paintColor(executed.style);
        renderTablets(shown ?? view);
      },
      onVerdict(view, ranked) {
        renderHp(view);
        verdict.showGrade(view.verdict.grade);
        (view.verdict.grade === 'crush' ? SFX.crush : SFX.hit)();
        if (ranked) SFX.rank();
      },
      onEnd(view) {
        logDispatchResult(session, { mission, win: view.outcome.win });
        ctx.go('result', { kind: 'dispatch', win: view.outcome.win, view });
      },
    }),
  });

  match.start();
  return () => { match.stop(); verdict.hide(); };
}
