// @ts-nocheck
/**
 * ข้อมูลอาคารของแผนผังโรงงาน (ขนาด/ตำแหน่ง) — แยกจากฉาก 3 มิติ เพื่อให้หน้าเว็บแสดงข้อมูลได้ทันที
 * โดยไม่ต้องรอโหลด three.js และโค้ดสร้างฉาก (factoryScene3d.ts โหลดภายหลังแบบ dynamic import)
 * หน่วยเป็นเมตร: แกน X = ตะวันออก(+)/ตะวันตก(-), Z = เหนือ(0) -> ใต้(+) หน้าประตู
 */
import { locEn, locTh } from '@/lib/locText';
export interface FactoryBuilding {
  id: string; name: string; en: string; note: string;
  w: number; l: number; h: number; fl: number; fh: number;
  ex: number; ez: number; cx: number; cz: number; z0: number;
  area: number; gfa: number; vol: number;
}

export const BUILDINGS_RAW=[
 {id:'wh',name:locTh('data.factory_buildings.buildings_raw.wh.name'),en:locEn('data.factory_buildings.buildings_raw.wh.name'),w:18,l:52,h:32,fl:4,fh:8,solar:1,col:'#f7f8fa',win:'small',note:'หลังคาโซลาร์เซลล์'},
 {id:'fac',name:locTh('data.factory_buildings.buildings_raw.fac.name'),en:locEn('data.factory_buildings.buildings_raw.fac.name'),w:27,l:120,h:10,fl:1,fh:10,solar:2,col:'#d4d6da',win:'band',note:'แผงโซลาร์เซลล์เต็มหลังคา · ห้องงานระบบปิดทึบด้านตะวันออก (หลังคาเมทัลชีทสีน้ำเงิน ยื่น 3.5 ม. สูง 4 ม.) ต่อด้วยชายคาเมทัลชีทสีน้ำเงิน ยื่นอีก 1.5 ม. สูงจากพื้น 2.5 ม.'},
 {id:'b5',name:locTh('data.factory_buildings.buildings_raw.b5.name'),en:locEn('data.factory_buildings.buildings_raw.b5.name'),w:17,l:22,rot:1,h:24,fl:6,fh:4,hvac:1,col:'#e0d8cc',win:'office',note:'ด้านหน้า (ฝั่งถนน): ผนังแผ่นขาวกรอบเทาเข้ม กล่องเทาเข้มชั้นบน ชั้นล่างกระจก กันสาดทางเข้า · ด้านข้าง (ฝั่งโรงงาน): ระเบียงทุกชั้น คอมเพรสเซอร์แอร์ · ดาดฟ้า: ถังเก็บน้ำ 4 ถัง · ห้องควบคุมและปั๊มน้ำชิลเลอร์ (สูง 4 ม.) · ชิลเลอร์ 2 ยูนิต · ราวกันตกรอบดาดฟ้า'},
 {id:'b4',name:locTh('data.factory_buildings.buildings_raw.b4.name'),en:locEn('data.factory_buildings.buildings_raw.b4.name'),w:19,l:55,h:6,fl:1,fh:6,col:'#f1f2ef',win:'office',note:'อาคารยาว ชั้นเดียว ผนังปูนสีขาว · ชายคากล่องหนารอบอาคาร ยื่น 1.2 ม. ใต้ชายคาลาดเอียง มีครีบค้ำสามเหลี่ยมด้านยาว · ด้านติดอาคาร 5: ประตูบานคู่สีเทา บอร์ดประกาศ · เลข 4 สีน้ำเงินที่ผนังด้านยาวใกล้มุม · ฐานปูนยกพร้อมกระถางต้นไม้ด้านลานจอดรถ'},
 {id:'b1',name:locTh('data.factory_buildings.buildings_raw.b1.name'),en:locEn('data.factory_buildings.buildings_raw.b1.name'),w:11,l:24,rot:1,h:8,fl:2,fh:4,col:'#f4f4f2',win:'none',note:'หน้าประตูทางเข้า'}
];
// อาคาร 1: ยกพื้น 0.9 ม. (เท่าชานบันไดทางเข้า) + ชั้น 1 สูงถึงขอบล่างชายคาอาคาร 4 (eaveY), ชั้น 2 สูง fh
// อาคาร 4 ห่างอาคาร 1 = 5 ม. = ส่วนต่อเติมหลังอาคาร 1 กว้าง 3 ม. + ทางเดินมีหลังคา 2 ม.
{const b1=BUILDINGS_RAW.find(b=>b.id==='b1'),b4=BUILDINGS_RAW.find(b=>b.id==='b4');b4.eaveY=4.6;b1.base=.9;b1.fh1=+(b4.eaveY-b1.base).toFixed(2);b1.h=+(b1.base+b1.fh1+b1.fh*(b1.fl-1)).toFixed(2)}
const GAP=[15,10,6,5,0];let p=0;
// แนวอ้างอิงแกน X: FE = ผนังโรงงานฝั่งถนนเข้าโรงงาน (โกดังชิดแนวนี้), OW = แนวผนังอาคาร 1/4/5 ฝั่งตรงข้าม
// โรงงานกว้าง 27 ม. ขยายออกฝั่งตรงข้ามถนน; อาคาร 5/4/1 ขยายไปทางซ้าย (มองจากหน้าบริษัท) ให้ผนังตะวันตกแนวเดียวกับโรงงาน (ฝั่งชิลเลอร์/ระบบบำบัด) — แนวถนนและอาคาร 1/4/5 อยู่ที่เดิม
const FE=12.5,OW=FE-BUILDINGS_RAW[1].w;                                                  // ระยะห่างระหว่างอาคาร (โกดัง→โรงงาน→อาคาร 5→อาคาร 4→อาคาร 1); อาคาร 5–4 = 6 ม.
BUILDINGS_RAW.forEach((b,i)=>{b.ex=b.rot?b.l:b.w;b.ez=b.rot?b.w:b.l;b.z0=p;b.cz=p+b.ez/2;b.cx=['wh','fac'].includes(b.id)?FE-b.ex/2:(['b1','b4','b5'].includes(b.id)?OW+b.ex/2:0);b.area=b.w*b.l;b.gfa=b.area*b.fl;b.vol=b.area*b.h;p+=b.ez+GAP[i]});
export const TOTAL=BUILDINGS_RAW[4].z0+BUILDINGS_RAW[4].ez,C=TOTAL/2;
export const N=n=>n.toLocaleString('th-TH');

