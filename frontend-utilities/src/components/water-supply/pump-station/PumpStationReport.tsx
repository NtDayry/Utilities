import { useTranslation } from 'react-i18next';
import { FileBarChart } from 'lucide-react';
import MockSensorReport from '@/components/common/reports/MockSensorReport';
import MockBanner from '@/components/common/page/MockBanner';
import { usePumpStationReportsStore } from '@/store/reportsStore';
import { fetchPumpStationReport, isPsChartKey, isPsTableKey } from '@/lib/pumpStationReportMock';

/**
 * ตารางรายงานของระบบบ่อน้ำประปาโรงงานและปั๊มน้ำ (ท้ายหน้ารายละเอียด)
 * ใช้ component รายงานเดียวกับหน้ารายงานอื่น: ตัวกรองวันที่/ช่วงเวลา, ตารางหัวแบบ span, MIN/MAX/AVG, CSV/Excel
 */
export default function PumpStationReport() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5 px-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white">
          <FileBarChart className="h-4.5 w-4.5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">
            {t('water_supply.station_report.title', 'รายงานระบบบ่อน้ำประปาและปั๊มน้ำ')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t(
              'water_supply.station_report.subtitle',
              'ระดับน้ำ ปริมาณน้ำในบ่อ มิเตอร์น้ำเข้า วาล์ว และการทำงานของปั๊ม ตามช่วงเวลาที่เลือก'
            )}
          </p>
        </div>
      </div>
      <MockBanner
        text={t(
          'water_supply.station_report.mock_desc',
          'ข้อมูลย้อนหลังในตารางเป็นข้อมูลจำลอง ระหว่างรอระบบบันทึกข้อมูล MQTT ของบ่อประปาและปั๊มลงฐานข้อมูล'
        )}
      />
      <MockSensorReport
        useStore={usePumpStationReportsStore}
        fetcher={fetchPumpStationReport}
        isChartKey={isPsChartKey}
        isTableKey={isPsTableKey}
        exportFilename="water_supply_pump_station_report"
        auditEntity="water_supply_pump_station_reports"
      />
    </section>
  );
}
