import { useSyncExternalStore } from 'react';
import { loadTankConfig, subscribeTankConfig } from '@/lib/tankCalculations';
import type { TankConfig } from '@/types/waterSupply.types';

/** ขนาดบ่อประปาหลัก — อัปเดตเองเมื่อได้ค่าจาก backend หรือ admin บันทึกค่าใหม่ */
export function useTankConfig(): TankConfig {
  return useSyncExternalStore(subscribeTankConfig, loadTankConfig, loadTankConfig);
}
