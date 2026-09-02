// 도전자 예고 화면 + 파견 관전 (REQ-403~407·504). 2막의 본체는 손을 놓고 보는 것이라,
// 유저의 유일한 개입 수단은 그 수 한정의 지시 탭이다.

import { BALANCE } from '../../balance.mjs';
import { createDiscipleHand } from '../../bot.mjs';
import { discipleStyleRank, discipleStyles, finisherOf, foeStyleById } from '../../core.mjs';
import { attrMark, clear, composeScreen, el, hpBar, topBand } from '../dom.mjs';
import { ATTR_VIEW, attrLabel, winAttrOf } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { createMatch } from '../match.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, canDispatch, currentMission,
  missionLockRankOf, missionShortfallOf,
} from '../session.mjs';
import { createTablets } from '../tablets.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, dispatchWiring, logDispatchResult } from '../wiring.mjs';

const styleIcon = (style, extra = '', rankTag = null) => el('div', {
  class: `cand${extra ? ` ${extra}` : ''}`, style: `--attr:${ATTR_VIEW[style.attr].color}`,
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
      el('b', { text: `절초 ${finisher.name} ${finisher.hanja}` }),
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
  const stageLabel = `B-${session.dispatchStage}`;

  const top = topBand(session, ART_NAME);
  ctx.ownTop(top.paint);
  composeScreen(root, { top: top.node, body: el('section', { class: 'card' }, [
    el('h2', { text: `임무 ${stageLabel} — ${challenger.name} ${challenger.hanja}` }),
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
      el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ].filter(Boolean)) });
}

export function startDispatch(ctx) {
  const { session, root } = ctx;
  // 자격은 진입 함수가 진다 — 버튼 비활성은 표현일 뿐이라 그것만으로는 우회 경로가 닫히지 않는다 (REQ-743).
  if (!canDispatch(session)) return renderPreview(ctx);
  const mission = currentMission(session);
  const challenger = mission.challenger;
  const styles = discipleStyles(session.disciple, ART_ID);

  const verdict = createVerdictOverlay();
  // 관전 화면에는 십자 키패드가 없다 — 죽간만 따로 장착하는 경로다 (REQ-805·851).
  const tablets = createTablets();
  const foeHpEl = el('div', {});
  const selfHpEl = el('div', {});
  const telegraphEl = el('div', { class: 'tg-slot' });
  const windowFill = el('i', {});

  const top = topBand(session, ART_NAME);
  ctx.ownTop(top.paint);
  composeScreen(root, {
    top: top.node,
    body: el('section', { class: 'card arena' }, [
      el('div', { class: 'head' }, [
        el('b', { text: challenger.name }),
        el('span', { class: 'hanja', text: challenger.hanja }),
        el('span', { class: 'dim', text: '관전 — 지시는 선택이다' }),
      ]),
      foeHpEl,
      telegraphEl,
      el('div', { class: 'arena-gap' }),
      el('div', { class: 'window' }, [windowFill]),
      el('div', { class: 'head' }, [el('b', { text: '제자' }), el('span', { class: 'dim', text: ART_NAME })]),
      selfHpEl,
      tablets.node,
      // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
      verdict.node,
    ]),
  });

  let instructed = null;
  let fired = false;
  const disciple = createDiscipleHand({ session, styles, fire: (shot) => match.fire(shot) });

  function renderTablets(view, { flash = false } = {}) {
    // 그 수 예고의 파해를 제자가 보유하면 한 번 반짝여 지시를 유도한다 (강제 아님).
    const hintId = view.telegraphed
      ? styles.find((s) => s.counters === view.telegraphed.id)?.id ?? null
      : null;
    tablets.render(styles.map((style) => ({
      style,
      mods: [
        style === instructed ? 'picked' : '',
        flash && style.id === hintId ? 'flash' : '',
      ].filter(Boolean).join(' '),
      // 지시 여부를 외곽선 색만으로 두면 색각 이상에서 구분되지 않는다.
      tags: style === instructed ? ['지시'] : [],
      onTap: () => {
        if (fired) return;
        instructed = style;
        renderTablets(view);
      },
    })));
  }

  const renderHp = (view) => {
    clear(foeHpEl).appendChild(hpBar(view.foeHp, view.foeHpMax));
    clear(selfHpEl).appendChild(hpBar(view.selfHp, view.selfHpMax));
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
        verdict.hide();
        windowFill.style.width = '100%';
        clear(telegraphEl).appendChild(view.foeOpen
          ? el('div', { class: 'telegraph open', text: '빈틈! — 제자가 연환을 잇는다' })
          : el('div', { class: 'telegraph', style: `--attr:${ATTR_VIEW[view.telegraphed.attr].color}` }, [
            el('div', { class: 'tg-foe' }, [
              attrMark(view.telegraphed.attr, { size: 'big' }),
              el('b', { text: view.telegraphed.name }),
              el('span', { class: 'dim', text: `${attrLabel(view.telegraphed.attr)} · ${view.telegraphed.len}수` }),
            ]),
            el('div', { class: 'tg-win', style: `--attr:${ATTR_VIEW[winAttrOf(view.telegraphed.attr)].color}` }, [
              el('span', { class: 'dim', text: '이기는 색' }),
              attrMark(winAttrOf(view.telegraphed.attr), { size: 'big' }),
            ]),
          ]));
        renderHp(view);
        // 반짝임은 그 수의 예고에서 한 번뿐 — 지시 탭으로 다시 그릴 때는 재생하지 않는다.
        renderTablets(view, { flash: true });
      },
      onTick(view, executed) {
        windowFill.style.width = `${view.ratio * 100}%`;
        if (executed) fired = true;
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
