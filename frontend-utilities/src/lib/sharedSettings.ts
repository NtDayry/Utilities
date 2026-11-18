/**
 * การตั้งค่าส่วนกลางที่เดิมเก็บใน localStorage ของแต่ละเบราว์เซอร์ → backend (/api/utilities/settings)
 *   'factory-sensors'   : store/factorySensorSettings.ts (เซ็นเซอร์ / alarm บนแผนผังโรงงาน)
 *   'pump-station-tank' : lib/tankCalculations.ts (ขนาดบ่อประปาหลัก)
 *
 * - หลัง login: โหลดค่าจาก backend มาใช้ (localStorage เป็นแค่สำเนาไว้แสดงผลเร็ว)
 * - backend ยังไม่มีค่า แต่เบราว์เซอร์ของ admin มีค่าเดิม → ย้ายขึ้น backend ครั้งเดียว
 * - admin แก้การตั้งค่าแผนผังโรงงาน → ส่งขึ้น backend อัตโนมัติ (หน่วง 0.6 วินาที รวมการคลิกต่อเนื่อง)
 */
import { create } from 'zustand';
import { getSharedSettings, putSharedSetting } from '@/api/utilities/utilitiesApi';
import { FACTORY_SETTINGS_STORAGE_KEY, isAdminRole, pickFactorySettings, useFactorySensorSettings } from '@/store/factorySensorSettings';
import { applyTankConfig, hasLocalTankConfig, loadTankConfig, parseTankConfig } from '@/lib/tankCalculations';
import { useAuthStore } from '@/store/auth';

interface SharedSettingsStatus {
  /** บันทึกการตั้งค่าแผนผังโรงงานขึ้น backend ไม่สำเร็จ (null = ปกติ) */
  saveError: string | null;
  synced: boolean;
}
export const useSharedSettingsStatus = create<SharedSettingsStatus>()(() => ({ saveError: null, synced: false }));

let syncedFor: string | null = null;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const isAdmin = () => isAdminRole(useAuthStore.getState().role);

/** โหลดการตั้งค่าส่วนกลางจาก backend (เรียกหลัง login — ซ้ำได้ ทำจริงครั้งเดียวต่อผู้ใช้) */
export async function syncSharedSettings(): Promise<void> {
  const username = useAuthStore.getState().username;
  if (!username || syncedFor === username) return;
  syncedFor = username;
  let remote: Awaited<ReturnType<typeof getSharedSettings>>;
  try {
    remote = await getSharedSettings();
  } catch (err) {
    syncedFor = null; // ลองใหม่ครั้งหน้า
    console.warn('[shared-settings] load failed — using values cached in this browser:', err);
    return;
  }

  // ---- แผนผังโรงงาน ----
  const factory = remote['factory-sensors'];
  if (factory && typeof factory === 'object') {
    applyingRemote = true;
    useFactorySensorSettings.setState(pickFactorySettings(factory));
    applyingRemote = false;
  } else if (isAdmin() && localStorage.getItem(FACTORY_SETTINGS_STORAGE_KEY)) {
    await putSharedSetting('factory-sensors', pickFactorySettings(useFactorySensorSettings.getState())).catch((e) =>
      console.warn('[shared-settings] migrate factory-sensors failed:', e),
    );
  }

  // ---- ขนาดบ่อประปาหลัก ----
  const tank = remote['pump-station-tank'];
  if (tank && typeof tank === 'object') applyTankConfig(parseTankConfig(tank));
  else if (isAdmin() && hasLocalTankConfig()) {
    await putSharedSetting('pump-station-tank', loadTankConfig()).catch((e) => console.warn('[shared-settings] migrate pump-station-tank failed:', e));
  }
  useSharedSettingsStatus.setState({ synced: true });
}

// admin เปลี่ยนการตั้งค่าแผนผังโรงงาน → ส่งขึ้น backend
useFactorySensorSettings.subscribe((state, prev) => {
  if (applyingRemote || !isAdmin()) return;
  const next = pickFactorySettings(state);
  if (JSON.stringify(next) === JSON.stringify(pickFactorySettings(prev))) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    putSharedSetting('factory-sensors', pickFactorySettings(useFactorySensorSettings.getState()))
      .then(() => useSharedSettingsStatus.setState({ saveError: null }))
      .catch((e) => {
        console.error('[shared-settings] save factory-sensors failed:', e);
        useSharedSettingsStatus.setState({ saveError: e?.response?.status === 403 ? 'forbidden' : 'failed' });
      });
  }, 600);
});

// เปลี่ยนผู้ใช้ → โหลดใหม่ตามสิทธิ์ของผู้ใช้คนใหม่
useAuthStore.subscribe((s, prev) => {
  if (s.username !== prev.username) {
    syncedFor = null;
    useSharedSettingsStatus.setState({ synced: false, saveError: null });
  }
});
