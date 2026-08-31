// 도전자 예고 화면 + 파견 관전 (REQ-403~407·504). 2막의 본체는 손을 놓고 보는 것이라,
// 유저의 유일한 개입 수단은 그 수 한정의 지시 탭이다.

import { BALANCE } from '../../balance.mjs';
import {
  discipleRankOf, discipleStyles, finisherOf, isEffectiveSuccess, selectDiscipleStyle,
} from '../../core.mjs';
import { attrMark, clear, el, hpBar } from '../dom.mjs';
import { ATTR_VIEW, GRADE_VIEW, attrLabel, gradeLabel, winAttrOf } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { createMatch } from '../match.mjs';
import { ART_ID, DISPATCH_CHALLENGER, accrueDiscipleRank, logEvent } from '../session.mjs';

const styleIcon = (style, extra = '') => el('div', {
  class: `cand${extra ? ` ${extra}` : ''}`, style: `--attr:${ATTR_VIEW[style.attr].color}`,
}, [attrMark(style.attr), el('span', { class: 'cand-name', text: style.name })]);

export function renderPreview(ctx) {
  const { session, root } = ctx;
  const challenger = DISPATCH_CHALLENGER;
  const finisher = finisherOf(challenger);
  const styles = discipleStyles(session.disciple, ART_ID);
  ctx.pad.detach();
  clear(root);

  root.append(el('section', { class: 'card' }, [
    el('h2', { text: `도전자 예고 — ${challenger.name} ${challenger.hanja}` }),
    el('p', { class: 'dim', text: '문파가 절초 하나를 미리 드러냈다. 제자의 세팅을 확인하고 내보내라.' }),
    el('div', { class: 'icons' }, [styleIcon(finisher, 'big-icon')]),
    el('p', {}, [
      el('b', { text: `절초 ${finisher.name} ${finisher.hanja}` }),
      el('span', { class: 'dim', text: ` · ${attrLabel(finisher.attr)} · ${finisher.len}수 · 이기는 색 ${attrLabel(winAttrOf(finisher.attr))}` }),
    ]),
    el('h2', { text: `제자 — 유운검법 ${discipleRankOf(session.disciple, ART_ID)}성` }),
    el('div', { class: 'icons' }, styles.map((s) => styleIcon(s))),
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '파견 보내기', onclick: () => ctx.go('dispatch') }),
      el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ]));
}

export function startDispatch(ctx) {
  const { session, root } = ctx;
  const challenger = DISPATCH_CHALLENGER;
  const styles = discipleStyles(session.disciple, ART_ID);
  const rankFrom = discipleRankOf(session.disciple, ART_ID);
  ctx.pad.detach();
  clear(root);

  const foeHpEl = el('div', {});
  const selfHpEl = el('div', {});
  const telegraphEl = el('div', { class: 'tg-slot' });
  const verdictEl = el('div', { class: 'verdict' });
  const iconsEl = el('div', { class: 'icons' });
  const windowFill = el('i', {});

  root.append(el('section', { class: 'card arena' }, [
    el('div', { class: 'head' }, [
      el('b', { text: challenger.name }),
      el('span', { class: 'hanja', text: challenger.hanja }),
      el('span', { class: 'dim', text: '관전 — 지시는 선택이다' }),
    ]),
    foeHpEl,
    telegraphEl,
    verdictEl,
    el('div', { class: 'window' }, [windowFill]),
    el('div', { class: 'head' }, [el('b', { text: '제자' }), el('span', { class: 'dim', text: `유운검법 ${rankFrom}성` })]),
    selfHpEl,
    iconsEl,
  ]));

  let instructed = null;
  let fired = false;

  function renderIcons(view) {
    // 그 수 예고의 파해를 제자가 보유하면 한 번 반짝여 지시를 유도한다 (강제 아님).
    const hintId = view.telegraphed
      ? styles.find((s) => s.counters === view.telegraphed.id)?.id ?? null
      : null;
    clear(iconsEl);
    for (const style of styles) {
      const icon = styleIcon(style, [
        style === instructed ? 'picked' : '',
        style.id === hintId ? 'flash' : '',
      ].filter(Boolean).join(' '));
      icon.addEventListener('click', () => {
        if (fired) return;
        instructed = style;
        renderIcons(view);
      });
      iconsEl.appendChild(icon);
    }
  }

  const renderHp = (view) => {
    clear(foeHpEl).appendChild(hpBar(view.foeHp, view.foeHpMax));
    clear(selfHpEl).appendChild(hpBar(view.selfHp, view.selfHpMax));
  };

  const match = createMatch({
    challenger,
    selfHpMax: BALANCE.hp.disciple,
    rankOf: () => discipleRankOf(session.disciple, ART_ID),
    openLen: Math.max(...styles.map((s) => s.seq.length)),
    hooks: {
      onTelegraph(view) {
        instructed = null;
        fired = false;
        clear(verdictEl);
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
        renderIcons(view);
      },
      onTick(view) {
        windowFill.style.width = `${view.ratio * 100}%`;
        if (fired || view.ratio > 1 - BALANCE.discipleFireRatio) return;
        fired = true;
        const style = instructed ?? selectDiscipleStyle({
          styles,
          foeStyle: view.telegraphed,
          rankOf: () => discipleRankOf(session.disciple, ART_ID),
        });
        logEvent(session, 'select', { styleId: style.id, byUser: Boolean(instructed) });
        // 제자는 창의 60% 시점에 반드시 실행하므로 선기 잔여는 상수다 (하네스 시뮬과 같은 값).
        match.fire({ style, oneTap: false, r: 1 - BALANCE.discipleFireRatio });
      },
      onVerdict(view) {
        logEvent(session, 'verdict', {
          grade: view.verdict.grade,
          dmg_out: view.verdict.dmgOut,
          dmg_in: view.verdict.dmgIn,
          state: view.verdict.opening,
          who: 'disciple',
        });
        renderHp(view);
        const gv = GRADE_VIEW[view.verdict.grade];
        clear(verdictEl).appendChild(el('div', {
          class: 'grade', style: `color:${gv.color}`,
          text: `${gv.mark} ${gradeLabel(view.verdict.grade)}`,
        }));
        (view.verdict.grade === 'crush' ? SFX.crush : SFX.hit)();
        if (view.fire && isEffectiveSuccess(view.verdict.grade)) {
          if (accrueDiscipleRank(session, view.fire.style.id)) SFX.rank();
        }
      },
      onEnd(view) {
        ctx.go('result', {
          kind: 'dispatch',
          win: view.outcome.win,
          rankFrom,
          rankTo: discipleRankOf(session.disciple, ART_ID),
          view,
        });
      },
    },
  });

  logEvent(session, 'dispatch', { challenger: challenger.id });
  match.start();
  return () => match.stop();
}
