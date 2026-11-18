/**
 * ระบบบำบัดน้ำเสีย — รายการหน่วยบำบัด (ตรงกับวัตถุบนแผนผังโรงงาน) + แบบจำลองข้อมูล (MOCKUP)
 *
 * ⚠️ ค่าทั้งหมดเป็นข้อมูลจำลองแบบ deterministic (เวลาเดิม = ค่าเดิมทุกหน้า) จนกว่าจะติดตั้ง/เชื่อมเซนเซอร์จริง
 *
 * ความสัมพันธ์ของค่า (ตรวจไขว้กันได้):
 *   ปริมาตรบ่อ EQ = ปริมาตรตั้งต้น + ∫(น้ำเสียเข้า − น้ำที่สูบออก) → ระดับ %
 *   น้ำเสียเข้า/น้ำที่ระบาย สะสม = อินทิเกรตเชิงวิเคราะห์ของอัตราการไหล (มิเตอร์เพิ่มขึ้นตลอด)
 */
import { locEn, locTh } from '@/lib/locText';
import { URL } from '@/api';

export type WwUnitKey = 'eq' | 'eqpump' | 'aer' | 'anae' | 'sand' | 'pool' | 'panel';

/**
 * มาตรฐานควบคุมการระบายน้ำทิ้งจากโรงงาน (ประกาศกระทรวงอุตสาหกรรม พ.ศ. 2560) — ค่าอ้างอิงทั่วไป
 * ⚠️ โรงงานบางประเภท/พื้นที่อาจมีค่ากำหนดต่างกัน ให้ตรวจสอบกับเงื่อนไขใบอนุญาตของโรงงานก่อนใช้จริง
 */
export const EFFLUENT_LIMITS = {
  ph: { min: 5.5, max: 9.0 },
  temp: { max: 40 },
  tss: { max: 50 },
  bod: { max: 20 },
  cod: { max: 120 },
} as const;

/* ====================================================================== */
/* signal model                                                            */
/* ====================================================================== */
const TAU = 2 * Math.PI;
const REF_MS = Date.UTC(2020, 0, 1);
const hrs = (ms: number) => (ms - REF_MS) / 3_600_000;
const BKK_H = 7;
const wob = (ms: number, seed: number) => {
  const h = hrs(ms);
  return 0.5 * Math.sin(h * 1.3 + seed) + 0.3 * Math.sin(h * 3.7 + seed * 1.9) + 0.2 * Math.sin(h * 9.1 + seed * 0.6);
};

// อัตราไหลเข้า (m³/h): สูงช่วงทำงานกลางวัน · ไหลออก (สูบ/ระบาย): เฉลี่ยเท่ากัน แต่เรียบกว่าและล่าช้า → ไม่สะสมระยะยาว
const qIn = (ms: number) => {
  const h = hrs(ms) + BKK_H;
  return 1.8 + 1.4 * Math.sin((TAU * (h - 8)) / 24) + 0.3 * Math.sin((TAU * h) / 168);
};
const qOut = (ms: number) => {
  const h = hrs(ms) + BKK_H;
  return 1.8 + 0.6 * Math.sin((TAU * (h - 11)) / 24) + 0.3 * Math.sin((TAU * h) / 168 - 0.3);
};
// อินทิเกรตเชิงวิเคราะห์ (m³) ตั้งแต่ REF
const cumIn = (ms: number) => {
  const h = hrs(ms) + BKK_H;
  return 1.8 * h - ((1.4 * 24) / TAU) * Math.cos((TAU * (h - 8)) / 24) - ((0.3 * 168) / TAU) * Math.cos((TAU * h) / 168);
};
const cumOut = (ms: number) => {
  const h = hrs(ms) + BKK_H;
  return 1.8 * h - ((0.6 * 24) / TAU) * Math.cos((TAU * (h - 11)) / 24) - ((0.3 * 168) / TAU) * Math.cos((TAU * h) / 168 - 0.3);
};

