/**
 * ช่องทาง MQTT ผ่าน backend: WebSocket /ws/utilities/mqtt (login ด้วย cookie เดียวกับ API)
 *
 * - เบราว์เซอร์ไม่ต่อ broker เอง และไม่มีรหัสผ่าน broker อยู่ในไฟล์ JS
 * - การส่งคำสั่ง (<topic>/set) ตรวจสิทธิ์ admin ที่ backend
 * - การเชื่อมต่อเดียวใช้ร่วมกันทุกหน้า: เปิดเมื่อมีผู้ฟังคนแรก ปิดเมื่อไม่มีผู้ฟัง, หลุดแล้วต่อใหม่เอง + subscribe ซ้ำ
 *
 * systemId: ใช้ broker ที่บันทึกไว้ของระบบนั้น (ระบบที่กำหนด broker เอง) ; ไม่ระบุ = broker พื้นฐานของเซิร์ฟเวอร์
 */
import type { UtilityAlarmEvent } from '@/lib/utilityAlarms/types';

export interface BridgeMessage {
  topic: string;
  systemId: string | null;
  data: Record<string, unknown>;
  /** เวลาที่ได้รับ (ms ตามนาฬิกาของเบราว์เซอร์) */
  at: number;
}
/** null = ยังไม่รู้ (กำลังต่อ) ; true/false = backend ต่อ broker ได้ / ไม่ได้ */
export type BridgeStatus = { ws: 'connecting' | 'open' | 'closed'; broker: boolean | null; error: string | null };
export interface BridgeAlarm {
  action: 'raised' | 'cleared' | 'acknowledged';
  event: UtilityAlarmEvent;
}

type MsgFn = (m: BridgeMessage) => void;

/** ข้อความจาก backend (ws.py) */
interface ServerMsg {
  type?: string;
  topic?: string;
  systemId?: string | null;
  data?: Record<string, unknown>;
  ageMs?: number;
  connected?: boolean;
  isAdmin?: boolean;
  id?: string;
  ok?: boolean;
  error?: string;
  action?: BridgeAlarm['action'];
  event?: UtilityAlarmEvent;
}
type StatusFn = (s: BridgeStatus) => void;

interface Sub {
  topic: string;
  systemId: string | null;
  onMsg: Set<MsgFn>;
  onStatus: Set<StatusFn>;
  status: BridgeStatus;
  last: BridgeMessage | null;
}

const PATH = '/ws/utilities/mqtt';
const PUBLISH_TIMEOUT_MS = 8_000;
const CLOSE_DELAY_MS = 3_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 15_000;

const subKey = (topic: string, systemId: string | null) => `${systemId ?? ''}\n${topic}`;

class BackendBridge {
  private ws: WebSocket | null = null;
  private wsState: BridgeStatus['ws'] = 'closed';
  private subs = new Map<string, Sub>();
  private alarmFns = new Set<(a: BridgeAlarm) => void>();
  private acks = new Map<string, { resolve: (err?: string) => void; timer: ReturnType<typeof setTimeout> }>();
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;
  /** ได้จากข้อความ hello ของ backend */
  isAdmin = false;

  // ------------------------------------------------------------ public
  subscribe(topic: string, systemId: string | null, onMsg: MsgFn, onStatus?: StatusFn): () => void {
    const key = subKey(topic, systemId);
    let sub = this.subs.get(key);
    const first = !sub;
    if (!sub) {
      sub = { topic, systemId, onMsg: new Set(), onStatus: new Set(), status: this.statusFor(null), last: null };
      this.subs.set(key, sub);
    }
    sub.onMsg.add(onMsg);
    if (onStatus) {
      sub.onStatus.add(onStatus);
      onStatus(sub.status);
    }
    if (sub.last) onMsg(sub.last);
    this.ensureOpen();
    if (first) this.send({ type: 'subscribe', topic, systemId });
    return () => {
      const s = this.subs.get(key);
      if (!s) return;
      s.onMsg.delete(onMsg);
      if (onStatus) s.onStatus.delete(onStatus);
      if (s.onMsg.size === 0 && s.onStatus.size === 0) {
        this.subs.delete(key);
        this.send({ type: 'unsubscribe', topic, systemId });
      }
      this.closeIfIdle();
    };
  }

