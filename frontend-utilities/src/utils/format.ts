/** ฟังก์ชันจัดรูปแบบ/เวลา ที่ใช้ร่วมกันหลายหน้า */

export const DAY_MS = 86_400_000;
/** UTC+7 (Asia/Bangkok) */
export const BKK_OFFSET_MS = 7 * 3_600_000;

/** เวลาเริ่มต้นของวัน (00:00 เวลาไทย) ของ timestamp ที่ให้ */
export const startOfBkkDay = (ms: number) => Math.floor((ms + BKK_OFFSET_MS) / DAY_MS) * DAY_MS - BKK_OFFSET_MS;

/** ตัวเลขทศนิยมคงที่ + คั่นหลักพัน เช่น fmtFixed(1234.5, 1) → "1,234.5" */
export const fmtFixed = (v: number, d = 1) =>
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** ตัวเลขทศนิยมคงที่ตาม locale เครื่อง — null/undefined/NaN แสดงเป็น `empty` (ค่าเริ่มต้น "—") */
export const fmtNum = (v: number | null | undefined, d: number, empty = '—') =>
  v === null || v === undefined || Number.isNaN(v)
    ? empty
    : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
