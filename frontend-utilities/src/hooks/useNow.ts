import { useEffect, useState } from 'react';

/** เวลาปัจจุบัน (ms) ที่อัปเดตทุก `intervalMs` — ใช้กับหน้า dashboard/รายละเอียดที่ต้องรีเฟรชค่าเป็นระยะ */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
