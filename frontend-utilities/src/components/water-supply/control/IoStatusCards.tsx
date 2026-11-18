import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@/components/water-supply/shared/WaterSupplyUI';
import type { TankData } from '@/types/waterSupply.types';

/**
 * สถานะ I/O ของ controller: Local I/O + RS485 Modbus I/O
 * (แสดงที่หน้าควบคุมและตั้งค่าระบบประปา)
 */
export default function IoStatusCards({ data }: { data: TankData | null }) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        {[t('water_supply.local_io'), t('water_supply.rs485_io')].map((title) => (
          <Card key={title} title={title}>
            <div className="py-6 text-center text-sm text-gray-400">{t('water_supply.control.io_waiting')}</div>
          </Card>
        ))}
      </div>
    );
  }

  const { local_io, rs485_io } = data;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Local I/O */}
      <Card title={t('water_supply.local_io')}>
        <div className="grid grid-cols-2 gap-2.5">
          {Object.entries(local_io).map(([k, v]) => (
            <Badge key={k} label={k.toUpperCase()} on={v} />
          ))}
        </div>
      </Card>

      {/* RS485 I/O */}
      <Card title={`${t('water_supply.rs485_io')} ${rs485_io.status_ok ? '' : '(Error)'}`}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Digital Input</div>
            {Object.entries(rs485_io.input).map(([k, v]) => (
              <Badge key={k} label={k.toUpperCase()} on={v} />
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Digital Output</div>
            {Object.entries(rs485_io.output).map(([k, v]) => (
              <Badge key={k} label={k.toUpperCase()} on={v} />
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
