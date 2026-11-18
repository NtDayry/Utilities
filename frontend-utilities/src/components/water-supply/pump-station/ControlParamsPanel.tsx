import { useTranslation } from 'react-i18next';
import { Cpu, Network } from 'lucide-react';
import type { TankData } from '@/types/waterSupply.types';

/** สถานะการสื่อสารของอุปกรณ์ภาคสนาม (เดิมมีพารามิเตอร์ PID/อินเวอร์เตอร์ด้วย — นำออกแล้ว) */
export default function ControlParamsPanel({ data }: { data: TankData }) {
  const { t } = useTranslation();
  const s = data.system;
  const comms: { key: string; ok: boolean }[] = [
    { key: 'level', ok: s.level_comm_ok },
    { key: 'pump1', ok: s.pump1_comm_ok },
    { key: 'pump2', ok: s.pump2_comm_ok },
    { key: 'pressure', ok: s.pressure_comm_ok },
    { key: 'meter', ok: s.meter_comm_ok },
    { key: 'rs485', ok: s.rs485_io_ok },
    { key: 'sensor', ok: s.sensor_comm_ok },
  ];
  const okCount = comms.filter((x) => x.ok).length;

  return (
    <div>
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white/90">
            <Network className="h-4 w-4 text-brand-500" />
            {t('water_supply.scene3d.comm_title')}
          </h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
              okCount === comms.length
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
            }`}
          >
            {okCount}/{comms.length}
          </span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {comms.map((x) => (
            <li key={x.key} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs dark:border-gray-800">
              <span className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <Cpu className="h-3.5 w-3.5 text-gray-400" />
                {t(`water_supply.scene3d.comm_${x.key}`)}
              </span>
              <span className={`inline-flex items-center gap-1.5 font-bold ${x.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-error-600 dark:text-error-400'}`}>
                <span className={`h-2 w-2 rounded-full ${x.ok ? 'bg-emerald-500' : 'bg-error-500'}`} />
                {x.ok ? t('water_supply.sensor_normal') : t('water_supply.sensor_lost')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
