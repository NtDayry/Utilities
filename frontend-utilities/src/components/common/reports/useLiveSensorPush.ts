import { useEffect } from 'react';
import { sensorStore } from '@/components/common/reports/reportUtils';

/**
 * ส่งค่าสด (ป้าย LIVE บนกราฟรายงาน) ทุก `intervalMs`
 * `compute(now)` คืน { sensor_key: value } — เปลี่ยน deps เมื่อสูตรเปลี่ยน (เช่น ช่วงเวลา aggregate)
 */
export function useLiveSensorPush(
  compute: (now: number) => Record<string, number>,
  deps: unknown[] = [],
  intervalMs = 5000
) {
  useEffect(() => {
    const push = () => sensorStore.set(compute(Date.now()));
    push();
    const id = setInterval(push, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);
}