export const EQ_CAPACITY_M3 = 30;
const EQ_V0 = 15;
const eqVolume = (ms: number) => Math.min(EQ_CAPACITY_M3, Math.max(0, EQ_V0 + cumIn(ms) - cumOut(ms) - (cumIn(REF_MS) - cumOut(REF_MS))));
const eqLevel = (ms: number) => (eqVolume(ms) / EQ_CAPACITY_M3) * 100;
const dayIndex = (ms: number) => Math.floor((ms + BKK_H * 3_600_000) / 86_400_000);
const hourOfDay = (ms: number) => (((ms / 3_600_000 + BKK_H) % 24) + 24) % 24;

const pump1On = (ms: number) => (dayIndex(ms) % 2 === 0 ? eqLevel(ms) > 35 : eqLevel(ms) > 65);
const pump2On = (ms: number) => (dayIndex(ms) % 2 === 1 ? eqLevel(ms) > 35 : eqLevel(ms) > 65);
const backwashOn = (ms: number) => {
  const h = hourOfDay(ms);
  return h >= 6 && h < 6 + 20 / 60; // ล้างย้อนทุกวัน 06:00–06:20
};
const sludgeLevel = (ms: number) => ((hrs(ms) / 24) % 21) / 21 * 85 + 5; // สะสม 21 วัน แล้วสูบตะกอนออก

/** มิเตอร์สะสม (m³) สำหรับรายงาน: อ้างอิงเลขเริ่มต้นสมมติ */
export const inflowMeterAt = (ms: number) => 8_500 + cumIn(ms) - cumIn(Date.UTC(2025, 0, 1));
export const dischargeMeterAt = (ms: number) => 8_200 + cumOut(ms) - cumOut(Date.UTC(2025, 0, 1));
export const inflowBetween = (a: number, b: number) => cumIn(b) - cumIn(a);
export const dischargeBetween = (a: number, b: number) => cumOut(b) - cumOut(a);

/* ====================================================================== */
/* units & parameters                                                      */
/* ====================================================================== */
export interface WwParam {
  id: string;
  th: string;
  en: string;
  unit: string;
  dp: number;
  kind?: 'value' | 'onoff';
  fn: (ms: number) => number;
  /** ช่วงทำงานที่เหมาะสม (หลุด = เฝ้าระวัง) */
  normal?: { min?: number; max?: number };
  /** ค่ามาตรฐาน/ขีดจำกัด (หลุด = เกินมาตรฐาน) */
  limit?: { min?: number; max?: number };
  chart?: boolean;
}

export interface WwUnit {
  key: WwUnitKey;
  objectId: string;
  stage: number; // ลำดับในกระบวนการ (0 = อุปกรณ์ควบคุม)
  th: string;
  en: string;
  shortTh: string;
  shortEn: string;
  params: WwParam[];
}

