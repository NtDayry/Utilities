# Parity: การแปลงค่า Purified Water (backend ↔ หน้าเว็บ)

เทียบ `app/purified_water/mqtt_ingest.py::convert` (ค่าที่บันทึก/แจ้งเตือน) กับ
`frontend-utilities/src/lib/purifiedWater/pwConvert.ts::convertPwRaw` (ค่าสดบนหน้าเว็บ) ด้วยข้อมูลสุ่ม

```bash
cd backend-utilities/tests/parity/pw_convert
npx esbuild ../../../../frontend-utilities/src/lib/purifiedWater/pwConvert.ts --format=esm --outfile=pwConvert.mjs
python gen.py 1        # สร้าง cases.json จาก backend (ต้องติดตั้ง requirements ของ backend)
node run.mjs           # ต้องได้ "0 differences"
```
