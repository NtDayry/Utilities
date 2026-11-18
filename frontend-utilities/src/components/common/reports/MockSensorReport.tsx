import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SensorReportResponse } from '@_types/sensor';
import type { ReportsState } from '@/store/reportsStore';
import { pickKeys, type MockReportRequest } from '@/lib/reportMock';
import SensorReport from '@/components/common/reports/SensorReport';

/**
 * รายงานที่ใช้ข้อมูลจำลอง (mock) — ใช้ SensorReport ตัวเดียวกับ Purified Water
 * ส่งเพียง: store ตัวกรอง, ฟังก์ชันสร้างข้อมูล, key ที่แสดงในกราฟ/ตาราง และชื่อไฟล์ export
 *
 * ⚠️ `isChartKey` / `isTableKey` / `fetcher` ควรเป็นฟังก์ชันระดับ module (reference คงที่)
 */
export default function MockSensorReport({
  useStore,
  fetcher,
  isChartKey,
  isTableKey,
  exportFilename,
  auditEntity,
}: {
  useStore: () => ReportsState;
  fetcher: (req: MockReportRequest, isEn: boolean) => Promise<SensorReportResponse>;
  isChartKey: (key: string) => boolean;
  isTableKey: (key: string) => boolean;
  exportFilename: string;
  auditEntity: string;
}) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const fetchReport = useCallback((req: MockReportRequest) => fetcher(req, isEn), [fetcher, isEn]);
  const selectChart = useMemo(() => (d: SensorReportResponse) => pickKeys(d, isChartKey), [isChartKey]);
  const selectTable = useMemo(() => (d: SensorReportResponse) => pickKeys(d, isTableKey), [isTableKey]);

  return (
    <SensorReport
      useStore={useStore}
      fetchReport={fetchReport}
      fetchTablePage={fetchReport}
      selectChartData={selectChart}
      selectTableData={selectTable}
      loadSensorMeta={false}
      sensorWebSocket={false}
      exportFilename={exportFilename}
      auditEntity={auditEntity}
    />
  );
}
