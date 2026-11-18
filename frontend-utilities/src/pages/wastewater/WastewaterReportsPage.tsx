import { useTranslation } from 'react-i18next';
import ReportPageLayout from '@/components/common/reports/ReportPageLayout';
import MockSensorReport from '@/components/common/reports/MockSensorReport';
import { useLiveSensorPush } from '@/components/common/reports/useLiveSensorPush';
import { useWastewaterReportsStore } from '@/store/reportsStore';
import { paramOf } from '@/lib/wastewaterUnits';
import { fetchWastewaterReport, isWwChartKey, isWwTableKey } from '@/lib/wastewaterReportMock';

/** ค่าสดของแต่ละ key รายงาน (ป้าย LIVE) */
const liveValues = (now: number) => ({
  ww_eq_level: paramOf('eq', 'level').fn(now),
  ww_inflow_rate: paramOf('eq', 'inflow').fn(now),
  ww_aer_do: paramOf('aer', 'do').fn(now),
  ww_eff_ph: paramOf('pool', 'ph').fn(now),
  ww_eff_cod: paramOf('pool', 'cod').fn(now),
  ww_eff_bod: paramOf('pool', 'bod').fn(now),
  ww_eff_tss: paramOf('pool', 'tss').fn(now),
});

/**
 * รายงานระบบบำบัดน้ำเสีย — หน้าตาเดียวกับรายงาน Purified Water (component ร่วม)
 * ⚠️ MOCKUP (lib/wastewaterReportMock.ts)
 */
export default function WastewaterReports() {
  const { t } = useTranslation();
  useLiveSensorPush(liveValues);

  return (
    <ReportPageLayout
      metaTitle={t('wastewater.report_title')}
      metaDescription="Wastewater treatment report (mockup)"
      title={t('wastewater.report_title')}
      subtitle={t('wastewater.report_subtitle')}
      iconCls="text-teal-500"
      mockText={t('wastewater.mock_desc')}
    >
      <MockSensorReport
        useStore={useWastewaterReportsStore}
        fetcher={fetchWastewaterReport}
        isChartKey={isWwChartKey}
        isTableKey={isWwTableKey}
        exportFilename="wastewater_report"
        auditEntity="wastewater_reports"
      />
    </ReportPageLayout>
  );
}
