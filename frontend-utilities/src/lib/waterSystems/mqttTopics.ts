import { WATER_MQTT_URL } from '@/constants/waterSupply';
import { backendBridge, type BridgeStatus } from '@/lib/mqtt/backendBridge';
import type { BrokerConfig } from '@/types/waterSystem.types';

/**
 * ข้อมูลสดจาก MQTT แยกตาม (broker, topic) — ใช้กับถังน้ำ/บ่อเก็บน้ำที่เพิ่มจากหน้าเว็บ
 * รับผ่าน WebSocket ของ backend ทั้งหมด (lib/mqtt/backendBridge.ts) — เบราว์เซอร์ไม่ต่อ broker เอง
 * ทุกหน้าที่ฟัง feed เดียวกันใช้ subscription เดียว (เปิดเมื่อมีผู้ฟังคนแรก ปิดเมื่อไม่มีผู้ฟังแล้ว)
 * broker ที่กำหนดเองของระบบที่บันทึกแล้ว: ส่ง systemId ให้ backend ใช้ broker ที่เก็บไว้ของระบบนั้น
 */
export type FeedStatus = 'connecting' | 'connected' | 'offline';

export interface FeedSnapshot {
  status: FeedStatus;
  /** สาเหตุล่าสุดที่เชื่อมต่อไม่ได้ (ข้อความจากไลบรารี MQTT / 'unsupported_url') */
  error: string | null;
  /** ข้อความล่าสุด (JSON ที่แปลงแล้ว) — undefined = ยังไม่มีข้อความ */
  raw: unknown;
  /** เวลาที่ได้รับข้อความล่าสุด (ms) */
  at: number | null;
}

export interface Feed {
  broker: BrokerConfig | null;
  topic: string;
  /** id ของระบบที่บันทึกแล้ว — โหมด backend ใช้หา broker ที่กำหนดเองของระบบ */
  systemId?: string;
}

/** broker พื้นฐานของ backend (แสดงผล / ค่าเริ่มต้นเมื่อกำหนด broker เอง) */
export const DEFAULT_BROKER: BrokerConfig = { url: WATER_MQTT_URL, username: '', password: '' };
export const resolveBroker = (b: BrokerConfig | null | undefined): BrokerConfig => (b && b.url ? b : DEFAULT_BROKER);
const brokerKey = (b: BrokerConfig) => `${b.url}\n${b.username}\n${b.password}`;
/** key ของ 1 feed (ใช้เป็น key ของผลลัพธ์จาก useFeeds) */
export const feedKey = (feed: Feed) => `${brokerKey(resolveBroker(feed.broker))}\n${feed.topic}`;

const IDLE: FeedSnapshot = { status: 'offline', error: null, raw: undefined, at: null };

const emit = (entry: BackendEntry, next: FeedSnapshot) => {
  entry.snapshot = next;
  entry.listeners.forEach((fn) => fn());
};

interface BackendEntry {
  snapshot: FeedSnapshot;
  listeners: Set<() => void>;
  unsub: () => void;
}
const backendEntries = new Map<string, BackendEntry>();

const bridgeToFeedStatus = (st: BridgeStatus): FeedStatus =>
  st.ws === 'closed' ? 'offline' : st.ws === 'connecting' || st.broker === null ? 'connecting' : st.broker ? 'connected' : 'offline';

function subscribeFeedBackend(feed: Feed, listener: () => void): () => void {
  const key = feedKey(feed);
  let entry = backendEntries.get(key);
  if (!entry) {
    const e: BackendEntry = { snapshot: { status: 'connecting', error: null, raw: undefined, at: null }, listeners: new Set(), unsub: () => {} };
    entry = e;
    backendEntries.set(key, e);
    const custom = Boolean(feed.broker && feed.broker.url);
    if (custom && !feed.systemId) {
      // broker ที่กำหนดเองแต่ยังไม่ได้บันทึกระบบ: backend ยังไม่รู้จัก broker นี้ (หน้าต่างเพิ่มระบบใช้ probeMqtt แทน)
      e.snapshot = { status: 'offline', error: 'unsaved_broker', raw: undefined, at: null };
    } else {
      e.unsub = backendBridge.subscribe(
        feed.topic,
        custom ? feed.systemId ?? null : null,
        (m) => emit(e, { status: 'connected', error: null, raw: m.data, at: m.at }),
        (st) => emit(e, { ...e.snapshot, status: bridgeToFeedStatus(st), error: st.error }),
      );
    }
  }
  const e = entry;
  e.listeners.add(listener);
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      e.unsub();
      backendEntries.delete(key);
    }
  };
}

/** ข้อมูลล่าสุดของ feed (object ใหม่ทุกครั้งที่เปลี่ยน) */
export const getFeedSnapshot = (feed: Feed): FeedSnapshot => backendEntries.get(feedKey(feed))?.snapshot ?? IDLE;

/** ฟังข้อความของ feed — คืนฟังก์ชันเลิกฟัง */
export function subscribeFeed(feed: Feed, listener: () => void): () => void {
  if (!feed.topic) return () => {};
  return subscribeFeedBackend(feed, listener);
}
