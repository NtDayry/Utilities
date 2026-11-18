/**
 * สไตล์การ์ด/กรอบที่อยู่ในสถานะแจ้งเตือน (ใช้ร่วมกันทุกหน้าระบบน้ำ):
 * พื้นแดงอ่อนโปร่งใส + แสงแดงฟุ้งรอบขอบกะพริบแบบไซเรน (animate-siren ใน styles/others/animations.css)
 * ผู้ใช้ที่ตั้ง "ลดการเคลื่อนไหว" จะเห็นแสงฟุ้งค้างไว้แทนการกะพริบ
 */
export const SIREN_CARD =
  'border-error-400 bg-error-50/70 animate-siren motion-reduce:animate-none motion-reduce:shadow-[0_0_18px_3px_rgb(239_68_68/0.3)] dark:border-error-600 dark:bg-error-500/10';
