import { create } from 'zustand';
import { createAuditLog } from '@/api';
import { BROKER_PASSWORD_MASK } from '@/api/utilities/utilitiesApi';
import type { WaterSystemConfig } from '@/types/waterSystem.types';
import { waterSystemRepository } from '@/lib/waterSystems/repository';
import { isAdminRole } from '@/store/factorySensorSettings';
import { useAuthStore } from '@/store/auth';

/**
 * รายการระบบน้ำที่เพิ่มจากหน้าเว็บ — บันทึกที่ backend ก่อนแล้วจึงอัปเดตหน้าจอ (บันทึกไม่ได้ → โยน error ให้หน้าจอแจ้งผู้ใช้)
 * ทุกการเพิ่ม/แก้/ลบ ส่งเข้า Audit Log กลาง (entity: water_system) พร้อมค่าเดิม/ค่าใหม่ (ไม่รวมรหัสผ่าน broker)
 */
interface WaterSystemsStore {
  loaded: boolean;
  loading: boolean;
  /** โหลดรายการไม่สำเร็จ (null = ไม่มีปัญหา) */
  error: string | null;
  systems: WaterSystemConfig[];
  /** โหลดครั้งแรก (เรียกซ้ำได้ — โหลดจริงครั้งเดียว) ; force = โหลดใหม่จาก backend */
  load: (force?: boolean) => Promise<void>;
  save: (system: WaterSystemConfig) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** ค่าที่ส่งเข้า Audit Log: ไม่เก็บรหัสผ่าน broker */
const forAudit = (s: WaterSystemConfig | undefined) =>
  s && s.broker ? { ...s, broker: { ...s.broker, password: s.broker.password ? BROKER_PASSWORD_MASK : '' } } : s;

let inflight: Promise<void> | null = null;

export const useWaterSystems = create<WaterSystemsStore>()((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  systems: [],

  load: async (force = false) => {
    if (get().loaded && !force) return;
    // หลายหน้า/หลาย component เรียกพร้อมกัน → ใช้คำขอเดียว
    if (inflight) return inflight;
    set({ loading: true });
    inflight = (async () => {
      try {
        const systems = await waterSystemRepository.load(isAdminRole(useAuthStore.getState().role));
        set({ loaded: true, loading: false, error: null, systems });
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : 'load_failed' });
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  save: async (system) => {
    const before = get().systems.find((s) => s.id === system.id);
    const saved = await waterSystemRepository.save({ ...system, updatedAt: new Date().toISOString() });
    // ใช้รายการล่าสุด ณ ตอนที่บันทึกเสร็จ (ไม่ใช่ตอนเริ่ม) — ไม่ทับการเปลี่ยนแปลงอื่นที่เกิดระหว่างรอ
    set((st) => ({ systems: st.systems.some((s) => s.id === saved.id) ? st.systems.map((s) => (s.id === saved.id ? saved : s)) : [...st.systems, saved] }));
    void createAuditLog({ action: before ? 'update_water_system' : 'create_water_system', entity: 'water_system', entity_id: saved.id, old_data: forAudit(before), new_data: forAudit(saved) });
  },

  remove: async (id) => {
    const before = get().systems.find((s) => s.id === id);
    if (!before) return;
    await waterSystemRepository.remove(id);
    set((st) => ({ systems: st.systems.filter((s) => s.id !== id) }));
    void createAuditLog({ action: 'delete_water_system', entity: 'water_system', entity_id: id, old_data: forAudit(before) });
  },
}));

// ออกจากระบบ / เปลี่ยนผู้ใช้ → ล้างรายการ (ผู้ใช้คนถัดไปโหลดใหม่ตามสิทธิ์ของตัวเอง)
useAuthStore.subscribe((s, prev) => {
  if (s.username !== prev.username) useWaterSystems.setState({ loaded: false, error: null, systems: [] });
});
