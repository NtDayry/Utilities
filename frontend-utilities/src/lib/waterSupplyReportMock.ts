/**
 * ⚠️ MOCKUP — รายงานระบบประปา (รูปแบบเดียวกับ /sensors/report)
 *
 * ตาราง (หัวแบบ span):
 *   มิเตอร์น้ำประปาหลัก : เลขมิเตอร์ (ไม่สรุป) | ปริมาณการใช้ (= แถวนี้ − แถวก่อนหน้า) | อัตราการไหล
 *   ทุกบ่อ/ถัง          : ระดับน้ำ (%) เท่านั้น — บ่อน้ำประปาโรงงานแยกบ่อ 1 / บ่อ 2 (คำนวณจากเซนเซอร์ระดับร่วม + ขนาดบ่อ)
 * กราฟ: อัตราการไหลของมิเตอร์หลัก + ระดับน้ำของทุกบ่อ/ถัง
 *
 * backend ยังไม่ได้เก็บข้อมูลระบบประปา และถังอื่นยังไม่มีเซนเซอร์ → เมื่อพร้อม เปลี่ยน fetchWaterSupplyReport ให้เรียก API จริง
 * (ใช้ key ชุดเดียวกัน) — UI ไม่ต้องแก้
 */
import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { SensorReportResponse } from '@_types/sensor';
import { calculateTanks, loadTankConfig } from '@/lib/tankCalculations';
import { WATER_HIGH_PCT, WATER_LOW_PCT } from '@/constants/waterSupply';
import { mainFlow, mainMeter, MODEL_TANKS, tankLevelPct, type ModelTankKey } from '@/lib/waterTankModel';
import { TANK_SITES } from '@/lib/waterTanks';
import {
  assembleMockReport,
  avgOver,
  mockBuckets,
  pickKeys,
  withDelay,
  type MockGroupSpec,
  type MockReportRequest,
  type MockSensorSpec,
} from '@/lib/reportMock';

export type WaterReportRequest = MockReportRequest;

export const WS_KEYS = {
  mainMeter: 'wm_meter',
  mainUsage: 'wm_usage',
  mainFlow: 'wm_flow',
  pond1Level: 'ws_t1_level',
  pond2Level: 'ws_t2_level',
} as const;
/** ระดับน้ำของถังอื่น */
export const wtLevelKey = (tank: ModelTankKey) => `wt_${tank}_level`;

const CHART = (k: string) => k === WS_KEYS.mainFlow || k.endsWith('_level');
const TABLE = (k: string) => k.startsWith('wm_') || k.endsWith('_level');
export const isWsChartKey = CHART;
export const isWsTableKey = TABLE;
export const pickSensors = (res: SensorReportResponse, keys: string[]) => pickKeys(res, (k) => keys.includes(k));

