/** สถานะอินเวอร์เตอร์/ปั๊มแต่ละตัว (อ่านผ่าน Modbus RS485) */
export interface PumpInfo {
  running: boolean;
  alarm: boolean;
  freq: number; // Hz
  current: number; // A
  status_word: number;
  auto_enabled: boolean;
  manual_enabled: boolean;
  modbus_ok: boolean;
}

export interface TankData {
  water_level: {
    level_cm: number;
    level_pct: number; // % ที่ controller คำนวณจาก tank_capacity_cm
    volumn: number; // ชื่อ key ตามที่ firmware ส่งมา (สะกด volumn)
    flow_rate: number;
    tank_capacity_cm: number;
  };
  controls: {
    valve_on: boolean;
    pump1_on: boolean;
    pump2_on: boolean;
    pump1_overload?: boolean;
    pump2_overload?: boolean;
    pump1_alarm: boolean;
    pump2_alarm: boolean;
    alarm_on: boolean;
    auto_mode: boolean;
    auto_pump1: boolean;
    auto_pump2: boolean;
    manual_pump1: boolean;
    manual_pump2: boolean;
    manual_valve: boolean;
    manual_speed_pump1: number; // %
    manual_speed_pump2: number; // %
    pressure_bar: number;
    set_pressure: number;
    pid_kp: number;
    pid_ki: number;
    acc_dec: number; // s
    sleep_freq: number; // Hz
    sleep_delay_sec: number;
    is_sleeping: boolean;
    lower_limit_cm: number;
    sensor_type_switch: boolean;
    sensor_type: string; // 'pressure_switch' | 'pressure_sensor'
    pressure_switch: boolean;
    pressure_sensor_ok: boolean;
    pid_target_freq: number; // Hz
  };
  /** มิเตอร์น้ำ (firmware รุ่นใหม่: object flow_meter) — flow_rate / volumn ถูก map ไปที่ water_level ด้วย */
  flow_meter: {
    ok: boolean;
    velocity: number; // m/s
    today_total: number; // m³ วันนี้
    month_total: number; // m³ เดือนนี้
    temp_c: number;
    error_code: string;
    battery_v: number;
    flow_alarm: boolean;
  };
  pump1: PumpInfo;
  pump2: PumpInfo;
  local_io: { di0: boolean; di1: boolean; do0: boolean; do1: boolean };
  rs485_io: {
    status_ok: boolean;
    input: Record<string, boolean>;
    output: Record<string, boolean>;
  };
  system: {
    wifi_rssi: number;
    ip: string;
    sensor_comm_ok: boolean;
    rs485_io_ok: boolean;
    meter_comm_ok: boolean;
    level_comm_ok: boolean;
    pump1_comm_ok: boolean;
    pump2_comm_ok: boolean;
    pressure_comm_ok: boolean;
    uptime_sec: number;
  };
}

export type ConnStatus = 'connecting' | 'connected' | 'offline';

export interface LevelPoint {
  t: number;
  cm: number;
  flow?: number; // อัตราการไหล (m³/h) ณ เวลาเดียวกัน
}

export type DisplayUnit = 'cm' | 'liter';

export interface TankDimensions {
  width_m: number;
  length_m: number;
  height_m: number;
}

export interface TankConfig {
  tank1: TankDimensions;
  tank2: TankDimensions;
  tank2_offset_cm: number; // บ่อ 2 อยู่ต่ำกว่าบ่อ 1 กี่ ซม.
  sensor_tank: 1 | 2; // เซนเซอร์วัดอยู่ที่บ่อ 1 หรือ บ่อ 2
}

export interface SingleTankCalc {
  level_cm: number;
  height_cm: number;
  volume_l: number;
  capacity_l: number;
  percent: number;
  width_m: number;
  length_m: number;
  height_m: number;
}

export interface TankCalculations {
  tank1: SingleTankCalc;
  tank2: SingleTankCalc;
  total: {
    volume_l: number;
    capacity_l: number;
    percent: number;
  };
}

/** ค่าตั้งปัจจุบันของคอนโทรลเลอร์ (MQTT <base>/settings, retained) — ชื่อ key ตาม firmware */
export interface WaterControllerSettings {
  valve_on_cm: number;
  tank_capacity: number; // ช่วงวัด/ความสูงบ่อ (cm)
  valve_period_sec: number;
  alert_min_cm: number;
  alert_max_cm: number;
  alert_period_sec: number;
  lower_limit_cm: number;
  auto_mode: boolean;
  auto_pump1: boolean;
  auto_pump2: boolean;
  manual_pump1: boolean;
  manual_pump2: boolean;
  manual_valve: boolean;
  manual_speed_pump1: number; // Hz
  manual_speed_pump2: number; // Hz
  pid_kp: number;
  pid_ki: number;
  acc_dec: number;
  set_pressure: number;
  sleep_freq: number;
  sleep_delay_sec: number;
  sensor_type_switch: boolean;
}

/** ข้อมูลระบบของคอนโทรลเลอร์ (MQTT <base>/configs, retained) */
export interface WaterControllerConfigs {
  system?: { device?: string; firmware_version?: string; uptime_sec?: number; free_heap?: number };
  power_system?: { auto_backlight_enabled?: boolean; auto_backlight_min?: number; auto_restart_enabled?: boolean; auto_restart_min?: number };
  network?: { ip?: string; mac?: string; wifi_rssi?: number };
  mqtt?: { base_topic?: string };
}
