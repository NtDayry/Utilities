import { Link } from 'react-router';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  /** ไม่ใส่ = หน้าปัจจุบัน */
  to?: string;
}

interface Props {
  to: string;
  label: string;
  /** เส้นทางของหน้า เช่น ภาพรวมระบบน้ำ › รายละเอียด › ตั้งค่า (ตัวสุดท้ายคือหน้าปัจจุบัน) */
  crumbs?: Crumb[];
  className?: string;
}

/**
 * ปุ่มย้อนกลับ + breadcrumb สำหรับหัวหน้ารายละเอียด
 * - ปุ่มมีพื้นที่กดใหญ่ (สูง 36px) ขอบชัด hover/focus เห็นชัด และใช้คีย์บอร์ดได้
 * - breadcrumb กดข้ามไปหน้าก่อนหน้าได้ทุกระดับ (ซ่อนบนจอเล็กเพื่อไม่ให้รก)
 */
export default function BackNav({ to, label, crumbs, className = 'mb-3' }: Props) {
  return (
    <nav aria-label="breadcrumb" className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <Link
        to={to}
        className="group inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 pl-1 pr-4 text-sm font-semibold text-gray-700 shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.98] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-200 transition-all group-hover:-translate-x-0.5 group-hover:bg-brand-500 group-hover:text-white group-hover:ring-brand-500 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700">
          <ArrowLeft className="h-4 w-4" />
        </span>
        {label}
      </Link>

      {crumbs && crumbs.length > 0 && (
        <ol className="hidden flex-wrap items-center gap-1 text-xs text-gray-500 sm:flex dark:text-gray-400">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" aria-hidden />}
                {c.to && !last ? (
                  <Link to={c.to} className="rounded px-1 py-0.5 transition-colors hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800 dark:hover:text-brand-400">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className={`px-1 py-0.5 ${last ? 'font-semibold text-gray-700 dark:text-gray-200' : ''}`}>
                    {c.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
