import { AlertEvent } from '@/api';
import { dateUtils } from '@/utils/DatetimeFormat';
import { exportCsv, type CsvColumn } from '@/utils/export/csv';
import { exportStyledExcel, type ExcelColumn } from '@/utils/export/excel';

const dt = (v?: string | null, empty = '-') => (v ? dateUtils.formatCompactDateTime(v) : empty);
const num = (v?: number | null) => (v !== null && v !== undefined ? v : '-');

const SEVERITY_BADGE: Record<string, { bg: string; fg: string }> = {
  CRITICAL: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  WARNING: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  INFO: { bg: 'FFE0F2FE', fg: 'FF075985' },
};

/* ----------------------------- CSV ----------------------------- */
const CSV_COLUMNS: CsvColumn<AlertEvent>[] = [
  { header: 'Event ID', value: (e) => e.id },
  { header: 'Device Name', value: (e) => e.device_name || '' },
  { header: 'Metric Name', value: (e) => e.metric_name || '' },
  { header: 'Severity', value: (e) => (e.severity || '').toUpperCase() },
  { header: 'Trigger Value', value: (e) => num(e.trigger_value) },
  { header: 'Started At', value: (e) => dt(e.started_at) },
  { header: 'Triggered At', value: (e) => dt(e.triggered_at) },
  { header: 'Ended At', value: (e) => dt(e.ended_at, 'Active') },
  { header: 'Duration (Seconds)', value: (e) => num(e.duration_seconds) },
  { header: 'Acknowledged', value: (e) => (e.acknowledged ? 'YES' : 'NO') },
  { header: 'Acknowledged By', value: (e) => e.acknowledged_by ?? '-' },
  { header: 'Acknowledged At', value: (e) => dt(e.acknowledged_at) },
];

export const exportCSVAlarms = (events: AlertEvent[], filename = 'alarm_report') => exportCsv(events, CSV_COLUMNS, filename);

/* ---------------------------- Excel ---------------------------- */
const EXCEL_COLUMNS: ExcelColumn<AlertEvent>[] = [
  { header: 'ID', width: 8, align: 'center', value: (e) => e.id },
  { header: 'Device Name', width: 18, value: (e) => e.device_name || '-' },
  { header: 'Metric Name', width: 18, value: (e) => e.metric_name || '-' },
  {
    header: 'Severity',
    width: 14,
    align: 'center',
    value: (e) => (e.severity || 'info').toUpperCase(),
    badge: (e) => SEVERITY_BADGE[(e.severity || 'info').toUpperCase()] ?? { bg: 'FFE2E8F0', fg: 'FF334155' },
  },
  { header: 'Trigger Value', width: 14, value: (e) => num(e.trigger_value) },
  { header: 'Started At', width: 20, value: (e) => dt(e.started_at) },
  { header: 'Triggered At', width: 20, value: (e) => dt(e.triggered_at) },
  { header: 'Ended At', width: 20, value: (e) => dt(e.ended_at, 'ACTIVE') },
  { header: 'Duration (s)', width: 14, value: (e) => num(e.duration_seconds) },
  { header: 'Status', width: 12, align: 'center', value: (e) => (e.ended_at ? 'Ended' : 'Active') },
  { header: 'Acknowledged', width: 14, align: 'center', value: (e) => (e.acknowledged ? 'Yes' : 'No') },
  { header: 'Ack At', width: 20, value: (e) => dt(e.acknowledged_at) },
];

export const exportExcelAlarms = (events: AlertEvent[], filename = 'alarm_report') => {
  const sev = (s: string) => events.filter((e) => e.severity?.toLowerCase() === s).length;
  return exportStyledExcel({
    rows: events,
    columns: EXCEL_COLUMNS,
    filename,
    title: 'Purified Water System - Alarm Events Report',
    sheetName: 'Alarm Events',
    summary: [
      { label: 'Total Alarms', value: events.length, color: 'FF3B82F6' },
      { label: 'Critical', value: sev('critical'), color: 'FFEF4444' },
      { label: 'Warning', value: sev('warning'), color: 'FFF59E0B' },
      { label: 'Info', value: sev('info'), color: 'FF3B82F6' },
      { label: 'Active', value: events.filter((e) => !e.ended_at).length, color: 'FFEC4899' },
      { label: 'Acknowledged', value: events.filter((e) => e.acknowledged).length, color: 'FF10B981' },
    ],
  });
};
