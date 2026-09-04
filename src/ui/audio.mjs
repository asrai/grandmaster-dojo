// 오디오 (REQ-920~926) — 재생을 소유하는 유일한 모듈이다. `src/` 루트의 DOM-free 계약을 지키려면
// 재생이 이 층에 있어야 하고, 어떤 사건에 어떤 소리가 붙는지의 **매핑만** 데이터로 간다
// (`BALANCE.audio`). 실파일 경로는 그 표 밖이다 — id 가 곧 파일 이름의 줄기라 아래 `srcOf` 가
// 그 하나에서 파생하므로, 표와 파일 이름이 서로 어긋날 자리가 없다.
//
// 문서·오디오 컨텍스트는 전부 함수 안에서만 닿는다 — 모듈 최상위가 DOM-free 라야 하네스가
// 아래 cue 계약을 화면 없이 검사할 수 있고, 그 검사가 「매핑 없는 사건이 조용히 무음으로
// 지나가지 않는다」의 기계 층이다.

import { BALANCE } from '../balance.mjs';

/** 소리가 붙는 사건 — 호출부는 이 이름으로만 부르고, 어느 소리인지는 아래 두 표가 정한다. */
export const CUE = {
  KEY: 'key',
  IGNORE: 'ignore',
  RESET: 'reset',
  FIRE: 'fire',
  CONFIRM: 'confirm',
  RANK_UP: 'rankUp',
  TRANSMIT: 'transmit',
};

/**
 * 납품이 없는 자리의 합성 레시피 — 아트 계약이 실파일을 준 7 id 밖의 사건이다(오입력 무시 ·
 * 되돌리기 · 발동 · 전수 완료). 파일이 납품되면 그 cue 를 `BALANCE.audio` 로 옮기고 여기서 뺀다.
 */
const TONE = {
  [CUE.IGNORE]: [{ freq: 110, ms: 160, type: 'square', gain: 0.06, sweep: -40 }],
  [CUE.RESET]: [{ freq: 300, ms: 90, type: 'sine', gain: 0.05, sweep: -120 }],
  [CUE.FIRE]: [{ freq: 880, ms: 140, type: 'triangle', gain: 0.07, sweep: 320 }],
  [CUE.TRANSMIT]: [0, 160, 320, 520].map((at, i) => ({
    freq: 392 * (1 + i * 0.25), ms: 320, type: 'triangle', gain: 0.07, at,
  })),
};

/** 그 cue 의 실파일 id — 없으면 합성 자리다. 판정은 등급으로 한 단계 더 갈린다 (REQ-924). */
const fileIdOf = (cue) => BALANCE.audio[cue] ?? null;

// 파일도 합성도 없는 cue 는 화면에서 조용한 무음이 되고, 그 결손은 아무 데서도 드러나지 않는다.
for (const cue of Object.values(CUE)) {
  if (!fileIdOf(cue) && !TONE[cue]) throw new Error(`소리가 배정되지 않은 사건: ${cue}`);
  if (fileIdOf(cue) && TONE[cue]) throw new Error(`파일과 합성이 겹친 사건: ${cue}`);
}

/** 파일 경로는 매핑 표 밖이다 (REQ-920) — 아트 계약이 `<id>.ogg` 로 납품을 고정했다. */
const srcOf = (id) => `assets/audio/${id}.ogg`;

/** 방향 키 타격음의 피치 폭 (REQ-922) — 같은 소리가 연속되면 손맛이 죽는다. */
const KEY_PITCH = [0.88, 1.14];

/** 마스터 게인 전환 길이 — 계단 대입은 파형이 끊겨 그 자리가 팝으로 들린다 (#163). */
const GAIN_RAMP_MS = 30;

/**
 * 이 표지가 붙은 요소를 향한 활성화 입력은 REQ-921 의 「최초 입력」이 아니다 — 그 재개는
 * `toggleMute` 가 직접 진다. 표지를 붙이는 쪽(`dom.mjs`)과 거르는 쪽(`app.mjs`)이 같은 이름을
 * 이 한 자리에서 받아야, 오디오 컨트롤이 하나 더 생길 때 표지 누락이 조용히 지나가지 않는다.
 */
export const AUDIO_CONTROL_ATTR = 'data-audio-control';

const state = {
  ctx: null,
  master: null,
  buffers: new Map(),
  bgm: null,
  muted: false,
  resumed: false,
  resumedAtMs: null,
  startedAtMs: 0,
  log: () => {},
  now: () => 0,
};

/** 컨텍스트는 정지 상태로 먼저 서고 (디코드가 그것을 요구한다), 소리는 첫 제스처 뒤에 난다. */
function context() {
  if (state.ctx) return state.ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  state.ctx = new Ctor();
  state.master = state.ctx.createGain();
  state.master.gain.value = state.muted ? 0 : 1;
  state.master.connect(state.ctx.destination);
  return state.ctx;
}

function tone(ac, { freq, ms, type = 'sine', gain = 0.08, sweep = 0, at = 0 }) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const t0 = ac.currentTime + at / 1000;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + ms / 1000);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(amp).connect(state.master);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

