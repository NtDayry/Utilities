import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * หัวหน้าเพจแบบการ์ด (ไอคอนไล่สี + ชื่อหน้า + คำอธิบาย) ใช้ร่วมกันทุกหน้า dashboard / รายละเอียด
 * - `actions`  : ปุ่มด้านขวาของหัว (เช่น ลิงก์ไปหน้ารายงาน)
 * - `footer`   : แถวล่างคั่นเส้น (เช่น BackNav + ป้ายสถานะ) สำหรับหน้ารายละเอียด
 */
export default function PageHero({
  icon,
  gradientCls,
  title,
  subtitle,
  actions,
  footer,
  darkBgCls = 'dark:bg-white/[0.03]',
}: {
  icon: ReactNode;
  /** สีไล่ของกล่องไอคอน เช่น 'from-amber-400 to-brand-500' */
  gradientCls: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  darkBgCls?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 ${darkBgCls}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${gradientCls} text-white shadow-sm`}>
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{title}</h1>
            {subtitle && <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</div>}
          </div>
        </div>
        {actions}
      </div>
      {footer && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          {footer}
        </div>
      )}
    </div>
  );
}

/** ปุ่มลิงก์ขนาดเล็กสำหรับ `actions` ของ PageHero */
export function HeroLink({ to, icon, children }: { to: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
    >
      {icon}
      {children}
    </Link>
  );
}
