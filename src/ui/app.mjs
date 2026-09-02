// 상태기계 1개 — 도장 / 수련 / 도전자 선택 · 사부 대련 / 전수 / 파견 예고 · 파견 / 결과.
// 화면 전환마다 `cycle{phase}` 를 남겨, 로그만으로 구간 예산과 실전 창을 분리 판독할 수 있다.

import { BALANCE } from '../balance.mjs';
import { createBot } from '../bot.mjs';
import { $, LEDGER_MS, ledgerMs } from './dom.mjs';
import { initAudio, resumeAudio } from './audio.mjs';
import { createFrameBudget } from './frame-budget.mjs';
import { SCREEN } from './theme.mjs';
import { mountCheatPanel } from './cheat.mjs';
import { createPad } from './pad.mjs';
import {
  createSession, enterPhase, exportPayload, flushScreenView, logEvent, logSessionMeta, setBotRunning,
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
/**
 * 프레임 예산 원장 (REQ-914·915) — 화면 하나 단위로 모으고 떠날 때 낸다. 화면을 섞으면
 * 「어느 화면이 비싼가」가 평균에 묻히므로 전이마다 비운다.
 */
const budget = createFrameBudget();
/** 그 화면의 무대·판정 노드 — 프레임마다 DOM 을 뒤지지 않도록 전이 때 한 번만 잡는다. */
let sceneNode = null;
let overlayNode = null;
let lastFrameAt = 0;
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
  // 화면을 떠나기 전에 낸다 — teardown 뒤에는 그 화면의 노드도 표본의 주인도 남지 않는다.
  if (nextPhase !== phase) flushFrameBudget();
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
  sceneNode = ctx.root.querySelector('.scene');
  overlayNode = ctx.root.querySelector('.verdict-overlay');
  announceScreen(nextPhase);
  releaseVerdictLive();
}

/**
 * 이 프레임이 무엇을 그리고 있었나 (REQ-915) — 측정 대상은 「흔들림 + 96px 글로우 + 스크림이
 * 겹치는 프레임」이라, 판정이 재생 중인 프레임을 다른 것과 섞지 않는 것이 이 구분의 전부다.
 */
function sceneOfFrame() {
  if (overlayNode?.classList.contains('on')) return 'verdict';
  if (sceneNode && !sceneNode.classList.contains('flat')) return 'parallax';
  return 'idle';
}

/** 떠나는 화면의 프레임 예산을 장면별로 낸다 — 표본이 모자란 장면은 말하지 않는다. */
function flushFrameBudget() {
  if (phase === null) return;
  for (const scene of budget.scenes()) {
    logEvent(session, 'frame_budget', {
      screen: SCREEN[phase].id,
      scene,
      p95_ms: Math.round(budget.p95(scene) * 10) / 10,
      dropped: budget.dropped(scene),
    });
  }
  budget.reset();
}

/**
 * 프레임 시계 (REQ-914·915) — 게임 루프와 별개로 도는 관측자다. 패럴랙스를 끄는 판정도 여기서
 * 하는 것은, 끌지 말지의 근거가 바로 이 표본이기 때문이다. 임계 50fps 는 실기 측정 전 잠정값이다.
 */
function watchFrames(at) {
  window.requestAnimationFrame(watchFrames);
  const delta = at - lastFrameAt;
  lastFrameAt = at;
  budget.sample(sceneOfFrame(), delta);
  if (!sceneNode) return;
  const fps = budget.fps('parallax');
  // 표본이 모자라면 켜 둔 채로 둔다 — 시작하자마자 끄면 무엇을 잰 것인지가 없다.
  // 한 번 끈 화면에서는 다시 켜지지 않는다: 끈 뒤의 프레임은 되켜도 되는지의 근거가 아니고,
  // 껐다 켰다 하는 무대가 느린 무대보다 나쁘다. 판정은 화면 전이에서 표본과 함께 다시 선다.
  if (fps !== null) sceneNode.classList.toggle('flat', fps < BALANCE.parallaxMinFps);
}

/** 직전에 낭독한 화면 — 도장은 조작마다 자기를 다시 그리므로, 그 재렌더는 전환이 아니다. */
let announcedScreen = null;

/**
 * 전환 낭독 (#102) — 판정 전용 `#live` 와 **분리한** 리전에 화면 이름을 한 번 싣는다.
 * 한 리전을 나눠 쓰면 같은 프레임에 겹친 두 낭독 중 뒤가 앞을 덮는다.
 */
function announceScreen(nextPhase) {
  if (announcedScreen === nextPhase) return;
  announcedScreen = nextPhase;
  $('nav-live').textContent = SCREEN[nextPhase].label;
}

/**
 * 판정 낭독의 잔류를 끊는다 (#101) — 비우는 시점이 다음 화면 렌더 **뒤 한 틱**인 것이 계약이다.
 * 렌더 전으로 당기면 대련 마지막 수의 판정이 결과 화면 전환에 잘린다. 그 한 틱 사이에 새 화면이
 * 자기 문면을 실었으면 그것은 남긴다 — 비우려던 것은 떠난 화면의 잔상뿐이다.
 */
function releaseVerdictLive() {
  const region = $('live');
  const leftover = region.textContent;
  if (!leftover) return;
  window.setTimeout(() => { if (region.textContent === leftover) region.textContent = ''; }, 0);
}

