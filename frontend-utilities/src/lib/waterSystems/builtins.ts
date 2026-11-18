import type { WaterSystemConfig, WaterSystemKind } from '@/types/waterSystem.types';
import { defaultTank, newSystem } from './model';

/**
 * ถัง/บ่อของระบบน้ำประปาที่มีอยู่เดิมในโรงงาน — สร้างจากแม่แบบเดียวกับระบบที่เพิ่มจากหน้าเว็บ
 * ใส่ให้อัตโนมัติครั้งแรก (ยังไม่มี topic = "ยังไม่เชื่อมต่อเซ็นเซอร์") แล้ว admin ตั้ง topic / เซ็นเซอร์ / ขนาดต่อในหน้าของระบบ
 * id ตรงกับ key ใน TANK_SITES (lib/waterTanks.ts) เพื่อให้ลิงก์จากแผนผังโรงงานเปิดหน้าเดียวกัน
 * ขนาดตั้งต้นประมาณจากความจุ/ความสูงใน TANK (lib/factorySensors.ts) — ปรับให้ตรงของจริงได้ในหน้าตั้งค่า
 *
 * ไม่รวม "บ่อน้ำประปาโรงงาน + ระบบปั๊ม" (หน้าเฉพาะ /water-supply/tanks/pump) และ Purified Water
 */
interface BuiltinSpec {
  id: string;
  kind: WaterSystemKind;
  name: string;
  location: string;
  count: number;
  /** ถังน้ำ: เส้นผ่านศูนย์กลาง ; บ่อ: กว้าง × ยาว */
  diameter_m?: number;
  width_m?: number;
  length_m?: number;
  height_m: number;
  highPct: number;
}

const SPECS: BuiltinSpec[] = [
  // 120 m³ สูง 3 ม. → 5 × 8 × 3
  { id: 'tank14', kind: 'pond', name: 'บ่อเก็บน้ำอาคาร 1, 4', location: 'อาคาร 4 (ลานจอดรถ)', count: 1, width_m: 5, length_m: 8, height_m: 3, highPct: 98 },
  // รวม 10 m³ (4 ถัง × 2.5 m³) สูง 2 ม. → ⌀ 1.26 ม.
  { id: 'b5tank', kind: 'tank', name: 'ถังเก็บน้ำดาดฟ้าอาคาร 5', location: 'ดาดฟ้าอาคาร 5', count: 4, diameter_m: 1.26, height_m: 2, highPct: 98 },
  // รวม 9 m³ (2 ถังสแตนเลส × 4.5 m³) สูง 2.4 ม. → ⌀ 1.55 ม.
  { id: 'whtank', kind: 'tank', name: 'ถังเก็บน้ำดาดฟ้าโกดัง', location: 'ดาดฟ้าอาคารโกดัง', count: 2, diameter_m: 1.55, height_m: 2.4, highPct: 98 },
];

export const BUILTIN_SYSTEM_IDS = SPECS.map((s) => s.id);

export function builtinSystems(): WaterSystemConfig[] {
  return SPECS.map((s) => {
    const base = newSystem(s.kind);
    return {
      ...base,
      id: s.id,
      name: s.name,
      location: s.location,
      highPct: s.highPct,
      tanks: Array.from({ length: s.count }, (_, i) => ({
        ...defaultTank(s.kind, i),
        ...(s.diameter_m ? { diameter_m: s.diameter_m } : {}),
        ...(s.width_m ? { width_m: s.width_m } : {}),
        ...(s.length_m ? { length_m: s.length_m } : {}),
        height_m: s.height_m,
      })),
    };
  });
}