function playBuffer(ac, id, { rate = 1, loop = false } = {}) {
  const buffer = state.buffers.get(id);
  // 아직 디코드 전이면 그 초의 소리는 없다 — 기다렸다 늦게 내면 그 사건과 어긋나 붙는다.
  if (!buffer) return null;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.loop = loop;
  source.connect(state.master);
  source.start();
  return source;
}

/**
 * 사건 하나를 낸다 — 매핑에 없는 이름은 그 자리에서 터뜨린다 (수용 기준 ③).
 * @param {string} cue `CUE` 의 값
 */
export function play(cue) {
  if (!Object.values(CUE).includes(cue)) throw new Error(`매핑 없는 소리 사건: ${cue}`);
  const ac = context();
  if (!ac || state.muted) return;
  const fileId = fileIdOf(cue);
  if (!fileId) {
    for (const recipe of TONE[cue]) tone(ac, recipe);
    return;
  }
  // 방향 키만 피치를 흔든다 — 나머지는 그 사건의 고유 소리라 흔들면 다른 소리로 들린다 (REQ-922).
  const rate = cue === CUE.KEY
    ? KEY_PITCH[0] + Math.random() * (KEY_PITCH[1] - KEY_PITCH[0]) : 1;
  playBuffer(ac, fileId, { rate });
}

/**
 * 판정음 (REQ-924) — 6단 전부가 3계열 중 하나로 덮이고, 그 접힘은 데이터에만 있다.
 * 매핑 표와 등급 집합이 같다는 것은 로드가 지고, 표를 우회해 부른 등급은 여기가 문다.
 */
export function playVerdict(grade) {
  const id = BALANCE.audio.verdict[grade];
  if (!id) throw new Error(`소리가 배정되지 않은 판정 등급: ${grade}`);
  const ac = context();
  if (!ac || state.muted) return;
  playBuffer(ac, id);
}

/** BGM 루프 (REQ-926) — 한 벌만 돈다. 이미 돌고 있으면 다시 걸지 않는다. */
function startBgm() {
  const ac = context();
  if (!ac || state.bgm || state.muted) return;
  state.bgm = playBuffer(ac, BALANCE.audio.bgm, { loop: true });
}

/**
 * BGM 정지 — 정지가 미래면 그때까지 소스는 아직 살아 있으므로 참조를 붙들고 있는다: 미리
 * 버리면 그 창 안에 온 해제가 두 번째 소스를 겹쳐 걸어 같은 루프 두 벌이 위상이 어긋난 채
 * 함께 울린다. 실제로 끝난 자리에서 지금의 음소거 상태를 다시 본다 (#163).
 * @param {number} at 정지 시각 (오디오 시계) — 지금 이전이면 즉시다
 */
function stopBgm(at = 0) {
  const source = state.bgm;
  if (!source) return;
  const pending = at > state.ctx.currentTime;
  state.bgm = pending ? source : null;
  if (pending) {
    source.onended = () => { if (state.bgm === source) { state.bgm = null; applyMute(); } };
  }
  source.stop(at);
}

/**
 * 지금의 음소거 상태를 소리에 반영하는 유일한 자리 (#163) — 재개·토글·늦은 디코드 어느
 * 경로로 들어와도 여기를 지나므로, 늦게 끝난 재개가 그때의 `muted` 를 다시 보고 BGM 을 건다.
 * 순서가 흩어져 있으면 「끄려고 누른 손이 소리를 켠다」가 경로 조합마다 되살아난다.
 */
function applyMute() {
  const ac = state.ctx;
  if (!ac || !state.master) return;
  // 소리가 흐르지 않는 동안의 계단은 팝이 될 수 없다 — 거기에 램프를 두면 재개 직후의 그 30ms
  // 가 도리어 들려, 끄려고 누른 손이 소리를 켜는 자리로 돌아간다. 「흐르는가」의 판정에 이 모듈이
  // 든 `resumed` 를 함께 두는 것은, 엔진의 상태 하나에 그 정합을 맡기지 않기 위함이다.
  const flowing = state.resumed && ac.state === 'running';
  const gain = state.master.gain;
  const t0 = ac.currentTime;
  const target = state.muted ? 0 : 1;
  const until = flowing ? t0 + GAIN_RAMP_MS / 1000 : t0;
  // 취소는 `t0` 이후의 예약을 지우므로 지금 값의 판독이 그보다 앞이어야 이어붙일 자리가 남는다.
  const held = gain.value;
  gain.cancelScheduledValues(t0);
  gain.setValueAtTime(flowing ? held : target, t0);
  if (flowing) gain.linearRampToValueAtTime(target, until);
  // 램프가 끝나기 전에 소스를 끊으면 잘린 파형이 다시 팝이 된다 — 정지는 램프 뒤다.
  if (state.muted) stopBgm(until);
  else startBgm();
}

/** 음소거 상태 — 화면의 토글이 이 값을 그린다. */
export const isMuted = () => state.muted;

