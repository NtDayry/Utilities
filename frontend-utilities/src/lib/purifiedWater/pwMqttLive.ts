/**
 * ค่าสดของเซนเซอร์ Purified Water จาก MQTT (แทน WebSocket /ws/sensor-data เดิม)
 *
 * - topic + field ของแต่ละเซนเซอร์: GET /api/purified-water/mqtt/sources (ตั้งในหน้า purified-water/settings)
 * - รับข้อความ MQTT ผ่าน backend (/ws/utilities/mqtt, systemId ของ Purified Water) — เบราว์เซอร์ไม่ต่อ broker เอง ไม่มีรหัสผ่าน broker
 * - แปลงค่า raw ด้วย sensor config ที่ใช้งานอยู่ (สูตรเดียวกับ backend — pwConvert.ts)
 * - ส่งให้หน้าเว็บทุก 1 วินาทีในรูปแบบ payload เดิมของ /ws/sensor-data (data / raw_data / raw / statuses)
 *   หน้าเว็บเดิมจึงใช้ข้อมูลได้เหมือนเดิม
 * การเชื่อมต่อเดียวใช้ร่วมกันทุกหน้า: เริ่มเมื่อมีผู้ฟังคนแรก หยุดเมื่อไม่มีผู้ฟัง
 */
import { api, getSensorConfigs, type SensorConfig } from '@/api';
import { backendBridge, type BridgeMessage, type BridgeStatus } from '@/lib/mqtt/backendBridge';
import type { ConnStatus } from '@/types/waterSupply.types';
import { convertPwRaw, readPwField, type PwReadingStatus } from '@/lib/purifiedWater/pwConvert';

export interface PwLiveMessage {
  type: 'data';
  timestamp: string;
  /** ค่าจริงตามอุปกรณ์ { [device]: { [metric]: value } } + adjusted / raw แบบแบน (เหมือนเดิม) */
  data: Record<string, Record<string, unknown>>;
  raw_data: Record<string, Record<string, unknown>>;
  raw: Record<string, unknown>;
  statuses: Record<string, PwReadingStatus>;
}

interface Mapping {
  device_name: string;
  metric_name: string;
  topic: string;
  field: string;
}
interface Sources {
  systemId: string;
  enabled: boolean;
  mappings: Mapping[];
}
interface Latest {
  raw: number;
  value: number;
  status: PwReadingStatus;
  at: number;
}

const EMIT_MS = 1_000;
const RELOAD_MS = 15_000;
/** ค่าที่ไม่ได้รับนานกว่านี้ไม่ส่งเป็นค่าสด */
const LIVE_STALE_MS = 30_000;

type DataFn = (msg: PwLiveMessage) => void;
type StatusFn = (s: ConnStatus) => void;

class PwMqttLive {
  private dataFns = new Set<DataFn>();
  private statusFns = new Set<StatusFn>();
  private systemId = '__purified_water__';
  private byTopic = new Map<string, Mapping[]>();
  private configs = new Map<string, SensorConfig>();
  private latest = new Map<string, Latest>();
  private subs = new Map<string, () => void>();
  private topicStatus = new Map<string, BridgeStatus>();
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private reloadTimer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  private running = false;
  private status: ConnStatus = 'connecting';

  subscribe(onData: DataFn, onStatus?: StatusFn): () => void {
    this.dataFns.add(onData);
    if (onStatus) {
      this.statusFns.add(onStatus);
      onStatus(this.status);
    }
    if (!this.running) this.start();
    else {
      const msg = this.buildMessage(Date.now());
      if (msg) onData(msg);
    }
    return () => {
      this.dataFns.delete(onData);
      if (onStatus) this.statusFns.delete(onStatus);
      if (this.dataFns.size === 0 && this.statusFns.size === 0) this.stop();
    };
  }

  /** โหลด topic/field + sensor config ใหม่ทันที (เรียกหลังแก้ค่าในหน้า settings) */
  reload(): Promise<void> {
    return this.load();
  }

  // ------------------------------------------------------------ lifecycle
  private start() {
    this.running = true;
    this.load();
    this.emitTimer = setInterval(() => this.emit(), EMIT_MS);
    this.reloadTimer = setInterval(() => this.load(), RELOAD_MS);
  }

  private stop() {
    this.running = false;
    if (this.emitTimer) clearInterval(this.emitTimer);
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    this.emitTimer = this.reloadTimer = null;
    this.subs.forEach((unsub) => unsub());
    this.subs.clear();
    this.topicStatus.clear();
    this.byTopic.clear();
    this.latest.clear();
    this.loaded = false;
    this.status = 'connecting';
  }

