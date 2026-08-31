// 통합 로그 스키마 + 세션 버퍼 (spec REQ-601~603).
// 필드 이름은 kill-criterion 산식의 인터페이스라, 스키마 밖 이벤트·필드는 throw 로 막는다.

/** 전 이벤트 공통 시각 필드. */
export const TIME_FIELD = 't_ms';

/** 이벤트 → 필수 필드(+ 열거값). spec § 통합 로그 스키마 표와 글자 단위로 일치한다. */
export const LOG_SCHEMA = {
  key:      { fields: ['dir', 'accepted', 'candidates_n', 'top_attr', 'device'], enums: { device: ['keyboard', 'button'] } },
  ignore:   { fields: ['dir'] },
  reset:    { fields: [] },
  narrow:   { fields: ['styleId'] },
  fire:     { fields: ['styleId', 'len', 'oneTap', 'r'] },
  timeout:  { fields: ['styleTop', 'buffer_len'] },
  verdict:  { fields: ['grade', 'dmg_out', 'dmg_in', 'state', 'who'] },
  mastery:  { fields: ['styleId', 'from', 'to'] },
  rank:     { fields: ['style_set', 'from', 'to', 'pts'] },
  unlock:   { fields: ['styleId'] },
  slot:     { fields: ['action', 'styleId'] },
  transmit: { fields: ['style_set'] },
  dispatch: { fields: ['challenger'] },
  select:   { fields: ['styleId', 'byUser'] },
  coins:    { fields: ['delta', 'reason'] },
  cycle:    { fields: ['phase'] },
  session:  { fields: ['tester_role', 'device'], enums: { tester_role: ['self', 'friend', 'bot'] } },
};

/**
 * 세션 로그 버퍼. `now` 를 주입받아 하네스가 결정적으로 돌 수 있게 한다.
 * @param {{now?: () => number}} [opts]
 */
export function createLogBuffer({ now = () => Date.now() } = {}) {
  const entries = [];
  const t0 = now();

  function log(event, fields = {}) {
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
    const entry = { event, [TIME_FIELD]: now() - t0, ...fields };
    entries.push(entry);
    return entry;
  }

  return {
    entries,
    log,
    toJSON: () => JSON.stringify(entries),
    clear: () => { entries.length = 0; },
  };
}
