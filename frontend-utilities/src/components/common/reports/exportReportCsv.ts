import { dateUtils } from '@/utils/DatetimeFormat';
import { csvField, downloadCsv } from '@/utils/export/csv';

export const exportCSVAll = (raw: any, filename = 'sensor_report') => {
  if (!raw) {
    console.warn('❌ raw is empty');
    return;
  }

  const sensors: {
    name: string;
    values: (number | null)[];
    decimal: number;
  }[] = [];

  const timestamps: string[] = raw?.meta?.timestamps ?? [];

  // 🔥 recursive collect (รองรับ group ใหม่)
  const collectSensors = (group: any, parentName = '') => {
    if (!group) return;

    const groupName = group.group_name || group.sub_group_name || group.group_key || '';

    const prefix = parentName ? `${parentName} - ${groupName}` : groupName;

    // sensors ใน group นี้
    if (group.sensors?.length) {
      group.sensors.forEach((s: any) => {
        sensors.push({
          name: s.name,
          values: s.values ?? [],
          decimal: s.decimal_places ?? 2,
        });
      });
    }

    // children
    if (group.children?.length) {
      [...group.children].sort((a, b) => a.group_index - b.group_index).forEach((child) => collectSensors(child, prefix));
    }
  };

  // root groups
  const groups = raw?.data ?? [];

  [...groups].sort((a, b) => a.group_index - b.group_index).forEach((g) => collectSensors(g));

  if (sensors.length === 0) {
    console.warn('❌ No sensors found');
    return;
  }

  // rowCount กัน mismatch
  const rowCount = Math.max(timestamps.length, ...sensors.map((s) => s.values.length));

  // header
  const headers = ['timestamp', ...sensors.map((s) => s.name)];
  const rows: string[][] = [headers];

  // build rows
  for (let i = 0; i < rowCount; i++) {
    const row: string[] = [];

    // timestamp
    const ts = timestamps[i];
    row.push(ts ? dateUtils.formatCompactDateTime(ts) : '');

    // sensor values
    sensors.forEach((s) => {
      const val = s.values[i];
      row.push(val === null || val === undefined ? '' : Number(val).toFixed(s.decimal));
    });

    rows.push(row);
  }

  // CSV (ไม่มี BOM — รูปแบบเดิมของรายงานเซนเซอร์)
  downloadCsv(rows.map((r) => r.map(csvField).join(',')).join('\n'), filename, { bom: false });
};
