/**
 * ตัวช่วยสร้างรายงานจำลอง (MOCKUP) ในรูปแบบ SensorReportResponse ของ /sensors/report
 * ใช้ร่วมกันระหว่างรายงานระบบไฟฟ้าและระบบบำบัดน้ำเสีย (ก่อนต่อ backend จริง)
 */
import dayjs, { type Dayjs } from 'dayjs';
import type { ReportGroup, ReportSensor, SensorReportResponse } from '@_types/sensor';
import type { AGGREGATE } from '@/store/reportsStore';

export interface MockReportRequest {
  start_time: string;
  stop_time: string;
  aggregate: AGGREGATE;
  page?: number;
  page_size?: number;
}

/** ช่วงเวลา 1 แถวของรายงาน: ts = ป้ายเวลา (ต้นช่วง), start/end = ช่วงที่มีข้อมูลจริง */
export interface Bucket {
  ts: string;
  start: number;
  end: number;
}

const STEP: Record<AGGREGATE, (d: Dayjs) => Dayjs> = {
  '30m': (d) => d.add(30, 'minute'),
  '1h': (d) => d.add(1, 'hour'),
  '1d': (d) => d.add(1, 'day'),
  '1mo': (d) => d.add(1, 'month'),
  '1y': (d) => d.add(1, 'year'),
};
const ALIGN: Record<AGGREGATE, (d: Dayjs) => Dayjs> = {
  '30m': (d) => d.startOf('hour').add(d.minute() >= 30 ? 30 : 0, 'minute'),
  '1h': (d) => d.startOf('hour'),
  '1d': (d) => d.startOf('day'),
  '1mo': (d) => d.startOf('month'),
  '1y': (d) => d.startOf('year'),
};

/** สร้างช่วงเวลาตาม aggregate (เรียงเก่า → ใหม่) ไม่เกินเวลาปัจจุบัน และไม่ก่อน dataStartMs */
export function mockBuckets(req: MockReportRequest, dataStartMs: number): Bucket[] {
  const startMs = Math.max(dayjs(req.start_time).valueOf(), dataStartMs);
  const stopMs = Math.min(dayjs(req.stop_time).valueOf(), Date.now());
  const out: Bucket[] = [];
  if (stopMs <= startMs) return out;
  for (let b = ALIGN[req.aggregate](dayjs(startMs)); b.valueOf() < stopMs; b = STEP[req.aggregate](b)) {
    const start = Math.max(b.valueOf(), startMs);
    const end = Math.min(STEP[req.aggregate](b).valueOf(), stopMs);
    if (end > start) out.push({ ts: b.toISOString(), start, end });
  }
  return out;
}

/** ค่าเฉลี่ยของฟังก์ชันในช่วง (สุ่มตัวอย่างจุดกึ่งกลาง สูงสุด maxSamples จุด) */
export function avgOver(b: Bucket, fn: (ms: number) => number, maxSamples = 48): number {
  const n = Math.max(1, Math.min(maxSamples, Math.ceil((b.end - b.start) / 300_000)));
  let s = 0;
  for (let i = 0; i < n; i++) s += fn(b.start + ((i + 0.5) * (b.end - b.start)) / n);
  return s / n;
}

/** ปริมาณสะสม (อินทิเกรต rate ต่อชั่วโมง) ในช่วง */
export const integrateOver = (b: Bucket, ratePerHour: (ms: number) => number, maxSamples = 96) =>
  avgOver(b, ratePerHour, maxSamples) * ((b.end - b.start) / 3_600_000);

export interface MockSensorSpec {
  id: number;
  key: string;
  name: string;
  unit: string;
  dp: number;
  alert?: { min?: number | null; max?: number | null };
  /** หัวตารางแบบ span (ไม่บังคับ) */
  columnGroup?: string;
  columnLabel?: string;
  /** false = ไม่สรุป MIN/MAX/AVG ของคอลัมน์นี้ (เช่น เลขมิเตอร์สะสม) */
  summary?: boolean;
  /** ค่าทุกแถว (เรียงตาม buckets เก่า → ใหม่) */
  values: number[];
}
export interface MockGroupSpec {
  key: string;
  index: number;
  name: string;
  sub?: string | null;
  sensors: MockSensorSpec[];
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));

/** ประกอบ response (ล่าสุดก่อน เหมือน backend) + สถิติทั้งช่วง + แบ่งหน้า */
export function assembleMockReport(
  req: MockReportRequest,
  buckets: Bucket[],
  groups: MockGroupSpec[],
  result: string
): SensorReportResponse {
  const total = buckets.length;
  const paginated = !!req.page && !!req.page_size && req.page_size > 0;
  const page = paginated ? Math.max(1, req.page!) : 1;
  const pageSize = paginated ? req.page_size! : total;
  const idx = [...buckets.keys()].reverse(); // ใหม่ → เก่า
  const pageIdx = paginated ? idx.slice((page - 1) * pageSize, page * pageSize) : idx;

  const data: ReportGroup[] = groups.map((g) => ({
    group_key: g.key,
    group_index: g.index,
    group_name: g.name,
    sub_group_name: g.sub ?? null,
    children: [],
    sensors: g.sensors.map((s): ReportSensor => {
      const all = s.values.map((v) => round(v, s.dp));
      return {
        id: s.id,
        key: s.key,
        name: s.name,
        unit: s.unit,
        color: null,
        decimal_places: s.dp,
        values: pageIdx.map((i) => all[i]),
        statistics: all.length
          ? { min: Math.min(...all), max: Math.max(...all), avg: all.reduce((a, b) => a + b, 0) / all.length }
          : { min: null, max: null, avg: null },
        alert_min: s.alert?.min ?? null,
        alert_max: s.alert?.max ?? null,
        column_group: s.columnGroup ?? null,
        column_label: s.columnLabel ?? null,
        ...(s.summary === false ? { summary: false } : {}),
      };
    }),
  }));

  return {
    status: 'success',
    meta: {
      result,
      table: 0,
      timestamps: pageIdx.map((i) => buckets[i].ts),
      time_range: { start: buckets[total - 1]?.ts ?? req.start_time, stop: buckets[0]?.ts ?? req.stop_time },
      total_count: total,
      ...(paginated ? { page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) } : {}),
    },
    data,
  };
}

/** เลือกเฉพาะ sensor ตาม key (กลุ่มที่ว่างจะถูกตัดออก) */
export function pickKeys(res: SensorReportResponse, keep: (key: string) => boolean): SensorReportResponse {
  return {
    ...res,
    data: res.data
      .map((g) => ({ ...g, sensors: g.sensors.filter((s) => keep(s.key)) }))
      .filter((g) => g.sensors.length > 0),
  };
}

export const withDelay = <T>(fn: () => T, ms = 250): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(fn()), ms));