  private async load() {
    try {
      const [src, cfgs] = await Promise.all([
        api.get<Sources>('/purified-water/mqtt/sources').then((r) => r.data),
        getSensorConfigs(),
      ]);
      if (!this.running) return;
      this.systemId = src.systemId || this.systemId;
      this.configs = new Map(cfgs.map((c) => [`${c.device_name}/${c.metric_name}`, c]));
      const byTopic = new Map<string, Mapping[]>();
      for (const m of src.enabled ? src.mappings : []) {
        if (!m.topic) continue;
        const list = byTopic.get(m.topic) ?? [];
        list.push(m);
        byTopic.set(m.topic, list);
      }
      // เลิกฟัง topic ที่ไม่ใช้แล้ว / เริ่มฟัง topic ใหม่
      for (const [topic, unsub] of this.subs) {
        if (!byTopic.has(topic)) {
          unsub();
          this.subs.delete(topic);
          this.topicStatus.delete(topic);
        }
      }
      this.byTopic = byTopic;
      for (const topic of byTopic.keys()) {
        if (this.subs.has(topic)) continue;
        const unsub = backendBridge.subscribe(
          topic,
          this.systemId,
          (m) => this.onMessage(m),
          (s) => {
            this.topicStatus.set(topic, s);
            this.updateStatus();
          },
        );
        this.subs.set(topic, unsub);
      }
      const mapped = new Set([...byTopic.values()].flat().map((m) => `${m.device_name}/${m.metric_name}`));
      for (const key of this.latest.keys()) if (!mapped.has(key)) this.latest.delete(key);
      this.loaded = true;
      this.updateStatus();
    } catch (err) {
      console.warn('[pw-mqtt-live] load sources failed:', err);
      if (!this.loaded) this.setStatus('offline');
    }
  }

  private onMessage(m: BridgeMessage) {
    for (const map of this.byTopic.get(m.topic) ?? []) {
      const key = `${map.device_name}/${map.metric_name}`;
      const cfg = this.configs.get(key);
      if (!cfg) continue;
      const raw = readPwField(m.data, map.field);
      if (raw === undefined) continue;
      const conv = convertPwRaw(raw, cfg);
      if (!conv) continue;
      this.latest.set(key, { ...conv, at: m.at });
    }
  }

  private updateStatus() {
    if (!this.loaded) return;
    const states = [...this.topicStatus.values()];
    // ไม่มี topic ที่ตั้งไว้ = ไม่มีแหล่งข้อมูล
    if (this.byTopic.size === 0) return this.setStatus('offline');
    if (states.some((s) => s.ws === 'open' && s.broker === true)) return this.setStatus('connected');
    if (states.length < this.byTopic.size || states.some((s) => s.ws === 'connecting' || (s.ws === 'open' && s.broker === null))) {
      return this.setStatus('connecting');
    }
    this.setStatus('offline');
  }

  private setStatus(s: ConnStatus) {
    if (s === this.status) return;
    this.status = s;
    this.statusFns.forEach((fn) => fn(s));
  }

  // ------------------------------------------------------------ payload
  private buildMessage(now: number): PwLiveMessage | null {
    const fresh = [...this.latest.entries()].filter(([, v]) => now - v.at <= LIVE_STALE_MS);
    if (!fresh.length) return null;
    const msg: PwLiveMessage = {
      type: 'data',
      timestamp: new Date(now).toISOString(),
      data: { adjusted: {}, raw: {} },
      raw_data: {},
      raw: {},
      statuses: {},
    };
    for (const [key, v] of fresh) {
      const [device, metric] = key.split('/');
      (msg.data[device] ??= {})[metric] = v.value;
      (msg.raw_data[device] ??= {})[metric] = v.raw;
      msg.data.adjusted[metric] = v.value;
      msg.data.adjusted[`${device}_${metric}`] = v.value;
      msg.data.raw[metric] = v.raw;
      msg.data.raw[`${device}_${metric}`] = v.raw;
      msg.raw[metric] = v.raw;
      msg.raw[`${device}_${metric}`] = v.raw;
      msg.statuses[metric] = v.status;
    }
    return msg;
  }

  private emit() {
    const msg = this.buildMessage(Date.now());
    if (msg) this.dataFns.forEach((fn) => fn(msg));
  }
}

const live = new PwMqttLive();

/** รับค่าสดของ Purified Water (payload รูปแบบเดิมของ /ws/sensor-data) — คืนฟังก์ชันเลิกรับ */
export const subscribePwLive = (onData: (msg: PwLiveMessage) => void, onStatus?: (s: ConnStatus) => void) => live.subscribe(onData, onStatus);

/** โหลด topic/field + sensor config ใหม่ทันที */
export const reloadPwLive = () => live.reload();
