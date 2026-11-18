import { usePwSensors } from '@/hooks/usePwSensors';

const DEVICE = 'distribution_loop';
const METRIC = 'water_level';
const DEFAULT_MAX = 2000; // ค่าเดียวกับหน้า Purified Water

/** ตัวคูณแปลงหน่วยปริมาตร → m³ (null = ไม่ใช่หน่วยปริมาตร เช่น mm / cm / m) */
export function volumeUnitToM3(unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (['l', 'liter', 'liters', 'litre', 'litres', 'ลิตร'].includes(u)) return 0.001;
  if (['m3', 'm³', 'cbm', 'ลบ.ม.', 'ลูกบาศก์เมตร'].includes(u)) return 1;
  return null;
}

/**
 * ระดับน้ำถัง PW (Distribution Loop) + ข้อมูลเซ็นเซอร์ทั้งชุด (sensors) จาก MQTT (usePwSensors → pwMqttLive)
 * ใช้ในหน้า Purified Water และการ์ดถัง PW ในหน้าภาพรวมระบบน้ำ
 */
export function usePwTankLevel() {
  const sensors = usePwSensors();
  const cfg = sensors.configs[DEVICE]?.[METRIC];
  const max = Number(cfg?.max_range ?? cfg?.range_max);
  const maxRange = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX;
  const unit = cfg?.unit || 'mm';
  const level = sensors.value(METRIC);

  const percent = level === null ? null : Math.min(100, Math.max(0, (level / maxRange) * 100));
  // หน่วยของเซนเซอร์ (ตั้งในหน้า Sensor Calibration): ถ้าเป็นหน่วยปริมาตร ค่าที่อ่านได้ = ปริมาณน้ำในถังโดยตรง
  // และ max_range = ความจุถัง → ไม่ต้องเดาความจุ
  const toM3 = volumeUnitToM3(unit);
  const volumeM3 = toM3 !== null && level !== null ? level * toM3 : null;
  const capacityM3 = toM3 !== null ? maxRange * toM3 : null;
  // เกณฑ์เตือนของระดับน้ำ (หน่วยเดียวกับค่าที่อ่านได้) → %
  const lim = sensors.limits(DEVICE, METRIC);
  const lowPct = lim.min !== null ? Math.min(100, Math.max(0, (lim.min / maxRange) * 100)) : null;
  const highPct = lim.max !== null ? Math.min(100, Math.max(0, (lim.max / maxRange) * 100)) : null;
  return { level, percent, maxRange, unit, status: sensors.status, lastUpdate: sensors.lastUpdate, volumeM3, capacityM3, lowPct, highPct, sensors };
}
