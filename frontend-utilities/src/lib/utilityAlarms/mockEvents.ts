/**
 * ประวัติการแจ้งเตือนจำลอง (MOCKUP) — deterministic: ช่วงเวลาเดิมได้เหตุการณ์ชุดเดิมทุกครั้ง
 * เมื่อมี backend ให้แทน mockEvents() ด้วย getAlertEvents() (api/alerts/alertEvents.ts) แล้ว map เป็น UtilityAlarmEvent
 */
import { defaultRule, getCatalog } from './catalog';
import { loadAcks, type AckMap } from './repository';
import type { AlarmLevel, AlarmSensorDef, UtilityAlarmEvent, UtilitySystem } from './types';
import { LEVEL_SEVERITY } from './types';

const DAY = 86_400_000;
const MIN = 60_000;
const OPERATORS = ['admin', 'operator1', 'maintenance'];

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string) {
  let a = hashStr(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

function pickLevel(s: AlarmSensorDef, r: () => number): { level: AlarmLevel; value: number | null; limit: number | null } | null {
  const rule = defaultRule(s);
  if (s.kind === 'digital') return { level: s.comm ? 'COMM' : 'STATE', value: s.comm ? null : rule.triggerOn, limit: null };
  const opts: { level: AlarmLevel; w: number }[] = [];
  if (rule.h !== null) opts.push({ level: 'H', w: 3 });
  if (rule.hh !== null) opts.push({ level: 'HH', w: 1 });
  if (rule.l !== null) opts.push({ level: 'L', w: 3 });
  if (rule.ll !== null) opts.push({ level: 'LL', w: 1 });
  if (!opts.length) return null;
  let x = r() * opts.reduce((a, o) => a + o.w, 0);
  const lv = opts.find((o) => (x -= o.w) < 0)?.level ?? opts[0].level;
  const span = (a: number | null, b: number | null, base: number) => (a !== null && b !== null ? Math.abs(b - a) : Math.abs(base) * 0.08 || 1);
  const step = 10 ** -s.dp;
  switch (lv) {
    case 'H':
      return { level: lv, limit: rule.h, value: round(Math.min(rule.hh !== null ? rule.hh - step : Infinity, rule.h! + step + span(rule.h, rule.hh, rule.h!) * 0.85 * r()), s.dp) };
    case 'HH':
      return { level: lv, limit: rule.hh, value: round(rule.hh! + step + Math.abs(rule.hh!) * 0.04 * r(), s.dp) };
    case 'L':
      return { level: lv, limit: rule.l, value: round(Math.max(rule.ll !== null ? rule.ll + step : -Infinity, rule.l! - step - span(rule.ll, rule.l, rule.l!) * 0.85 * r()), s.dp) };
    default:
      return { level: lv, limit: rule.ll, value: round(Math.max(0, rule.ll! - step - Math.abs(rule.ll!) * 0.04 * r()), s.dp) };
  }
}

function durationMin(s: AlarmSensorDef, r: () => number) {
  if (s.comm) return 1 + r() * 35;
  if (s.kind === 'digital') return 2 + r() * 50;
  return 3 + r() ** 2 * 240;
}

function build(system: UtilitySystem, s: AlarmSensorDef, startMs: number, durMin: number, nowMs: number, r: () => number): UtilityAlarmEvent | null {
  const lv = pickLevel(s, r);
  if (!lv) return null;
  const endMs = startMs + durMin * MIN;
  const active = endMs > nowMs;
  const severity = lv.level === 'STATE' ? defaultRule(s).stateSeverity : LEVEL_SEVERITY[lv.level as Exclude<AlarmLevel, 'STATE'>];
  const autoAck = !active && nowMs - startMs > 6 * 3_600_000 && r() < 0.85;
  return {
    id: `${system}:${s.key}:${startMs}`,
    system,
    groupId: s.groupId,
    sensorKey: s.key,
    deviceName: s.deviceName,
    metricName: s.metricName,
    deviceTh: s.deviceTh,
    deviceEn: s.deviceEn,
    th: s.kind === 'digital' && s.stateTh ? `${s.th} (${s.stateTh})` : s.th,
    en: s.kind === 'digital' && s.stateEn ? `${s.en} (${s.stateEn})` : s.en,
    unit: s.unit,
    dp: s.dp,
    level: lv.level,
    severity,
    value: lv.value,
    limit: lv.limit,
    startedAt: new Date(startMs).toISOString(),
    endedAt: active ? null : new Date(endMs).toISOString(),
    durationSec: Math.round(((active ? nowMs : endMs) - startMs) / 1000),
    acknowledged: autoAck,
    ackBy: autoAck ? OPERATORS[Math.floor(r() * OPERATORS.length)] : null,
    ackAt: autoAck ? new Date(endMs + r() * 90 * MIN).toISOString() : null,
  };
}

/** เหตุการณ์ทั้งหมดของระบบในช่วง [fromMs, toMs] เรียงจากล่าสุด */
export function mockEvents(system: UtilitySystem, fromMs: number, toMs: number, nowMs = Date.now(), acks: AckMap = loadAcks()): UtilityAlarmEvent[] {
  const { sensors } = getCatalog(system);
  const out: UtilityAlarmEvent[] = [];
  const end = Math.min(toMs, nowMs);
  const d0 = Math.floor(fromMs / DAY) - 1;
  const d1 = Math.floor(end / DAY);
  for (let d = d0; d <= d1; d++) {
    for (const s of sensors) {
      const rate = s.mockRate ?? 0;
      if (rate <= 0) continue;
      const r = rng(`${system}|${s.key}|${d}`);
      for (let k = 0; k < 3 && r() < rate; k++) {
        const start = d * DAY + Math.floor(r() * DAY);
        if (start > nowMs) continue;
        const ev = build(system, s, start, durationMin(s, r), nowMs, r);
        if (ev) out.push(ev);
      }
    }
  }
  // ให้มี alarm ที่ยังค้างอยู่ 1–2 รายการเสมอ (เปลี่ยนชุดทุก 6 ชั่วโมง) เพื่อให้เห็นสถานะ "กำลังเกิด"
  const bucket = Math.floor(nowMs / (6 * 3_600_000));
  const ra = rng(`${system}|active|${bucket}`);
  const pool = sensors.filter((s) => (s.mockRate ?? 0) > 0);
  const nActive = 1 + Math.floor(ra() * 2);
  for (let i = 0; i < nActive && pool.length; i++) {
    const s = pool[Math.floor(ra() * pool.length)];
    const start = nowMs - Math.floor((10 + ra() * 100) * MIN);
    const ev = build(system, s, Math.floor(start / MIN) * MIN, 24 * 60, nowMs, ra);
    if (ev && !out.some((e) => e.id === ev.id)) out.push(ev);
  }

  return out
    .filter((e) => {
      const t = Date.parse(e.startedAt);
      return t >= fromMs && t <= toMs;
    })
    .map((e) => (acks[e.id] ? { ...e, acknowledged: true, ackBy: acks[e.id].by, ackAt: acks[e.id].at } : e))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
