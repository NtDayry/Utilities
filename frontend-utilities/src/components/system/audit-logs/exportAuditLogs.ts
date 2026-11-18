import { AuditLogItem } from '@_types/audit_log';
import { dateUtils } from '@/utils/DatetimeFormat';
import { exportCsv, type CsvColumn } from '@/utils/export/csv';
import { exportStyledExcel, type ExcelColumn } from '@/utils/export/excel';

/** แปลงค่าใด ๆ เป็นข้อความ (object → JSON) */
function asText(value: unknown, pretty = false): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') {
    try {
      return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
const dt = (v?: string | null) => (v ? dateUtils.formatCompactDateTime(v) : '-');
const has = (l: AuditLogItem, ...words: string[]) => words.some((w) => (l.action || '').toLowerCase().includes(w));

/* ----------------------------- CSV ----------------------------- */
const CSV_COLUMNS: CsvColumn<AuditLogItem>[] = [
  { header: 'ID', value: (l) => l.id },
  { header: 'Created At', value: (l) => dt(l.created_at) },
  { header: 'Username', value: (l) => asText(l.username) },
  { header: 'Action', value: (l) => asText(l.action) },
  { header: 'Entity', value: (l) => asText(l.entity) },
  { header: 'Entity ID', value: (l) => asText(l.entity_id) },
  { header: 'IP Address', value: (l) => asText(l.ip_address) },
  { header: 'User Agent', value: (l) => asText(l.user_agent) },
  { header: 'Old Data', value: (l) => asText(l.old_data) },
  { header: 'New Data', value: (l) => asText(l.new_data) },
];

export const exportCSVAuditLogs = (logs: AuditLogItem[], filename = 'audit_logs_report') => exportCsv(logs, CSV_COLUMNS, filename);

/* ---------------------------- Excel ---------------------------- */
function actionBadge(l: AuditLogItem) {
  if (has(l, 'delete', 'remove', 'revoke')) return { bg: 'FFFEE2E2', fg: 'FF991B1B' };
  if (has(l, 'create', 'add')) return { bg: 'FFDCFCE7', fg: 'FF166534' };
  if (has(l, 'update', 'edit', 'patch')) return { bg: 'FFE0F2FE', fg: 'FF075985' };
  if (has(l, 'login', 'logout')) return { bg: 'FFF3E8FF', fg: 'FF6B21A8' };
  return { bg: 'FFE2E8F0', fg: 'FF334155' };
}

const EXCEL_COLUMNS: ExcelColumn<AuditLogItem>[] = [
  { header: 'ID', width: 8, align: 'center', headerAlign: 'center', value: (l) => l.id },
  { header: 'Created At', width: 20, value: (l) => dt(l.created_at) },
  { header: 'Username', width: 18, value: (l) => l.username || '-' },
  { header: 'Action', width: 18, align: 'center', headerAlign: 'center', value: (l) => l.action || '-', badge: actionBadge },
  { header: 'Entity', width: 18, value: (l) => l.entity || '-' },
  { header: 'Entity ID', width: 14, value: (l) => l.entity_id || '-' },
  { header: 'IP Address', width: 16, value: (l) => l.ip_address || '-' },
  { header: 'User Agent', width: 26, value: (l) => l.user_agent || '-' },
  { header: 'Old Data', width: 30, wrap: true, value: (l) => asText(l.old_data, true) },
  { header: 'New Data', width: 30, wrap: true, value: (l) => asText(l.new_data, true) },
];

export const exportExcelAuditLogs = (
  logs: AuditLogItem[],
  filename = 'audit_logs_report',
  timeRangeInfo?: { start?: string; stop?: string }
) => {
  const range =
    timeRangeInfo?.start && timeRangeInfo?.stop
      ? ` | Time Range: ${dt(timeRangeInfo.start)} – ${dt(timeRangeInfo.stop)}`
      : '';
  return exportStyledExcel({
    rows: logs,
    columns: EXCEL_COLUMNS,
    filename,
    title: 'Purified Water System — Audit Logs Report',
    sheetName: 'Audit Logs',
    metaExtra: ` | Unique Users: ${new Set(logs.map((l) => l.username).filter(Boolean)).size}${range}`,
    font: 'Segoe UI',
    headerAlign: 'left',
    roomy: true,
    summary: [
      { label: 'Total Logs', value: logs.length, color: 'FF2563EB' },
      { label: 'Creates', value: logs.filter((l) => has(l, 'create')).length, color: 'FF10B981' },
      { label: 'Updates', value: logs.filter((l) => has(l, 'update', 'edit')).length, color: 'FF0284C7' },
      { label: 'Deletes', value: logs.filter((l) => has(l, 'delete', 'remove')).length, color: 'FFEF4444' },
      { label: 'Auth Events', value: logs.filter((l) => has(l, 'login', 'logout')).length, color: 'FF8B5CF6' },
    ],
  });
};
