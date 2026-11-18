import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import ReportPageLayout from '@/components/common/reports/ReportPageLayout';
import MockSensorReport from '@/components/common/reports/MockSensorReport';
import { useLiveSensorPush } from '@/components/common/reports/useLiveSensorPush';
import { useElectricalReportsStore, type AGGREGATE } from '@/store/reportsStore';
import { ELECTRICAL_POINTS, energyBetween } from '@/lib/electricalPoints';
import { fetchElectricalReport, isElChartKey, isElTableKey } from '@/lib/electricalReportMock';

/** ต้นช่วงเวลาปัจจุบันตาม aggregate (ตรงกับการแบ่งช่วงของรายงาน) */
function currentBucketStart(agg: AGGREGATE, now: number) {
  const d = dayjs(now);
  switch (agg) {
    case '30m':
      return d.startOf('hour').add(d.minute() >= 30 ? 30 : 0, 'minute').valueOf();
    case '1h':
      return d.startOf('hour').valueOf();
    case '1d':
      return d.startOf('day').valueOf();
    case '1mo':
      return d.startOf('month').valueOf();
    default:
      return d.startOf('year').valueOf();
  }
}

/**
 * รายงานระบบไฟฟ้า — หน้าตาเดียวกับรายงาน Purified Water (component ร่วม)
 * กราฟ: พลังงานที่ใช้ต่อช่วงของแต่ละจุด · ตาราง: เลขมิเตอร์ + พลังงานที่ใช้ (แถวนี้ − แถวก่อนหน้า)
 * ⚠️ MOCKUP (lib/electricalReportMock.ts)
 */
export default function ElectricalReports() {
  const { t } = useTranslation();

  // ค่า LIVE บนกราฟ = พลังงานที่ใช้ไปแล้วในช่วงปัจจุบัน (ตามช่วงเวลาที่เลือก: 30 นาที / ชั่วโมง / วัน / เดือน / ปี)
  const aggregate = useElectricalReportsStore((s) => s.dateRange.aggregate);
  useLiveSensorPush(
    (now) => {
      const start = currentBucketStart(aggregate, now);
      return Object.fromEntries(ELECTRICAL_POINTS.map((p) => [`${p.key}_kwh`, energyBetween(p, start, now)]));
    },
    [aggregate]
  );

  return (
    <ReportPageLayout
      metaTitle={t('electrical.report_title')}
      metaDescription="Electrical system report (mockup)"
      title={t('electrical.report_title')}
      subtitle={t('electrical.report_subtitle')}
      iconCls="text-amber-500"
      mockText={t('electrical.report_mock_desc')}
    >
      <MockSensorReport
        useStore={useElectricalReportsStore}
        fetcher={fetchElectricalReport}
        isChartKey={isElChartKey}
        isTableKey={isElTableKey}
        exportFilename="electrical_report"
        auditEntity="electrical_reports"
      />
    </ReportPageLayout>
  );
}
