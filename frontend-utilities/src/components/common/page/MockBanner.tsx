import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** ป้ายแจ้งว่าข้อมูลในหน้าเป็นข้อมูลจำลอง (Mockup) — ลบออกเมื่อเชื่อมข้อมูลจริง */
export default function MockBanner({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-warning-300 bg-warning-50/60 px-4 py-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-500/5 dark:text-warning-400">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <b>{t('water_supply.report.mock_title')}</b> — {text}
      </span>
    </div>
  );
}
