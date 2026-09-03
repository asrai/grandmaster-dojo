// 수련 모드 (REQ-715·840~846) — 상대도 판정도 없고, 실전과 같은 창 `T` 안에 완주하면 성공이다.
// 화면은 S1 대련과 픽셀 단위로 같은 3단(띠 50 / 수련장 440 / 입력부 362)을 쓴다 — 전이를
// 만드는 것은 규칙의 동일함이 아니라 좌표의 동일함이다 (REQ-840). 무대만 아레나가 아닌
// 도장 안이라 정경을 여기서 짓고, 하단부는 대련과 같은 `pad.mjs` 를 그대로 꽂는다.

import { ARROW, ATTRS, BALANCE } from '../../balance.mjs';
import { foeStyleById, styleById, trainVisitSpan } from '../../core.mjs';
import { clear, composeScreen, el } from '../dom.mjs';
import { stageBand } from '../band.mjs';
import { attrMark } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { visitStair } from '../components/rank-stair.mjs';
import { SCREEN, TRAIN_DONE_VIEW, attrLabel } from '../theme.mjs';
import { CUE, play } from '../audio.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import { ART_NAME, logEvent, rankOfStyle, trainHitsLeft } from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { trainWiring } from '../wiring.mjs';

/**
 * 구결 족자 (REQ-841·842) — 딜레이드 힌트가 0 인 수련에서는 이 점등이 곧 힌트다 (REQ-712).
 * 화면에서 유일하게 밝은 면이라 색이 아니라 표면(C9 화선지)으로 서고, 상하 축과 주사 낙관이
 * 그것을 족자로 만든다.
 */
function gugyeolScroll(style) {
  const verses = style.gugyeol.map((verse, i) => el('div', { class: 'verse' }, [
    el('i', { class: 'verse-dir', text: ARROW[style.seq[i]] }),
    el('span', { text: verse }),
  ]));
  // 낙관은 두 자다 — 초식 한자의 앞 두 자를 새긴다.
  const stamp = el('span', { class: 'stamp' }, [hanja(style.hanja.slice(0, 2), { stacked: true })]);
  const list = el('div', { class: 'verse-list' }, verses);
  const node = el('div', { class: 'scroll' }, [
    el('div', { class: 'rod', 'aria-hidden': 'true' }),
    // 낙관은 움직이는 목록이 아니라 창에 붙는다 — 족자에 찍힌 도장은 글이 흘러도 제자리다.
    el('div', { class: 'silk' }, [el('div', { class: 'verse-win' }, [list]), stamp]),
    el('div', { class: 'rod', 'aria-hidden': 'true' }),
  ]);
  let lit = -1;
  /** @param {number} done 이미 친 키 수 */
  const light = (done) => {
    if (lit === done) return;
    lit = done;
    // 둘째 줄이 지금 칠 구절이므로 목록은 `done - 1` 줄만큼 올라간다 — 아직 아무것도 안 쳤으면
    // 한 줄 내려가 첫 줄이 비고, 완주하면 마지막 구절이 첫 줄에 점등된 채 남는다.
    list.style.setProperty('--verse-shift', String(1 - done));
    verses.forEach((verse, i) => verse.classList.toggle('lit', i === done - 1));
  };
  // 화면에 붙기 전에 시작 상태를 세운다 — 붙은 뒤 세우면 진입하자마자 전이가 한 번 돈다.
  light(0);
  return { node, light };
}

/**
 * 초식 해설 3줄 (REQ-844) — 파해 1:1 대응(REQ-731)이 그동안 비급 구결 텍스트에만 있었고,
 * 수련은 그 초식만 보는 유일한 화면이라 해설의 제자리다. 죽간이 1매뿐이라 비는 그 옆에 선다.
 */
function styleDetail(style) {
  const answer = foeStyleById(style.counters);
  const line = (key, children, mod = '') => el('div', { class: 'ln' }, [
    el('span', { class: 'k', text: key }),
    el('span', { class: `v ${mod}`.trim() }, children),
  ]);
  return el('div', { class: 'detail' }, [
    line('창안', [
      el('b', { text: style.founder.name }),
      hanja(style.founder.hanja),
      el('span', { class: 'sub', text: ` · ${ART_NAME} 제${style.order}초식` }),
    ], 'wrap'),
    line('특성', [
      attrMark(style.attr, { silent: true }),
      el('b', { text: attrLabel(style.attr) }),
      el('span', { class: 'sub', text: ` · ${style.seq.length}수 · ${attrLabel(ATTRS[style.attr].beats)}에 우세` }),
    ]),
    line('파해', [
      attrMark(answer.attr),
      el('b', { class: 'brk', text: answer.name }),
      hanja(answer.hanja),
    ]),
  ]);
}

