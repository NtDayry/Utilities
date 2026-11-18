import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScannedPoint } from '@/lib/waterSystems/model';

// ชิ้นส่วนฟอร์มที่หน้าต่างเชื่อมต่อ (เพิ่มระบบ) และแผงตั้งค่าในหน้าระบบใช้ร่วมกัน

export const inputCls =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:disabled:bg-gray-800';
export const smallCls = inputCls.replace('h-10', 'h-9');
export const errorCls = 'border-red-500 focus:border-red-500 focus:ring-red-500/20';

export function Field({ label, error, hint, children, className = '' }: { label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span> : hint ? <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span> : null}
    </label>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="text-sm font-bold text-gray-800 dark:text-white/90">{title}</h4>
      {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** ปุ่มเลือกจำนวน min…max */
export function CountPicker({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800">
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={`h-8 min-w-9 rounded-md px-2 text-sm font-semibold ${value === n ? 'bg-sky-500 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** ช่องตัวเลข: ส่งค่าเป็นตัวเลข ; ช่องว่าง/ไม่ใช่ตัวเลข = NaN → ตรวจไม่ผ่านตอนบันทึก */
export function NumInput({ value, onChange, className = smallCls, min }: { value: number; onChange: (n: number) => void; className?: string; min?: number }) {
  const [textValue, setTextValue] = useState(Number.isFinite(value) ? String(value) : '');
  return (
    <input
      className={className}
      type="number"
      step="any"
      min={min}
      value={textValue}
      onChange={(e) => {
        setTextValue(e.target.value);
        onChange(e.target.value.trim() === '' ? NaN : Number(e.target.value));
      }}
    />
  );
}

const CUSTOM = '__custom__';

/**
 * เลือก "ตำแหน่งของข้อมูล" จากผลสแกนข้อความล่าสุด (แสดงค่าปัจจุบันของแต่ละจุด) หรือพิมพ์เอง
 * ยังไม่มีผลสแกน (ยังไม่มีข้อความเข้า) → เป็นช่องพิมพ์
 */
export function PathPicker({
  value,
  onChange,
  points,
  types,
  invalid = false,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (path: string) => void;
  points: ScannedPoint[];
  /** ชนิดของจุดข้อมูลที่เลือกได้ */
  types: ScannedPoint['type'][];
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const options = points.filter((p) => types.includes(p.type));
  const listed = options.some((p) => p.path === value);
  const cls = `${smallCls} font-mono ${invalid ? errorCls : ''}`;

  if (options.length === 0 || custom) {
    return (
      <div>
        <input className={cls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} spellCheck={false} />
        {options.length > 0 && (
          <button type="button" className="mt-1 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400" onClick={() => setCustom(false)}>
            {t('water_systems.path.back_to_list')}
          </button>
        )}
      </div>
    );
  }
  return (
    <select className={cls} value={value} disabled={disabled} onChange={(e) => (e.target.value === CUSTOM ? setCustom(true) : onChange(e.target.value))}>
      <option value="">{t('water_systems.path.pick')}</option>
      {value && !listed && <option value={value}>{`${value}  (${t('water_systems.path.not_in_data')})`}</option>}
      {options.map((p) => (
        <option key={p.path} value={p.path}>{`${p.path}  =  ${p.preview}`}</option>
      ))}
      <option value={CUSTOM}>{t('water_systems.path.custom')}</option>
    </select>
  );
}
