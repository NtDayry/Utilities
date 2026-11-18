/**
 * ⚠️ MOCKUP — รายงานระบบบ่อน้ำประปาโรงงานและปั๊มน้ำ (แสดงท้ายหน้า /water-supply/tanks/pump)
 * รูปแบบเดียวกับ /sensors/report → ใช้ component รายงานเดียวกับหน้ารายงานอื่น
 * เมื่อ backend เก็บข้อมูล MQTT ของระบบนี้แล้ว: เปลี่ยน fetchPumpStationReport ให้เรียก API (ใช้ key ชุดเดียวกัน)
 *
 * ค่าต่อช่วงเวลา (ตรวจไขว้กันได้):
 *   ระดับน้ำ (cm / %)            = เฉลี่ยในช่วง
 *   ปริมาณน้ำบ่อ 1 / 2 / รวม (L)  = คำนวณจากระดับน้ำ × ขนาดบ่อ (TankConfig) เฉลี่ยในช่วง
 *   เลขมิเตอร์ (m³)              = ค่ามิเตอร์น้ำเข้าบ่อ ณ ปลายช่วง — ไม่สรุป MIN/MAX/AVG
 *   ปริมาณน้ำเข้า (m³)            = เลขมิเตอร์แถวนี้ − แถวก่อนหน้า
 *   อัตราการไหลเฉลี่ย (m³/h)       = ปริมาณน้ำเข้า ÷ ชั่วโมงของช่วง
 *   ชั่วโมงเปิดวาล์ว / ชั่วโมงทำงานปั๊ม = เวลารวมที่ทำงานในช่วง (ชม.)
 *   ความถี่ / กระแสเฉลี่ย          = เฉลี่ยเฉพาะขณะปั๊มทำงาน (ไม่ทำงานทั้งช่วง = 0)
 */
import dayjs from 'dayjs';
import type { SensorReportResponse } from '@_types/sensor';
import { calculateTanks, loadTankConfig } from '@/lib/tankCalculations';
import { WATER_HIGH_PCT, WATER_LOW_PCT } from '@/constants/waterSupply';
import { supplyLevelAt } from '@/lib/waterSupplyReportMock';
import { assembleMockReport, mockBuckets, withDelay, type Bucket, type MockReportRequest, type MockSensorSpec } from '@/lib/reportMock';

const TAU = 2 * Math.PI;
const BKK_MS = 7 * 3_600_000;
const DATA_START_MS = dayjs('2025-01-01').startOf('day').valueOf();
const METER_START = 5_000; // เลขมิเตอร์ ณ วันเริ่มเก็บข้อมูล (สมมติ)
const STEP_MS = 15 * 60_000;

const hourOfDay = (ms: number) => (((ms + BKK_MS) / 3_600_000) % 24 + 24) % 24;
const dayIdx = (ms: number) => Math.floor((ms + BKK_MS) / 86_400_000);
const wob = (ms: number, seed: number) => {
  const h = ms / 3_600_000;
  return 0.5 * Math.sin(h * 1.3 + seed) + 0.3 * Math.sin(h * 3.1 + seed * 1.7) + 0.2 * Math.sin(h * 8.3 + seed * 0.4);
};

/** วาล์วน้ำเข้าเปิด = ระดับน้ำกำลังเพิ่มขึ้น */
const valveOpen = (ms: number) => supplyLevelAt(ms + 60_000) > supplyLevelAt(ms - 60_000);
/** อัตราน้ำเข้าบ่อ (m³/h) ขณะวาล์วเปิด */
const inflowRate = (ms: number) => (valveOpen(ms) ? 3 + 1 * Math.sin((TAU * hourOfDay(ms)) / 24) + 0.3 * wob(ms, 2) : 0);

