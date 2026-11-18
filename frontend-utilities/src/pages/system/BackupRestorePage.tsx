import { useTranslation } from 'react-i18next';
import PageBreadcrumb from '@/components/common/navigation/PageBreadCrumb';
import PageMeta from '@/components/common/page/PageMeta';
import BackupSettingsPanel from '@/components/system/settings/BackupSettingsPanel';

export default function BackupRestorePage() {
  const { t } = useTranslation();

  return (
    <>
      <PageMeta
        title={t('backup.meta_title')}
        description={t('backup.panel_subtitle')}
      />
      <PageBreadcrumb
        pageTitle={t('backup.panel_title')}
        pageSubTitle={t('backup.panel_subtitle')}
      />
      <BackupSettingsPanel />
    </>
  );
}
