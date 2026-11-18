import { datedFilename, downloadBlob } from './download';

/** ครอบ field ด้วย "..." เมื่อมี , " หรือขึ้นบรรทัดใหม่ (มาตรฐาน RFC 4180) */
export function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** สร้างข้อความ CSV จากแถว + คอลัมน์ */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return [columns.map((c) => csvField(c.header)).join(','), ...rows.map((r) => columns.map((c) => csvField(c.value(r))).join(','))].join(
    '\n'
  );
}

/**
 * ดาวน์โหลด CSV
 * @param bom ใส่ UTF-8 BOM (ให้ Excel เปิดภาษาไทยถูก) — ค่าเริ่มต้น true
 * @param dated เติมวันที่ท้ายชื่อไฟล์ `<name>_YYYY-MM-DD.csv` — ค่าเริ่มต้น true
 */
export function downloadCsv(content: string, filename: string, { bom = true, dated = true } = {}) {
  const blob = new Blob([(bom ? '﻿' : '') + content], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, dated ? datedFilename(filename, 'csv') : filename);
}

/** ทางลัด: สร้าง + ดาวน์โหลด CSV จาก rows/columns */
export function exportCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string, opts?: { bom?: boolean; dated?: boolean }) {
  if (!rows?.length) {
    console.warn(`❌ No rows to export (${filename})`);
    return;
  }
  downloadCsv(toCsv(rows, columns), filename, opts);
}
