import { locEn, locTh } from '@/lib/locText';
// รายการเซ็นเซอร์บนแผนผังโรงงาน 3 มิติ + ช่องรายละเอียดที่แต่ละจุดแสดงได้ (ใช้ร่วมกันระหว่างหน้าแผนผังและหน้าตั้งค่า)
// key = ตัวเดียวกับที่ส่งให้ scene.setMeter()

export type MeterKey =
  | 'water' | 'power' | 'tr1' | 'tr2' | 'tr3' | 'tr4' | 'tr5'
  | 'tank14' | 'b5tank' | 'pump' | 'pool' | 'b5chiller' | 'chiller' | 'cda'
  | 'pwtank' | 'pwvel' | 'whtank'
  | 'ww_eq' | 'ww_aer' | 'ww_sand' | 'ww_anae';   // ระบบบำบัดน้ำเสีย

export type SensorGroup = 'power' | 'transformer' | 'water' | 'pw' | 'wastewater';
// also = key อื่นที่รวมอยู่ในแถวเดียวกัน (เปิด/ปิด, alarm, ช่องรายละเอียด ตั้งค่าร่วมกันผ่าน key หลัก)
export type SensorInfo = { key: MeterKey; also?: MeterKey[]; group: SensorGroup; th: string; en: string; unit: string };

export const SENSOR_GROUPS: { id: SensorGroup; th: string; en: string }[] = [
  { id: 'power', th: locTh('data.factory_sensors.sensor_groups.power.name'), en: locEn('data.factory_sensors.sensor_groups.power.name') },
  { id: 'transformer', th: locTh('data.factory_sensors.sensor_groups.transformer.name'), en: locEn('data.factory_sensors.sensor_groups.transformer.name') },
  { id: 'water', th: locTh('data.factory_sensors.sensor_groups.water.name'), en: locEn('data.factory_sensors.sensor_groups.water.name') },
  { id: 'pw', th: locTh('data.factory_sensors.sensor_groups.pw.name'), en: locEn('data.factory_sensors.sensor_groups.pw.name') },
  { id: 'wastewater', th: locTh('data.factory_sensors.sensor_groups.wastewater.name'), en: locEn('data.factory_sensors.sensor_groups.wastewater.name') },
];

