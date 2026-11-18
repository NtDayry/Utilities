/**
 * ⚠️ MOCKUP — รายงานระบบไฟฟ้า (รูปแบบเดียวกับ /sensors/report)
 * ใช้แบบจำลองเดียวกับหน้ารายละเอียดจุดวัด (lib/electricalPoints) → ตัวเลขตรงกันทุกหน้า
 *   {key}_meter = เลขมิเตอร์ ณ ปลายช่วง (kWh)                           → ตาราง
 *   {key}_kwh   = พลังงานที่ใช้ = เลขมิเตอร์แถวนี้ − แถวก่อนหน้า (kWh)     → ตาราง + กราฟ
 * ตารางใช้หัวคอลัมน์ 2 แถว: ชื่อจุดวัด (span) → เลขมิเตอร์ | พลังงานที่ใช้
 */
import { locEn, locTh } from '@/lib/locText';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import { ELECTRICAL_POINTS, energyBetween, meterAt, type ElectricalType } from '@/lib/electricalPoints';
import { assembleMockReport, mockBuckets, withDelay, type MockGroupSpec, type MockReportRequest } from '@/lib/reportMock';

const DATA_START_MS = dayjs('2025-01-01').startOf('day').valueOf();

export const EL_GROUPS: { id: string; types: ElectricalType[]; th: string; en: string }[] = [
  { id: 'el_main', types: ['main'], th: locTh('data.electrical_report.el_groups.el_main.name'), en: locEn('data.electrical_report.el_groups.el_main.name') },
  { id: 'el_tr', types: ['transformer'], th: locTh('data.electrical_report.el_groups.el_tr.name'), en: locEn('data.electrical_report.el_groups.el_tr.name') },
  { id: 'el_load', types: ['chiller', 'utility'], th: locTh('data.electrical_report.el_groups.el_load.name'), en: locEn('data.electrical_report.el_groups.el_load.name') },
];

export const isElChartKey = (k: string) => k.endsWith('_kwh');
export const isElTableKey = (k: string) => k.endsWith('_meter') || k.endsWith('_kwh');

export function buildElectricalReport(req: MockReportRequest, isEn = false) {
  const tr = i18n.getFixedT(isEn ? 'en' : 'th');
  const buckets = mockBuckets(req, DATA_START_MS);
  const stepMin = req.aggregate === '1mo' || req.aggregate === '1y' ? 60 : 15;
  let id = 9100;

  const groups: MockGroupSpec[] = EL_GROUPS.map((g, gi) => ({
    key: g.id,
    index: gi + 1,
    name: isEn ? g.en : g.th,
    sensors: ELECTRICAL_POINTS.filter((p) => g.types.includes(p.type)).flatMap((p) => {
      const name = isEn ? p.en : p.th;
      const energyRaw = buckets.map((b) => energyBetween(p, b.start, b.end, stepMin));
      // เลขมิเตอร์ ณ ปลายแต่ละช่วง (ทศนิยม 1 ตำแหน่ง): ค่าต้นช่วงแรก + พลังงานสะสม (คำนวณครั้งเดียว)
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const m0 = buckets.length ? r1(meterAt(p, buckets[0].start, stepMin)) : 0;
      let acc = buckets.length ? meterAt(p, buckets[0].start, stepMin) : 0;
      const meter = energyRaw.map((e) => r1((acc += e)));
      // พลังงานที่ใช้ = เลขมิเตอร์แถวนี้ − เลขมิเตอร์แถวก่อนหน้า (แถวแรกเทียบกับเลขมิเตอร์ต้นช่วง) → ลบกันในตารางได้พอดี
      const energy = meter.map((m, i) => r1(m - (i === 0 ? m0 : meter[i - 1])));
      return [
        {
          id: id++,
          key: `${p.key}_meter`,
          name: `${name} — ${tr('electrical.report_mock.meter')}`,
          unit: 'kWh',
          dp: 1,
          columnGroup: name,
          columnLabel: tr('electrical.report_mock.meter_reading'),
          summary: false, // ค่าสะสม — ไม่สรุป MIN/MAX/AVG
          values: meter,
        },
        {
          id: id++,
          key: `${p.key}_kwh`,
          name: `${name} — ${tr('electrical.report_mock.energy')}`,
          unit: 'kWh',
          dp: 1,
          columnGroup: name,
          columnLabel: tr('electrical.report_mock.energy_used'),
          values: energy,
        },
      ];
    }),
  }));

  return assembleMockReport(req, buckets, groups, 'electrical_report_mock');
}

export const fetchElectricalReport = (req: MockReportRequest, isEn = false) =>
  withDelay(() => buildElectricalReport(req, isEn));