export function startTrain(ctx) {
  const { session, params } = ctx;
  const style = styleById(params.styleId);
  let windowMs = 1;

  const verdict = createVerdictOverlay();
  const scroll = gugyeolScroll(style);
  const progressEl = el('div', { class: 'progress' });
  const windowFill = el('i', {});

  composeScreen(ctx, {
    top: stageBand({
      onLeave: () => ctx.go('dojo'), cap: '수련', name: style.name, hanja: style.hanja,
    }),
    body: el('div', { class: 'hall' }, [
      el('div', { class: 'layer floor' }),
      el('div', { class: 'layer mist' }),
      // 역광이 없으면 먹 실루엣이 어두운 배경에서 사라진다 — 사람과 한 쌍으로만 존재한다 (REQ-821).
      el('div', { class: 'backlight', 'aria-hidden': 'true' }),
      el('div', { class: 'fig sil_master_stance', 'aria-hidden': 'true' }),
      el('div', { class: 'layer vignette' }),
      el('div', { class: 'ground', 'aria-hidden': 'true' }),
      scroll.node,
      progressEl,
      el('div', { class: 'gauge' }, [windowFill]),
      // 시각 오버레이는 무대 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
      verdict.node,
    ]),
    bottom: ctx.pad.node,
    // 무대는 풀블리드 레이어라 여백이 붙으면 3단 고정이 어긋난다 (REQ-802·820·840).
    padded: false,
  });

  const input = createSequenceInput({
    pool: [style],
    rankOf: (s) => rankOfStyle(session, s.id),
    // 수련은 힌트가 즉시라, 창은 실전과 같아도 완주가 손의 속도만으로 결정된다.
    hintDelayMs: BALANCE.hintDelayMs.train,
    now: () => performance.now(),
    remainingRatio: () => Math.max(0, 1 - (performance.now() - startedAt) / windowMs),
    log: (event, fields) => logEvent(session, event, fields),
    screen: SCREEN.train.id,
  });

  const wiring = trainWiring(session, { styleId: params.styleId, input });
  const detail = styleDetail(style);

  let startedAt = 0;
  let settled = false;
  let raf = 0;
  let rearm = 0;

  const showProgress = () => {
    const span = trainVisitSpan(session.progress.styles[style.id]);
    const left = trainHitsLeft(session, style.id);
    clear(progressEl);
    // 8성 벽은 「덜 했다」가 아니라 「여기서부터는 실전」이라, 계단 자리에 그 사유가 선다 (REQ-706).
    if (span) progressEl.appendChild(visitStair(span));
    progressEl.appendChild(el('span', { class: 'cap' }, left === null
      ? [el('span', { text: '수련으로는 여기까지, 실전으로 민다' })]
      : [
        el('span', { text: '다음 ' }),
        el('b', { text: `${rankOfStyle(session, style.id) + 1}성` }),
        el('span', { text: `까지 ${left}회` }),
      ]));
  };

  function arm() {
    settled = false;
    windowMs = wiring.onArm();
    startedAt = performance.now();
    ctx.pad.attach({
      input,
      rankOf: (s) => rankOfStyle(session, s.id),
      accepting: () => !settled,
      // 수련에는 후보 필터가 없어 죽간이 1매뿐이므로, 비는 그 옆이 해설의 자리다 (REQ-843·844).
      aside: detail,
      onFire: () => {
        if (settled) return;
        settled = true;
        play(CUE.FIRE);
        // 수련 적립이 성을 올리는 초에도 상승음이 난다 — 발화 조건은 화면이 아니라 「성이 오른다」다 (REQ-925).
        if (wiring.onFire()?.rank) play(CUE.RANK_UP);
        // 마지막 구절은 프레임 루프가 아니라 여기서 켠다 — 완주가 루프를 세우므로 그 한 구절만
        // 영영 흐린 채로 성공 화면이 뜬다 (REQ-841).
        scroll.light(style.seq.length);
        verdict.show(TRAIN_DONE_VIEW);
        showProgress();
        rearm = setTimeout(arm, BALANCE.resolveMs);
      },
    });
    verdict.hide();
    scroll.light(0);
    showProgress();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (settled) return;
    const left = Math.max(0, 1 - (performance.now() - startedAt) / windowMs);
    windowFill.style.width = `${left * 100}%`;
    scroll.light(input.buffer.length);
    ctx.pad.render();
    if (left > 0) return;
    settled = true;
    // 실패에 시각 표시를 두지 않는 규칙(REQ-846)은 「관측되지 않는다」가 아니다 — 채널이
    // 시각이 아닐 뿐이라, 실패는 낭독으로만 나간다 (#51).
    verdict.announce('수련 실패 — 창이 다시 열린다');
    rearm = setTimeout(arm, BALANCE.resolveMs);
  }

  arm();
  raf = requestAnimationFrame(frame);
  // 재무장 타이머가 살아남으면 도장 화면 위에서 패드가 되살아나 수련 적립이 무한해진다.
  return () => { cancelAnimationFrame(raf); clearTimeout(rearm); verdict.hide(); };
}
