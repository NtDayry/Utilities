/**
 * จุดวัดไฟฟ้าบนแผนผังโรงงาน (มิเตอร์ไฟฟ้า / หม้อแปลง / ชิลเลอร์ / ห้อง CDA)
 * + แหล่งข้อมูลจำลอง (MOCKUP) สำหรับหน้ารายละเอียด /electricity/meters/:pointKey
 *
 * ⚠️ ค่าทั้งหมดเป็นข้อมูลจำลองแบบ deterministic (เวลาเดิม = ค่าเดิม) อิงค่าตั้งต้นชุดเดียวกับแผนผังโรงงาน
 * (POWER_KW / TR_KVA / TR_PF ใน lib/factorySensors) — เมื่อมีข้อมูลจริง ให้แทนฟังก์ชัน *At() ด้วยการดึง API
 */
import { locEn, locTh } from '@/lib/locText';
import { URL } from '@/api';
import { POWER_KW, TR_KVA, type MeterKey } from '@/lib/factorySensors';

export type ElectricalType = 'main' | 'transformer' | 'chiller' | 'utility';

export interface ElectricalPoint {
  key: MeterKey;
  objectId: string; // id ใน OBJECTS/ROOMS ของแผนผังโรงงาน
  type: ElectricalType;
  th: string;
  en: string;
  locationTh: string;
  locationEn: string;
  baseKw: number; // กำลังไฟฟ้าเฉลี่ย (kW)
  kva?: number; // พิกัดหม้อแปลง
  kwhRef: number; // เลขมิเตอร์ ณ เวลาอ้างอิง (ค่าตั้งต้นเดียวกับแผนผังโรงงาน)
  profile: 'office' | 'process' | 'hvac' | 'flat';
}

const kw = (k: MeterKey) => POWER_KW[k] ?? 0;

