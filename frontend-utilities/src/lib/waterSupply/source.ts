import { useSyncExternalStore } from 'react';
import { getWaterSupplySource, WATER_SUPPLY_SYSTEM_ID, type WaterSupplySource } from '@/api/utilities/utilitiesApi';

/**
 * topic / broker ของบ่อน้ำประปาโรงงาน + ระบบปั๊ม — ตั้งในหน้า Water Supply → ตั้งค่าคอนโทรลเลอร์ (admin)
 * โหลดจาก backend ครั้งเดียว ใช้ร่วมกันทุกหน้า ; refreshWaterSupplySource() หลังบันทึกค่าใหม่
 */
export interface SupplySourceState extends WaterSupplySource {
  /** false = ยังโหลดไม่เสร็จ (topic ว่าง → hook ยังไม่ subscribe) */
  loaded: boolean;
  error: boolean;
}

let state: SupplySourceState = { systemId: WATER_SUPPLY_SYSTEM_ID, topic: '', brokerUrl: '', customBroker: false, loaded: false, error: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

const set = (next: SupplySourceState) => {
  state = next;
  listeners.forEach((fn) => fn());
};

export function refreshWaterSupplySource(): Promise<void> {
  inflight ??= getWaterSupplySource()
    .then((s) => set({ ...s, loaded: true, error: false }))
    .catch((err) => {
      console.warn('[water-supply] load MQTT source failed:', err);
      set({ ...state, loaded: true, error: true });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!state.loaded && !inflight) void refreshWaterSupplySource();
  return () => listeners.delete(fn);
}

export const useWaterSupplySource = (): SupplySourceState => useSyncExternalStore(subscribe, () => state);
