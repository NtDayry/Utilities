import { useOutletContext } from 'react-router';
import PurifiedWaterDashboard from '@/components/purified-water/dashboard/PurifiedWaterDashboard';

type DashboardOutletContext = {
  isHmiMode?: boolean;
};

/** หน้า Purified Water — โหมด HMI เต็มจอใช้หน้าเดียวกันแต่ซ่อนแถบหัว */
export default function Home() {
  const { isHmiMode = false } = useOutletContext<DashboardOutletContext>();
  return <PurifiedWaterDashboard hmi={isHmiMode} />;
}
