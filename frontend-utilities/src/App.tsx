import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router';
import { useEffect } from 'react';
import { api, API_URL } from '@/api';
import Login from '@/pages/auth/LoginPage';
import Register from '@/pages/auth/RegisterPage';
import Logout from '@/pages/auth/LogoutPage';
import NotFound from '@/pages/other/NotFoundPage';
import UserProfiles from '@/pages/account/UserProfilePage';
import AuditLogsPage from '@/pages/system/AuditLogsPage';
import Home from '@/pages/purified-water/PurifiedWaterDashboardPage';
import SystemMonitorPage from '@/pages/system/SystemMonitorPage';
import SettingsPage from '@/pages/system/SettingsPage';
import SettingsDevicesPage from '@/pages/purified-water/PurifiedWaterSettingsPage';
import UsersManagementPage from '@/pages/system/UsersManagementPage';
import Support from '@/pages/other/SupportPage';
import AppLayout from './layout/AppLayout';
import Reports from '@/pages/purified-water/PurifiedWaterReportsPage';
import AlarmReportsPage from '@/pages/purified-water/PurifiedWaterAlarmsPage';
import BackupRestorePage from '@/pages/system/BackupRestorePage';
import WaterSupplyDashboard from '@/pages/water-supply/WaterSupplyDashboardPage';
import WaterSupplyReports from '@/pages/water-supply/WaterSupplyReportsPage';
import WaterSupplyDetails from '@/pages/water-supply/PumpStationPage';
import WaterTankDetail from '@/pages/water-supply/WaterTankDetailPage';
import WaterSupplyControl from '@/pages/water-supply/WaterSupplyControlPage';
import ElectricalPointDetail from '@/pages/electrical/ElectricalPointDetailPage';
import ElectricalDashboard from '@/pages/electrical/ElectricalDashboardPage';
import ElectricalReports from '@/pages/electrical/ElectricalReportsPage';
import WastewaterDashboard from '@/pages/wastewater/WastewaterDashboardPage';
import WastewaterUnitDetail from '@/pages/wastewater/WastewaterUnitDetailPage';
import WastewaterReports from '@/pages/wastewater/WastewaterReportsPage';
import FactoryLayoutPage from '@/pages/factory-layout/FactoryLayoutPage';
import FactoryLayoutSettingsPage from '@/pages/factory-layout/FactoryLayoutSettingsPage';
import WaterSystemPage from '@/pages/water-supply/WaterSystemPage';
import { UtilityAlarmReportPage, UtilityAlarmSettingsPage } from '@/pages/utility-alarms/UtilityAlarmPages';

import { ScrollToTop } from '@/components/common/navigation/ScrollToTop';
import { URL } from './api';
import { useAuthStore } from '@/store/auth';

import { PermissionConfig, setServerPermissions } from './config/permission.config';
import { PermissionGuard } from '@/hooks/usePermission';
import { syncSharedSettings } from '@/lib/sharedSettings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to={URL.LOGIN} replace />;
}

