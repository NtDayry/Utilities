import type { WaterSystemConfig } from '@/types/waterSystem.types';
import { deleteWaterSystem, getWaterSystems, putWaterSystem, seedWaterSystems } from '@/api/utilities/utilitiesApi';
import { normalizeSystem } from './model';
import { builtinSystems } from './builtins';

/**
 * ที่เก็บรายการระบบน้ำที่เพิ่มจากหน้าเว็บ — backend (/api/utilities/water-systems) ทุกเครื่องเห็นรายการเดียวกัน
 * ทุกส่วนของแอปเรียกผ่าน interface นี้เท่านั้น (store/waterSystems.ts)
 *
 * - บันทึก/ลบทีละระบบ (ไม่ส่งทั้งรายการ) → admin 2 คนแก้พร้อมกันไม่ทับระบบของกันและกัน
 * - ถัง/บ่อตั้งต้นของโรงงาน (builtins.ts): backend ใส่ให้ครั้งเดียวต่อ id (ลบแล้วไม่กลับมา)
 * - ข้อมูลเดิมที่เคยเก็บใน localStorage ของเบราว์เซอร์: admin เปิดหน้าครั้งแรก → ย้ายขึ้น backend ให้อัตโนมัติ
 */
export interface WaterSystemRepository {
  /** isAdmin = ทำงานที่ต้องใช้สิทธิ์ admin ได้ (ใส่ระบบตั้งต้น / ย้ายข้อมูลเดิม) */
  load(isAdmin: boolean): Promise<WaterSystemConfig[]>;
  save(system: WaterSystemConfig): Promise<WaterSystemConfig>;
  remove(id: string): Promise<void>;
}

/** key เดิมของ localStorage (ก่อนมี backend) */
export const LEGACY_STORAGE_KEY = 'utilities-water-systems-v2';
const LEGACY_SEEDED_KEY = 'utilities-water-systems-seeded';
const LEGACY_MIGRATED_KEY = 'utilities-water-systems-v2:migrated';

const clean = (list: unknown): WaterSystemConfig[] => {
  const out: WaterSystemConfig[] = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const sys = normalizeSystem(item);
    if (sys && !out.some((x) => x.id === sys.id)) out.push(sys);
  }
  return out;
};

function readLegacy(): WaterSystemConfig[] {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY)) return [];
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** ระบบที่เคยเก็บไว้ในเบราว์เซอร์นี้แต่ยังไม่มีบน backend → ส่งขึ้น backend (เฉพาะ admin) */
async function migrateLegacy(server: WaterSystemConfig[]): Promise<boolean> {
  const legacy = readLegacy();
  if (legacy.length === 0) return false;
  const have = new Set(server.map((s) => s.id));
  let failed = 0;
  for (const sys of legacy) {
    if (have.has(sys.id)) continue;
    try {
      await putWaterSystem(sys);
    } catch (err) {
      failed++;
      console.warn(`[water-systems] migrate ${sys.id} failed:`, err);
    }
  }
  if (failed === 0) {
    // เก็บสำเนาเดิมไว้ (ไม่ลบ) แต่ทำเครื่องหมายว่าย้ายแล้ว ไม่ย้ายซ้ำ
    try {
      localStorage.setItem(LEGACY_MIGRATED_KEY, new Date().toISOString());
      localStorage.removeItem(LEGACY_SEEDED_KEY);
    } catch {
      /* ignore */
    }
  }
  return true;
}

export const waterSystemRepository: WaterSystemRepository = {
  async load(isAdmin) {
    let list = clean(await getWaterSystems());
    if (isAdmin) {
      try {
        // ระบบตั้งต้นที่เบราว์เซอร์นี้ลบไปแล้ว (ตอนยังเก็บใน localStorage) ไม่ต้องใส่กลับ
        const legacySeeded: string[] = JSON.parse(localStorage.getItem(LEGACY_SEEDED_KEY) ?? '[]');
        const legacyIds = new Set(readLegacy().map((s) => s.id));
        const builtins = builtinSystems().filter((b) => !(Array.isArray(legacySeeded) && legacySeeded.includes(b.id) && !legacyIds.has(b.id)));
        const moved = await migrateLegacy(list);
        list = clean(builtins.length ? await seedWaterSystems(builtins) : moved ? await getWaterSystems() : list);
      } catch (err) {
        // ใส่ระบบตั้งต้น/ย้ายข้อมูลไม่ได้ ไม่ทำให้หน้าเปิดไม่ได้ — ใช้รายการที่โหลดได้
        console.warn('[water-systems] seed/migrate skipped:', err);
      }
    }
    return list;
  },
  async save(system) {
    return normalizeSystem(await putWaterSystem(system)) ?? system;
  },
  async remove(id) {
    await deleteWaterSystem(id);
  },
};
