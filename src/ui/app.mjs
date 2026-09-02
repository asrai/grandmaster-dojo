// 상태기계 1개 — 도장 / 수련 / 도전자 선택 · 사부 대련 / 전수 / 파견 예고 · 파견 / 결과.
// 화면 전환마다 `cycle{phase}` 를 남겨, 로그만으로 구간 예산과 실전 창을 분리 판독할 수 있다.

import { BALANCE } from '../balance.mjs';
import { createBot } from '../bot.mjs';
import { $ } from './dom.mjs';
import { mountCheatPanel } from './cheat.mjs';
import { createPad } from './pad.mjs';
import {
  createSession, enterPhase, exportPayload, logSessionMeta, setBotRunning,
} from './session.mjs';
import { renderDojo } from './screens/dojo.mjs';
import { renderPreview, startDispatch } from './screens/dispatch.mjs';
import { startDuel } from './screens/duel.mjs';
import { renderSelect } from './screens/select.mjs';
import { renderResult } from './screens/result.mjs';
import { renderTransmit } from './screens/transmit.mjs';
import { startTrain } from './screens/train.mjs';

const ROUTES = {
  dojo: renderDojo,
  train: startTrain,
  select: renderSelect,
  duel: startDuel,
  preview: renderPreview,
  dispatch: startDispatch,
  transmit: renderTransmit,
  result: renderResult,
};

// 손가락 입력 기기와 키보드는 `ignore_rate` 가 다른 모집단이라 세션 메타에 그대로 실린다 (REQ-603).
const DEVICE = window.matchMedia?.('(pointer: coarse)')?.matches ? 'button' : 'keyboard';

// `t_ms` 는 kill (a)·(d) 의 경과 시간이라 게임 루프와 같은 단조 시계를 써야 한다 (REQ-603).
const session = createSession({ now: () => performance.now() });
const ctx = {
  session,
  root: $('app'),
  pad: createPad(),
  params: {},
  go,
  ownTop,
  refreshTop,
};
let teardown = null;
let phase = null;
// 상단 띠의 주인이 화면이라 갱신 주체도 그 화면이다 — 띠가 없는 화면에서는 갱신할 것도 없다 (REQ-801).
let paintTop = () => {};

/** 상단 띠를 그린 화면이 그 다시 그리는 함수를 등록하는 자리. */
function ownTop(paint) {
  paintTop = paint;
}

function refreshTop() {
  paintTop();
}

/** 화면 전환의 유일한 경로 — 이전 화면의 루프·리스너·입력 회수가 여기 한 곳에 묶인다. */
function go(nextPhase, params = {}) {
  if (teardown) teardown();
  teardown = null;
  paintTop = () => {};
  // 패드 소비자를 라우트가 각자 끊으면 한 화면이 빠뜨리는 순간 키보드가 죽은 화면으로 흘러든다.
  ctx.pad.detach();
  const route = ROUTES[nextPhase];
  if (!route) throw new Error(`알 수 없는 화면: ${nextPhase}`);
  ctx.params = params;
  phase = nextPhase;
  enterPhase(session, phase);
  teardown = route(ctx) ?? null;
}

// 낭독 리전이 사라지면 판정이 에러 없이 침묵한다 — 그 마크업 계약을 부팅 때 터뜨린다 (REQ-807).
if (!$('live')) throw new Error('낭독 리전 #live 가 스테이지에 없다');
// 셸이 없으면 흔들림이 스테이지로 올라가 완파·역파마다 배율이 날아간다 (REQ-816).
if (!$('shell')) throw new Error('흔들림 래퍼 #shell 이 스테이지에 없다');

// 히트 영역 최소치도 BALANCE 값이라, CSS 가 그 값을 변수로 받아 간다 (REQ-101).
document.documentElement.style.setProperty('--hit', `${BALANCE.buttonHitPx}px`);

/** 원장의 연출 시간 하나 — 값을 못 읽으면 아래 예산 검사가 0 으로 통과하므로 형식부터 문다. */
function ledgerMs(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!/^\d+(\.\d+)?ms$/.test(raw)) throw new Error(`${name} 이 ms 값이 아니다 — ${raw || '<미정의>'}`);
  return parseFloat(raw);
}

// 두 원장이 만나는 유일한 결합 — 판정 재생 앞에서 히트스톱과 확정 연출 대기가 함께 예산을 먹고,
// 남는 것이 없으면 완파·역파가 에러 없이 화면에서 사라진다. 밸런스 쪽에서 재생 길이만 줄여도
// 깨지므로 부팅 때 문다 (REQ-815·826).
const preroll = ledgerMs('--juice-hitstop') + ledgerMs('--only-hold');
if (preroll >= BALANCE.resolveMs) {
  throw new Error(`판정 앞 대기 ${preroll}ms 가 판정 재생 ${BALANCE.resolveMs}ms 를 남기지 않는다`);
}

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
  // 문서에 붙지 않은 링크는 일부 브라우저에서 클릭이 무시되고, 동기 revoke 는 내려받기 시작 전에 URL 을 끊는다.
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  onDone: () => { setBotRunning(session, false); refreshCheat(); paintBotButton(); },
});

function paintBotButton() {
  // 봇이 도는 동안 사람 입력이 섞이면 그 표본이 어느 손의 것인지 로그로 가를 수 없다.
  ctx.pad.bot.own(bot.running);
  $('botBtn').textContent = bot.running ? '봇 정지' : '봇 v2 실행';
  $('botBtn').setAttribute('aria-pressed', String(bot.running));
  $('botBtn').classList.toggle('urge', bot.running);
}

// 치트 패널은 게임 화면 밖의 도구 영역에 산다 — 기본 숨김이고 명시 토글만이 그것을 연다 (REQ-781).
// 재렌더를 도장으로 좁힌다 — 결과·전수 화면의 렌더는 정산·전수를 함께 실행해 비멱등이다.
const refreshCheat = mountCheatPanel({
  session,
  refresh: () => { refreshTop(); if (phase === 'dojo') go('dojo'); },
});

// 도구 띠가 세로를 먹어 무대 배율이 1 밑으로 내려가므로, 목업 대조 스크린샷은 이 스위치로 1:1 을 되찾는다.
if (new URLSearchParams(window.location.search).get('tools') === '0') $('tools').hidden = true;

$('exportBtn').addEventListener('click', exportLog);
$('botBtn').addEventListener('click', () => {
  if (bot.running) bot.stop();
  else bot.start();
  // 봇 페이스 표본에 주입이 섞이지 않게 구동 상태를 세션에 알린다 (REQ-783).
  setBotRunning(session, bot.running);
  refreshCheat();
  paintBotButton();
});
paintBotButton();

// 콘솔에서 세션을 들여다보는 자리 — 봇·내보내기는 화면 버튼이 정본이다.
window.__dojo = { session, go, BALANCE, bot, exportLog };

logSessionMeta(session, { testerRole: 'self', device: DEVICE });
go('dojo');