export const SENSORS: SensorInfo[] = [
  { key: 'power', group: 'power', th: locTh('data.factory_sensors.sensors.power.name'), en: locEn('data.factory_sensors.sensors.power.name'), unit: 'kWh' },
  { key: 'tr1', group: 'transformer', th: locTh('data.factory_sensors.sensors.tr1.name'), en: locEn('data.factory_sensors.sensors.tr1.name'), unit: 'kWh' },
  { key: 'tr2', group: 'transformer', th: locTh('data.factory_sensors.sensors.tr2.name'), en: locEn('data.factory_sensors.sensors.tr2.name'), unit: 'kWh' },
  { key: 'tr3', group: 'transformer', th: locTh('data.factory_sensors.sensors.tr3.name'), en: locEn('data.factory_sensors.sensors.tr3.name'), unit: 'kWh' },
  { key: 'tr4', group: 'transformer', th: locTh('data.factory_sensors.sensors.tr4.name'), en: locEn('data.factory_sensors.sensors.tr4.name'), unit: 'kWh' },
  { key: 'tr5', group: 'transformer', th: locTh('data.factory_sensors.sensors.tr5.name'), en: locEn('data.factory_sensors.sensors.tr5.name'), unit: 'kWh' },
  { key: 'b5chiller', group: 'power', th: locTh('data.factory_sensors.sensors.b5chiller.name'), en: locEn('data.factory_sensors.sensors.b5chiller.name'), unit: 'kWh' },
  { key: 'chiller', group: 'power', th: locTh('data.factory_sensors.sensors.chiller.name'), en: locEn('data.factory_sensors.sensors.chiller.name'), unit: 'kWh' },
  { key: 'cda', group: 'power', th: locTh('data.factory_sensors.sensors.cda.name'), en: locEn('data.factory_sensors.sensors.cda.name'), unit: 'kWh' },
  { key: 'water', group: 'water', th: locTh('data.factory_sensors.sensors.water.name'), en: locEn('data.factory_sensors.sensors.water.name'), unit: 'm³' },
  { key: 'pump', group: 'water', th: locTh('data.factory_sensors.sensors.pump.name'), en: locEn('data.factory_sensors.sensors.pump.name'), unit: '%' },
  { key: 'tank14', group: 'water', th: locTh('data.factory_sensors.sensors.tank14.name'), en: locEn('data.factory_sensors.sensors.tank14.name'), unit: '%' },
  { key: 'b5tank', group: 'water', th: locTh('data.factory_sensors.sensors.b5tank.name'), en: locEn('data.factory_sensors.sensors.b5tank.name'), unit: '%' },
  { key: 'whtank', group: 'water', th: locTh('data.factory_sensors.sensors.whtank.name'), en: locEn('data.factory_sensors.sensors.whtank.name'), unit: '%' },
  { key: 'pool', group: 'wastewater', th: locTh('data.factory_sensors.sensors.pool.name'), en: locEn('data.factory_sensors.sensors.pool.name'), unit: '%' },
  { key: 'pwtank', also: ['pwvel'], group: 'pw', th: locTh('data.factory_sensors.sensors.pwtank.name'), en: locEn('data.factory_sensors.sensors.pwtank.name'), unit: '% · m/s' },
  { key: 'ww_eq', group: 'wastewater', th: locTh('data.factory_sensors.sensors.ww_eq.name'), en: locEn('data.factory_sensors.sensors.ww_eq.name'), unit: '%' },
  { key: 'ww_aer', group: 'wastewater', th: locTh('data.factory_sensors.sensors.ww_aer.name'), en: locEn('data.factory_sensors.sensors.ww_aer.name'), unit: 'mg/L' },
  { key: 'ww_sand', group: 'wastewater', th: locTh('data.factory_sensors.sensors.ww_sand.name'), en: locEn('data.factory_sensors.sensors.ww_sand.name'), unit: 'NTU' },
  { key: 'ww_anae', group: 'wastewater', th: locTh('data.factory_sensors.sensors.ww_anae.name'), en: locEn('data.factory_sensors.sensors.ww_anae.name'), unit: '%' },
];

// ===== ค่าตั้งต้นของแต่ละจุด (ใช้คำนวณค่าที่อนุมานได้ / ค่าจำลอง) =====
export const POWER_KW: Partial<Record<MeterKey, number>> = { power: 320, tr1: 420, tr2: 280, tr3: 350, tr4: 190, tr5: 240, b5chiller: 110, chiller: 85, cda: 55 };   // กำลังไฟฟ้าเฉลี่ย (kW)
export const TR_KVA: Partial<Record<MeterKey, number>> = { tr1: 1000, tr2: 800, tr3: 1000, tr4: 630, tr5: 800 };   // พิกัดหม้อแปลง (kVA)
export const TANK: Partial<Record<MeterKey, { cap: number; h: number }>> = {   // ความจุ (m³) + ความสูงถัง (m) → ปริมาตร/ความสูงน้ำ
  tank14: { cap: 120, h: 3 }, pool: { cap: 350, h: 1.5 }, b5tank: { cap: 10, h: 2 }, pump: { cap: 80, h: 2.5 }, pwtank: { cap: 2, h: 2.2 } /* ถัง PW 2,000 L = ช่วงเซนเซอร์ distribution_loop.water_level 0–2000 Liter */, whtank: { cap: 9, h: 2.4 },
};
export const PIPE_DN = 65;
export const TR_PF = 0.8;   // ตัวประกอบกำลังมาตรฐานที่ใช้แปลงพิกัด kVA → kW ของหม้อแปลง

// ===== ช่องรายละเอียด (แสดงในกล่องข้อมูลเมื่อคลิกจุดนั้น) =====
export type DetailId =
  | 'size' | 'kw' | 'a' | 'v' | 'pf' | 'hz'                   // มิเตอร์ไฟ / หม้อแปลง (หม้อแปลงเพิ่ม size)
  | 'flow' | 'meter' | 'press' | 'vol' | 'height'            // ระบบน้ำ (ทุกจุดใช้ชุดเดียวกัน เลือกเปิด/ปิดในหน้าตั้งค่า)
  | 'liters' | 'uv' | 'toc' | 'cond';                        // Purified Water
