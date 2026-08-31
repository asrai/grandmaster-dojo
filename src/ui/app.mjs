// 상태기계 1개 — 도장 / 수련 / 사부 대련 / 전수 / 도전자 예고 / 파견 / 결과.
// 화면 전환마다 `cycle{phase}` 를 남겨, 로그만으로 구간 예산과 실전 창을 분리 판독할 수 있다.

import { BALANCE } from '../balance.mjs';
import { $ } from './dom.mjs';
import { createPad } from './pad.mjs';
import { artRank, createSession, logEvent } from './session.mjs';
import { renderDojo } from './screens/dojo.mjs';
import { renderPreview, startDispatch } from './screens/dispatch.mjs';
import { startDuel } from './screens/duel.mjs';
import { renderResult } from './screens/result.mjs';
import { renderTransmit } from './screens/transmit.mjs';
import { startTrain } from './screens/train.mjs';

const ROUTES = {
  dojo: renderDojo,
  train: startTrain,
  duel: startDuel,
  preview: renderPreview,
  dispatch: startDispatch,
  transmit: renderTransmit,
  result: renderResult,
};

const session = createSession();
const ctx = {
  session,
  root: $('screen'),
  pad: createPad(),
  params: {},
  go,
  refreshTop,
};
let teardown = null;

function refreshTop() {
  $('label').textContent = session.label;
  $('rank').textContent = `유운검법 ${artRank(session)}성`;
  $('coins').textContent = `元 ${session.coins}`;
}

/** 화면 전환의 유일한 경로 — 이전 화면의 루프·리스너 회수가 여기 한 곳에 묶인다. */
function go(phase, params = {}) {
  if (teardown) teardown();
  teardown = null;
  const route = ROUTES[phase];
  if (!route) throw new Error(`알 수 없는 화면: ${phase}`);
  ctx.params = params;
  logEvent(session, 'cycle', { phase });
  teardown = route(ctx) ?? null;
  refreshTop();
}

// 히트 영역 최소치도 BALANCE 값이라, CSS 가 그 값을 변수로 받아 간다 (REQ-101).
document.documentElement.style.setProperty('--hit', `${BALANCE.buttonHitPx}px`);

$('a11y').addEventListener('change', (event) => {
  // 데이터 테이블은 시드로 두고 런타임 값은 세션이 갖는다 — 다음 창부터 반영된다.
  session.accessibility = event.target.checked;
});

// 유닛 3(로그 내보내기·봇 v2)이 세션에 붙는 자리.
window.__dojo = { session, go, BALANCE };

go('dojo');