export const BUILDINGS: FactoryBuilding[] = BUILDINGS_RAW;

// ห้อง/แผนกด้านถนนของอาคารโรงงาน (o = ระยะจากหัวอาคารฝั่งโกดัง, w = ความกว้างโซนคลิก ม.)
export interface FactoryRoom { id: string; name: string; en: string; o: number; w: number; parent: string }
export const ROOMS: FactoryRoom[] = [
 {id:'r_load1',name:locTh('data.factory_buildings.rooms.r_load1.name'),en:locEn('data.factory_buildings.rooms.r_load1.name'),o:109.6,w:9.4,parent:'fac'},
 {id:'r_boiler',name:locTh('data.factory_buildings.rooms.r_boiler.name'),en:locEn('data.factory_buildings.rooms.r_boiler.name'),o:100.6,w:6.0,parent:'fac'},
 {id:'r_ahu1',name:locTh('data.factory_buildings.rooms.r_ahu1.name'),en:locEn('data.factory_buildings.rooms.r_ahu1.name'),o:82,w:7.0,parent:'fac'},
 {id:'r_load2',name:locTh('data.factory_buildings.rooms.r_load2.name'),en:locEn('data.factory_buildings.rooms.r_load2.name'),o:75.1,w:5.4,parent:'fac'},
 {id:'r_cda',name:locTh('data.factory_buildings.rooms.r_cda.name'),en:locEn('data.factory_buildings.rooms.r_cda.name'),o:68.1,w:5.8,parent:'fac'},
 {id:'r_pw',name:locTh('data.factory_buildings.rooms.r_pw.name'),en:locEn('data.factory_buildings.rooms.r_pw.name'),o:60.6,w:7.0,parent:'fac'},
 {id:'r_eng',name:locTh('data.factory_buildings.rooms.r_eng.name'),en:locEn('data.factory_buildings.rooms.r_eng.name'),o:51.5,w:10.0,parent:'fac'},
 {id:'r_ahu2',name:locTh('data.factory_buildings.rooms.r_ahu2.name'),en:locEn('data.factory_buildings.rooms.r_ahu2.name'),o:43.5,w:6.0,parent:'fac'},
 {id:'r_store',name:locTh('data.factory_buildings.rooms.r_store.name'),en:locEn('data.factory_buildings.rooms.r_store.name'),o:35,w:9.0,parent:'fac'},
 {id:'r_ahu3',name:locTh('data.factory_buildings.rooms.r_ahu3.name'),en:locEn('data.factory_buildings.rooms.r_ahu3.name'),o:1.5,w:3.0,parent:'fac'},
];

