import { useMemo, useState } from 'react';
import { useNow } from '@/hooks/useNow';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Moon, Settings, SlidersHorizontal } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { isAdminRole } from '@/store/factorySensorSettings';
import { Link } from 'react-router';
import PageMeta from '@/components/common/page/PageMeta';
import BackNav from '@/components/common/navigation/BackNav';
import { useMqttTank } from '@/hooks/useMqttTank';
import PumpSystem3D from '@/components/water-supply/pump-station/PumpSystem3D';
import PumpStatusCards from '@/components/common/widgets/PumpStatusCards';
import ControlParamsPanel from '@/components/water-supply/pump-station/ControlParamsPanel';
import PumpStationReport from '@/components/water-supply/pump-station/PumpStationReport';
import TankSummaryCards from '@/components/water-supply/pump-station/TankSummaryCards';
import TankConfigModal from '@/components/water-supply/pump-station/TankConfigModal';
import WaterSupplyDiagnostics from '@/components/water-supply/pump-station/WaterSupplyDiagnostics';
import { calculateTanks, saveTankConfig } from '@/lib/tankCalculations';
import { useTankConfig } from '@/hooks/useTankConfig';
import useSwalAlert from '@/hooks/useSwalAlert';
import type { DisplayUnit, TankConfig } from '@/types/waterSupply.types';
import { URL } from '@/api';
import {
  DEFAULT_TANK_DATA,
  WATER_HIGH_PCT,
  WATER_LOW_PCT,
  WATER_STALE_MS,
} from '@/constants/waterSupply';
import { useWaterSupplySource } from '@/lib/waterSupply/source';

/** หน้านี้แสดงปริมาณน้ำเป็นลิตรเสมอ (เอาปุ่มสลับ ซม./ลิตร ออกแล้ว) */
const DISPLAY_UNIT: DisplayUnit = 'liter';

/** หน้ารายละเอียดบ่อน้ำประปา + ระบบบูสเตอร์ปั๊ม — route: URL.WATER_SUPPLY_DETAILS (/water-supply/tanks/pump) */
export default function WaterSupplyDetails() {
  const { t } = useTranslation();
  const swal = useSwalAlert();
  const isAdmin = isAdminRole(useAuthStore((s) => s.role));
  const src = useWaterSupplySource();
  const { data: mqttData, status, lastUpdate, history } = useMqttTank(src.topic, src.systemId);
  const now = useNow(1000);
  const tankConfig = useTankConfig();
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);


  const handleSaveConfig = async (cfg: TankConfig) => {
    try {
      await saveTankConfig(cfg);
    } catch (e) {
      console.error('[pump-station] save tank config failed:', e);
      swal.error({ message: t('water_systems.error.save_failed') });
    }
  };

  const isLive = status === 'connected';
  const stale = lastUpdate === null || now - lastUpdate > WATER_STALE_MS;
  const conn = {
    text: isLive
      ? stale
        ? t('water_supply.stale_data')
        : t('water_supply.live')
      : status === 'connecting'
        ? t('water_supply.connecting')
        : t('water_supply.offline'),
    cls:
      isLive && !stale
        ? 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400 border border-success-200 dark:border-success-800'
        : status === 'connecting'
          ? 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-400 border border-warning-200 dark:border-warning-800'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
  };

  const displayData = mqttData || DEFAULT_TANK_DATA;
  const { water_level: wl, controls: c } = displayData;
  const tankCalculations = useMemo(() => calculateTanks(wl.level_cm, tankConfig), [wl.level_cm, tankConfig]);
  const percent = tankCalculations.total.percent;
  const low = percent < WATER_LOW_PCT;
  const high = percent > WATER_HIGH_PCT;
  const p1Fault = displayData.pump1.alarm || c.pump1_alarm || !!c.pump1_overload;
  const p2Fault = displayData.pump2.alarm || c.pump2_alarm || !!c.pump2_overload;

  return (
    <div className="space-y-6 pb-12">
      <PageMeta title={t('water_supply.details_title')} description="Water supply tanks & booster pumps — live MQTT" />

      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{t('water_supply.details_title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('water_supply.last_updated')}:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '-'}</span> ·{' '}
            {t('water_supply.broker')}: <span className="font-mono text-xs font-medium text-gray-600 dark:text-gray-300">{src.brokerUrl || '-'}</span> ·{' '}
            {t('water_supply.topic')}: <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">{src.topic || '-'}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-gray-100 pt-4 dark:border-gray-800">
          <BackNav
            to={URL.WATER_SUPPLY_DASHBOARD}
            label={t('water_supply.overview.back_to_overview')}
            crumbs={[{ label: t('navbar.water_supply_dashboard'), to: URL.WATER_SUPPLY_DASHBOARD }, { label: t('water_supply.details_title') }]}
            className=""
          />
          <div className="flex flex-wrap items-center gap-3">
            {c.alarm_on && (
              <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full bg-error-600 px-3.5 py-1 text-xs font-bold text-white shadow-sm">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('water_supply.alarm_active')}
              </span>
            )}
            {(p1Fault || p2Fault) && (
              <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full bg-error-600 px-3.5 py-1 text-xs font-bold text-white shadow-sm ring-2 ring-error-400/40">
                <AlertTriangle className="h-3.5 w-3.5" />
                {p1Fault && p2Fault
                  ? t('water_supply.both_pumps_overload')
                  : p1Fault
                    ? t('water_supply.pump1_overload_alert')
                    : t('water_supply.pump2_overload_alert')}
              </span>
            )}
            {c.is_sleeping && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <Moon className="h-3.5 w-3.5" />
                {t('water_supply.scene3d.sleeping')}
              </span>
            )}

            <button
              type="button"
              onClick={() => setIsConfigModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              title={t('water_supply.tank_settings_title')}
            >
              <Settings className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
              {t('water_supply.tank_settings_btn')}
            </button>

            {isAdmin && (
              <Link
                to={URL.WATER_SUPPLY_SETTINGS}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-600"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('water_supply.control.open_control_page')}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ขนาดบ่อ ปริมาตร และระดับน้ำ */}
      <TankSummaryCards calculations={tankCalculations} config={tankConfig} unit={DISPLAY_UNIT} onOpenSettings={() => setIsConfigModalOpen(true)} />

      {/* ปั๊ม 1/2 (Hz, A, Modbus), วาล์วน้ำเข้า, แรงดันท่อจ่าย */}
      <PumpStatusCards data={displayData} />

      {/* ผังระบบ 3 มิติ */}
      <PumpSystem3D
        data={displayData}
        hasData={mqttData !== null}
        percent={percent}
        low={low}
        high={high}
        conn={conn}
        tankConfig={tankConfig}
        displayUnit={DISPLAY_UNIT}
        tankCalculations={tankCalculations}
      />

      {/* สถานะการสื่อสารของอุปกรณ์ภาคสนาม */}
      <ControlParamsPanel data={displayData} />

      {/* กราฟระดับน้ำสด, I/O, ระบบควบคุม */}
      <WaterSupplyDiagnostics data={displayData} history={history} percent={percent} />

      {/* ตารางรายงานของระบบ (รูปแบบเดียวกับหน้ารายงาน) */}
      <PumpStationReport />

      <TankConfigModal isOpen={isConfigModalOpen} onClose={() => setIsConfigModalOpen(false)} config={tankConfig} onSave={handleSaveConfig} />
    </div>
  );
}
