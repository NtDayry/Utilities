import { useTranslation } from 'react-i18next';
import ReportPageLayout from '@/components/common/reports/ReportPageLayout';
import SensorReport from '@/components/common/reports/SensorReport';

// คอลัมน์ที่ไม่สรุป MIN/MAX/AVG (ค่าสะสม เช่น เลขมิเตอร์)
const NO_SUMMARY_KEYS = new Set(['water_meter']);
const pwSummary = (key: string) => !NO_SUMMARY_KEYS.has(key);

export default function ReportsPage() {
  const { t } = useTranslation();

  return (
    <ReportPageLayout
      metaTitle={t('page.reports.meta_title')}
      metaDescription={t('page.reports.meta_description')}
      title={t('page.reports.title')}
      subtitle={t('page.reports.subtitle')}
      iconCls="text-sky-500"
    >
      <SensorReport summary={pwSummary} />
    </ReportPageLayout>
  );
}
