// 수련 모드 (REQ-308) — 상대도 판정도 없고, 실전과 같은 창 `T` 안에 완주하면 성공이다.

import { BALANCE } from '../../balance.mjs';
import { masteryPct, styleById } from '../../core.mjs';
import { arrowRow, attrMark, clear, el } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import { logEvent, masteryOf } from '../session.mjs';
import { trainWiring } from '../wiring.mjs';

export function startTrain(ctx) {
  const { session, root, params } = ctx;
  const style = styleById(params.styleId);
  let windowMs = 0;
  clear(root);

  const statusEl = el('div', { class: 'grade' });
  const progressEl = el('p', { class: 'dim' });
  const windowFill = el('i', {});

  root.append(el('section', { class: 'card arena' }, [
    el('div', { class: 'head' }, [
      el('b', { text: `수련 — ${style.name}` }),
      el('span', { class: 'hanja', text: style.hanja }),
      el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
    el('div', { class: 'telegraph', style: `--attr:${ATTR_VIEW[style.attr].color}` }, [
      el('div', { class: 'tg-foe' }, [attrMark(style.attr, { size: 'big' }), el('span', { text: style.gugyeol })]),
    ]),
    arrowRow(style.seq, 0, style.seq.length),
    statusEl,
    el('div', { class: 'window' }, [windowFill]),
    progressEl,
  ]));

  const input = createSequenceInput({
    pool: [style],
    masteryOf: (s) => masteryOf(session, s.id),
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
    const hits = Math.min(session.progress.styles[style.id].trainHits, BALANCE.trainGraduateHits);
    progressEl.textContent = `수련 성공 ${hits}/${BALANCE.trainGraduateHits}`
      + ` · 숙련 ${masteryPct(session.progress, style.id)}%`
      + (hits >= BALANCE.trainGraduateHits ? ' — 졸업, 실전 슬롯에 장착됐다' : '');
  };

  function arm() {
    settled = false;
    windowMs = wiring.onArm();
    startedAt = performance.now();
    ctx.pad.attach({
      input,
      masteryOf: (s) => masteryOf(session, s.id),
      accepting: () => !settled,
      onFire: (fired) => {
        if (settled) return;
        settled = true;
        SFX.fire();
        wiring.onFire();
        statusEl.textContent = '성공';
        statusEl.style.color = '#43c98a';
        showProgress();
        ctx.refreshTop();
        rearm = setTimeout(arm, BALANCE.resolveMs);
      },
    });
    statusEl.textContent = '';
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
    // 수련 실패는 무벌 재시도 — 로그는 실전 창의 완주율 분모와 섞이지 않게 남기지 않는다.
    statusEl.textContent = '창을 넘겼다 — 다시';
    statusEl.style.color = '#e08a4a';
    rearm = setTimeout(arm, BALANCE.resolveMs);
  }

  arm();
  raf = requestAnimationFrame(frame);
  // 재무장 타이머가 살아남으면 도장 화면 위에서 패드가 되살아나 수련 적립이 무한해진다.
  return () => { cancelAnimationFrame(raf); clearTimeout(rearm); ctx.pad.detach(); };
}