export default function App() {
  // login ใหม่ / เปลี่ยนผู้ใช้ → โหลดการตั้งค่าส่วนกลางจาก backend (แผนผังโรงงาน, ขนาดบ่อประปา)
  const username = useAuthStore((s) => s.username);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (isAuthenticated && username) void syncSharedSettings();
  }, [isAuthenticated, username]);

  // Silent refresh on app mount: try to restore session from refresh token cookie
  useEffect(() => {
    const authDataString = localStorage.getItem('ocr-auth');
    if (!authDataString) return; // ไม่มีข้อมูล auth เลย ให้จบการทำงาน

    try {
      const authData = JSON.parse(authDataString);
      if (!authData?.state?.id) return;
    } catch (error) {
      console.error('Failed to parse ocr-auth from localStorage', error);
      return;
    }

    let mounted = true;

    const refresh = async () => {
      try {
        const res = await api.post(API_URL.REFRESH, {}, { _skipAuthRedirect: true });

        // FIX: Change profile_image to profileImage to match your state
        const { id, fullname, profile_image, username, role, permissions } = res.data || {};
        console.log('Refresh response:', res.data); // Debug log

        if (mounted && username && role) {
          // Pass the correctly mapped variable here
          useAuthStore.getState().setAuth(id, fullname, profile_image, username, role, permissions || []);
          // session ยืนยันแล้ว → โหลดการตั้งค่าส่วนกลางจาก backend
          void syncSharedSettings();
        }
      } catch {
        useAuthStore.getState().logout();
      }

      // After refresh attempt, load server permission registry once (do not race with refresh)
      try {
        const permRes = await api.get(API_URL.PERMISSIONS, { _skipAuthRedirect: true });
        const keys = (permRes.data?.permissions || []).map((permission: { permission_key?: string } | string) =>
          typeof permission === 'string' ? permission : permission.permission_key || ''
        );
        if (mounted) setServerPermissions(keys.filter(Boolean));
      } catch (err) {
        console.warn('Failed to load server permission keys:', err);
        if (mounted) setServerPermissions([]);
      }
    };

    refresh();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <Router>
        <ScrollToTop />
        <Routes>
          {/* Dashboard Layout */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route
              path={URL.HOME}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.dashboard}>
                  <FactoryLayoutPage />
                </PermissionGuard>
              }
            />
            <Route
              path={URL.PURIFIED_WATER_DASHBOARD}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.dashboard}>
                  <Home />
                </PermissionGuard>
              }
            />
            <Route
              path={URL.PURIFIED_WATER_REPORTS}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.reports}>
                  <Reports />
                </PermissionGuard>
              }
            />
            <Route path={URL.PURIFIED_WATER_ALARMS} element={
              <PermissionGuard permissionKeys={PermissionConfig.Routes.alarm_reports}>
                <AlarmReportsPage />
              </PermissionGuard>
            } />
            <Route
              path={URL.PURIFIED_WATER_SETTINGS}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.device}>
                  <SettingsDevicesPage />
                </PermissionGuard>
              }
            />

            {/* Purified Water: /purified-water -> dashboard และ redirect ลิงก์เก่า */}
            <Route path={URL.PURIFIED_WATER} element={<Navigate to={URL.PURIFIED_WATER_DASHBOARD} replace />} />
            <Route path="/hmi" element={<Navigate to={URL.PURIFIED_WATER_DASHBOARD} replace />} />
            <Route path="/reports" element={<Navigate to={URL.PURIFIED_WATER_REPORTS} replace />} />
            <Route path="/alarm-reports" element={<Navigate to={URL.PURIFIED_WATER_ALARMS} replace />} />
            <Route path="/settings-devices" element={<Navigate to={URL.PURIFIED_WATER_SETTINGS} replace />} />

            {/* ลิงก์เก่าของแผนผังโรงงาน -> หน้า Home */}
            <Route path={URL.FACTORY_LAYOUT} element={<Navigate to={URL.HOME} replace />} />
            {/* ตั้งค่าเซ็นเซอร์บนแผนผัง (เฉพาะ admin — ตรวจสิทธิ์ในหน้า) */}
            <Route path={URL.FACTORY_LAYOUT_SETTINGS} element={<FactoryLayoutSettingsPage />} />

            {/* Water Supply System */}
            <Route path={URL.WATER_SUPPLY} element={<Navigate to={URL.WATER_SUPPLY_DASHBOARD} replace />} />
            <Route path={URL.WATER_SUPPLY_DASHBOARD} element={<WaterSupplyDashboard />} />
            {/* บ่อประปา + ปั๊ม (MQTT): path คงที่ /water-supply/tanks/pump มีลำดับก่อน :tankKey */}
            <Route path={URL.WATER_SUPPLY_DETAILS} element={<WaterSupplyDetails />} />
            <Route path={URL.WATER_SUPPLY_DETAILS_LEGACY} element={<Navigate to={URL.WATER_SUPPLY_DETAILS} replace />} />
            <Route path={URL.WATER_TANK_DETAIL_ROUTE} element={<WaterTankDetail />} />
            {/* ระบบน้ำที่เพิ่มจากหน้าภาพรวมระบบน้ำ — แสดงผลตามที่ตั้งค่า */}
            <Route path={URL.WATER_SYSTEM_ROUTE} element={<WaterSystemPage />} />
            {/* ควบคุม/ตั้งค่าปั๊มผ่าน MQTT — ตรวจสิทธิ์ admin ในหน้า */}
            <Route path={URL.WATER_SUPPLY_SETTINGS} element={<WaterSupplyControl />} />
            <Route path={URL.WATER_SUPPLY_MQTT} element={<Navigate to={URL.WATER_SUPPLY_SETTINGS} replace />} />
            {/* การแจ้งเตือนระบบประปา: รายงาน + ตั้งค่าเกณฑ์แจ้งเตือนเซนเซอร์ (MOCKUP) */}
            <Route path={URL.WATER_SUPPLY_ALARMS} element={<UtilityAlarmReportPage system="water" />} />
            <Route path={URL.WATER_SUPPLY_ALARM_SETTINGS} element={<UtilityAlarmSettingsPage system="water" />} />

            {/* Electrical: รายละเอียดจุดวัดไฟฟ้า (เข้าจากปุ่มบนแผนผังโรงงาน) */}
            <Route path={URL.ELECTRICAL_POINT_ROUTE} element={<ElectricalPointDetail />} />
            <Route path={URL.ELECTRICAL_DASHBOARD} element={<ElectricalDashboard />} />
            <Route path={URL.ELECTRICAL_REPORTS} element={<ElectricalReports />} />
            <Route path={URL.ELECTRICAL_ALARMS} element={<UtilityAlarmReportPage system="electrical" />} />
            <Route path={URL.ELECTRICAL_SETTINGS} element={<UtilityAlarmSettingsPage system="electrical" />} />
            <Route path="/electricity" element={<Navigate to={URL.ELECTRICAL_DASHBOARD} replace />} />

            {/* Wastewater (MOCKUP) */}
            <Route path={URL.WASTEWATER_DASHBOARD} element={<WastewaterDashboard />} />
            <Route path={URL.WASTEWATER_UNIT_ROUTE} element={<WastewaterUnitDetail />} />
            <Route path={URL.WASTEWATER_REPORTS} element={<WastewaterReports />} />
            <Route path={URL.WASTEWATER_ALARMS} element={<UtilityAlarmReportPage system="wastewater" />} />
            <Route path={URL.WASTEWATER_SETTINGS} element={<UtilityAlarmSettingsPage system="wastewater" />} />
            <Route path="/wastewater" element={<Navigate to={URL.WASTEWATER_DASHBOARD} replace />} />
            <Route path={URL.WATER_SUPPLY_REPORTS} element={<WaterSupplyReports />} />

            <Route path={URL.SYSTEM_MONITOR} element={
              <PermissionGuard permissionKeys={PermissionConfig.Routes.system_monitor}>
                <SystemMonitorPage />
              </PermissionGuard>
            } />
            <Route path={URL.BACKUP_RESTORE} element={
              <PermissionGuard permissionKeys={PermissionConfig.Routes.backup_restore}>
                <BackupRestorePage />
              </PermissionGuard>
            } />
            <Route
              path={URL.SETTINGS}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.settings}>
                  <SettingsPage />
                </PermissionGuard>
              }
            />
            {/* Others Page */}
            <Route
              path={URL.AUDIT_LOGS}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.audit_logs}>
                  <AuditLogsPage />
                </PermissionGuard>
              }
            />

            {/* Users management */}
            <Route
              path={URL.USERS_MANAGEMENT}
              element={
                <PermissionGuard permissionKeys={PermissionConfig.Routes.users_management}>
                  <UsersManagementPage />
                </PermissionGuard>
              }
            />

            <Route path={URL.USER_PROFILE} element={<UserProfiles />} />

            <Route path={URL.LOGOUT} element={<Logout />} />
          </Route>

          {/* Auth Layout */}
          <Route path={URL.LOGIN} element={<Login />} />
          <Route path={URL.REGISTER} element={<Register />} />

          {/* Fallback Route */}
          <Route path={URL.SUPPORT} element={<Support />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </>
  );
}