export type DetailField = { id: DetailId; th: string; en: string; u: string };

const WATER_FIELDS: DetailField[] = [
  { id: 'flow', th: locTh('data.factory_sensors.water_fields.flow.name'), en: locEn('data.factory_sensors.water_fields.flow.name'), u: 'm³/h' },
  { id: 'meter', th: locTh('data.factory_sensors.water_fields.meter.name'), en: locEn('data.factory_sensors.water_fields.meter.name'), u: 'm³' },
  { id: 'press', th: locTh('data.factory_sensors.water_fields.press.name'), en: locEn('data.factory_sensors.water_fields.press.name'), u: 'bar' },
  { id: 'vol', th: locTh('data.factory_sensors.water_fields.vol.name'), en: locEn('data.factory_sensors.water_fields.vol.name'), u: 'm³' },
  { id: 'height', th: locTh('data.factory_sensors.water_fields.height.name'), en: locEn('data.factory_sensors.water_fields.height.name'), u: 'm' },
];

export function detailFields(k: MeterKey): DetailField[] {
  if (POWER_KW[k] !== undefined) {
    const kva = TR_KVA[k];
    return [
      ...(kva ? [{ id: 'size' as const, th: locTh('data.factory_sensors.size.name'), en: locEn('data.factory_sensors.size.name'), u: '' }] : []),
      { id: 'kw', th: locTh('data.factory_sensors.kw.name'), en: locEn('data.factory_sensors.kw.name'), u: 'kW' },
      { id: 'a', th: locTh('data.factory_sensors.a.name'), en: locEn('data.factory_sensors.a.name'), u: 'A' },
      { id: 'v', th: locTh('data.factory_sensors.v.name'), en: locEn('data.factory_sensors.v.name'), u: 'V' },
      { id: 'pf', th: locTh('data.factory_sensors.pf.name'), en: locEn('data.factory_sensors.pf.name'), u: '' },
      { id: 'hz', th: locTh('data.factory_sensors.hz.name'), en: locEn('data.factory_sensors.hz.name'), u: 'Hz' },
    ];
  }
  if (k === 'pwtank') return [{ id: 'liters', th: locTh('data.factory_sensors.liters.name'), en: locEn('data.factory_sensors.liters.name'), u: 'L' }];
  if (k === 'pwvel') return [
    { id: 'flow', th: locTh('data.factory_sensors.flow_dn.name', { dn: PIPE_DN }), en: locEn('data.factory_sensors.flow_dn.name', { dn: PIPE_DN }), u: 'm³/h' },
    { id: 'uv', th: locTh('data.factory_sensors.uv.name'), en: locEn('data.factory_sensors.uv.name'), u: '' },
    { id: 'toc', th: locTh('data.factory_sensors.toc.name'), en: locEn('data.factory_sensors.toc.name'), u: 'ppb' },
    { id: 'cond', th: locTh('data.factory_sensors.cond.name'), en: locEn('data.factory_sensors.cond.name'), u: 'µS/cm' },
  ];
  if (SENSORS.find((s) => s.key === k)?.group === 'water' || k === 'pool') return WATER_FIELDS;
  return [];
}

// ช่องที่ซ่อนเป็นค่าเริ่มต้น (ไม่มีข้อมูลสำหรับจุดนั้น) — เปิดเองได้ในหน้าตั้งค่า
export const DEFAULT_HIDDEN: Partial<Record<MeterKey, DetailId[]>> = { water: ['vol', 'height'] };
export const hiddenOf = (hf: Partial<Record<MeterKey, DetailId[]>>, k: MeterKey): DetailId[] => hf[k] ?? DEFAULT_HIDDEN[k] ?? [];

// แถวในหน้าตั้งค่า ↔ key ของมิเตอร์ (Distribution Loop = pwtank + pwvel)
export const sensorKeys = (s: SensorInfo): MeterKey[] => [s.key, ...(s.also ?? [])];
export const primaryOf = (k: MeterKey): MeterKey => SENSORS.find((s) => s.key === k || s.also?.includes(k))?.key ?? k;
export const sensorFields = (s: SensorInfo): DetailField[] => sensorKeys(s).flatMap(detailFields);