export const WW_UNITS: WwUnit[] = [
  {
    key: 'eq', objectId: 'o_wt_eq', stage: 1, th: locTh('data.wastewater_units.ww_units.eq.name'), en: locEn('data.wastewater_units.ww_units.eq.name'), shortTh: locTh('data.wastewater_units.ww_units.eq.short'), shortEn: locEn('data.wastewater_units.ww_units.eq.short'),
    params: [
      { id: 'level', th: locTh('data.wastewater_units.ww_units.eq.level.name'), en: locEn('data.wastewater_units.ww_units.eq.level.name'), unit: '%', dp: 1, fn: eqLevel, normal: { min: 20, max: 85 }, limit: { max: 95 }, chart: true },
      { id: 'inflow', th: locTh('data.wastewater_units.ww_units.eq.inflow.name'), en: locEn('data.wastewater_units.ww_units.eq.inflow.name'), unit: 'm³/h', dp: 2, fn: qIn, chart: true },
      { id: 'ph', th: locTh('data.wastewater_units.ww_units.eq.ph.name'), en: locEn('data.wastewater_units.ww_units.eq.ph.name'), unit: '', dp: 2, fn: (ms) => 7.1 + 0.5 * wob(ms, 3), normal: { min: 6, max: 9 }, chart: true },
    ],
  },
  {
    key: 'eqpump', objectId: 'o_wt_eqpump', stage: 2, th: locTh('data.wastewater_units.ww_units.eqpump.name'), en: locEn('data.wastewater_units.ww_units.eqpump.name'), shortTh: locTh('data.wastewater_units.ww_units.eqpump.short'), shortEn: locEn('data.wastewater_units.ww_units.eqpump.short'),
    params: [
      { id: 'p1', th: locTh('data.wastewater_units.ww_units.eqpump.p1.name'), en: locEn('data.wastewater_units.ww_units.eqpump.p1.name'), unit: '', dp: 0, kind: 'onoff', fn: (ms) => Number(pump1On(ms)) },
      { id: 'p2', th: locTh('data.wastewater_units.ww_units.eqpump.p2.name'), en: locEn('data.wastewater_units.ww_units.eqpump.p2.name'), unit: '', dp: 0, kind: 'onoff', fn: (ms) => Number(pump2On(ms)) },
      { id: 'flow', th: locTh('data.wastewater_units.ww_units.eqpump.flow.name'), en: locEn('data.wastewater_units.ww_units.eqpump.flow.name'), unit: 'm³/h', dp: 2, fn: qOut, chart: true },
      { id: 'amp', th: locTh('data.wastewater_units.ww_units.eqpump.amp.name'), en: locEn('data.wastewater_units.ww_units.eqpump.amp.name'), unit: 'A', dp: 1, fn: (ms) => (Number(pump1On(ms)) + Number(pump2On(ms))) * (4.2 + 0.2 * wob(ms, 5)), normal: { max: 10 }, chart: true },
    ],
  },
  {
    key: 'aer', objectId: 'o_wt_aer', stage: 3, th: locTh('data.wastewater_units.ww_units.aer.name'), en: locEn('data.wastewater_units.ww_units.aer.name'), shortTh: locTh('data.wastewater_units.ww_units.aer.short'), shortEn: locEn('data.wastewater_units.ww_units.aer.short'),
    params: [
      { id: 'do', th: locTh('data.wastewater_units.ww_units.aer.do.name'), en: locEn('data.wastewater_units.ww_units.aer.do.name'), unit: 'mg/L', dp: 2, fn: (ms) => 2.7 - 0.25 * (qIn(ms) - 1.8) + 0.35 * wob(ms, 7), normal: { min: 2, max: 4 }, limit: { min: 1 }, chart: true },
      { id: 'mlss', th: locTh('data.wastewater_units.ww_units.aer.mlss.name'), en: locEn('data.wastewater_units.ww_units.aer.mlss.name'), unit: 'mg/L', dp: 0, fn: (ms) => 3000 + 250 * wob(ms, 9), normal: { min: 2500, max: 3500 }, chart: true },
      { id: 'ph', th: locTh('data.wastewater_units.ww_units.aer.ph.name'), en: locEn('data.wastewater_units.ww_units.aer.ph.name'), unit: '', dp: 2, fn: (ms) => 7.3 + 0.25 * wob(ms, 11), normal: { min: 6.5, max: 8.5 }, chart: true },
      { id: 'temp', th: locTh('data.wastewater_units.ww_units.aer.temp.name'), en: locEn('data.wastewater_units.ww_units.aer.temp.name'), unit: '°C', dp: 1, fn: (ms) => 30.5 + 1.5 * Math.sin((TAU * (hourOfDay(ms) - 9)) / 24) + 0.3 * wob(ms, 13), normal: { max: 38 }, chart: true },
      { id: 'blower', th: locTh('data.wastewater_units.ww_units.aer.blower.name'), en: locEn('data.wastewater_units.ww_units.aer.blower.name'), unit: '', dp: 0, kind: 'onoff', fn: () => 1 },
    ],
  },
  {
    key: 'anae', objectId: 'o_wt_anae', stage: 4, th: locTh('data.wastewater_units.ww_units.anae.name'), en: locEn('data.wastewater_units.ww_units.anae.name'), shortTh: locTh('data.wastewater_units.ww_units.anae.short'), shortEn: locEn('data.wastewater_units.ww_units.anae.short'),
    params: [
      { id: 'sludge', th: locTh('data.wastewater_units.ww_units.anae.sludge.name'), en: locEn('data.wastewater_units.ww_units.anae.sludge.name'), unit: '%', dp: 1, fn: sludgeLevel, normal: { max: 75 }, limit: { max: 90 }, chart: true },
      { id: 'h2s', th: locTh('data.wastewater_units.ww_units.anae.h2s.name'), en: locEn('data.wastewater_units.ww_units.anae.h2s.name'), unit: 'ppm', dp: 2, fn: (ms) => Math.max(0, 1.6 + 1.0 * wob(ms, 17)), normal: { max: 5 }, limit: { max: 10 }, chart: true },
      { id: 'ph', th: locTh('data.wastewater_units.ww_units.anae.ph.name'), en: locEn('data.wastewater_units.ww_units.anae.ph.name'), unit: '', dp: 2, fn: (ms) => 7.0 + 0.2 * wob(ms, 19), normal: { min: 6.5, max: 7.5 }, chart: true },
    ],
  },
  {
    key: 'sand', objectId: 'o_wt_sand', stage: 5, th: locTh('data.wastewater_units.ww_units.sand.name'), en: locEn('data.wastewater_units.ww_units.sand.name'), shortTh: locTh('data.wastewater_units.ww_units.sand.short'), shortEn: locEn('data.wastewater_units.ww_units.sand.short'),
    params: [
      { id: 'turb', th: locTh('data.wastewater_units.ww_units.sand.turb.name'), en: locEn('data.wastewater_units.ww_units.sand.turb.name'), unit: 'NTU', dp: 2, fn: (ms) => 3.5 + 1.2 * wob(ms, 23) + 0.15 * ((hourOfDay(ms) + 18) % 24), normal: { max: 10 }, chart: true },
      { id: 'headloss', th: locTh('data.wastewater_units.ww_units.sand.headloss.name'), en: locEn('data.wastewater_units.ww_units.sand.headloss.name'), unit: 'm', dp: 2, fn: (ms) => 0.3 + 0.9 * (((hourOfDay(ms) - 6.34 + 24) % 24) / 24), normal: { max: 1.5 }, chart: true },
      { id: 'backwash', th: locTh('data.wastewater_units.ww_units.sand.backwash.name'), en: locEn('data.wastewater_units.ww_units.sand.backwash.name'), unit: '', dp: 0, kind: 'onoff', fn: (ms) => Number(backwashOn(ms)) },
    ],
  },
  {
    key: 'pool', objectId: 'o_pool', stage: 6, th: locTh('data.wastewater_units.ww_units.pool.name'), en: locEn('data.wastewater_units.ww_units.pool.name'), shortTh: locTh('data.wastewater_units.ww_units.pool.short'), shortEn: locEn('data.wastewater_units.ww_units.pool.short'),
    params: [
      { id: 'level', th: locTh('data.wastewater_units.ww_units.pool.level.name'), en: locEn('data.wastewater_units.ww_units.pool.level.name'), unit: '%', dp: 1, fn: (ms) => 70 + 6 * Math.sin((TAU * hrs(ms)) / 24 - 2) + 2 * wob(ms, 29), normal: { min: 20, max: 95 }, chart: true },
      { id: 'discharge', th: locTh('data.wastewater_units.ww_units.pool.discharge.name'), en: locEn('data.wastewater_units.ww_units.pool.discharge.name'), unit: 'm³/h', dp: 2, fn: qOut, chart: true },
      { id: 'ph', th: locTh('data.wastewater_units.ww_units.pool.ph.name'), en: locEn('data.wastewater_units.ww_units.pool.ph.name'), unit: '', dp: 2, fn: (ms) => 7.4 + 0.3 * wob(ms, 31), limit: EFFLUENT_LIMITS.ph, chart: true },
      { id: 'cod', th: locTh('data.wastewater_units.ww_units.pool.cod.name'), en: locEn('data.wastewater_units.ww_units.pool.cod.name'), unit: 'mg/L', dp: 1, fn: (ms) => 62 + 18 * wob(ms, 37), limit: EFFLUENT_LIMITS.cod, chart: true },
      { id: 'bod', th: locTh('data.wastewater_units.ww_units.pool.bod.name'), en: locEn('data.wastewater_units.ww_units.pool.bod.name'), unit: 'mg/L', dp: 1, fn: (ms) => 11 + 4.5 * wob(ms, 41), limit: EFFLUENT_LIMITS.bod, chart: true },
      { id: 'tss', th: locTh('data.wastewater_units.ww_units.pool.tss.name'), en: locEn('data.wastewater_units.ww_units.pool.tss.name'), unit: 'mg/L', dp: 1, fn: (ms) => 21 + 9 * wob(ms, 43), limit: EFFLUENT_LIMITS.tss, chart: true },
      { id: 'temp', th: locTh('data.wastewater_units.ww_units.pool.temp.name'), en: locEn('data.wastewater_units.ww_units.pool.temp.name'), unit: '°C', dp: 1, fn: (ms) => 30 + 1.8 * Math.sin((TAU * (hourOfDay(ms) - 9)) / 24) + 0.3 * wob(ms, 47), limit: EFFLUENT_LIMITS.temp, chart: true },
    ],
  },
  {
    key: 'panel', objectId: 'o_wwtp_panel', stage: 0, th: locTh('data.wastewater_units.ww_units.panel.name'), en: locEn('data.wastewater_units.ww_units.panel.name'), shortTh: locTh('data.wastewater_units.ww_units.panel.short'), shortEn: locEn('data.wastewater_units.ww_units.panel.short'),
    params: [
      { id: 'mode', th: locTh('data.wastewater_units.ww_units.panel.mode.name'), en: locEn('data.wastewater_units.ww_units.panel.mode.name'), unit: '', dp: 0, kind: 'onoff', fn: () => 1 },
      { id: 'kw', th: locTh('data.wastewater_units.ww_units.panel.kw.name'), en: locEn('data.wastewater_units.ww_units.panel.kw.name'), unit: 'kW', dp: 2, fn: (ms) => 7.5 + (Number(pump1On(ms)) + Number(pump2On(ms))) * 2.2 + 0.3 * wob(ms, 53), chart: true },
      { id: 'volt', th: locTh('data.wastewater_units.ww_units.panel.volt.name'), en: locEn('data.wastewater_units.ww_units.panel.volt.name'), unit: 'V', dp: 1, fn: (ms) => 400 + 4 * wob(ms, 59), normal: { min: 380, max: 420 }, chart: true },
    ],
  },
];