// ===== แบบจำลองระดับน้ำบ่อน้ำประปาโรงงาน (deterministic, ซม. ที่เซนเซอร์) =====
const REF_MS = Date.UTC(2020, 0, 1);
const DATA_START_MS = dayjs('2025-01-01').startOf('day').valueOf();
const TAU = 2 * Math.PI;
/** ระดับน้ำ (ซม.) ที่เซนเซอร์บ่อน้ำประปาโรงงาน — ใช้ร่วมกับรายงานระบบบ่อประปาและปั๊มน้ำ */
export const supplyLevelAt = (ms: number) => {
  const h = (ms - REF_MS) / 3_600_000;
  return 120 + 40 * Math.sin((TAU * h) / 24 - 1.2) + 10 * Math.sin((TAU * h) / 7.3) + 6 * Math.sin((TAU * h) / 720);
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildWaterSupplyReport(req: MockReportRequest, isEn = false): SensorReportResponse {
  const tr = i18n.getFixedT(isEn ? 'en' : 'th');
  const B = mockBuckets(req, DATA_START_MS);
  const cfg = loadTankConfig();
  const lvl = tr('water_supply.report_mock.water_level');
  const site = (k: string) => TANK_SITES.find((s) => s.key === k)!;
  const siteName = (k: string) => (isEn ? site(k).en : site(k).th);
  let id = 9500;

  // --- มิเตอร์น้ำประปาหลัก: ปริมาณการใช้ = ผลต่างของเลขมิเตอร์ที่แสดง (ลบกันในตารางได้พอดี)
  const mainName = tr('water_supply.report_mock.main_water_meter');
  const meter = B.map((b) => r1(mainMeter(b.end)));
  const m0 = B.length ? r1(mainMeter(B[0].start)) : 0;
  const usage = meter.map((m, i) => r1(m - (i === 0 ? m0 : meter[i - 1])));
  const flow = B.map((b) => (mainMeter(b.end) - mainMeter(b.start)) / ((b.end - b.start) / 3_600_000));
  const mainSensors: MockSensorSpec[] = [
    { id: id++, key: WS_KEYS.mainMeter, name: `${mainName} — ${tr('water_supply.report_mock.meter_reading')}`, unit: 'm³', dp: 1, columnGroup: mainName, columnLabel: tr('water_supply.report_mock.meter_reading'), summary: false, values: meter },
    { id: id++, key: WS_KEYS.mainUsage, name: `${mainName} — ${tr('water_supply.report_mock.usage')}`, unit: 'm³', dp: 1, columnGroup: mainName, columnLabel: tr('water_supply.report_mock.usage'), values: usage },
    { id: id++, key: WS_KEYS.mainFlow, name: `${mainName} — ${tr('water_supply.report_mock.flow_rate')}`, unit: 'm³/h', dp: 2, columnGroup: mainName, columnLabel: tr('water_supply.report_mock.flow_rate'), values: flow },
  ];

  // --- บ่อน้ำประปาโรงงาน: แยกระดับน้ำบ่อ 1 / บ่อ 2 (%)
  const pondPct = (pick: (c: ReturnType<typeof calculateTanks>) => number) =>
    B.map((b) => avgOver(b, (ms) => pick(calculateTanks(supplyLevelAt(ms), cfg))));
  const pond1 = tr('water_supply.report_mock.supply_tank_1');
  const pond2 = tr('water_supply.report_mock.supply_tank_2');
  const pondAlert = { min: WATER_LOW_PCT, max: WATER_HIGH_PCT };
  const levelSpec = (key: string, name: string, values: number[], alert: { min: number; max: number }): MockSensorSpec => ({
    id: id++, key, name: `${name} — ${lvl}`, unit: '%', dp: 1, columnGroup: name, columnLabel: lvl, alert, values,
  });

  const groups: MockGroupSpec[] = [
    { key: 'ws_main', index: 1, name: mainName, sub: tr('water_supply.report_mock.utility_water_intake'), sensors: mainSensors },
    {
      key: 'ws_pump',
      index: 2,
      name: siteName('pump'),
      sub: tr('water_supply.report_mock.tank_1_2_interconnected'),
      sensors: [
        levelSpec(WS_KEYS.pond1Level, pond1, pondPct((c) => c.tank1.percent), pondAlert),
        levelSpec(WS_KEYS.pond2Level, pond2, pondPct((c) => c.tank2.percent), pondAlert),
      ],
    },
  ];

  // --- ถัง/บ่ออื่น: ระดับน้ำเท่านั้น
  MODEL_TANKS.forEach((k, i) => {
    const s = site(k);
    groups.push({
      key: `ws_${k}`,
      index: i + 3,
      name: siteName(k),
      sub: isEn ? s.locationEn : s.locationTh,
      sensors: [levelSpec(wtLevelKey(k), siteName(k), B.map((b) => avgOver(b, (ms) => tankLevelPct(k, ms))), { min: s.lowPct, max: s.highPct })],
    });
  });

  return assembleMockReport(req, B, groups, 'water_supply_report_mock');
}

/** จำลองการเรียก API (มี delay เล็กน้อยให้ loading state ทำงานเหมือนจริง) */
export const fetchWaterSupplyReport = (req: MockReportRequest, isEn = false): Promise<SensorReportResponse> =>
  withDelay(() => buildWaterSupplyReport(req, isEn));

/** ค่าสดสำหรับป้าย LIVE (มิเตอร์หลัก + ถังที่ยังไม่มีเซนเซอร์ จากแบบจำลอง) */
export const modelLive = (ms: number) => ({
  [WS_KEYS.mainFlow]: mainFlow(ms),
  ...Object.fromEntries(MODEL_TANKS.map((k) => [wtLevelKey(k), tankLevelPct(k, ms)])),
});
