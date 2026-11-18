/**
 * ⚠️ MOCKUP — รายงานระบบบำบัดน้ำเสีย (รูปแบบเดียวกับ /sensors/report)
 * ใช้แบบจำลองเดียวกับหน้า dashboard/รายละเอียด (lib/wastewaterUnits)
 *
 * กราฟ : ระดับบ่อ EQ, น้ำเสียเข้า, DO บ่อเติมอากาศ, pH/COD/BOD/TSS น้ำทิ้ง
 * ตาราง: มิเตอร์น้ำเสียเข้า, ปริมาณน้ำเสียเข้า/น้ำทิ้งระบายต่อช่วง, คุณภาพน้ำทิ้งเฉลี่ย
 */
import dayjs from 'dayjs';
import i18n from '@/i18n';
import {
  dischargeBetween,
  inflowBetween,
  inflowMeterAt,
  paramOf,
  type WwUnitKey,
} from '@/lib/wastewaterUnits';
import { assembleMockReport, avgOver, mockBuckets, withDelay, type MockReportRequest, type MockSensorSpec } from '@/lib/reportMock';

const DATA_START_MS = dayjs('2025-01-01').startOf('day').valueOf();

const CHART = new Set(['ww_eq_level', 'ww_inflow_rate', 'ww_aer_do', 'ww_eff_ph', 'ww_eff_cod', 'ww_eff_bod', 'ww_eff_tss']);
const TABLE = new Set(['ww_inflow_meter', 'ww_inflow_vol', 'ww_discharge_vol', 'ww_eff_ph', 'ww_eff_cod', 'ww_eff_bod', 'ww_eff_tss']);
export const isWwChartKey = (k: string) => CHART.has(k);
export const isWwTableKey = (k: string) => TABLE.has(k);

export function buildWastewaterReport(req: MockReportRequest, isEn = false) {
  const B = mockBuckets(req, DATA_START_MS);
  const tr = i18n.getFixedT(isEn ? 'en' : 'th');
  const avgParam = (unit: WwUnitKey, id: string) => B.map((b) => avgOver(b, paramOf(unit, id).fn));
  const lim = (unit: WwUnitKey, id: string) => {
    const p = paramOf(unit, id);
    return { min: p.limit?.min ?? p.normal?.min ?? null, max: p.limit?.max ?? p.normal?.max ?? null };
  };

  const flow: MockSensorSpec[] = [
    { id: 9301, key: 'ww_inflow_meter', name: tr('wastewater.report_mock.inflow_meter'), unit: 'm³', dp: 1, summary: false, values: B.map((b) => inflowMeterAt(b.end)) },
    { id: 9302, key: 'ww_inflow_vol', name: tr('wastewater.report_mock.wastewater_inflow'), unit: 'm³', dp: 2, values: B.map((b) => inflowBetween(b.start, b.end)) },
    { id: 9303, key: 'ww_discharge_vol', name: tr('wastewater.report_mock.effluent_discharged'), unit: 'm³', dp: 2, values: B.map((b) => dischargeBetween(b.start, b.end)) },
    { id: 9304, key: 'ww_inflow_rate', name: tr('wastewater.report_mock.inflow_rate'), unit: 'm³/h', dp: 2, values: B.map((b) => inflowBetween(b.start, b.end) / ((b.end - b.start) / 3_600_000)) },
  ];
  const process: MockSensorSpec[] = [
    { id: 9311, key: 'ww_eq_level', name: tr('wastewater.report_mock.eq_tank_level'), unit: '%', dp: 1, alert: lim('eq', 'level'), values: avgParam('eq', 'level') },
    { id: 9312, key: 'ww_aer_do', name: tr('wastewater.report_mock.aeration_do'), unit: 'mg/L', dp: 2, alert: { min: 2, max: 4 }, values: avgParam('aer', 'do') },
  ];
  const effluent: MockSensorSpec[] = [
    { id: 9321, key: 'ww_eff_ph', name: tr('wastewater.report_mock.effluent_ph'), unit: '', dp: 2, alert: lim('pool', 'ph'), values: avgParam('pool', 'ph') },
    { id: 9322, key: 'ww_eff_cod', name: tr('wastewater.report_mock.effluent_cod'), unit: 'mg/L', dp: 1, alert: lim('pool', 'cod'), values: avgParam('pool', 'cod') },
    { id: 9323, key: 'ww_eff_bod', name: tr('wastewater.report_mock.effluent_bod'), unit: 'mg/L', dp: 1, alert: lim('pool', 'bod'), values: avgParam('pool', 'bod') },
    { id: 9324, key: 'ww_eff_tss', name: tr('wastewater.report_mock.effluent_tss'), unit: 'mg/L', dp: 1, alert: lim('pool', 'tss'), values: avgParam('pool', 'tss') },
  ];

  return assembleMockReport(
    req,
    B,
    [
      { key: 'ww_flow', index: 1, name: tr('wastewater.report_mock.flow_volume'), sensors: flow },
      { key: 'ww_process', index: 2, name: tr('wastewater.report_mock.treatment_process'), sensors: process },
      { key: 'ww_effluent', index: 3, name: tr('wastewater.report_mock.effluent_quality'), sub: tr('wastewater.report_mock.vs_moi_2017_standard'), sensors: effluent },
    ],
    'wastewater_report_mock'
  );
}

export const fetchWastewaterReport = (req: MockReportRequest, isEn = false) => withDelay(() => buildWastewaterReport(req, isEn));
