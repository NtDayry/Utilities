// รายการถัง/บ่อเก็บน้ำทั้งหมดในโรงงาน สำหรับหน้า dashboard รวมระบบน้ำ
// key ใช้ตัวเดียวกับแผนผังโรงงาน 3D (lib/factorySensors.ts) เพื่อให้ขยายต่อได้ง่าย
import { locEn, locTh } from '@/lib/locText';
import { URL } from '@/api';
import { TANK, type MeterKey } from '@/lib/factorySensors';
import { OBJECTS } from '@/lib/factoryBuildings';

export type TankGroup = 'supply' | 'pw' | 'effluent';

/**
 * แหล่งข้อมูลของแต่ละจุด
 * - water-supply-mqtt : MQTT topic water-system (บ่อน้ำประปา 2 บ่อ + ปั๊ม)
 * - pw-sensor-mqtt    : ค่าสด Purified Water จาก MQTT (distribution_loop.water_level)
 * - none              : ยังไม่ได้ติดตั้ง/เชื่อมต่อเซนเซอร์
 */
export type TankSource = 'water-supply-mqtt' | 'pw-sensor-mqtt' | 'none';

export interface TankSite {
  key: MeterKey;
  objectId: string; // id ใน OBJECTS/ROOMS ของแผนผังโรงงาน
  group: TankGroup;
  th: string;
  en: string;
  locationTh: string;
  locationEn: string;
  unitCountTh?: string;
  unitCountEn?: string;
  source: TankSource;
  capacity_m3: number;
  height_m: number;
  lowPct: number;
  highPct: number;
  detailPath: string;
  /**
   * true = จุดนี้เป็น "ระบบน้ำ" ที่ตั้งค่าได้จากหน้าเว็บ (lib/waterSystems/builtins.ts, id = key)
   * หน้าภาพรวมแสดงจากรายการระบบแทน และ detailPath ชี้ไปหน้าของระบบ (/water-supply/systems/:id)
   */
  managed?: boolean;
}

export const TANK_GROUPS: { id: TankGroup; th: string; en: string; descTh: string; descEn: string }[] = [
  { id: 'supply', th: locTh('data.water_tanks.tank_groups.supply.name'), en: locEn('data.water_tanks.tank_groups.supply.name'), descTh: locTh('data.water_tanks.tank_groups.supply.desc'), descEn: locEn('data.water_tanks.tank_groups.supply.desc') },
  { id: 'pw', th: locTh('data.water_tanks.tank_groups.pw.name'), en: locEn('data.water_tanks.tank_groups.pw.name'), descTh: locTh('data.water_tanks.tank_groups.pw.desc'), descEn: locEn('data.water_tanks.tank_groups.pw.desc') },
  { id: 'effluent', th: locTh('data.water_tanks.tank_groups.effluent.name'), en: locEn('data.water_tanks.tank_groups.effluent.name'), descTh: locTh('data.water_tanks.tank_groups.effluent.desc'), descEn: locEn('data.water_tanks.tank_groups.effluent.desc') },
];

export const tankDetailPath = (key: MeterKey) => URL.WATER_TANK_DETAIL_ROUTE.replace(':tankKey', key);
export const waterSystemPath = (id: string) => URL.WATER_SYSTEM_ROUTE.replace(':systemId', id);

const cap = (k: MeterKey) => TANK[k] ?? { cap: 0, h: 0 };

