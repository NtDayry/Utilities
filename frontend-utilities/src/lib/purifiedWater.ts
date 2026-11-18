import type { Tone } from '@/components/common/widgets/PumpStatusCards';
import type { PwSensorStatus } from '@/hooks/usePwSensors';

/**
 * รายการเซ็นเซอร์ของระบบ Purified Water แยกตามกลุ่ม (กลุ่มเดียวกับหน้า PW เดิม)
 * device = device_name ใน sensor configs / alert rules ของ backend ; metric = key ในข้อมูลค่าสด (lib/purifiedWater/pwMqttLive)
 * temp = ค่าอุณหภูมิคู่กัน (ถ้ามี) แสดงเป็นค่ารอง
 */
export type PwGroupId = 'tank' | 'loop' | 'ro';

export interface PwSensorItem {
  id: string;
  label: string;
  device: string;
  metric: string;
  temp?: string;
  /** สีตัวเลขค่าหลัก + โทนพื้นการ์ด */
  color: string;
  /** รูปแบบการ์ด: default = ค่าหลัก (+อุณหภูมิ) · compact = แถวเดียวเตี้ย · gauge = วงแหวน */
  tile?: PwTileVariant;
}

export type PwTileVariant = 'default' | 'compact' | 'gauge';

export interface PwGroup {
  id: PwGroupId;
  title: string;
  subtitle: string;
  accent: string;
  items: PwSensorItem[];
}

export const PW_LEVEL = { device: 'distribution_loop', metric: 'water_level' } as const;

export const PW_GROUPS: PwGroup[] = [
  {
    id: 'tank',
    title: 'PW Tank',
    subtitle: 'Purified Water',
    accent: '#22c55e',
    items: [
      { id: 'water_meter', label: 'Water Meter', device: 'water_flow', metric: 'water_meter', color: '#0ea5e9' },
      { id: 'flow_rate', label: 'Flow Rate', device: 'water_flow', metric: 'flow_rate', color: '#0ea5e9' },
    ],
  },
  {
    id: 'loop',
    title: 'Distribution Loop',
    subtitle: 'Circulation & Quality',
    accent: '#f43f5e',
    items: [
      { id: 'uv', label: 'UV Index', device: 'distribution_loop', metric: 'uv3', color: '#7050fd', tile: 'gauge' },
      { id: 'toc', label: 'TOC', device: 'distribution_loop', metric: 'toc', temp: 'toc_temp', color: '#eab308' },
      { id: 'conduct', label: 'Conductivity', device: 'distribution_loop', metric: 'dis_loop_conduct', temp: 'dis_loop_temp', color: '#06b6d4' },
      { id: 'instant_flow', label: 'Instant flow rate', device: 'flow_metrics', metric: 'instant_flow_rate', tile: 'compact', color: '#0ea5e9' },
      { id: 'velocity', label: 'Fluid velocity', device: 'flow_metrics', metric: 'fluid_velocity', tile: 'compact', color: '#0ea5e9' },
    ],
  },
  {
    id: 'ro',
    title: 'RO System',
    subtitle: 'Reverse Osmosis + EDI',
    accent: '#818cf8',
    items: [
      { id: 'ro1', label: 'RO 1', device: 'ro_system', metric: 'ro1_conduct', temp: 'ro1_temp', color: '#8b5cf6' },
      { id: 'ro2', label: 'RO 2', device: 'ro_system', metric: 'ro2_conduct', temp: 'ro2_temp', color: '#8b5cf6' },
      { id: 'edi', label: 'EDI', device: 'ro_system', metric: 'edi_conduct', temp: 'edi_temp', color: '#8b5cf6' },
    ],
  },
];

export const PW_LOOP = PW_GROUPS.find((g) => g.id === 'loop')!;

/** สถานะเซ็นเซอร์ → โทนการ์ด (warning = เกินเกณฑ์เตือน → การ์ดแดงแบบไซเรน) */
export const PW_STATUS_TONE: Record<PwSensorStatus, Tone> = {
  normal: 'run',
  warning: 'fault',
  under_range: 'sleep',
  over_range: 'sleep',
  no_signal: 'stop',
  inactive: 'stop',
};

export { fmtNum } from '@/utils/format';