/**
 * 음소거 토글 (REQ-926) — 마스터 게인 하나로 끊는다. 끈 동안 BGM 도 멈춘다: 게인만 0 으로
 * 두면 들리지 않는 루프가 계속 디코드된 채로 돌아 저사양에서 프레임 예산을 먹는다. 게인을
 * 계단으로 대입하지 않는 이유와 정지가 램프 뒤인 이유는 `applyMute` 에 있다.
 * @returns {boolean} 토글 뒤의 음소거 여부
 */
export function toggleMute() {
  state.muted = !state.muted;
  // 이 누름은 REQ-921 의 「최초 입력」에서 빠져 있어(`app.mjs`) 재개를 여기서 진다 — 재개가
  // 끝나는 자리도 `applyMute` 라, 음소거로 가는 누름이 소리를 켜는 순서가 성립하지 않는다.
  resumeAudio();
  applyMute();
  logState();
  return state.muted;
}

function logState() {
  state.log('audio_state', {
    resumed: state.resumed,
    muted: state.muted,
    ms_to_resume: state.resumedAtMs === null ? null : Math.round(state.resumedAtMs),
  });
}

/**
 * 첫 사용자 입력에 컨텍스트를 재개한다 (REQ-921) — 브라우저 자동재생 정책상 그 전에는 소리가
 * 나지 않으므로, 이 호출이 실제로 뚫렸는지가 `audio_state` 로만 판독된다. 그래서 `resumed` 는
 * 시도한 사실이 아니라 **컨텍스트가 실제로 running 이 된 사실**이다 — 정책이 제스처를 거절한
 * 세션이 「뚫렸다」로 기록되면 그 판독이 조용히 거짓 통과한다.
 * 못 뚫렸으면 이 경로는 아무것도 남기지 않고 (`toggleMute` 는 그 사이에도 자기 줄을 남긴다),
 * 다음 입력이 같은 자리로 다시 온다.
 */
export function resumeAudio() {
  const ac = context();
  // 뚫린 적 있다는 사실만으로 걸러 내면, 인터럽트로 다시 정지한 컨텍스트가 그 세션 내내 무음이
  // 된다 — 음소거 버튼은 이제 전역 재개 리스너 밖이라 그 우연한 복구 경로도 여기 하나뿐이다.
  if (!ac || (state.resumed && ac.state === 'running')) return;
  const settle = () => {
    state.resumed = ac.state === 'running';
    if (!state.resumed) return;
    // 재개가 뚫리기 전에 들어온 입력마다 시도가 겹치므로, 늦은 성사가 첫 성사를 덮으면
    // `ms_to_resume` 가 실제 경과보다 커진다.
    if (state.resumedAtMs === null) state.resumedAtMs = state.now() - state.startedAtMs;
    applyMute();
    logState();
  };
  // 정지의 이름은 하나가 아니다 — WebKit 은 오디오 세션 인터럽트를 `interrupted` 로 남기고
  // 그 값은 표준 열거 밖이라, 「suspended 일 때만」으로 좁히면 그 세션이 영영 복구되지 않는다.
  if (ac.state !== 'running') ac.resume().then(settle, settle);
  else settle();
}

/**
 * 오디오 기동 (REQ-920) — 컨텍스트를 정지 상태로 세우고 납품 파일을 내려받아 디코드한다.
 * 첫 제스처 전에 끝나 있어야 REQ-921 의 「그 입력부터 소리가 난다」가 성립한다.
 * @param {object} p
 * @param {(event: string, fields: object) => void} p.log 통합 로그 싱크
 * @param {() => number} p.now 세션과 같은 단조 시계 — `ms_to_resume` 의 출처다
 */
export function initAudio({ log, now }) {
  state.log = log;
  state.now = now;
  // `ms_to_resume` 는 기동부터 재개까지의 **경과**다 — 절대 시각을 실으면 이름과 값이 갈린다.
  state.startedAtMs = now();
  const ac = context();
  if (!ac) return;
  const ids = [...new Set([
    ...Object.values(BALANCE.audio).filter((v) => typeof v === 'string'),
    ...Object.values(BALANCE.audio.verdict),
  ])];
  for (const id of ids) {
    // 한 파일이 실패해도 나머지는 난다 — 소리 하나 때문에 게임이 멈추는 편이 더 나쁘다.
    fetch(srcOf(id))
      // 404 의 본문을 그대로 디코드에 넘기면 실패 문면이 「깨진 오디오」로 바뀌어 원인을 가린다.
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status} ${srcOf(id)}`))))
      .then((raw) => ac.decodeAudioData(raw))
      .then((buffer) => {
        state.buffers.set(id, buffer);
        // 첫 제스처가 디코드보다 빨랐으면 그 세션 내내 루프가 없다 — 도착한 그 자리에서 되살린다.
        // `startBgm` 을 직접 부르면 그 도착이 순서 계약을 우회하는 두 번째 기동 경로가 된다.
        if (id === BALANCE.audio.bgm) applyMute();
      })
      .catch((err) => console.warn(`[오디오] ${id} 를 재생 준비하지 못했다 — ${err.message}`));
  }
}