export const findWwUnit = (key?: string) => WW_UNITS.find((u) => u.key === key);
export const wwUnitPath = (key: WwUnitKey) => URL.WASTEWATER_UNIT_ROUTE.replace(':unitKey', key);
/** หน่วยตามลำดับกระบวนการ (ไม่รวมตู้ควบคุม) */
export const WW_PROCESS = WW_UNITS.filter((u) => u.stage > 0).sort((a, b) => a.stage - b.stage);

export type WwTone = 'ok' | 'warn' | 'error' | 'idle';
/** สถานะของค่า: เกินมาตรฐาน = error · หลุดช่วงเหมาะสม หรือความเข้มข้น (mg/L) ≥ 80% ของค่ามาตรฐาน = warn */
export function paramTone(p: WwParam, v: number): WwTone {
  if (p.kind === 'onoff') return v ? 'ok' : 'idle';
  const l = p.limit, n = p.normal;
  if (l && ((l.min !== undefined && v < l.min) || (l.max !== undefined && v > l.max))) return 'error';
  if (n && ((n.min !== undefined && v < n.min) || (n.max !== undefined && v > n.max))) return 'warn';
  if (p.unit === 'mg/L' && l?.max !== undefined && l.min === undefined && v >= 0.8 * l.max) return 'warn';
  return 'ok';
}
export function unitTone(u: WwUnit, ms: number): WwTone {
  const tones = u.params.map((p) => paramTone(p, p.fn(ms)));
  return tones.includes('error') ? 'error' : tones.includes('warn') ? 'warn' : 'ok';
}
export const paramOf = (u: WwUnitKey, id: string) => findWwUnit(u)!.params.find((p) => p.id === id)!;
