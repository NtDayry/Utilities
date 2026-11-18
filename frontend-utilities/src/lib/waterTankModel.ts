/**
 * ⚠️ MOCKUP — แบบจำลองถัง/บ่อเก็บน้ำประปาที่ยังไม่มีเซนเซอร์ (อาคาร 1,4 / ดาดฟ้าอาคาร 5 / ดาดฟ้าโกดัง)
 * ใช้ร่วมกันระหว่างรายงานระบบประปาและแผนผังโรงงาน → ตัวเลขตรงกันทุกหน้า (เวลาเดิม = ค่าเดิม)
 *
 *   อัตราการไหลเข้า (m³/h) > 0 เสมอ · เลขมิเตอร์ = อินทิเกรตเชิงวิเคราะห์ของอัตราการไหล (เพิ่มขึ้นตลอด)
 *   ระดับน้ำ (%) ขึ้น-ลงรายวัน/รายสัปดาห์ · ปริมาณน้ำ = ระดับ × ความจุ (TANK ใน lib/factorySensors)
 */
import { TANK, type MeterKey } from '@/lib/factorySensors';

export type ModelTankKey = 'tank14' | 'b5tank' | 'whtank';

const TAU = 2 * Math.PI;
const BKK_H = 7;
// เวลาอ้างอิงเลขมิเตอร์ตั้งต้น (ค่าเดียวกับแผนผังโรงงาน) — 14 พ.ย. 2026 00:00 น. เวลาไทย
const REF_MS = Date.UTC(2026, 10, 13, 17, 0, 0);

const P: Record<ModelTankKey, { q: number; meter0: number; seed: number }> = {
  tank14: { q: 4, meter0: 21536, seed: 0.7 },
  b5tank: { q: 1.2, meter0: 3418, seed: 1.9 },
  whtank: { q: 1, meter0: 2871, seed: 3.1 },
};

export const MODEL_TANKS = Object.keys(P) as ModelTankKey[];
export const isModelTank = (k: MeterKey | string): k is ModelTankKey => k in P;

const hrs = (ms: number) => (ms - REF_MS) / 3_600_000 + BKK_H;

/** อัตราการไหลเข้าถัง (m³/h): สูงช่วงกลางวัน */
export const tankFlow = (k: ModelTankKey, ms: number) => {
  const { q, seed } = P[k], h = hrs(ms);
  return q * (1 + 0.6 * Math.sin((TAU * (h - 9)) / 24 + seed) + 0.2 * Math.sin((TAU * h) / 168 + seed));
};
const cum = (k: ModelTankKey, ms: number) => {
  const { q, seed } = P[k], h = hrs(ms);
  return q * (h - ((0.6 * 24) / TAU) * Math.cos((TAU * (h - 9)) / 24 + seed) - ((0.2 * 168) / TAU) * Math.cos((TAU * h) / 168 + seed));
};
/** เลขมิเตอร์น้ำเข้าถัง (m³) */
export const tankMeter = (k: ModelTankKey, ms: number) => P[k].meter0 + cum(k, ms) - cum(k, REF_MS);
/** ระดับน้ำ (%) */
export const tankLevelPct = (k: ModelTankKey, ms: number) => {
  const { seed } = P[k], h = hrs(ms);
  return 70 + 12 * Math.sin((TAU * (h - 14)) / 24 + seed) + 5 * Math.sin((TAU * h) / 168 + seed * 2);
};
/** ปริมาณน้ำในถัง (ลิตร) */
export const tankVolumeL = (k: ModelTankKey, ms: number) => (tankLevelPct(k, ms) / 100) * (TANK[k]?.cap ?? 0) * 1000;

/* ====================================================================== */
/* มิเตอร์น้ำประปาหลัก (จุดรับน้ำเข้าโรงงาน — key 'water' บนแผนผัง)        */
/* ====================================================================== */
const MAIN = { q: 2.6, meter0: 12845.6, seed: 0.3 };
/** อัตราการไหลผ่านมิเตอร์หลัก (m³/h) > 0 เสมอ */
export const mainFlow = (ms: number) => {
  const h = hrs(ms);
  return MAIN.q * (1 + 0.55 * Math.sin((TAU * (h - 8)) / 24 + MAIN.seed) + 0.2 * Math.sin((TAU * h) / 168 + MAIN.seed));
};
const mainCum = (ms: number) => {
  const h = hrs(ms);
  return MAIN.q * (h - ((0.55 * 24) / TAU) * Math.cos((TAU * (h - 8)) / 24 + MAIN.seed) - ((0.2 * 168) / TAU) * Math.cos((TAU * h) / 168 + MAIN.seed));
};
/** เลขมิเตอร์น้ำประปาหลัก (m³) */
export const mainMeter = (ms: number) => MAIN.meter0 + mainCum(ms) - mainCum(REF_MS);
