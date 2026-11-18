import { useEffect, useState } from 'react';
import { feedKey, getFeedSnapshot, subscribeFeed, type Feed, type FeedSnapshot } from '@/lib/waterSystems/mqttTopics';

/** ข้อมูล MQTT ล่าสุดของแต่ละ feed (broker + topic) — ผลลัพธ์ใช้ feedKey(feed) เป็น key ; การเชื่อมต่อใช้ร่วมกันทุกหน้า */
export function useFeeds(feeds: Feed[]): Record<string, FeedSnapshot> {
  const unique = new Map<string, Feed>();
  for (const f of feeds) if (f.topic) unique.set(feedKey(f), f);
  // key ของ effect: เปลี่ยนเมื่อชุด feed เปลี่ยนจริงเท่านั้น
  const signature = JSON.stringify([...unique.keys()].sort());
  const [snaps, setSnaps] = useState<Record<string, FeedSnapshot>>({});

  useEffect(() => {
    const list = [...unique.entries()];
    const read = () => setSnaps(Object.fromEntries(list.map(([k, f]) => [k, getFeedSnapshot(f)])));
    const unsubs = list.map(([, f]) => subscribeFeed(f, read));
    read();
    return () => unsubs.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unique สร้างใหม่ทุก render ; signature แทนเนื้อหาของมัน
  }, [signature]);

  return snaps;
}

/** เวลาปัจจุบันที่ขยับทุก intervalMs (ให้สถานะ "ข้อมูลค้าง" เปลี่ยนเองแม้ไม่มีข้อความเข้า) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
