import type { DisplayUnit, TankCalculations, TankConfig } from '@/types/waterSupply.types';
import { putSharedSetting } from '@/api/utilities/utilitiesApi';

export const DEFAULT_TANK_CONFIG: TankConfig = {
  tank1: {
    width_m: 2.2,
    length_m: 8.2,
    height_m: 2.2,
  },
  tank2: {
    width_m: 4.0,
    length_m: 8.0,
    height_m: 1.5,
  },
  tank2_offset_cm: 0, // ฐานบ่อน้ำอยู่ระดับเดียวกัน
  sensor_tank: 1, // เซนเซอร์ติดตั้งอยู่ที่บ่อ 1 เป็นหลัก
};

const STORAGE_KEY_CONFIG = 'water_tank_dimensions_config_v2';
const STORAGE_KEY_UNIT = 'water_display_unit_v1';

/** แปลง/ตรวจค่าที่อ่านมา (localStorage หรือ backend) — ค่าที่ขาดใช้ค่าเริ่มต้น */
export function parseTankConfig(input: unknown): TankConfig {
  const parsed = (input && typeof input === 'object' ? input : {}) as {
    tank1?: Record<string, unknown>;
    tank2?: Record<string, unknown>;
    tank2_offset_cm?: unknown;
    sensor_tank?: unknown;
  };
  return {
    tank1: {
      width_m: Number(parsed?.tank1?.width_m) || DEFAULT_TANK_CONFIG.tank1.width_m,
      length_m: Number(parsed?.tank1?.length_m) || DEFAULT_TANK_CONFIG.tank1.length_m,
      height_m: Number(parsed?.tank1?.height_m) || DEFAULT_TANK_CONFIG.tank1.height_m,
    },
    tank2: {
      width_m: Number(parsed?.tank2?.width_m) || DEFAULT_TANK_CONFIG.tank2.width_m,
      length_m: Number(parsed?.tank2?.length_m) || DEFAULT_TANK_CONFIG.tank2.length_m,
      height_m: Number(parsed?.tank2?.height_m) || DEFAULT_TANK_CONFIG.tank2.height_m,
    },
    tank2_offset_cm:
      parsed?.tank2_offset_cm !== undefined && Number.isFinite(Number(parsed.tank2_offset_cm))
        ? Number(parsed.tank2_offset_cm)
        : DEFAULT_TANK_CONFIG.tank2_offset_cm,
    sensor_tank: parsed?.sensor_tank === 2 ? 2 : 1,
  };
}

/**
 * ขนาดบ่อประปาหลัก — ค่าจริงเก็บที่ backend (การตั้งค่าส่วนกลาง 'pump-station-tank', ทุกเครื่องเห็นค่าเดียวกัน)
 * localStorage ใช้เป็นสำเนาไว้แสดงผลทันทีตอนเปิดหน้า ; lib/sharedSettings.ts โหลดค่าจาก backend หลัง login แล้วเรียก applyTankConfig
 */
let current: TankConfig | null = null;
const listeners = new Set<() => void>();

export function loadTankConfig(): TankConfig {
  if (current) return current;
  if (typeof window === 'undefined') return DEFAULT_TANK_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    current = raw ? parseTankConfig(JSON.parse(raw)) : DEFAULT_TANK_CONFIG;
  } catch {
    current = DEFAULT_TANK_CONFIG;
  }
  return current;
}

/** มีค่าที่เคยตั้งไว้ในเบราว์เซอร์นี้หรือไม่ (ใช้ตัดสินใจย้ายขึ้น backend) */
export const hasLocalTankConfig = () => {
  try {
    return localStorage.getItem(STORAGE_KEY_CONFIG) !== null;
  } catch {
    return false;
  }
};

export function subscribeTankConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** ใช้ค่าใหม่ในเครื่องนี้ (ไม่ส่งไป backend) — เรียกเมื่อได้ค่าจาก backend หรือหลังบันทึกสำเร็จ */
export function applyTankConfig(cfg: TankConfig): void {
  current = parseTankConfig(cfg);
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to cache tank config:', err);
  }
  listeners.forEach((fn) => fn());
}