export const ELECTRICAL_POINTS: ElectricalPoint[] = [
  { key: 'power', objectId: 'o_emeter', type: 'main', th: locTh('data.electrical_points.electrical_points.power.name'), en: locEn('data.electrical_points.electrical_points.power.name'), locationTh: locTh('data.electrical_points.electrical_points.power.location'), locationEn: locEn('data.electrical_points.electrical_points.power.location'), baseKw: kw('power'), kwhRef: 98432, profile: 'process' },
  { key: 'tr1', objectId: 'o_tr1', type: 'transformer', th: locTh('data.electrical_points.electrical_points.tr1.name'), en: locEn('data.electrical_points.electrical_points.tr1.name'), locationTh: locTh('data.electrical_points.electrical_points.tr1.location'), locationEn: locEn('data.electrical_points.electrical_points.tr1.location'), baseKw: kw('tr1'), kva: TR_KVA.tr1, kwhRef: 412530, profile: 'process' },
  { key: 'tr2', objectId: 'o_tr2', type: 'transformer', th: locTh('data.electrical_points.electrical_points.tr2.name'), en: locEn('data.electrical_points.electrical_points.tr2.name'), locationTh: locTh('data.electrical_points.electrical_points.tr2.location'), locationEn: locEn('data.electrical_points.electrical_points.tr2.location'), baseKw: kw('tr2'), kva: TR_KVA.tr2, kwhRef: 287640, profile: 'office' },
  { key: 'tr3', objectId: 'o_tr3', type: 'transformer', th: locTh('data.electrical_points.electrical_points.tr3.name'), en: locEn('data.electrical_points.electrical_points.tr3.name'), locationTh: locTh('data.electrical_points.electrical_points.tr3.location'), locationEn: locEn('data.electrical_points.electrical_points.tr3.location'), baseKw: kw('tr3'), kva: TR_KVA.tr3, kwhRef: 356210, profile: 'process' },
  { key: 'tr4', objectId: 'o_tr4', type: 'transformer', th: locTh('data.electrical_points.electrical_points.tr4.name'), en: locEn('data.electrical_points.electrical_points.tr4.name'), locationTh: locTh('data.electrical_points.electrical_points.tr4.location'), locationEn: locEn('data.electrical_points.electrical_points.tr4.location'), baseKw: kw('tr4'), kva: TR_KVA.tr4, kwhRef: 198870, profile: 'office' },
  { key: 'tr5', objectId: 'o_tr5', type: 'transformer', th: locTh('data.electrical_points.electrical_points.tr5.name'), en: locEn('data.electrical_points.electrical_points.tr5.name'), locationTh: locTh('data.electrical_points.electrical_points.tr5.location'), locationEn: locEn('data.electrical_points.electrical_points.tr5.location'), baseKw: kw('tr5'), kva: TR_KVA.tr5, kwhRef: 243905, profile: 'process' },
  { key: 'b5chiller', objectId: 'o_b5chiller', type: 'chiller', th: locTh('data.electrical_points.electrical_points.b5chiller.name'), en: locEn('data.electrical_points.electrical_points.b5chiller.name'), locationTh: locTh('data.electrical_points.electrical_points.b5chiller.location'), locationEn: locEn('data.electrical_points.electrical_points.b5chiller.location'), baseKw: kw('b5chiller'), kwhRef: 154320, profile: 'hvac' },
  { key: 'chiller', objectId: 'o_chiller', type: 'chiller', th: locTh('data.electrical_points.electrical_points.chiller.name'), en: locEn('data.electrical_points.electrical_points.chiller.name'), locationTh: locTh('data.electrical_points.electrical_points.chiller.location'), locationEn: locEn('data.electrical_points.electrical_points.chiller.location'), baseKw: kw('chiller'), kwhRef: 87650, profile: 'hvac' },
  { key: 'cda', objectId: 'r_cda', type: 'utility', th: locTh('data.electrical_points.electrical_points.cda.name'), en: locEn('data.electrical_points.electrical_points.cda.name'), locationTh: locTh('data.electrical_points.electrical_points.cda.location'), locationEn: locEn('data.electrical_points.electrical_points.cda.location'), baseKw: kw('cda'), kwhRef: 63210, profile: 'flat' },
];

export const electricalDetailPath = (key: MeterKey) => URL.ELECTRICAL_POINT_ROUTE.replace(':pointKey', key);
export const findElectricalPoint = (key?: string) => ELECTRICAL_POINTS.find((p) => p.key === key);

