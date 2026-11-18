import type { TankData } from '@/types/waterSupply.types';

// MQTT ของระบบประปา: หน้าเว็บรับ/ส่งผ่าน WebSocket /ws/utilities/mqtt ของ backend เท่านั้น
// (ไม่มีชื่อผู้ใช้/รหัสผ่าน broker ในหน้าเว็บ ; ส่งคำสั่งได้เฉพาะ admin — ตรวจที่ backend)
// topic / broker ของบ่อประปา + ปั๊ม ตั้งในหน้าเว็บ (lib/waterSupply/source.ts)
// URL ใช้แสดงผลเท่านั้น = broker พื้นฐานของ backend (DEFAULT_MQTT_URL) — ค่าเริ่มต้นเมื่อระบบน้ำกำหนด broker เอง
export const WATER_MQTT_URL = import.meta.env.VITE_MQTT_WATER_URL || 'mqtt://utilities-mqtt:1883';

// เกณฑ์ระดับน้ำ (% ของความจุรวม) และเวลาที่ถือว่าข้อมูลค้าง
export const WATER_LOW_PCT = 20;
export const WATER_HIGH_PCT = 95;
export const WATER_STALE_MS = 15_000;

// ค่าเริ่มต้นเมื่อยังไม่มีข้อมูล MQTT เข้ามา (สถานะปิด/ว่าง)
const DEFAULT_PUMP = {
  running: false,
  alarm: false,
  freq: 0,
  current: 0,
  status_word: 0,
  auto_enabled: false,
  manual_enabled: false,
  modbus_ok: false,
};

export const DEFAULT_TANK_DATA: TankData = {
  water_level: {
    level_cm: 0,
    level_pct: 0,
    volumn: 0,
    flow_rate: 0,
    tank_capacity_cm: 180.0,
  },
  controls: {
    valve_on: false,
    pump1_on: false,
    pump2_on: false,
    pump1_overload: false,
    pump2_overload: false,
    pump1_alarm: false,
    pump2_alarm: false,
    alarm_on: false,
    auto_mode: false,
    auto_pump1: false,
    auto_pump2: false,
    manual_pump1: false,
    manual_pump2: false,
    manual_valve: false,
    manual_speed_pump1: 0,
    manual_speed_pump2: 0,
    pressure_bar: 0,
    set_pressure: 0,
    pid_kp: 0,
    pid_ki: 0,
    acc_dec: 0,
    sleep_freq: 0,
    sleep_delay_sec: 0,
    is_sleeping: false,
    lower_limit_cm: 0,
    sensor_type_switch: false,
    sensor_type: '-',
    pressure_switch: false,
    pressure_sensor_ok: false,
    pid_target_freq: 0,
  },
  flow_meter: {
    ok: false,
    velocity: 0,
    today_total: 0,
    month_total: 0,
    temp_c: 0,
    error_code: '',
    battery_v: 0,
    flow_alarm: false,
  },
  pump1: { ...DEFAULT_PUMP },
  pump2: { ...DEFAULT_PUMP },
  local_io: { di0: false, di1: false, do0: false, do1: false },
  rs485_io: {
    status_ok: false,
    input: { di1: false, di2: false, di3: false, di4: false },
    output: { ch1: false, ch2: false, ch3: false, ch4: false },
  },
  system: {
    wifi_rssi: 0,
    ip: '-',
    sensor_comm_ok: false,
    rs485_io_ok: false,
    meter_comm_ok: false,
    level_comm_ok: false,
    pump1_comm_ok: false,
    pump2_comm_ok: false,
    pressure_comm_ok: false,
    uptime_sec: 0,
  },
};