// ความต้องการน้ำ (0–1): สูงช่วงกลางวัน
const demand = (ms: number) => 0.25 + 0.75 * Math.max(0, Math.sin((TAU * (hourOfDay(ms) - 7)) / 24)) + 0.05 * wob(ms, 5);
/** ปั๊มหลักสลับกันทุกวัน: ปั๊มหลักทำงานเมื่อมีความต้องการ, ปั๊มเสริมช่วงพีค */
function pumpState(idx: 1 | 2, ms: number) {
  const lead = dayIdx(ms) % 2 === 0 ? 1 : 2;
  const d = demand(ms);
  const on = idx === lead ? d > 0.35 : d > 0.85;
  const freq = on ? (idx === lead ? 30 + 18 * d : 30 + 18 * (d - 0.5)) : 0;
  return { on, freq, amp: on ? 0.22 * freq + 0.3 * wob(ms, idx * 7) : 0 };
}

/** อินทิเกรตเชิงตัวเลขทีละ 15 นาที (จุดกึ่งกลาง) */
function integrate(a: number, b: number, rate: (ms: number) => number) {
  let s = 0;
  for (let t = a; t < b; t += STEP_MS) {
    const dt = Math.min(STEP_MS, b - t);
    s += rate(t + dt / 2) * (dt / 3_600_000);
  }
  return s;
}
/** เฉลี่ยทีละ 15 นาที (สูงสุด ~200 จุด/ช่วง เพื่อความเร็ว) */
function sampleOver(b: Bucket, fn: (ms: number) => number) {
  const n = Math.max(1, Math.min(200, Math.ceil((b.end - b.start) / STEP_MS)));
  let s = 0;
  for (let i = 0; i < n; i++) s += fn(b.start + ((i + 0.5) * (b.end - b.start)) / n);
  return s / n;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export const PS_CHART_KEYS = new Set(['ps_level_cm', 'ps_flow', 'ps_p1_hz', 'ps_p2_hz']);
export const isPsChartKey = (k: string) => PS_CHART_KEYS.has(k);
export const isPsTableKey = () => true;

export function buildPumpStationReport(req: MockReportRequest, isEn = false): SensorReportResponse {
  const L = (th: string, en: string) => (isEn ? en : th);
  const B = mockBuckets(req, DATA_START_MS);
  const cfg = loadTankConfig();
  const hoursOf = (b: Bucket) => (b.end - b.start) / 3_600_000;

  // มิเตอร์: ค่าต้นช่วงแรก (อินทิเกรตจากวันเริ่มเก็บข้อมูลครั้งเดียว) + ปริมาณน้ำเข้าแต่ละช่วง
  let acc = B.length ? METER_START + integrate(DATA_START_MS, B[0].start, inflowRate) : METER_START;
  const m0 = r1(acc);
  const meter = B.map((b) => r1((acc += integrate(b.start, b.end, inflowRate))));
  const usage = meter.map((m, i) => r1(m - (i === 0 ? m0 : meter[i - 1])));

  const tanks = B.map((b) => {
    let cm = 0, pct = 0, v1 = 0, v2 = 0;
    const n = Math.max(1, Math.min(96, Math.ceil((b.end - b.start) / STEP_MS)));
    for (let i = 0; i < n; i++) {
      const lv = supplyLevelAt(b.start + ((i + 0.5) * (b.end - b.start)) / n);
      const c = calculateTanks(lv, cfg);
      cm += lv; pct += c.total.percent; v1 += c.tank1.volume_l; v2 += c.tank2.volume_l;
    }
    return { cm: cm / n, pct: pct / n, v1: v1 / n, v2: v2 / n };
  });

  const pump = (idx: 1 | 2) =>
    B.map((b) => {
      const n = Math.max(1, Math.min(200, Math.ceil((b.end - b.start) / STEP_MS)));
      let on = 0, hz = 0, amp = 0;
      for (let i = 0; i < n; i++) {
        const st = pumpState(idx, b.start + ((i + 0.5) * (b.end - b.start)) / n);
        if (st.on) { on++; hz += st.freq; amp += st.amp; }
      }
      return { hours: (on / n) * hoursOf(b), hz: on ? hz / on : 0, amp: on ? amp / on : 0 };
    });
  const p1 = pump(1), p2 = pump(2);

  const G = {
    level: L('ระดับน้ำ', 'Water Level'),
    volume: L('ปริมาณน้ำในบ่อ', 'Water in Tanks'),
    meter: L('มิเตอร์น้ำเข้าบ่อ', 'Inflow Meter'),
    valve: L('วาล์วน้ำเข้า', 'Inlet Valve'),
    p1: L('ปั๊มน้ำ 1', 'Pump 1'),
    p2: L('ปั๊มน้ำ 2', 'Pump 2'),
  };
  let id = 9700;
  const S = (key: string, group: string, label: string, unit: string, dp: number, values: number[], extra: Partial<MockSensorSpec> = {}): MockSensorSpec => ({
    id: id++, key, name: `${group} — ${label}`, unit, dp, columnGroup: group, columnLabel: label, values, ...extra,
  });
  const sensorHeightCm = (cfg.sensor_tank === 2 ? cfg.tank2.height_m : cfg.tank1.height_m) * 100;
  const pumpCols = (idx: 1 | 2, d: typeof p1) => {
    const g = idx === 1 ? G.p1 : G.p2;
    return [
      S(`ps_p${idx}_h`, g, L('ชั่วโมงทำงาน', 'Run hours'), 'h', 2, d.map((x) => x.hours)),
      S(`ps_p${idx}_hz`, g, L('ความถี่เฉลี่ย', 'Avg frequency'), 'Hz', 1, d.map((x) => x.hz)),
      S(`ps_p${idx}_a`, g, L('กระแสเฉลี่ย', 'Avg current'), 'A', 1, d.map((x) => x.amp)),
    ];
  };

  const sensors: MockSensorSpec[] = [
    S('ps_level_cm', G.level, L('ระดับน้ำ', 'Level'), 'cm', 1, tanks.map((x) => x.cm), {
      alert: { min: r1((WATER_LOW_PCT / 100) * sensorHeightCm), max: r1((WATER_HIGH_PCT / 100) * sensorHeightCm) },
    }),
    S('ps_level_pct', G.level, L('ระดับน้ำ', 'Level'), '%', 1, tanks.map((x) => x.pct), { alert: { min: WATER_LOW_PCT, max: WATER_HIGH_PCT } }),
    S('ps_vol_t1', G.volume, L('บ่อ 1', 'Tank 1'), 'L', 0, tanks.map((x) => x.v1)),
    S('ps_vol_t2', G.volume, L('บ่อ 2', 'Tank 2'), 'L', 0, tanks.map((x) => x.v2)),
    S('ps_vol_total', G.volume, L('รวม', 'Total'), 'L', 0, tanks.map((x) => x.v1 + x.v2)),
    S('ps_meter', G.meter, L('เลขมิเตอร์', 'Meter reading'), 'm³', 1, meter, { summary: false }),
    S('ps_usage', G.meter, L('ปริมาณน้ำเข้า', 'Inflow'), 'm³', 1, usage),
    S('ps_flow', G.meter, L('อัตราการไหลเฉลี่ย', 'Avg flow rate'), 'm³/h', 2, B.map((b, i) => usage[i] / hoursOf(b))),
    S('ps_valve_h', G.valve, L('ชั่วโมงเปิด', 'Open hours'), 'h', 2, B.map((b) => sampleOver(b, (ms) => Number(valveOpen(ms))) * hoursOf(b))),
    ...pumpCols(1, p1),
    ...pumpCols(2, p2),
  ];

  return assembleMockReport(
    req,
    B,
    [{ key: 'pump_station', index: 1, name: L('บ่อน้ำประปาโรงงานและปั๊มน้ำ', 'Water-Supply Tanks & Pumps'), sub: L('บ่อ 1 + บ่อ 2', 'Tank 1 + 2'), sensors }],
    'pump_station_report_mock'
  );
}

export const fetchPumpStationReport = (req: MockReportRequest, isEn = false) => withDelay(() => buildPumpStationReport(req, isEn));