/* ====================================================================== */
/* MOCK signal model                                                       */
/* ====================================================================== */
const TAU = 2 * Math.PI;
const BKK_OFFSET_H = 7;
const hourOfDay = (ms: number) => (((ms / 3_600_000 + BKK_OFFSET_H) % 24) + 24) % 24;
const dayOfWeek = (ms: number) => new Date(ms + BKK_OFFSET_H * 3_600_000).getUTCDay(); // 0 = อาทิตย์
// สัญญาณรบกวนแบบ deterministic (เรียบ) ไม่ใช้ Math.random → ค่าเดิมทุกครั้งที่ดู
const wobble = (ms: number, seed: number) => {
  const h = ms / 3_600_000;
  return 0.5 * Math.sin(h * 1.7 + seed) + 0.3 * Math.sin(h * 4.3 + seed * 2.1) + 0.2 * Math.sin(h * 11.9 + seed * 0.7);
};
const seedOf = (key: string) => [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 97;

/** สัดส่วนโหลดเทียบกับ baseKw ตามรูปแบบการใช้งานของจุด */
function loadFactor(p: ElectricalPoint, ms: number): number {
  const h = hourOfDay(ms);
  const weekend = dayOfWeek(ms) === 0 || dayOfWeek(ms) === 6;
  const work = h >= 8 && h < 17.5 ? 1 : h >= 7 && h < 19 ? 0.6 : 0;
  let f: number;
  switch (p.profile) {
    case 'office':
      f = 0.35 + 0.9 * work * (weekend ? 0.3 : 1);
      break;
    case 'process':
      f = 0.7 + 0.45 * work * (weekend ? 0.5 : 1);
      break;
    case 'hvac': // ตามอุณหภูมิกลางวัน สูงสุดช่วงบ่าย
      f = 0.45 + 0.75 * Math.max(0, Math.sin((TAU * (h - 7)) / 24)) * (weekend ? 0.7 : 1);
      break;
    default:
      f = 0.9;
  }
  return Math.max(0.05, f * (1 + 0.06 * wobble(ms, seedOf(p.key))));
}

export interface ElectricalReading {
  kw: number;
  kva: number;
  kvar: number;
  pf: number;
  hz: number;
  vLL: number; // แรงดัน Line-Line เฉลี่ย
  aAvg: number;
  phases: { name: 'L1' | 'L2' | 'L3'; vLN: number; a: number; kw: number }[];
  unbalancePct: number; // กระแสไม่สมดุล (max deviation / avg)
  loadPct?: number; // หม้อแปลง: kVA / พิกัด
}

export function readingAt(p: ElectricalPoint, ms: number): ElectricalReading {
  const s = seedOf(p.key);
  const kwTot = p.baseKw * loadFactor(p, ms);
  const pf = Math.min(0.99, 0.93 + 0.025 * wobble(ms, s + 3));
  const hz = 50 + 0.06 * wobble(ms, s + 5);
  const vLL = 400 + 4 * wobble(ms, s + 7);
  const kva = kwTot / pf;
  const kvar = Math.sqrt(Math.max(0, kva * kva - kwTot * kwTot));
  const aAvg = (kva * 1000) / (Math.sqrt(3) * vLL);
  // แบ่งโหลดลงแต่ละเฟส (ไม่สมดุลเล็กน้อย)
  const skew = [1 + 0.03 * wobble(ms, s + 11), 1 + 0.03 * wobble(ms, s + 13), 0];
  skew[2] = 3 - skew[0] - skew[1];
  const phases = (['L1', 'L2', 'L3'] as const).map((name, i) => ({
    name,
    vLN: vLL / Math.sqrt(3) + 1.5 * wobble(ms, s + 17 + i),
    a: aAvg * skew[i],
    kw: (kwTot / 3) * skew[i],
  }));
  const unbalancePct = (Math.max(...phases.map((x) => Math.abs(x.a - aAvg))) / aAvg) * 100;
  return { kw: kwTot, kva, kvar, pf, hz, vLL, aAvg, phases, unbalancePct, loadPct: p.kva ? (kva / p.kva) * 100 : undefined };
}

/** พลังงาน (kWh) ระหว่างสองเวลา — อินทิเกรตทีละ 15 นาที */
export function energyBetween(p: ElectricalPoint, fromMs: number, toMs: number, stepMin = 15): number {
  if (toMs <= fromMs) return 0;
  const step = stepMin * 60_000;
  let e = 0;
  for (let t = fromMs; t < toMs; t += step) {
    const dt = Math.min(step, toMs - t);
    e += readingAt(p, t + dt / 2).kw * (dt / 3_600_000);
  }
  return e;
}

/** เวลาอ้างอิงของเลขมิเตอร์ตั้งต้น (kwhRef) — 14 พ.ย. 2026 00:00 น. เวลาไทย */
const METER_REF_MS = Date.UTC(2026, 10, 13, 17, 0, 0);

/** เลขมิเตอร์สะสม ณ เวลา ms — เพิ่มขึ้นตามพลังงานที่ใช้จริงในแบบจำลอง */
export const meterAt = (p: ElectricalPoint, ms: number, stepMin = 15) =>
  ms >= METER_REF_MS
    ? p.kwhRef + energyBetween(p, METER_REF_MS, ms, stepMin)
    : p.kwhRef - energyBetween(p, ms, METER_REF_MS, stepMin);
