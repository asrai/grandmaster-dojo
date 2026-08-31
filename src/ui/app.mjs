// 상태기계 1개 — 도장 / 수련 / 사부 대련 / 전수 / 도전자 예고 / 파견 / 결과.
// 화면 전환마다 `cycle{phase}` 를 남겨, 로그만으로 구간 예산과 실전 창을 분리 판독할 수 있다.

import { BALANCE } from '../balance.mjs';
import { createBot } from '../bot.mjs';
import { $ } from './dom.mjs';
import { createPad } from './pad.mjs';
import { ART_NAME, artRank, createSession, exportPayload, logEvent, logSessionMeta } from './session.mjs';
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

// 손가락 입력 기기와 키보드는 `ignore_rate` 가 다른 모집단이라 세션 메타에 그대로 실린다 (REQ-603).
const DEVICE = window.matchMedia?.('(pointer: coarse)').matches ? 'button' : 'keyboard';

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
let phase = null;

function refreshTop() {
  $('label').textContent = session.label;
  $('rank').textContent = `${ART_NAME} ${artRank(session)}성`;
  $('coins').textContent = `元 ${session.coins}`;
}

/** 화면 전환의 유일한 경로 — 이전 화면의 루프·리스너 회수가 여기 한 곳에 묶인다. */
function go(nextPhase, params = {}) {
  if (teardown) teardown();
  teardown = null;
  const route = ROUTES[nextPhase];
  if (!route) throw new Error(`알 수 없는 화면: ${nextPhase}`);
  ctx.params = params;
  phase = nextPhase;
  logEvent(session, 'cycle', { phase });
  teardown = route(ctx) ?? null;
  refreshTop();
}

// 히트 영역 최소치도 BALANCE 값이라, CSS 가 그 값을 변수로 받아 간다 (REQ-101).
document.documentElement.style.setProperty('--hit', `${BALANCE.buttonHitPx}px`);

$('a11y').checked = session.accessibility;
$('a11y').addEventListener('change', (event) => {
  // 데이터 테이블은 시드로 두고 런타임 값은 세션이 갖는다 — 다음 창부터 반영된다.
  session.accessibility = event.target.checked;
});

/** 로그 내보내기 (REQ-602) — 위반 목록을 함께 실어, 결손 로그가 조용히 판독에 쓰이지 않게 한다. */
function exportLog() {
  const payload = exportPayload(session);
  if (payload.log_violations.length) {
    window.alert(`로그 스키마 위반 ${payload.log_violations.length}건이 함께 실린다`
      + ' — 판독기가 이 파일을 거부한다.');
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `dojo-log-${payload.exported_at.replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

const bot = createBot({
  session,
  screen: { phase: () => phase, params: () => ctx.params, go, refresh: refreshTop },
  peek: () => ctx.pad.bot.peek(),
  press: (dir) => ctx.pad.bot.press(dir, DEVICE),
  reset: () => ctx.pad.bot.reset(),
  clock: {
    now: () => performance.now(),
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (id) => window.clearTimeout(id),
  },
  device: DEVICE,
  onDone: () => paintBotButton(),
});

function paintBotButton() {
  $('botBtn').textContent = bot.running ? '봇 정지' : '봇 v2 실행';
  $('botBtn').classList.toggle('urge', bot.running);
}

$('exportBtn').addEventListener('click', exportLog);
$('botBtn').addEventListener('click', () => {
  if (bot.running) bot.stop();
  else bot.start();
  paintBotButton();
});
paintBotButton();

// 콘솔에서 세션을 들여다보는 자리 — 봇·내보내기는 화면 버튼이 정본이다.
window.__dojo = { session, go, BALANCE, bot, exportLog };

logSessionMeta(session, { testerRole: 'self', device: DEVICE });
go('dojo');
