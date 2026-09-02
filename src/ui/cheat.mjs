// 개발자 치트 패널 (REQ-781~783) — 게임 화면 밖에 산다. 존재 근거는 전수 화면 도달 비용이라
// (#36), 주입은 「성 계단을 건너뛴다」는 사실을 세션에 지워지지 않게 남긴다.
// 주입 자체는 DOM-free 인 session.mjs 가 지므로 이 모듈은 그 버튼과 표시만 진다.

import { BALANCE, STYLES } from '../balance.mjs';
import { $, clear, el } from './dom.mjs';
import { cheatSetStyleRank, isCheatFlagged, isInjectableRank, setCheatEnabled } from './session.mjs';

/**
 * 치트 패널을 도구 영역에 건다.
 * @param {object} p
 * @param {() => void} p.refresh 주입 뒤 화면을 다시 그리는 호출부 훅 — 이 모듈은 라우터를 모른다
 * @returns {() => void} 봇 구동 등 바깥 사정으로 상태가 바뀌었을 때 다시 그리는 함수
 */
export function mountCheatPanel({ session, refresh }) {
  const host = $('cheat');
  const toggle = $('cheatBtn');
  if (!host || !toggle) return () => {};

  const note = el('p', { class: 'dim' });

  function render() {
    host.hidden = !session.cheat.enabled;
    toggle.disabled = session.botRunning;
    toggle.setAttribute('aria-pressed', String(session.cheat.enabled));
    toggle.textContent = session.botRunning ? '치트 (봇 구동 중 잠김)' : '개발자 치트';
    if (host.hidden) return;

    clear(host).append(
      el('p', { class: 'dim', text: `주입은 축적을 건너뛴다 — 이 세션은 회차·kill 표본에서 제외된다${isCheatFlagged(session) ? ' (플래그 켜짐)' : ''}` }),
      el('div', { class: 'cheat-rows' }, STYLES.map((style) => el('div', { class: 'cheat-row' }, [
        el('span', { text: style.name }),
        el('input', {
          type: 'number', min: '1', max: String(BALANCE.rankMax),
          'aria-label': `${style.name} 성`,
          value: String(session.progress.styles[style.id].rank),
          id: `cheat-rank-${style.id}`,
        }),
        el('button', {
          class: 'small',
          text: '성 주입',
          onclick: () => {
            const raw = Number($(`cheat-rank-${style.id}`).value);
            // 빈 칸은 0, 글자는 NaN 이 된다 — 걸러 두지 않으면 클릭 핸들러 밖으로 throw 가 샌다.
            note.textContent = isInjectableRank(raw) ? '' : `1~${BALANCE.rankMax} 정수만 주입할 수 있다`;
            if (!cheatSetStyleRank(session, style.id, raw)) return;
            render();
            refresh();
          },
        }),
      ]))),
      el('button', {
        class: 'small',
        text: `전 초식 ${BALANCE.rankMax}성 (전수 직전)`,
        onclick: () => {
          for (const style of STYLES) cheatSetStyleRank(session, style.id, BALANCE.rankMax);
          render();
          refresh();
        },
      }),
      note,
    );
  }

  toggle.addEventListener('click', () => {
    setCheatEnabled(session, !session.cheat.enabled);
    render();
  });
  render();
  return render;
}
