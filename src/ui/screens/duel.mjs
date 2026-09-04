// 사부 대련 (REQ-201·206~211·708·731~736) — 유저가 시퀀스를 치는 유일한 실전 화면.
// 화면은 상단 띠 50 / 아레나 440 / 입력부 362 의 3단 고정이고, 나머지 4화면이 그 좌표를
// 상속하므로 아레나는 `arena.mjs` 가, 하단부는 `pad.mjs` 가 각자 소유한다 (REQ-820·850).
// 대련 **전**의 준비(도전자 고르기·절초 공개·슬롯 교체)는 S7 `select.mjs` 의 몫이다 (REQ-880).

import { BALANCE } from '../../balance.mjs';
import { composeScreen, el } from '../dom.mjs';
import { CUE, play, playVerdict } from '../audio.mjs';
import { styleById } from '../../core.mjs';
import { SCREEN } from '../theme.mjs';
import { SPOT, createArena } from '../arena.mjs';
import { stageBand } from '../band.mjs';
import { createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  challengerOfStage, equippedStyles, logEvent, rankOfStyle,
} from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, duelWiring, logDuelStart } from '../wiring.mjs';

export function startDuel(ctx) {
  const { session, params } = ctx;
  const challenger = challengerOfStage(params.stage);
  const { foeRank } = logDuelStart(session, challenger);

  // 확정 연출이 한 프레임도 안 보이는 초를 위해 판정이 죽간의 금테를 기다린다 (REQ-826).
  const verdict = createVerdictOverlay({ heldSince: () => ctx.pad.onlyShownAt() });
  // 대각 대치 — 도전자가 원경에, 사부가 근경에 선다. 이 배치를 S4 는 사람만, S6 은 자세까지
  // 바꿔 그대로 물려받는다 (REQ-821·850·875).
  const arena = createArena({
    figures: [
      { spot: SPOT.FAR, id: 'sil_challenger', pose: 'stance' },
      { spot: SPOT.NEAR, id: 'sil_master', pose: 'stance' },
    ],
    bout: { [SPOT.FAR]: '적', [SPOT.NEAR]: '사부' },
  });
  const banner = el('div', { class: 'toast' });
  let exchanges = 0;
  // 대련 중 상황은 「누구와 몇 초째인가」뿐이라 띠가 그 둘만 진다 — 재화·접근성 토글은
  // 대련 밖(도장·도전자 선택)의 자리다 (REQ-820·893·897).
  const band = stageBand({
    onLeave: () => ctx.go('dojo'),
    name: challenger.name,
    hanja: challenger.hanja,
    seal: `${challenger.stage}차`,
    // 끝난 초의 수를 세므로 진행 중인 초는 그보다 하나 크다.
    count: { value: () => exchanges + 1, unit: '초째' },
  });

  arena.node.append(
    banner,
    // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
    verdict.node,
  );

  composeScreen(ctx, {
    top: band,
    body: arena.node,
    bottom: ctx.pad.node,
    // 아레나는 풀블리드 레이어라 여백이 붙으면 3단 고정이 어긋난다 (REQ-802·820).
    padded: false,
  });

  const toast = (text, cls = '') => {
    banner.className = `toast show ${cls}`.trim();
    banner.textContent = text;
  };

  const input = createSequenceInput({
    pool: equippedStyles(session),
    rankOf: (style) => rankOfStyle(session, style.id),
    hintDelayMs: BALANCE.hintDelayMs.duel,
    now: () => performance.now(),
    remainingRatio: () => match.windowRatio,
    log: (event, fields) => logEvent(session, event, fields),
    screen: SCREEN.duel.id,
    // 띠가 세는 「초째」와 같은 수 — 되돌리기가 몇 번째 초에서 났는지가 로그와 화면에서 갈리지 않는다.
    exchangeNo: () => exchanges + 1,
  });

  const renderHp = (view) => {
    arena.setVital(SPOT.FAR, view.foeHp, view.foeHpMax);
    arena.setVital(SPOT.NEAR, view.selfHp, view.selfHpMax);
  };

  // 창 자리의 빈틈 문면은 예고 모드에만 넘긴다 — 감춤 모드의 창이 빈틈을 말하면 창 동안
  // 상대를 감추는 계약을 화면이 스스로 어긴다 (#243 결정 2).
  const foeTexts = {
    open: BALANCE.blindExchange ? null : '빈틈! — 아무 초식이나 완주하면 완파',
    resolved: '빈틈 — 상대의 허를 찔렀다',
    // 흘린 갈래는 판정이 「피격」이라, 같은 프레임의 스트립이 이겼다고 말하면 화면이 스스로를 부정한다 (#255).
    missed: '빈틈이었는데 아까운 기회를 놓쳤다',
  };

  const match = createMatch({
    challenger,
    foeRank,
    selfHpMax: BALANCE.hp.user,
    rankOf: (style) => rankOfStyle(session, style.id),
    openLen: () => Math.max(...equippedStyles(session).map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    hooks: composeHooks(duelWiring(session, { input }), {
      onExchange(view) {
        arena.showFoe(view, foeTexts);
        verdict.hide();
        // 성장 고지는 그 초 한정이다 — 남기면 다음 초의 판정 위에 계속 떠 있는다.
        banner.className = 'toast';
        arena.setWindow(1);
        renderHp(view);
        ctx.pad.render();
        exchanges = view.exchange;
        ctx.refreshTop();
      },
      onWindow() {
        ctx.pad.render();
      },
      onTick(view) {
        arena.setWindow(view.ratio);
        ctx.pad.render();
      },
      onVerdict(view, changes) {
        const { verdict: resolved } = view;
        renderHp(view);
        // 감췄던 상대가 판정과 같은 프레임에 드러난다 — 「보」에 해당하는 자리다 (#243 결정 2).
        arena.showFoe(view, foeTexts);
        // 소리는 흔들림·글자와 한 덩어리로 읽혀야 해서 판정이 실제로 뜨는 순간에 맡긴다 —
        // 확정 연출을 기다리는 초에는 그만큼 함께 늦는다 (REQ-826).
        // 죽간이 다시 그려지기 전에 예약한다 — 대기 시간은 지금 화면에 뜬 금테를 기준으로 잰다.
        verdict.showGrade(resolved.grade, { onShow: () => playVerdict(resolved.grade) });
        ctx.pad.render();

        if (!changes) return;
        if (changes.rank) {
          play(CUE.RANK_UP);
          const name = styleById(changes.rank.style).name;
          toast(changes.rank.to >= BALANCE.rankMax
            ? `${name} — 완벽히 깨달음`
            : `${name} ${changes.rank.to}성`, 'rank');
        } else if (changes.wall) {
          toast(`${styleById(changes.wall.style).name} — 수련으로는 여기까지, 실전으로 민다`);
        } else if (changes.unlock) {
          toast('새 초식을 배울 수 있다 — 도장에서');
        }
      },
      onEnd(view) {
        ctx.go('result', { kind: 'duel', win: view.outcome.win, stage: params.stage });
      },
    }),
  });

  ctx.pad.attach({
    input,
    rankOf: (style) => rankOfStyle(session, style.id),
    // 확정한 뒤에도 창이 남아 있으므로 페이즈만으로는 손을 닫지 못한다 (#243 결정 1).
    accepting: () => match.open && !match.locked,
    // 확정 구간은 창 밖이 아니라 「낸 것을 무르지 못한다」이므로 화면이 그것을 갈라 말한다 (#243 결정 1).
    committed: () => match.locked,
    // 봇이 화면과 같은 근거로 고르도록 **공개된** 상대만 건넨다 — 감춘 초는 봇도 모르고, 그
    // 대신 도전자의 초식 목록이 판단의 재료다 (REQ-605 · REQ-894).
    foe: () => ({
      style: match.view().telegraphed,
      open: match.view().foeOpen,
      pool: challenger.styles,
    }),
    onFire: (fired) => { play(CUE.FIRE); match.fire(fired); },
  });
  match.start();
  return () => { match.stop(); verdict.hide(); };
}