// 낭독 리전이 사라지면 판정이 에러 없이 침묵한다 — 그 마크업 계약을 부팅 때 터뜨린다 (REQ-807).
if (!$('live')) throw new Error('낭독 리전 #live 가 스테이지에 없다');
// 전환 낭독도 같은 실패 모드다 — 리전이 없으면 화면이 바뀐 사실이 비시각 사용자에게 침묵한다 (#102).
if (!$('nav-live')) throw new Error('전환 낭독 리전 #nav-live 가 스테이지에 없다');
// 셸이 없으면 흔들림이 스테이지로 올라가 완파·역파마다 배율이 날아간다 (REQ-816).
if (!$('shell')) throw new Error('흔들림 래퍼 #shell 이 스테이지에 없다');

// 히트 영역 최소치도 BALANCE 값이라, CSS 가 그 값을 변수로 받아 간다 (REQ-101).
document.documentElement.style.setProperty('--hit', `${BALANCE.buttonHitPx}px`);

// 형식 위반을 여기서 전건 터뜨려, 판정 오버레이·죽간 exit·전수 팔 각도가 각자 연출 도중에
// 죽는 경로를 없앤다 — 실패 시점이 첫 페인트 앞으로 고정된다 (#132).
for (const name of LEDGER_MS) ledgerMs(name);

// 두 원장이 만나는 유일한 결합 — 판정 재생 앞에서 히트스톱과 확정 연출 대기가 함께 예산을 먹고,
// 남는 것이 없으면 완파·역파가 에러 없이 화면에서 사라진다. 밸런스 쪽에서 재생 길이만 줄여도
// 깨지므로 부팅 때 문다 (REQ-815·826).
const preroll = ledgerMs('--juice-hitstop') + ledgerMs('--only-hold');
if (preroll >= BALANCE.resolveMs) {
  throw new Error(`판정 앞 대기 ${preroll}ms 가 판정 재생 ${BALANCE.resolveMs}ms 를 남기지 않는다`);
}

/** 로그 내보내기 (REQ-602) — 위반 목록을 함께 실어, 결손 로그가 조용히 판독에 쓰이지 않게 한다. */
function exportLog() {
  // 체류·프레임 예산은 둘 다 이탈에서 찍히므로, 그대로 내보내면 지금 보고 있는 화면이 통째로 빠진다.
  flushScreenView(session);
  flushFrameBudget();
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
// 재렌더를 도장으로 좁힌다 — `go()` 는 전이 계측이라 같은 화면을 다시 열면 `cycle` 이 겹쳐 찍힌다.
const refreshCheat = mountCheatPanel({
  session,
  refresh: () => { refreshTop(); if (phase === 'dojo') go('dojo'); },
});

// 도구 띠가 세로를 먹어 무대 배율이 1 밑으로 내려가므로, 목업 대조 스크린샷은 이 스위치로 1:1 을 되찾는다.
if (new URLSearchParams(window.location.search).get('tools') === '0') $('tools').hidden = true;

// 오디오는 컨텍스트를 정지 상태로 먼저 세우고 파일을 디코드해 둔다 — 첫 제스처가 오는 순간
// 이미 준비돼 있어야 「그 입력부터 소리가 난다」가 성립한다 (REQ-920·921).
initAudio({ log: (event, fields) => logEvent(session, event, fields), now: () => performance.now() });
// 자동재생 정책을 푸는 것은 제스처 하나뿐이라, 어느 입력이 첫 입력이든 같은 자리를 지난다 (REQ-921).
// 한 번만 거는 것이 아닌 이유는 첫 제스처가 거절될 수 있어서다 — 재개된 뒤로는 즉시 반환한다.
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, resumeAudio, { capture: true });
}

/**
 * 서체 로드 계측 (REQ-803) — 서브셋의 효과가 「로딩 비용이 주 변수」라는 진단의 검증이므로,
 * 실제로 받은 바이트와 그것이 서브셋 파일이었는지를 함께 남긴다.
 */
function declaredFaces() {
  let n = 0;
  for (const sheet of document.styleSheets) {
    // 확장이 끼워 넣은 시트는 교차 출처라 규칙 열람이 던진다 — 우리 시트를 세는 것이 목적이다.
    try {
      for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) n += 1;
    } catch { /* 열 수 없는 시트에는 우리 @font-face 가 없다 */ }
  }
  return n;
}

function logFontReady() {
  const woff2 = performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.woff2'));
  const declared = declaredFaces();
  logEvent(session, 'font_ready', {
    ms: Math.round(performance.now()),
    bytes: woff2.reduce((sum, e) => sum + (e.encodedBodySize || e.transferSize || 0), 0),
    // 선언한 면을 전부 받았는가 — 한 벌이라도 빠지면 그 범위가 폴백 산세리프로 그려진다.
    subset_hit: declared > 0 && woff2.length >= declared,
  });
}
// 계측이 던지면 서체 로드 체인이 unhandled 로 끝나고 이 항목만 조용히 사라진다.
const measureFonts = () => { try { logFontReady(); } catch (err) { console.warn(`[서체 계측] ${err.message}`); } };
document.fonts.ready.then(measureFonts, measureFonts);

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
lastFrameAt = performance.now();
window.requestAnimationFrame(watchFrames);