/** บันทึกที่ backend (admin) แล้วใช้ค่าใหม่ — โยน error ถ้าบันทึกไม่ได้ */
export async function saveTankConfig(cfg: TankConfig): Promise<void> {
  await putSharedSetting('pump-station-tank', cfg);
  applyTankConfig(cfg);
}

export function loadDisplayUnit(): DisplayUnit {
  if (typeof window === 'undefined') return 'cm';
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UNIT);
    return raw === 'liter' ? 'liter' : 'cm';
  } catch {
    return 'cm';
  }
}

export function saveDisplayUnit(unit: DisplayUnit): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_UNIT, unit);
  } catch (err) {
    console.error('Failed to save display unit:', err);
  }
}

/**
 * คำนวณระดับน้ำ ปริมาตรเป็นลิตร และเปอร์เซ็นต์ของแต่ละบ่อและผลรวม
 * โดยที่ทั้งสองบ่อเป็นระดับน้ำเดียวกัน (communicating vessels)
 * แต่บ่อที่ 2 อยู่ต่ำกว่าบ่อที่ 1 ตามค่า offset_cm
 */
export function calculateTanks(sensor_cm: number, cfg: TankConfig): TankCalculations {
  const h1_max_cm = cfg.tank1.height_m * 100;
  const h2_max_cm = cfg.tank2.height_m * 100;
  const offset = cfg.tank2_offset_cm;

  let level1_cm = 0;
  let level2_cm = 0;

  if (cfg.sensor_tank === 1) {
    // เซนเซอร์ติดตั้งที่บ่อ 1
    level1_cm = Math.max(0, Math.min(h1_max_cm, sensor_cm));
    // บ่อ 2 อยู่ต่ำกว่าบ่อ 1 ดังนั้นความลึกน้ำในบ่อ 2 จะมากกว่าบ่อ 1 เท่ากับ offset
    level2_cm = Math.max(0, Math.min(h2_max_cm, sensor_cm + offset));
  } else {
    // เซนเซอร์ติดตั้งที่บ่อ 2
    level2_cm = Math.max(0, Math.min(h2_max_cm, sensor_cm));
    level1_cm = Math.max(0, Math.min(h1_max_cm, sensor_cm - offset));
  }

  // ปริมาตร = กว้าง(m) * ยาว(m) * ความลึก(m) * 1,000 ลิตร
  // ความลึก(m) = level_cm / 100
  // ดังนั้น ปริมาตร (ลิตร) = กว้าง * ยาว * level_cm * 10
  const vol1_l = cfg.tank1.width_m * cfg.tank1.length_m * level1_cm * 10;
  const cap1_l = cfg.tank1.width_m * cfg.tank1.length_m * cfg.tank1.height_m * 1000;
  const pct1 = cap1_l > 0 ? Math.max(0, Math.min(100, (vol1_l / cap1_l) * 100)) : 0;

  const vol2_l = cfg.tank2.width_m * cfg.tank2.length_m * level2_cm * 10;
  const cap2_l = cfg.tank2.width_m * cfg.tank2.length_m * cfg.tank2.height_m * 1000;
  const pct2 = cap2_l > 0 ? Math.max(0, Math.min(100, (vol2_l / cap2_l) * 100)) : 0;

  const total_vol_l = vol1_l + vol2_l;
  const total_cap_l = cap1_l + cap2_l;
  const total_pct = total_cap_l > 0 ? Math.max(0, Math.min(100, (total_vol_l / total_cap_l) * 100)) : 0;

  return {
    tank1: {
      level_cm: level1_cm,
      height_cm: h1_max_cm,
      volume_l: vol1_l,
      capacity_l: cap1_l,
      percent: pct1,
      width_m: cfg.tank1.width_m,
      length_m: cfg.tank1.length_m,
      height_m: cfg.tank1.height_m,
    },
    tank2: {
      level_cm: level2_cm,
      height_cm: h2_max_cm,
      volume_l: vol2_l,
      capacity_l: cap2_l,
      percent: pct2,
      width_m: cfg.tank2.width_m,
      length_m: cfg.tank2.length_m,
      height_m: cfg.tank2.height_m,
    },
    total: {
      volume_l: total_vol_l,
      capacity_l: total_cap_l,
      percent: total_pct,
    },
  };
}
