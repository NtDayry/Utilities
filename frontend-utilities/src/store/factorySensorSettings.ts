import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { hiddenOf, type DetailId, type MeterKey } from '@/lib/factorySensors';

// การตั้งค่าเซ็นเซอร์บนแผนผังโรงงาน (admin) — เก็บเป็น "สิ่งที่ปิด" เพื่อให้เซ็นเซอร์/ช่องที่เพิ่มใหม่เปิดเป็นค่าเริ่มต้น
// ค่าจริงเก็บที่ backend (การตั้งค่าส่วนกลาง 'factory-sensors') — lib/sharedSettings.ts โหลดหลัง login และส่งค่าที่ admin แก้ขึ้นไป
// localStorage (persist) เป็นสำเนาไว้แสดงผลทันทีตอนเปิดหน้า
interface FactorySensorSettings {
  disabled: MeterKey[];                                   // เซ็นเซอร์ที่ปิดใช้งาน → ไม่แสดงไอคอน/ค่า/alarm บนแผนผัง
  hiddenFields: Partial<Record<MeterKey, DetailId[]>>;    // ช่องรายละเอียดที่ไม่แสดงในกล่องข้อมูล
  alarms: boolean;                                        // สวิตช์รวม: แสดง alarm (ไอคอน/ป้ายแดงกะพริบ) บนแผนผัง
  alarmOff: MeterKey[];                                   // เซ็นเซอร์ที่ไม่แสดง alarm บนแผนผัง
  setAlarms: (on: boolean) => void;
  setAlarm: (k: MeterKey, on: boolean) => void;
  setAllAlarm: (keys: MeterKey[], on: boolean) => void;
  setEnabled: (k: MeterKey, on: boolean) => void;
  setAllEnabled: (keys: MeterKey[], on: boolean) => void;
  setField: (k: MeterKey, f: DetailId, on: boolean) => void;
  setAllFields: (k: MeterKey, fields: DetailId[], on: boolean) => void;
  reset: () => void;
}

const without = <T,>(a: T[], x: T) => a.filter((y) => y !== x);

export const FACTORY_SETTINGS_STORAGE_KEY = 'factory-sensor-settings';
export type FactorySettingsData = Pick<FactorySensorSettings, 'disabled' | 'hiddenFields' | 'alarms' | 'alarmOff'>;

/** เฉพาะข้อมูลที่บันทึก (ไม่รวมฟังก์ชัน) — ตรวจชนิดเมื่อมาจาก backend */
export function pickFactorySettings(input: unknown): FactorySettingsData {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const hidden: Record<string, string[]> = {};
  if (s.hiddenFields && typeof s.hiddenFields === 'object') for (const [k, v] of Object.entries(s.hiddenFields)) hidden[k] = arr(v);
  return {
    disabled: arr(s.disabled) as MeterKey[],
    hiddenFields: hidden as FactorySettingsData['hiddenFields'],
    alarms: typeof s.alarms === 'boolean' ? s.alarms : true,
    alarmOff: arr(s.alarmOff) as MeterKey[],
  };
}

export const useFactorySensorSettings = create<FactorySensorSettings>()(
  persist(
    (set) => ({
      disabled: [],
      hiddenFields: {},
      alarms: true,
      alarmOff: [],
      setAlarms: (on) => set({ alarms: on }),
      setAlarm: (k, on) => set((s) => ({ alarmOff: on ? without(s.alarmOff, k) : [...without(s.alarmOff, k), k] })),
      setAllAlarm: (keys, on) =>
        set((s) => ({ alarmOff: on ? s.alarmOff.filter((k) => !keys.includes(k)) : [...new Set([...s.alarmOff, ...keys])] })),
      setEnabled: (k, on) => set((s) => ({ disabled: on ? without(s.disabled, k) : [...without(s.disabled, k), k] })),
      setAllEnabled: (keys, on) =>
        set((s) => ({ disabled: on ? s.disabled.filter((k) => !keys.includes(k)) : [...new Set([...s.disabled, ...keys])] })),
      setField: (k, f, on) =>
        set((s) => {
          const cur = hiddenOf(s.hiddenFields, k);
          return { hiddenFields: { ...s.hiddenFields, [k]: on ? without(cur, f) : [...without(cur, f), f] } };
        }),
      setAllFields: (k, fields, on) => set((s) => ({ hiddenFields: { ...s.hiddenFields, [k]: on ? [] : [...fields] } })),
      reset: () => set({ disabled: [], hiddenFields: {}, alarms: true, alarmOff: [] }),
    }),
    { name: FACTORY_SETTINGS_STORAGE_KEY },
  ),
);

/** admin = role admin / super admin */
export const isAdminRole = (role: string | null | undefined) => role === 'admin' || role === 'super admin';
