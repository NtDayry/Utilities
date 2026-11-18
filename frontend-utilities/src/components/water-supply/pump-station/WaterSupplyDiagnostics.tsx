import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import TrendCard from '@/components/common/charts/TrendCard';
import { Badge, Card, Stat } from '@/components/water-supply/shared/WaterSupplyUI';
import type { LevelPoint, TankData } from '@/types/waterSupply.types';
import { WATER_HIGH_PCT, WATER_LOW_PCT } from '@/constants/waterSupply';

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

interface Props {
  data: TankData;
  history: LevelPoint[];
  percent: number;
}

/**
 * ส่วนวินิจฉัยระบบประปา (เดิมอยู่หน้า "รายงานระบบประปา")
 * แสดงในหน้ารายละเอียดใต้ผัง 3D/2D: กราฟระดับน้ำสด, สถานะอุปกรณ์, โหมดควบคุม, I/O, ระบบควบคุม
 * กราฟสะสมเฉพาะข้อมูลจริงตั้งแต่เปิดหน้า (ไม่มีข้อมูลจำลอง)
 */
export default function WaterSupplyDiagnostics({ data, history, percent }: Props) {
  const { t } = useTranslation();
  const { water_level: wl, controls: c, system } = data;

  const rssiLabel = (rssi: number) => {
    if (rssi > -60) return { text: t('water_supply.rssi_good'), cls: 'text-success-600 dark:text-success-400' };
    if (rssi > -70) return { text: t('water_supply.rssi_fair'), cls: 'text-warning-600 dark:text-warning-400' };
    return { text: t('water_supply.rssi_weak'), cls: 'text-error-600 dark:text-error-400' };
  };
  const rssi = rssiLabel(system.wifi_rssi);

  const levelPoints = useMemo(() => history.map((p) => ({ x: p.t, y: Number(p.cm.toFixed(1)) })), [history]);
  const flowPoints = useMemo(() => history.map((p) => ({ x: p.t, y: Number((p.flow ?? 0).toFixed(3)) })), [history]);

  const warningMin = Number(((WATER_LOW_PCT / 100) * wl.tank_capacity_cm).toFixed(1));
  const warningMax = Number(((WATER_HIGH_PCT / 100) * wl.tank_capacity_cm).toFixed(1));
  const levelLimits = useMemo(
    () => [
      { y: warningMin, label: `WARNING LOW ${warningMin}`, color: '#F59E0B' },
      { y: warningMax, label: `WARNING HIGH ${warningMax}`, color: '#EF4444' },
    ],
    [warningMin, warningMax]
  );

  return (
    <>
      {/* Main Grid: Chart & Controls */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: AreaChart (เหมือน ReportCharts.tsx) & Quick Stats */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <TrendCard
            title={t('water_supply.water_level_trend')}
            unit="cm"
            points={levelPoints}
            current={wl.level_cm}
            currentSuffix={`(${percent.toFixed(1)}%)`}
            defaultColor="#0284c7"
            decimals={1}
            height={320}
            limits={levelLimits}
            className="flex-1"
          />

          {/* กราฟอัตราการไหล (ค่าสดจากมิเตอร์น้ำ ตั้งแต่เปิดหน้า) */}
          <TrendCard
            title={t('water_supply.flow_rate_trend')}
            unit="m³/h"
            points={flowPoints}
            current={wl.flow_rate}
            defaultColor="#06b6d4"
            decimals={2}
            currentDecimals={3}
            height={280}
            alarm={data.flow_meter.flow_alarm}
            alarmLabel={t('water_supply.flow_alarm')}
            className="flex-1"
          />

          {/* Quick Stat Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <Stat label={t('water_supply.current_level')} value={wl.level_cm.toFixed(1)} unit="cm" />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <Stat label={t('water_supply.tank_capacity')} value={wl.tank_capacity_cm.toFixed(0)} unit="cm" />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <Stat label={t('water_supply.accumulated_volume')} value={wl.volumn.toFixed(2)} unit="m³" />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <Stat label={t('water_supply.flow_rate')} value={wl.flow_rate.toFixed(2)} unit="m³/h" />
            </div>
          </div>
        </div>

        {/* Right 1 Col: Status Badges */}
        <div className="flex flex-col gap-6">
          <Card title={t('water_supply.equipments')} className="flex-1">
            <div className="space-y-2.5">
              <Badge label={t('water_supply.inlet_valve')} on={c.valve_on} />
              <Badge label={t('water_supply.pump_1')} on={c.pump1_on} />
              {c.pump1_overload && <Badge label={t('water_supply.pump1_overload_alert')} on={true} tone="red" />}
              <Badge label={t('water_supply.pump_2')} on={c.pump2_on} />
              {c.pump2_overload && <Badge label={t('water_supply.pump2_overload_alert')} on={true} tone="red" />}
              <Badge label={t('water_supply.alarm')} on={c.alarm_on} tone="red" />
              <Badge label={t('water_supply.pressure_switch')} on={c.pressure_switch} />
            </div>
          </Card>

          <Card title={t('water_supply.control_mode')} className="flex-1">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('water_supply.control_status')}:</span>
              <span className="inline-block rounded-md bg-brand-50 px-3 py-1 text-xs font-bold text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                {c.auto_mode ? t('water_supply.auto') : t('water_supply.manual')}
              </span>
            </div>
            <div className="space-y-2">
              <Badge label={t('water_supply.auto_pump1')} on={c.auto_pump1} />
              <Badge label={t('water_supply.auto_pump2')} on={c.auto_pump2} />
              <Badge label={t('water_supply.manual_pump1')} on={c.manual_pump1} />
              <Badge label={t('water_supply.manual_pump2')} on={c.manual_pump2} />
              <Badge label={t('water_supply.manual_valve')} on={c.manual_valve} />
            </div>
          </Card>

          {/* System & Telemetry */}
          <Card title={t('water_supply.controller_system')} className="flex-1">
            <div className="grid grid-cols-2 gap-4">
              <Stat label={t('water_supply.ip_address')} value={system.ip} />
              <Stat label={t('water_supply.uptime')} value={formatUptime(system.uptime_sec)} />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('water_supply.wifi_rssi')}</div>
                <div className="text-2xl font-bold tabular-nums text-gray-800 dark:text-white/90">
                  {system.wifi_rssi} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">dBm</span>
                </div>
                <div className={`text-xs font-medium mt-0.5 ${rssi.cls}`}>{rssi.text}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('water_supply.sensor_status')}</div>
                <div
                  className={`text-lg font-bold mt-1 ${system.sensor_comm_ok ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}
                >
                  {system.sensor_comm_ok ? t('water_supply.sensor_normal') : t('water_supply.sensor_lost')}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