  /** ส่งคำสั่งไป <base>/set — คืน undefined เมื่อ backend ส่งต่อให้ broker แล้ว, หรือรหัสข้อผิดพลาด */
  publish(topic: string, payload: Record<string, unknown>, systemId: string | null = null): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (this.wsState !== 'open') return resolve('not_connected');
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        this.acks.delete(id);
        resolve('bridge_timeout');
      }, PUBLISH_TIMEOUT_MS);
      this.acks.set(id, { resolve, timer });
      this.send({ type: 'publish', id, topic, payload, systemId });
    });
  }

  onAlarm(fn: (a: BridgeAlarm) => void): () => void {
    this.alarmFns.add(fn);
    this.ensureOpen();
    return () => {
      this.alarmFns.delete(fn);
      this.closeIfIdle();
    };
  }

  // ------------------------------------------------------------ connection
  private url(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${PATH}`;
  }

  private ensureOpen() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.ws || this.retryTimer) return;
    this.connect();
  }

  private connect() {
    this.retryTimer = null;
    this.setWsState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'ws_error';
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = RETRY_MIN_MS;
      this.lastError = null;
      this.setWsState('open');
      // ต่อใหม่ → subscribe ทุก topic ที่ยังมีผู้ฟัง
      this.subs.forEach((s) => this.send({ type: 'subscribe', topic: s.topic, systemId: s.systemId }));
    };
    ws.onmessage = (ev) => {
      let m: unknown;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m && typeof m === 'object') this.handle(m as ServerMsg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // 4401 / 1008 / ปิดก่อน accept (HTTP 403) = ไม่ได้ login หรือ session หมดอายุ
      this.lastError = ev.code === 4401 || ev.code === 1008 ? 'unauthorized' : this.lastError ?? 'disconnected';
      this.setWsState('closed');
      this.acks.forEach((a) => {
        clearTimeout(a.timer);
        a.resolve('bridge_closed');
      });
      this.acks.clear();
      if (this.subs.size > 0 || this.alarmFns.size > 0) this.scheduleRetry();
    };
    ws.onerror = () => {
      this.lastError = 'ws_error';
    };
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  private closeIfIdle() {
    if (this.subs.size > 0 || this.alarmFns.size > 0 || this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (this.subs.size > 0 || this.alarmFns.size > 0) return;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      const ws = this.ws;
      this.ws = null;
      ws?.close();
      this.setWsState('closed');
    }, CLOSE_DELAY_MS);
  }

  private send(m: Record<string, unknown>) {
    if (this.ws && this.wsState === 'open') this.ws.send(JSON.stringify(m));
  }

  // ------------------------------------------------------------ messages
  private handle(m: ServerMsg) {
    switch (m?.type) {
      case 'hello':
        this.isAdmin = Boolean(m.isAdmin);
        break;
      case 'status': {
        const sub = this.subs.get(subKey(m.topic ?? '', m.systemId ?? null));
        if (sub) this.setSubStatus(sub, Boolean(m.connected), m.connected ? null : 'broker_offline');
        break;
      }
      case 'msg': {
        const sub = this.subs.get(subKey(m.topic ?? '', m.systemId ?? null));
        if (!sub || !m.data || typeof m.data !== 'object') break;
        // เวลาตามนาฬิกาของเบราว์เซอร์ (หน้าเว็บเทียบกับ Date.now() เพื่อดูว่าข้อมูลค้างหรือไม่) ; ข้อความที่ backend เก็บไว้ส่งอายุมาด้วย
        const msg: BridgeMessage = { topic: sub.topic, systemId: sub.systemId, data: m.data, at: Date.now() - Math.max(0, Number(m.ageMs) || 0) };
        sub.last = msg;
        // มีข้อความเข้า = backend ต่อ broker ได้
        if (sub.status.broker !== true) this.setSubStatus(sub, true, null);
        sub.onMsg.forEach((fn) => fn(msg));
        break;
      }
      case 'publish-ack': {
        const a = m.id ? this.acks.get(m.id) : undefined;
        if (a && m.id) {
          this.acks.delete(m.id);
          clearTimeout(a.timer);
          a.resolve(m.ok ? undefined : String(m.error || 'publish_failed'));
        }
        break;
      }
      case 'alarm':
        if (m.action && m.event) {
          const a: BridgeAlarm = { action: m.action, event: m.event };
          this.alarmFns.forEach((fn) => fn(a));
        }
        break;
      case 'error': {
        // unknown_system / topic_invalid ของ subscription ใด → แจ้งสถานะ offline พร้อมสาเหตุ
        const sub = m.topic !== undefined || m.systemId !== undefined ? this.subs.get(subKey(m.topic ?? '', m.systemId ?? null)) : undefined;
        if (sub) this.setSubStatus(sub, false, String(m.error));
        else if (m.systemId) this.subs.forEach((s) => s.systemId === m.systemId && this.setSubStatus(s, false, String(m.error)));
        break;
      }
    }
  }

  private statusFor(broker: boolean | null, error: string | null = null): BridgeStatus {
    return { ws: this.wsState, broker: this.wsState === 'open' ? broker : null, error: this.wsState === 'closed' ? this.lastError : error };
  }

  private setSubStatus(sub: Sub, broker: boolean | null, error: string | null) {
    sub.status = this.statusFor(broker, error);
    sub.onStatus.forEach((fn) => fn(sub.status));
  }

  private setWsState(state: BridgeStatus['ws']) {
    this.wsState = state;
    // ยังไม่รู้สถานะ broker จนกว่า backend จะตอบ status ของแต่ละ topic
    this.subs.forEach((s) => this.setSubStatus(s, null, null));
  }
}

export const backendBridge = new BackendBridge();
