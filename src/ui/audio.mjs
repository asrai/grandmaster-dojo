// Web Audio 합성음 — 아트·사운드 실파일은 M3 이라 프로토는 코드 렌더 + 합성으로 성립한다.

let ctx = null;

/** 오디오 컨텍스트는 사용자 제스처 안에서만 열리므로 첫 입력까지 지연 생성한다. */
function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, ms, type = 'sine', gain = 0.08, sweep = 0 }) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const t0 = ac.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + ms / 1000);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

export const SFX = {
  key: () => tone({ freq: 620, ms: 60, type: 'triangle', gain: 0.05 }),
  ignore: () => tone({ freq: 110, ms: 160, type: 'square', gain: 0.06, sweep: -40 }),
  reset: () => tone({ freq: 300, ms: 90, type: 'sine', gain: 0.05, sweep: -120 }),
  fire: () => tone({ freq: 880, ms: 140, type: 'triangle', gain: 0.07, sweep: 320 }),
  crush: () => tone({ freq: 220, ms: 260, type: 'sawtooth', gain: 0.09, sweep: 480 }),
  hit: () => tone({ freq: 160, ms: 200, type: 'square', gain: 0.07, sweep: -60 }),
  rank: () => [0, 90, 180].forEach((d, i) => setTimeout(() => tone({ freq: 520 + i * 180, ms: 160 }), d)),
  transmit: () => [0, 160, 320, 520].forEach((d, i) => setTimeout(
    () => tone({ freq: 392 * (1 + i * 0.25), ms: 320, type: 'triangle', gain: 0.07 }), d,
  )),
};
