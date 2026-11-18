import { useTranslation } from 'react-i18next';
import PageBreadcrumb from '@/components/common/navigation/PageBreadCrumb';
import PageMeta from '@/components/common/page/PageMeta';
import MockBanner from '@/components/common/page/MockBanner';
import UtilityAlarmReport from '@/components/common/utility-alarms/UtilityAlarmReport';
import UtilityAlarmSettings from '@/components/common/utility-alarms/UtilityAlarmSettings';
import { SYSTEM_META } from '@/components/common/utility-alarms/meta';
import type { UtilitySystem } from '@/lib/utilityAlarms';

/**
 * หน้ารายงานการแจ้งเตือน / ตั้งค่าการแจ้งเตือน ของระบบประปา · ไฟฟ้า · บำบัดน้ำเสีย (ใช้ component ร่วม)
 * ⚠️ MOCKUP — ข้อมูลจาก lib/utilityAlarms (ประวัติจำลอง + การตั้งค่าเก็บใน localStorage)
 */
function Header({ system, kind }: { system: UtilitySystem; kind: 'report' | 'settings' }) {
  const { t } = useTranslation();
  const meta = SYSTEM_META[system];
  const title = t(`utility_alarms.page.${system}.${kind}_title`);
  return (
    <>
      <PageMeta title={title} description={t(`utility_alarms.page.${kind}_sub`)} />
      <PageBreadcrumb
        pageTitle={title}
        pageSubTitle={t(`utility_alarms.page.${kind}_sub`)}
        icon={<span className={`inline-flex rounded-xl p-2.5 ${meta.accentBg} ${meta.accent}`}>{meta.icon}</span>}
      />
      <div className="mb-6">
        <MockBanner text={t(`utility_alarms.page.${kind}_mock`)} />
      </div>
    </>
  );
}

export function UtilityAlarmReportPage({ system }: { system: UtilitySystem }) {
  return (
    <>
      <Header system={system} kind="report" />
      <UtilityAlarmReport key={system} system={system} />
    </>
  );
}

export function UtilityAlarmSettingsPage({ system }: { system: UtilitySystem }) {
  return (
    <>
      <Header system={system} kind="settings" />
      <UtilityAlarmSettings key={system} system={system} />
    </>
  );
}
