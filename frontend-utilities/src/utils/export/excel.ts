import * as ExcelJS from 'exceljs';
import { dateUtils } from '@/utils/DatetimeFormat';
import { datedFilename, downloadBlob, XLSX_MIME } from './download';

type Align = 'left' | 'center' | 'right';

export interface ExcelColumn<T> {
  header: string;
  width: number;
  value: (row: T) => ExcelJS.CellValue;
  /** จัดแนวข้อมูล (ค่าเริ่มต้น left) */
  align?: Align;
  /** จัดแนวหัวคอลัมน์ (ค่าเริ่มต้น = `headerAlign` ของตาราง) */
  headerAlign?: Align;
  wrap?: boolean;
  /** สีพื้น/ตัวอักษรเฉพาะเซลล์ (เช่น คอลัมน์ severity) — คืน undefined = สีแถวปกติ */
  badge?: (row: T) => { bg: string; fg: string } | undefined;
}

export interface StyledExcelOptions<T> {
  rows: T[];
  columns: ExcelColumn<T>[];
  filename: string;
  title: string;
  sheetName: string;
  /** ข้อความบรรทัดที่ 2 ต่อจาก "Exported at: ... | Total Records: N" */
  metaExtra?: string;
  /** การ์ดสรุปแถวที่ 4 (เว้นทีละ 2 คอลัมน์: A, C, E, ...) */
  summary?: { label: string; value: number; color: string }[];
  font?: string;
  headerAlign?: Align;
  /** ระยะ/ความสูงแบบโปร่ง (มีแถวว่างคั่น + พื้นแถว meta) */
  roomy?: boolean;
}

const THIN = (argb: string) => ({ style: 'thin' as const, color: { argb } });
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

/**
 * Excel รายงานแบบตาราง (หัวรายงาน + การ์ดสรุป + ตารางลายแถว) ใช้ร่วมกับรายงาน Alarm / Audit Logs ฯลฯ
 */
export async function exportStyledExcel<T>({
  rows,
  columns,
  filename,
  title,
  sheetName,
  metaExtra = '',
  summary = [],
  font = 'Calibri',
  headerAlign = 'center',
  roomy = false,
}: StyledExcelOptions<T>) {
  if (!rows?.length) {
    console.warn(`❌ No rows to export (${filename})`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PurifieldWater System';
  workbook.created = new Date();
  const ws = workbook.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape' },
    views: [{ showGridLines: true }],
  });
  const lastCol = String.fromCharCode(64 + columns.length);

  // 1) Title
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: font, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = solid('FF1E293B');
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = roomy ? 38 : 36;

  // 2) Meta
  ws.mergeCells(`A2:${lastCol}2`);
  const metaCell = ws.getCell('A2');
  metaCell.value = `Exported at: ${dateUtils.formatCompactDateTime(new Date().toISOString())} | Total Records: ${rows.length}${metaExtra}`;
  metaCell.font = { name: font, size: 10, italic: true, color: { argb: 'FF475569' } };
  if (roomy) metaCell.fill = solid('FFF1F5F9');
  metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(2).height = roomy ? 22 : 20;
  if (roomy) ws.getRow(3).height = 10;

  // 3) Summary cards (row 4)
  ws.getRow(4).height = roomy ? 26 : 24;
  summary.forEach((s, i) => {
    const cell = ws.getCell(`${String.fromCharCode(65 + i * 2)}4`);
    cell.value = `${s.label}: ${s.value}`;
    cell.font = { name: font, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(s.color);
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  if (roomy) ws.getRow(5).height = 10;

  // 4) Header (row 6)
  const headerRow = ws.getRow(6);
  headerRow.height = 28;
  columns.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.header;
    cell.font = { name: font, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid('FF334155');
    cell.alignment = { vertical: 'middle', horizontal: c.headerAlign ?? headerAlign };
    cell.border = { top: THIN('FF94A3B8'), bottom: { style: 'medium', color: { argb: 'FF475569' } }, left: THIN('FF94A3B8'), right: THIN('FF94A3B8') };
  });

  // 5) Data rows
  rows.forEach((item, idx) => {
    const row = ws.getRow(7 + idx);
    row.height = 22;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    columns.forEach((c, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = c.value(item);
      const badge = c.badge?.(item);
      cell.font = badge ? { name: font, size: 10, bold: true, color: { argb: badge.fg } } : { name: font, size: 10 };
      cell.fill = solid(badge ? badge.bg : bg);
      cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left', wrapText: c.wrap };
      cell.border = { top: THIN('FFE2E8F0'), bottom: THIN('FFE2E8F0'), left: THIN('FFE2E8F0'), right: THIN('FFE2E8F0') };
    });
  });

  // 6) Widths + download
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), datedFilename(filename, 'xlsx'));
}
