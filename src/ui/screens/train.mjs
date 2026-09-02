// 수련 모드 (REQ-715) — 상대도 판정도 없고, 실전과 같은 창 `T` 안에 완주하면 성공이다.

import { BALANCE } from '../../balance.mjs';
import { styleById } from '../../core.mjs';
import { arrowRow, attrMark, composeScreen, el, topBand } from '../dom.mjs';
import { ATTR_VIEW, GRADE_VIEW } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import { ART_NAME, logEvent, rankOfStyle, trainHitsLeft } from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { trainWiring } from '../wiring.mjs';

// 수련에는 등급이 없다 — 등급 마크를 빌리면 성공이 「우세 판정」으로 오학습되므로 색만 빌린다 (#46).
const TRAIN_VIEW = {
  done: { color: GRADE_VIEW.advantage.color, label: '성공' },
};

export function startTrain(ctx) {
  const { session, root, params } = ctx;
  const style = styleById(params.styleId);
  let windowMs = 1;

  const verdict = createVerdictOverlay();
  const progressEl = el('p', { class: 'dim' });
  const windowFill = el('i', {});

  composeScreen(ctx, {
    top: topBand(session, ART_NAME),
    body: el('section', { class: 'card arena' }, [
      el('div', { class: 'head' }, [
        el('b', { text: `수련 — ${style.name}` }),
        el('span', { class: 'hanja', text: style.hanja }),
        el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
      ]),
      el('div', { class: 'telegraph', style: `--attr:${ATTR_VIEW[style.attr].color}` }, [
        el('div', { class: 'tg-foe' }, [attrMark(style.attr, { size: 'big' }), el('span', { text: style.gugyeol })]),
      ]),
      arrowRow(style.seq, 0, style.seq.length),
      el('div', { class: 'window' }, [windowFill]),
      progressEl,
      // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
      verdict.node,
    ]),
    bottom: ctx.pad.node,
  });

  const input = createSequenceInput({
    pool: [style],
    rankOf: (s) => rankOfStyle(session, s.id),
    // 수련은 힌트가 즉시라, 창은 실전과 같아도 완주가 손의 속도만으로 결정된다.
    hintDelayMs: BALANCE.hintDelayMs.train,
    now: () => performance.now(),
    remainingRatio: () => Math.max(0, 1 - (performance.now() - startedAt) / windowMs),
    log: (event, fields) => logEvent(session, event, fields),
  });

  const wiring = trainWiring(session, { styleId: params.styleId, input });

  let startedAt = 0;
  let settled = false;
  let raf = 0;
  let rearm = 0;

  const showProgress = () => {
    const left = trainHitsLeft(session, style.id);
    progressEl.textContent = `수련 성공 ${session.trainVisit.hits}`
      + ` · ${rankOfStyle(session, style.id)}성`
      // 8성 벽은 「덜 했다」가 아니라 「여기서부터는 실전」이라, 남은 횟수 자리에 그 사유가 선다 (REQ-706).
      + (left === null ? ' — 수련으로는 여기까지, 실전으로 민다' : ` · 다음 성까지 ${left}회`);
  };

  function arm() {
    settled = false;
    windowMs = wiring.onArm();
    startedAt = performance.now();
    ctx.pad.attach({
      input,
      rankOf: (s) => rankOfStyle(session, s.id),
      accepting: () => !settled,
      onFire: (fired) => {
        if (settled) return;
        settled = true;
        SFX.fire();
        wiring.onFire();
        verdict.show(TRAIN_VIEW.done);
        showProgress();
        ctx.refreshTop();
        rearm = setTimeout(arm, BALANCE.resolveMs);
      },
    });
    verdict.hide();
    showProgress();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (settled) return;
    const left = Math.max(0, 1 - (performance.now() - startedAt) / windowMs);
    windowFill.style.width = `${left * 100}%`;
    ctx.pad.render();
    if (left > 0) return;
    settled = true;
    // 수련 실패는 무벌 재시도 — 판정도 로그도 남기지 않고, 창 게이지가 되차오르는 것이 유일한 신호다 (#46).
    rearm = setTimeout(arm, BALANCE.resolveMs);
  }

  arm();
  raf = requestAnimationFrame(frame);
  // 재무장 타이머가 살아남으면 도장 화면 위에서 패드가 되살아나 수련 적립이 무한해진다.
  return () => { cancelAnimationFrame(raf); clearTimeout(rearm); verdict.hide(); };
}
