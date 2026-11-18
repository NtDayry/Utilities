import type { ReactNode } from 'react';
import PageBreadcrumb from '@/components/common/navigation/PageBreadCrumb';
import PageMeta from '@/components/common/page/PageMeta';
import MockBanner from '@/components/common/page/MockBanner';
import { StreamlineFileReportIcon } from '@/icons';

/**
 * โครงหน้ารายงานที่ใช้ร่วมกันทุกระบบ: PageMeta + หัวเพจ (ไอคอนรายงาน) + ป้าย Mockup (ถ้ามี) + เนื้อหา
 */
export default function ReportPageLayout({
  metaTitle,
  metaDescription,
  title,
  subtitle,
  iconCls = 'text-sky-500',
  mockText,
  children,
}: {
  metaTitle: string;
  metaDescription?: string;
  title: string;
  subtitle?: string;
  /** สีไอคอนหัวเพจ เช่น 'text-amber-500' */
  iconCls?: string;
  /** ข้อความป้ายแจ้งข้อมูลจำลอง — ไม่ใส่ = ไม่แสดงป้าย */
  mockText?: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageMeta title={metaTitle} description={metaDescription ?? metaTitle} />
      <PageBreadcrumb
        pageTitle={title}
        pageSubTitle={subtitle}
        icon={<StreamlineFileReportIcon className={`inline-block mr-1 ${iconCls}`} width={50} height={50} />}
      />
      {mockText && (
        <div className="mb-6">
          <MockBanner text={mockText} />
        </div>
      )}
      <div className="space-y-6">{children}</div>
    </>
  );
}