// วัตถุอื่นที่คลิกเลือกได้ (โซนคลิกสร้างใน factoryScene3d.ts ด้วย id เดียวกัน)
export interface FactoryObject { id: string; name: string; en: string; parent?: string; note?: string; noteEn?: string }
export const OBJECTS: FactoryObject[] = [
 {id:'o_canteen',name:locTh('data.factory_buildings.objects.o_canteen.name'),en:locEn('data.factory_buildings.objects.o_canteen.name')},
 {id:'o_pool',name:locTh('data.factory_buildings.objects.o_pool.name'),en:locEn('data.factory_buildings.objects.o_pool.name'),
  note:locTh('data.factory_buildings.objects.o_pool.note'),
  noteEn:locEn('data.factory_buildings.objects.o_pool.note')},
 {id:'o_chiller',name:locTh('data.factory_buildings.objects.o_chiller.name'),en:locEn('data.factory_buildings.objects.o_chiller.name'),parent:'wh'},
 {id:'o_pump',name:locTh('data.factory_buildings.objects.o_pump.name'),en:locEn('data.factory_buildings.objects.o_pump.name'),parent:'fac'},
 {id:'o_gen',name:locTh('data.factory_buildings.objects.o_gen.name'),en:locEn('data.factory_buildings.objects.o_gen.name'),parent:'b5'},
 {id:'o_b5tank',name:locTh('data.factory_buildings.objects.o_b5tank.name'),en:locEn('data.factory_buildings.objects.o_b5tank.name'),parent:'b5'},
 {id:'o_b5chiller',name:locTh('data.factory_buildings.objects.o_b5chiller.name'),en:locEn('data.factory_buildings.objects.o_b5chiller.name'),parent:'b5'},
 {id:'o_guard',name:locTh('data.factory_buildings.objects.o_guard.name'),en:locEn('data.factory_buildings.objects.o_guard.name')},
 {id:'o_wmeter',name:locTh('data.factory_buildings.objects.o_wmeter.name'),en:locEn('data.factory_buildings.objects.o_wmeter.name')},
 {id:'o_emeter',name:locTh('data.factory_buildings.objects.o_emeter.name'),en:locEn('data.factory_buildings.objects.o_emeter.name')},
 {id:'o_tr1',name:locTh('data.factory_buildings.objects.o_tr1.name'),en:locEn('data.factory_buildings.objects.o_tr1.name')},
 {id:'o_tr2',name:locTh('data.factory_buildings.objects.o_tr2.name'),en:locEn('data.factory_buildings.objects.o_tr2.name')},
 {id:'o_tr3',name:locTh('data.factory_buildings.objects.o_tr3.name'),en:locEn('data.factory_buildings.objects.o_tr3.name')},
 {id:'o_tr4',name:locTh('data.factory_buildings.objects.o_tr4.name'),en:locEn('data.factory_buildings.objects.o_tr4.name')},
 {id:'o_tr5',name:locTh('data.factory_buildings.objects.o_tr5.name'),en:locEn('data.factory_buildings.objects.o_tr5.name')},
 {id:'o_whlift',name:locTh('data.factory_buildings.objects.o_whlift.name'),en:locEn('data.factory_buildings.objects.o_whlift.name'),parent:'wh',note:locTh('data.factory_buildings.objects.o_whlift.note'),noteEn:locEn('data.factory_buildings.objects.o_whlift.note')},
 {id:'o_whtank',name:locTh('data.factory_buildings.objects.o_whtank.name'),en:locEn('data.factory_buildings.objects.o_whtank.name'),parent:'wh',note:locTh('data.factory_buildings.objects.o_whtank.note'),noteEn:locEn('data.factory_buildings.objects.o_whtank.note')},
 {id:'o_wt_eq',name:locTh('data.factory_buildings.objects.o_wt_eq.name'),en:locEn('data.factory_buildings.objects.o_wt_eq.name'),parent:'wh',
  note:locTh('data.factory_buildings.objects.o_wt_eq.note'),
  noteEn:locEn('data.factory_buildings.objects.o_wt_eq.note')},
 {id:'o_wt_eqpump',name:locTh('data.factory_buildings.objects.o_wt_eqpump.name'),en:locEn('data.factory_buildings.objects.o_wt_eqpump.name'),parent:'wh',note:locTh('data.factory_buildings.objects.o_wt_eqpump.note'),noteEn:locEn('data.factory_buildings.objects.o_wt_eqpump.note')},
 {id:'o_wwtp_panel',name:locTh('data.factory_buildings.objects.o_wwtp_panel.name'),en:locEn('data.factory_buildings.objects.o_wwtp_panel.name'),parent:'wh',note:locTh('data.factory_buildings.objects.o_wwtp_panel.note'),noteEn:locEn('data.factory_buildings.objects.o_wwtp_panel.note')},
 {id:'o_wt_aer',name:locTh('data.factory_buildings.objects.o_wt_aer.name'),en:locEn('data.factory_buildings.objects.o_wt_aer.name'),parent:'wh',
  note:locTh('data.factory_buildings.objects.o_wt_aer.note'),
  noteEn:locEn('data.factory_buildings.objects.o_wt_aer.note')},
 {id:'o_wt_sand',name:locTh('data.factory_buildings.objects.o_wt_sand.name'),en:locEn('data.factory_buildings.objects.o_wt_sand.name'),parent:'wh',
  note:locTh('data.factory_buildings.objects.o_wt_sand.note'),
  noteEn:locEn('data.factory_buildings.objects.o_wt_sand.note')},
 {id:'o_wt_anae',name:locTh('data.factory_buildings.objects.o_wt_anae.name'),en:locEn('data.factory_buildings.objects.o_wt_anae.name'),parent:'wh',
  note:locTh('data.factory_buildings.objects.o_wt_anae.note'),
  noteEn:locEn('data.factory_buildings.objects.o_wt_anae.note')},
 {id:'o_wh_wc',name:locTh('data.factory_buildings.objects.o_wh_wc.name'),en:locEn('data.factory_buildings.objects.o_wh_wc.name'),parent:'wh',note:locTh('data.factory_buildings.objects.o_wh_wc.note'),noteEn:locEn('data.factory_buildings.objects.o_wh_wc.note')},
 {id:'o_tank14',name:locTh('data.factory_buildings.objects.o_tank14.name'),en:locEn('data.factory_buildings.objects.o_tank14.name'),parent:'b4'},
];
