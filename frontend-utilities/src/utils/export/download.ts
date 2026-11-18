/** ดาวน์โหลด Blob เป็นไฟล์ในเบราว์เซอร์ */
export function downloadBlob(blob: Blob, fullFilename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fullFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/** ชื่อไฟล์มาตรฐาน: `<name>_YYYY-MM-DD.<ext>` */
export const datedFilename = (name: string, ext: string) => `${name}_${new Date().toISOString().split('T')[0]}.${ext}`;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
