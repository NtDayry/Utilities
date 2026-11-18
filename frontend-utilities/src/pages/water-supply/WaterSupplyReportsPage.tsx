import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReportPageLayout from '@/components/common/reports/ReportPageLayout';
import MockSensorReport from '@/components/common/reports/MockSensorReport';
import { useLiveSensorPush } from '@/components/common/reports/useLiveSensorPush';
import { sensorStore } from '@/components/common/reports/reportUtils';
import { useMqttTank } from '@/hooks/useMqttTank';
import { useWaterSupplyReportsStore } from '@/store/reportsStore';
import { fetchWaterSupplyReport, isWsChartKey, isWsTableKey, modelLive, WS_KEYS } from '@/lib/waterSupplyReportMock';
import { calculateTanks, loadTankConfig } from '@/lib/tankCalculations';
import { useWaterSupplySource } from '@/lib/waterSupply/source';

/**
 * รายงานระบบน้ำประปา — หน้าตาเดียวกับรายงาน Purified Water (ใช้ component ร่วมกัน)
 * มิเตอร์น้ำประปาหลัก: เลขมิเตอร์ / ปริมาณการใช้ / อัตราการไหล
 * ทุกบ่อ/ถัง (บ่อประปา 1, 2, บ่ออาคาร 1,4, ถังดาดฟ้าอาคาร 5, ถังดาดฟ้าโกดัง): ระดับน้ำ (%) เท่านั้น
 *
 * ⚠️ ข้อมูลย้อนหลังตอนนี้เป็น MOCKUP (lib/waterSupplyReportMock.ts) จนกว่า backend จะเก็บข้อมูล MQTT
 * ค่า LIVE ในกราฟเป็นค่าจริงจาก MQTT
 */
export default function WaterSupplyReports() {
  const { t } = useTranslation();

  // ค่า realtime จริงจาก MQTT → ป้าย LIVE บนกราฟ (sensorStore เดียวกับรายงาน PW, key ws_* ไม่ชนกัน)
  const supplySrc = useWaterSupplySource();
  const { data } = useMqttTank(supplySrc.topic, supplySrc.systemId);
  useEffect(() => {
    if (!data) return;
    // ระดับน้ำบ่อ 1 / บ่อ 2 (%) จากเซนเซอร์จริง (MQTT) + ขนาดบ่อ
    const c = calculateTanks(data.water_level.level_cm, loadTankConfig());
    sensorStore.set({ [WS_KEYS.pond1Level]: c.tank1.percent, [WS_KEYS.pond2Level]: c.tank2.percent });
  }, [data]);
  // มิเตอร์หลัก + บ่อ/ถังอื่น (ยังไม่มีเซนเซอร์): ค่าสดจากแบบจำลองเดียวกับรายงาน
  useLiveSensorPush(modelLive);

  return (
    <ReportPageLayout
      metaTitle={t('water_supply.report.meta_title')}
      metaDescription={t('water_supply.report.meta_description')}
      title={t('water_supply.report.title')}
      subtitle={t('water_supply.report.subtitle')}
      iconCls="text-sky-500"
      // ป้ายแจ้งว่าเป็นข้อมูลตัวอย่าง — ลบออกเมื่อเชื่อม backend จริง
      mockText={t('water_supply.report.mock_desc')}
    >
      <MockSensorReport
        useStore={useWaterSupplyReportsStore}
        fetcher={fetchWaterSupplyReport}
        isChartKey={isWsChartKey}
        isTableKey={isWsTableKey}
        exportFilename="water_supply_report"
        auditEntity="water_supply_reports"
      />
    </ReportPageLayout>
  );
}