export const TANK_SITES: TankSite[] = [
  {
    key: 'pump',
    objectId: 'o_pump',
    group: 'supply',
    th: locTh('data.water_tanks.tank_sites.pump.name'),
    en: locEn('data.water_tanks.tank_sites.pump.name'),
    locationTh: locTh('data.water_tanks.tank_sites.pump.location'),
    locationEn: locEn('data.water_tanks.tank_sites.pump.location'),
    unitCountTh: locTh('data.water_tanks.tank_sites.pump.unit_count'),
    unitCountEn: locEn('data.water_tanks.tank_sites.pump.unit_count'),
    source: 'water-supply-mqtt',
    capacity_m3: cap('pump').cap, // ค่าจริงคำนวณจากขนาดบ่อใน TankConfig
    height_m: cap('pump').h,
    lowPct: 20,
    highPct: 95,
    detailPath: URL.WATER_SUPPLY_DETAILS,
  },
  {
    key: 'tank14',
    objectId: 'o_tank14',
    group: 'supply',
    th: locTh('data.water_tanks.tank_sites.tank14.name'),
    en: locEn('data.water_tanks.tank_sites.tank14.name'),
    locationTh: locTh('data.water_tanks.tank_sites.tank14.location'),
    locationEn: locEn('data.water_tanks.tank_sites.tank14.location'),
    source: 'none',
    capacity_m3: cap('tank14').cap,
    height_m: cap('tank14').h,
    lowPct: 20,
    highPct: 98,
    detailPath: waterSystemPath('tank14'),
    managed: true,
  },
  {
    key: 'b5tank',
    objectId: 'o_b5tank',
    group: 'supply',
    th: locTh('data.water_tanks.tank_sites.b5tank.name'),
    en: locEn('data.water_tanks.tank_sites.b5tank.name'),
    locationTh: locTh('data.water_tanks.tank_sites.b5tank.location'),
    locationEn: locEn('data.water_tanks.tank_sites.b5tank.location'),
    unitCountTh: locTh('data.water_tanks.tank_sites.b5tank.unit_count'),
    unitCountEn: locEn('data.water_tanks.tank_sites.b5tank.unit_count'),
    source: 'none',
    capacity_m3: cap('b5tank').cap,
    height_m: cap('b5tank').h,
    lowPct: 20,
    highPct: 98,
    detailPath: waterSystemPath('b5tank'),
    managed: true,
  },
  {
    key: 'whtank',
    objectId: 'o_whtank',
    group: 'supply',
    th: locTh('data.water_tanks.tank_sites.whtank.name'),
    en: locEn('data.water_tanks.tank_sites.whtank.name'),
    locationTh: locTh('data.water_tanks.tank_sites.whtank.location'),
    locationEn: locEn('data.water_tanks.tank_sites.whtank.location'),
    unitCountTh: locTh('data.water_tanks.tank_sites.whtank.unit_count'),
    unitCountEn: locEn('data.water_tanks.tank_sites.whtank.unit_count'),
    source: 'none',
    capacity_m3: cap('whtank').cap,
    height_m: cap('whtank').h,
    lowPct: 20,
    highPct: 98,
    detailPath: waterSystemPath('whtank'),
    managed: true,
  },
  {
    key: 'pwtank',
    objectId: 'r_pw',
    group: 'pw',
    th: locTh('data.water_tanks.tank_sites.pwtank.name'),
    en: locEn('data.water_tanks.tank_sites.pwtank.name'),
    locationTh: locTh('data.water_tanks.tank_sites.pwtank.location'),
    locationEn: locEn('data.water_tanks.tank_sites.pwtank.location'),
    source: 'pw-sensor-mqtt',
    capacity_m3: cap('pwtank').cap,
    height_m: cap('pwtank').h,
    lowPct: 20,
    highPct: 95,
    detailPath: URL.PURIFIED_WATER_DASHBOARD,
  },
  {
    key: 'pool',
    objectId: 'o_pool',
    group: 'effluent',
    th: locTh('data.water_tanks.tank_sites.pool.name'),
    en: locEn('data.water_tanks.tank_sites.pool.name'),
    locationTh: locTh('data.water_tanks.tank_sites.pool.location'),
    locationEn: locEn('data.water_tanks.tank_sites.pool.location'),
    source: 'none',
    capacity_m3: cap('pool').cap,
    height_m: cap('pool').h,
    lowPct: 20,
    highPct: 98,
    detailPath: URL.WASTEWATER_UNIT_ROUTE.replace(':unitKey', 'pool'), // หน้าหน่วยบำบัด (มีคุณภาพน้ำทิ้ง)
  },
];

export const findTankSite = (key?: string) => TANK_SITES.find((s) => s.key === key);

/** คำอธิบายจุดจากแผนผังโรงงาน (ถ้ามี) */
export const tankNote = (site: TankSite, isEn: boolean): string | undefined => {
  const o = OBJECTS.find((x) => x.id === site.objectId);
  return (isEn ? o?.noteEn : o?.note) || undefined;
};
