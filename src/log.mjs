// 통합 로그 스키마 + 세션 버퍼 (spec REQ-601~603·791).
// 필드 이름은 kill-criterion 산식의 인터페이스라, 스키마 밖 이벤트·필드는 throw 로 막는다.

/** 전 이벤트 공통 시각 필드. */
export const TIME_FIELD = 't_ms';

/** 좌표 모델이 바뀐 이벤트의 스키마 판별 토큰 (REQ-791) — 구·신 로그 혼재 시 판독기가 필드 뜻을 오독한다. */
export const SCHEMA_VERSION_FIELD = 'sv';

/**
 * 이벤트 → 필수 필드(+ 열거값 · 스키마 판별). spec § 통합 로그 스키마 표와 글자 단위로 일치한다.
 * `sv` 는 적재 시점에 버퍼가 붙이므로 호출부가 넘기지 않는다 — 넘기는 자리를 두면 잊는 자리가 생긴다.
 */
export const LOG_SCHEMA = {
  key:       { fields: ['dir', 'accepted', 'candidates_n', 'top_attr', 'device'], enums: { device: ['keyboard', 'button'] } },
  ignore:    { fields: ['dir'] },
  reset:     { fields: [] },
  narrow:    { fields: ['styleId'] },
  fire:      { fields: ['styleId', 'len', 'oneTap', 'r'] },
  timeout:   { fields: ['styleTop', 'buffer_len'] },
  verdict:   { fields: ['grade', 'dmg_out', 'dmg_in', 'state', 'who'] },
  rank:      { fields: ['actor', 'style', 'from', 'to', 'via'], sv: 2, enums: { actor: ['master', 'disciple'], via: ['train', 'duel', 'mission', 'finish', 'crush'] } },
  rank_wall: { fields: ['actor', 'style', 'at_rank', 'attempted'], enums: { actor: ['master', 'disciple'], attempted: ['train'] } },
  unlock:    { fields: ['style', 'prev_style_rank'], sv: 2 },
  finish:    { fields: ['style', 'challenger', 'intended'] },
  slot:      { fields: ['action', 'styleId'] },
  transmit:  { fields: ['style_set'] },
  dispatch:  { fields: ['challenger'] },
  select:    { fields: ['styleId', 'byUser'] },
  coins:     { fields: ['delta', 'reason'] },
  cycle:     { fields: ['phase'] },
  cheat:     { fields: ['action', 'session_flagged'] },
  session:   { fields: ['tester_role', 'device'], enums: { tester_role: ['self', 'friend', 'bot'] } },
};

/** 스키마 대조 — 위반은 throw 다. 비엄격 버퍼를 쓰는 호출부가 직접 부를 수 있게 열어 둔다. */
export function validate(event, fields) {
  const spec = LOG_SCHEMA[event];
  if (!spec) throw new Error(`미정의 로그 이벤트: ${event}`);
  for (const f of spec.fields) {
    if (!(f in fields)) throw new Error(`${event} 필드 결손: ${f}`);
  }
  for (const f of Object.keys(fields)) {
    if (!spec.fields.includes(f)) throw new Error(`${event} 스키마 밖 필드: ${f}`);
  }
  for (const [f, allowed] of Object.entries(spec.enums ?? {})) {
    if (!allowed.includes(fields[f])) throw new Error(`${event}.${f} 허용 밖 값: ${fields[f]}`);
  }
}

/**
 * 세션 로그 버퍼.
 * @param {object} [opts]
 * @param {() => number} [opts.now] 주입 클럭 — 하네스가 결정적으로 돌기 위한 자리
 * @param {boolean} [opts.strict] 스키마 위반을 던질지. 플레이 중에는 끄고 적재를 잇는다 —
 *   판정 하나가 세션 전체 로그를 날리는 것이 스키마 드리프트보다 비싸다 (드리프트는 하네스가 잡는다).
 */
export function createLogBuffer({ now = () => Date.now(), strict = true } = {}) {
  const entries = [];
  const t0 = now();

  function log(event, fields = {}) {
    if (strict) validate(event, fields);
    const sv = LOG_SCHEMA[event]?.sv;
    const entry = { event, [TIME_FIELD]: now() - t0, ...fields };
    if (sv !== undefined) entry[SCHEMA_VERSION_FIELD] = sv;
    entries.push(entry);
    return entry;
  }

  return {
    entries,
    log,
    // `toJSON` 이면 JSON.stringify(buffer) 가 이 문자열을 다시 감싸 이중 인코딩된다.
    serialize: () => JSON.stringify(entries),
    clear: () => { entries.length = 0; },
  };
}
