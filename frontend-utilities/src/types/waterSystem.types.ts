/**
 * ถังน้ำ / บ่อเก็บน้ำที่เพิ่มจากหน้าภาพรวมระบบน้ำ
 * (บ่อน้ำประปา + ระบบปั๊มของโรงงาน และ Purified Water เป็นหน้าตายตัว ไม่ใช้ระบบนี้)
 *
 * 1 ระบบ = 1 MQTT topic ของคอนโทรลเลอร์ — ทุกค่าที่แสดงระบุ "ตำแหน่งของข้อมูล" ใน JSON เอง (เช่น water_level.level_cm)
 * จึงไม่ผูกกับโครงสร้างข้อมูลของ firmware ตัวใดตัวหนึ่ง
 */

export type WaterSystemKind = 'tank' | 'pond';
/** inverter = มี Hz / A ; magnetic = คอนแทคเตอร์ เดิน/หยุด */
export type PumpDrive = 'inverter' | 'magnetic';
export type TankShape = 'rect' | 'cylinder';
/** หน่วยของค่าที่เซ็นเซอร์ระดับส่งมา */
export type LevelUnit = 'cm' | 'm' | 'mm' | 'percent';

/** การเชื่อมต่อ MQTT over WebSocket — url ว่าง = ใช้ค่าพื้นฐานของระบบ (VITE_MQTT_WATER_*) */
export interface BrokerConfig {
  url: string;
  username: string;
  password: string;
}

export interface WaterSystemTank {
  name: string;
  shape: TankShape;
  /** ใช้เมื่อ shape = rect */
  width_m: number;
  length_m: number;
  /** ใช้เมื่อ shape = cylinder */
  diameter_m: number;
  height_m: number;
  /** พื้นของใบนี้ต่ำกว่าพื้นใบแรกกี่ ซม. (ใบแรก = 0) */
  offset_cm: number;
}

export interface SensorRef {
  enabled: boolean;
  /** ตำแหน่งของข้อมูลใน JSON คั่นด้วยจุด */
  path: string;
  /** หน่วยที่แสดง (ระดับน้ำใช้ levelUnit แทน) */
  unit: string;
}

export type SensorKey = 'level' | 'meterTotal' | 'flowRate' | 'inletValve';

export interface WaterSystemPump {
  name: string;
  drive: PumpDrive;
  /**
   * ตำแหน่งของข้อมูลปั๊ม: ชี้ไปที่ก้อนข้อมูล (เช่น pump1 ที่มี running / freq / current / alarm)
   * หรือชี้ไปที่ค่าเดิน/หยุดโดยตรง (เช่น controls.pump1_on)
   */
  path: string;
  /** (ไม่บังคับ) ตำแหน่งของสัญญาณ overload / fault */
  faultPath: string;
}

export interface WaterSystemConfig {
  id: string;
  name: string;
  location: string;
  kind: WaterSystemKind;
  /** null = broker พื้นฐานของระบบ */
  broker: BrokerConfig | null;
  topic: string;
  /** ทุกใบเชื่อมถึงกัน (ผิวน้ำระดับเดียวกัน) วัดด้วยเซ็นเซอร์ระดับตัวเดียว */
  tanks: WaterSystemTank[];
  /** เซ็นเซอร์ระดับติดตั้งที่ใบลำดับไหน (เริ่มที่ 0) */
  sensorTank: number;
  sensors: Record<SensorKey, SensorRef>;
  levelUnit: LevelUnit;
  /** สีของน้ำในภาพ 3 มิติและแถบระดับ (#rrggbb) — ค่าเริ่มต้นสีน้ำเงิน */
  waterColor: string;
  pumps: WaterSystemPump[];
  /** เกณฑ์ระดับน้ำ (% ของความจุรวม) */
  lowPct: number;
  highPct: number;
  createdAt: string;
  updatedAt: string;
}
