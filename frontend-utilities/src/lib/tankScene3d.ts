// ฉาก 3 มิติของถังน้ำ / บ่อเก็บน้ำ (three.js) — แสดง "ระดับน้ำ" (+ วาล์วเติมน้ำ ถ้าเปิดใช้เซ็นเซอร์วาล์ว)
// วาดตามค่าที่ตั้ง: จำนวนใบ รูปทรง (สี่เหลี่ยม / ทรงกระบอก) ขนาดจริงเป็นเมตร ระดับพื้นที่ต่างกัน และสีของน้ำ
//   ถังทรงกระบอก = แบบเดียวกับ "ถังเก็บน้ำประปา (ดาดฟ้าอาคาร 5)": ถังสแตนเลสบนขา + ฐานรอง + ขอบ/แถบรัด + ฝาโค้ง + ฝาช่องตรวจ
//                   (ผนังเป็นกระจกใสเพื่อให้เห็นระดับน้ำ ส่วนโครงเป็นสแตนเลสทึบ)
//   ถังสี่เหลี่ยม = ผนังกระจกใส + โครงเสาสแตนเลส ; บ่อ (pond) = ผนังคอนกรีต + ขอบบ่อ (coping) เปิดด้านบน
//   ขีดสเกล 0–100% อยู่ฝั่งซ้ายของทุกใบ ตัวหนังสือบอกระดับอยู่กลางใบ ไม่มีพื้นหลัง
// การเคลื่อนไหว (ทำงานตลอด): ผิวน้ำกระเพื่อม + ฟองอากาศใสลอยขึ้น + เส้นระดับน้ำเรืองแสงรอบผนัง
//   วาล์วเปิด = สายน้ำไหลต่อเนื่องลงถัง (ลายน้ำเลื่อนลง) + ฟองอากาศใสเล็ก ๆ ใต้จุดที่น้ำตก + ผิวน้ำกระเพื่อมแรงขึ้น
// ขนาดตัวหนังสือทุกป้ายแปรตามขนาดของถังบนจอ → ซูมออกตัวหนังสือเล็กลง
// ธีมมืด: สปอตไลต์ LED สีขาวส่องจากด้านบนลงพื้นกระเบื้อง เปลี่ยนตามธีมของหน้าทันที
// พื้น: กระเบื้องจางออกที่ขอบ รับเงาและแสง ; ป้ายสถานะวาล์วเป็นป้ายแคปซูลขนาดคงที่ อ่านง่าย
// ลากเมาส์ซ้าย = หมุน · ลากขวา = เลื่อน · ล้อเมาส์ = ซูม · ดับเบิลคลิก = รีเซ็ตมุมกล้อง
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export interface SceneTank {
  name: string;
  shape: 'rect' | 'cylinder';
  width_m: number;
  length_m: number;
  diameter_m: number;
  height_m: number;
  /** พื้นต่ำกว่าพื้นใบแรก (เมตร) */
  offset_m: number;
}

/** ข้อความกลางใบ: ชื่อ (เล็ก) · ค่าหลัก (ใหญ่) · รายละเอียด (เล็ก) */
export interface LevelLabel {
  title: string;
  value: string;
  sub: string;
}

export const DEFAULT_WATER_COLOR = '#2563eb';
const OFFLINE_COLOR = '#94a3b8';
const GAP = 1.1; // ระยะห่างระหว่างใบ (m) — เผื่อที่ให้ท่อเติมน้ำ
const LEG_H = 0.55; // ความสูงขาถัง (m)
const BUBBLES = 18; // ฟองอากาศต่อใบ
const SPLASH = 10; // ฟองอากาศเล็กใต้จุดที่น้ำจากวาล์วตก
const VIEW_DIR_BASE = new THREE.Vector3(0.32, 0.42, 1);
const damp = (cur: number, goal: number, k: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-k * dt));
const finite = (v: number, fallback: number) => (Number.isFinite(v) && v > 0 ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ลายสายน้ำ: เส้นแนวตั้งสว่าง/จางสลับกัน — เลื่อนลงทุกเฟรมให้ดูเป็นน้ำไหลต่อเนื่อง */
function makeStreamTexture() {
  const tex = canvasTexture(32, 128, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, 32, 128);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 32;
      const y = Math.random() * 128;
      const len = 18 + Math.random() * 50;
      g.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.6})`;
      g.fillRect(x, y, 1 + Math.random() * 2, len);
      g.fillRect(x, y - 128, 1 + Math.random() * 2, len); // ต่อเนื่องข้ามขอบบน-ล่าง
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** พื้นกระเบื้อง 1 แผ่น (ร่องยาแนว + เม็ดสีจาง) — ทำซ้ำตามขนาดพื้น */
function makeFloorTexture() {
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#e7e9ec';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const v = 205 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
    g.fillStyle = '#b4bac3';
    g.fillRect(0, 0, 256, 4);
    g.fillRect(0, 0, 4, 256);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** ความทึบของพื้น: ทึบตรงกลาง จางหายที่ขอบ (ไม่เห็นขอบพื้นเป็นเส้นตัด) */
function makeFloorFade() {
  return canvasTexture(
    128,
    128,
    (g) => {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.55, '#ffffff');
      grd.addColorStop(1, '#000000');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    },
    false
  );
}

/** เงาสัมผัสพื้นใต้วัตถุ (วงรีไล่เฉด) — ทำให้วัตถุดูวางบนพื้นจริง */
function makeContactTexture() {
  return canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(15,23,42,0.42)');
    grd.addColorStop(0.55, 'rgba(15,23,42,0.16)');
    grd.addColorStop(1, 'rgba(15,23,42,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

/** สีตามความสูง (ก้นเข้ม → ผิวสว่าง) — คูณกับสีน้ำที่ตั้งไว้ จึงไล่เฉดได้ทุกสี */
function addDepthGradient(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = 0.5 + 0.5 * clamp(pos.getY(i), 0, 1);
    colors.set([c, c, c], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface Bubble {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  phase: number;
  speed: number;
}

interface TankNode {
  water: THREE.Mesh;
  /** ผิวน้ำ (ตาข่ายที่ขยับจุดทุกเฟรมให้กระเพื่อม) */
  surface: THREE.Mesh;
  /** เส้นระดับน้ำเรืองแสงรอบผนัง */
  ring: THREE.Object3D;
  bubbles: Bubble[];
  height: number;
  /** ขนาดด้านกว้างของใบ (ใช้กำหนดความยาวคลื่น) */
  span: number;
  amp: number;
  level: number;
  goal: number;
  label: { root: HTMLDivElement; title: HTMLDivElement; value: HTMLDivElement; sub: HTMLDivElement };
  /** จุดกลางใบ (ใช้วัดระยะจากกล้องเพื่อปรับขนาดตัวหนังสือ) */
  anchor: THREE.Object3D;
  /** ตัวเลขสเกล + ป้ายอื่นของใบนี้ (ขนาดเล็กกว่าป้ายระดับ) */
  minor: HTMLElement[];
  /** ขนาดอ้างอิงของใบสำหรับคิดขนาดตัวหนังสือ (m): ความสูง หรือด้านกว้างสำหรับบ่อเตี้ย */
  labelRef: number;
  fontPx: number;
}

interface ValveNode {
  /** ใบที่วาล์วเติมน้ำลง */
  tank: number;
  wheel: THREE.Mesh;
  stream: THREE.Mesh;
  /** ฟองอากาศเล็กใต้จุดที่น้ำตก */
  splash: { mesh: THREE.Mesh; phase: number; angle: number }[];
  /** ตำแหน่งปากท่อ (พิกัดของตัวถัง) */
  x: number;
  spoutY: number;
  /** ป้ายสถานะวาล์ว (แคปซูล): จุดสี + ข้อความ */
  label: { root: HTMLDivElement; dot: HTMLSpanElement; text: HTMLSpanElement };
}

export class TankScene3D {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private stage = new THREE.Group(); // พื้น + เงา (วาดใหม่ตามขนาดฉาก)
  private key = new THREE.DirectionalLight('#ffffff', 1.9);
  private hemi = new THREE.HemisphereLight('#f8fafc', '#94a3b8', 0.7);
  private rim = new THREE.DirectionalLight('#dbeafe', 0.7);
  /** สปอตไลต์โทนอุ่นจากด้านบน (เปิดเฉพาะธีมมืด) */
  private spot = new THREE.SpotLight('#f5f8ff', 0, 0, Math.PI / 5, 0.55, 0);
  private themeObserver: MutationObserver;
  private dark = false;
  private env: THREE.Texture;
  private nodes: TankNode[] = [];
  private valve: ValveNode | null = null;
  private valveOpen = false;
  /** ป้าย HTML ทั้งหมดในฉาก — ต้องลบเองเมื่อวาดใหม่ */
  private domLabels: HTMLElement[] = [];
  private ro: ResizeObserver;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private layoutKey = '';
  private viewDir = VIEW_DIR_BASE.clone().normalize();
  private fitBox = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  private userMoved = false;
  private tmp = new THREE.Vector3();

  private sphereGeo = new THREE.SphereGeometry(1, 12, 10);
  private streamTex = makeStreamTexture();
  private contactTex = makeContactTexture();
  // น้ำ: depthWrite: false → ไม่บังฟองอากาศที่อยู่ข้างใน ; ลำดับการวาดคุมด้วย renderOrder
  private waterMat = new THREE.MeshPhysicalMaterial({
    color: DEFAULT_WATER_COLOR,
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
    roughness: 0.12,
    clearcoat: 0.6,
    depthWrite: false,
  });
  private surfaceMat = new THREE.MeshPhysicalMaterial({
    color: DEFAULT_WATER_COLOR,
    transparent: true,
    opacity: 0.92,
    roughness: 0.04,
    metalness: 0.1,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private ringMat = new THREE.MeshBasicMaterial({ color: '#93c5fd', transparent: true, opacity: 0.95 });
  // ฟองอากาศใส: โปร่งเกือบทั้งลูก มีจุดสะท้อนแสงให้เห็นเป็นฟอง
  private bubbleMat = new THREE.MeshPhongMaterial({
    color: '#ffffff',
    specular: '#ffffff',
    shininess: 140,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  private streamMat = new THREE.MeshStandardMaterial({
    color: '#e0f2fe',
    map: this.streamTex,
    transparent: true,
    opacity: 0.85,
    roughness: 0.1,
    depthWrite: false,
  });
  // กระจกใส (ผนังถัง)
  private glassMat = new THREE.MeshPhysicalMaterial({
    color: '#e2e8f0',
    metalness: 0.05,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private steelMat = new THREE.MeshStandardMaterial({ color: '#d4d9df', metalness: 0.88, roughness: 0.26 });
  private steelDarkMat = new THREE.MeshStandardMaterial({ color: '#7b8591', metalness: 0.75, roughness: 0.38 });
  private valveBodyMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.35, roughness: 0.45 });
  private wheelMat = new THREE.MeshStandardMaterial({ color: '#ef4444', metalness: 0.2, roughness: 0.45 });
  private scaleMat = new THREE.LineBasicMaterial({ color: '#475569' });
  private floorTex = makeFloorTexture();
  private floorFade = makeFloorFade();
  private floorMat = new THREE.MeshStandardMaterial({
    map: this.floorTex,
    alphaMap: this.floorFade,
    transparent: true,
    roughness: 0.7,
    metalness: 0.05,
    depthWrite: false,
  });
  private contactMat = new THREE.MeshBasicMaterial({ map: this.contactTex, transparent: true, depthWrite: false });

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      cursor: 'grab',
    });
    host.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(this.labelRenderer.domElement);

    // แสงสะท้อนรอบทิศ (ให้สแตนเลส/กระจก/ผิวน้ำมีประกาย) + แสงหลักที่ทอดเงา + แสงเสริมด้านหลัง
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.65;
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.rim.position.set(-6, 5, -8);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0004;
    this.scene.add(this.hemi, this.key, this.key.target, this.rim, this.spot, this.spot.target, this.stage, this.root);
    this.applyTheme();
    // ธีมของหน้าเปลี่ยน (คลาส dark บน <html>) → เปลี่ยนแสงทันที
    this.themeObserver = new MutationObserver(() => this.applyTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
      this.renderer.domElement.style.cursor = 'grabbing';
    });
    this.controls.addEventListener('end', () => (this.renderer.domElement.style.cursor = 'grab'));
    this.renderer.domElement.addEventListener('dblclick', this.resetView);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  /**
   * วาดถัง/บ่อใหม่เมื่อจำนวน รูปทรง ขนาด หรือการมีวาล์วเปลี่ยน (ระดับน้ำที่แสดงอยู่คงไว้)
   * hasValve = วาดท่อ + วาล์วเติมน้ำเหนือใบแรก
   */
  setLayout(kind: 'tank' | 'pond', tanks: SceneTank[], hasValve: boolean) {
    const key = JSON.stringify([kind, tanks, hasValve]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const previous = this.nodes.map((n) => n.goal);
    this.clearRoot();
    const dark = document.documentElement.classList.contains('dark');
    const ink = dark ? '#e2e8f0' : '#334155';
    this.scaleMat.color.set(dark ? '#cbd5e1' : '#475569');

    // ใบที่พื้นสูงกว่าใบต่ำสุด → มีฐานคอนกรีตรองรับถึงพื้น (ไม่ลอย)
    const floorOf = (t: SceneTank) => -(Number.isFinite(t.offset_m) ? t.offset_m : 0);
    const minFloor = Math.min(...tanks.map(floorOf));
    let x = 0;
    tanks.forEach((t, i) => {
      const h = finite(t.height_m, 1);
      const isCyl = t.shape === 'cylinder';
      const w = isCyl ? finite(t.diameter_m, 1) : finite(t.width_m, 1);
      const d = isCyl ? w : finite(t.length_m, 1);
      const floorY = floorOf(t);
      const steelTank = isCyl && kind === 'tank'; // ถังสแตนเลสบนขา มีฝาโค้ง
      const lift = steelTank ? LEG_H + 0.06 : kind === 'tank' ? 0.1 : 0;
      const group = new THREE.Group();
      group.position.set(x + w / 2, floorY, 0);
      const vessel = new THREE.Group(); // ตัวถัง/บ่อ: y = 0 คือก้นด้านใน
      vessel.position.y = lift;
      group.add(vessel);
      const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = vessel) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };
      const clear = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.renderOrder = order;
        vessel.add(m);
        return m;
      };

      const plinth = floorY - minFloor;
      if (plinth > 0.005) {
        const pw = w + 0.3;
        const pd = (isCyl ? w : d) + 0.3;
        solid(new THREE.BoxGeometry(pw, plinth, pd).translate(0, -plinth / 2, 0), this.steelDarkMat, group);
      }

      let waterGeo: THREE.BufferGeometry;
      let surfaceGeo: THREE.BufferGeometry;
      let ring: THREE.Object3D;
      let scaleX: number; // ขีดสเกล: ชิดขอบซ้ายของใบ
      let scaleZ: number;
      if (isCyl) {
        const r = w / 2;
        if (steelTank) {
          // ขากลม 4 ขา + แผ่นรองขา + ฐานรอง
          for (const a of [0, 1, 2, 3]) {
            const ang = (a * Math.PI) / 2 + Math.PI / 4;
            const lx = Math.cos(ang) * r * 0.72;
            const lz = Math.sin(ang) * r * 0.72;
            solid(new THREE.CylinderGeometry(0.045, 0.05, LEG_H, 14).translate(lx, LEG_H / 2, lz), this.steelDarkMat, group);
            solid(new THREE.BoxGeometry(0.16, 0.025, 0.16).translate(lx, 0.012, lz), this.steelDarkMat, group);
          }
          solid(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.06, 48).translate(0, LEG_H + 0.03, 0), this.steelMat, group);
          // ฝาโค้ง (กระจก) + ฝาช่องตรวจ + ท่อระบายอากาศ
          const dome = clear(new THREE.SphereGeometry(r, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.glassMat, 2);
          dome.scale.y = 0.22;
          dome.position.y = h;
          solid(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.07, 32).translate(r * 0.35, h + r * 0.2, 0), this.steelMat);
          solid(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12).translate(-r * 0.3, h + r * 0.2 + 0.08, r * 0.2), this.steelDarkMat);
        } else if (kind === 'pond') {
          // บ่อใส: ฐานรองสแตนเลสเข้ม
          solid(new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.08, 48).translate(0, -0.04, 0), this.steelDarkMat);
        }
        {
          clear(new THREE.CylinderGeometry(r, r, h, 48, 1, true).translate(0, h / 2, 0), this.glassMat, 2);
          // ขอบบน/ล่างสแตนเลส + แถบรัด 2 เส้น
          solid(new THREE.TorusGeometry(r, 0.028, 10, 64).rotateX(Math.PI / 2), this.steelMat);
          solid(new THREE.TorusGeometry(r, 0.028, 10, 64).rotateX(Math.PI / 2).translate(0, h, 0), this.steelMat);
          for (const f of [1 / 3, 2 / 3])
            solid(new THREE.TorusGeometry(r + 0.004, 0.012, 8, 64).rotateX(Math.PI / 2).translate(0, h * f, 0), this.steelMat);
        }
        waterGeo = addDepthGradient(new THREE.CylinderGeometry(r * 0.97, r * 0.97, 1, 48).translate(0, 0.5, 0));
        surfaceGeo = new THREE.RingGeometry(0, r * 0.97, 40, 6).rotateX(-Math.PI / 2);
        ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.014, 8, 64).rotateX(Math.PI / 2), this.ringMat);
        scaleX = -(r + 0.06);
        scaleZ = 0;
      } else {
        {
          // ถัง/บ่อสี่เหลี่ยม (ใส): ฐานรอง + ผนังกระจก + เสามุมและคานสแตนเลส
          solid(new THREE.BoxGeometry(w + 0.16, 0.1, d + 0.16).translate(0, -0.05 - lift / 2, 0), this.steelDarkMat);
          clear(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), this.glassMat, 2);
          const p = 0.05;
          for (const sx of [-1, 1])
            for (const sz of [-1, 1]) solid(new THREE.BoxGeometry(p, h + p, p).translate((sx * w) / 2, h / 2, (sz * d) / 2), this.steelMat);
          for (const y of [0, h / 2, h]) {
            for (const sz of [-1, 1]) solid(new THREE.BoxGeometry(w, p * (y === h / 2 ? 0.5 : 1), p).translate(0, y, (sz * d) / 2), this.steelMat);
            for (const sx of [-1, 1]) solid(new THREE.BoxGeometry(p, p * (y === h / 2 ? 0.5 : 1), d).translate((sx * w) / 2, y, 0), this.steelMat);
          }
          scaleX = -(w / 2 + 0.08);
          scaleZ = d / 2 + 0.02;
        }
        waterGeo = addDepthGradient(new THREE.BoxGeometry(w * 0.985, 1, d * 0.985).translate(0, 0.5, 0));
        surfaceGeo = new THREE.PlaneGeometry(w * 0.985, d * 0.985, 18, 18).rotateX(-Math.PI / 2);
        const pts = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2, -w / 2, 0, -d / 2];
        ring = new THREE.Line(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
          new THREE.LineBasicMaterial({ color: '#93c5fd' })
        );
      }
      const water = clear(waterGeo, this.waterMat, 1);
      water.visible = false;
      const surface = clear(surfaceGeo, this.surfaceMat, 1);
      surface.visible = false;
      ring.visible = false;
      vessel.add(ring);

      // ฟองอากาศ: กระจายในใบ ลอยจากก้นถึงผิวน้ำแล้ววนใหม่
      const bubbles: Bubble[] = [];
      for (let b = 0; b < BUBBLES; b++) {
        const mesh = clear(this.sphereGeo, this.bubbleMat, 3);
        mesh.scale.setScalar(clamp(w * 0.022, 0.022, 0.065) * (0.45 + Math.random() * 1.1));
        mesh.visible = false;
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * 0.8;
        bubbles.push({
          mesh,
          x: isCyl ? Math.cos(ang) * rad * (w / 2) : (Math.random() - 0.5) * w * 0.85,
          z: isCyl ? Math.sin(ang) * rad * (w / 2) : (Math.random() - 0.5) * d * 0.85,
          phase: Math.random(),
          speed: 0.15 + Math.random() * 0.25,
        });
      }

      // ขีดสเกล 0–100% ฝั่งซ้าย: ขีดทุก 10% (ยาวขึ้นทุก 50%) ตัวเลขทุก 20% — ขีดและตัวเลขหันเข้าหาตัวถัง
      const tick = clamp(w * 0.04, 0.05, 0.11);
      const minor: HTMLElement[] = [];
      const small = (obj: CSS2DObject) => {
        minor.push(obj.element);
        vessel.add(obj);
      };
      const pts: number[] = [scaleX, 0, scaleZ, scaleX, h, scaleZ];
      for (let p = 0; p <= 100; p += 10) {
        const y = (h * p) / 100;
        pts.push(scaleX, y, scaleZ, scaleX + (p % 50 === 0 ? tick * 1.7 : tick), y, scaleZ);
        if (p % 20 === 0)
          small(
            this.domLabel(String(p), new THREE.Vector3(scaleX + tick * 1.7 + clamp(w * 0.05, 0.07, 0.15), y, scaleZ), {
              font: '600 9px/1 ui-sans-serif, system-ui, sans-serif',
              color: ink,
              opacity: '0.85',
              textShadow: dark ? '0 0 3px #0f172a' : '0 0 3px #ffffff',
            })
          );
      }
      vessel.add(
        new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), this.scaleMat)
      );
      small(
        this.domLabel('%', new THREE.Vector3(scaleX, h + clamp(h * 0.06, 0.1, 0.22), scaleZ), {
          font: '700 9px/1 ui-sans-serif, system-ui, sans-serif',
          color: ink,
          opacity: '0.85',
        })
      );

      // ข้อความบอกระดับ: กลางใบ ไม่มีพื้นหลัง — ชื่อ (เล็ก) / ค่า (ใหญ่) / รายละเอียด (เล็ก)
      const labelObj = this.domLabel('', new THREE.Vector3(0, h / 2, 0), {
        color: '#ffffff',
        font: '800 14px/1.2 ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        textShadow: '0 0 2px rgba(15,23,42,.9), 0 0 6px rgba(15,23,42,.65), 0 1px 3px rgba(15,23,42,.9)',
      });
      const part = (style: Partial<CSSStyleDeclaration>) => {
        const el = document.createElement('div');
        Object.assign(el.style, style);
        labelObj.element.appendChild(el);
        return el;
      };
      const label = {
        root: labelObj.element as HTMLDivElement,
        title: part({ fontSize: '0.62em', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: '0.92' }),
        value: part({ fontSize: '1.45em', fontWeight: '800', letterSpacing: '-0.01em' }),
        sub: part({ fontSize: '0.66em', fontWeight: '600', opacity: '0.9' }),
      };
      vessel.add(labelObj);

      // วาล์วเติมน้ำ + ท่อ: เหนือใบแรก ฝั่งขวา
      if (hasValve && i === 0) this.valve = this.buildValve(vessel, i, w, h, lift, steelTank, w / 2);

      this.root.add(group);
      const goal = Math.min(h, previous[i] ?? 0);
      this.nodes.push({
        water,
        surface,
        ring,
        bubbles,
        height: h,
        span: Math.max(w, d),
        amp: clamp(Math.min(w, d) * 0.008, 0.006, 0.02),
        level: goal,
        goal,
        label,
        anchor: labelObj,
        minor,
        labelRef: Math.max(h, Math.min(w, d) * 0.9),
        fontPx: 0,
      });
      x += w + GAP;
    });
    this.applyValve();

    // จัดกึ่งกลาง + กล่องครอบวัตถุ (ใช้วางกล้อง แสงเงา และพื้น)
    this.root.position.set(-Math.max(1, x - GAP) / 2, 0, 0);
    this.root.updateMatrixWorld(true);
    this.fitBox.setFromObject(this.root);
    this.buildStage();
    const radius = Math.max(0.5, this.fitBox.getSize(this.tmp).length() / 2);
    this.controls.minDistance = radius * 0.5;
    this.controls.maxDistance = radius * 8;
    this.resetView();
  }

  /**
   * ระดับน้ำของแต่ละใบ (เมตร ; null = ไม่มีค่า → ไม่วาดน้ำ) + ข้อความกลางใบ
   * color = สีน้ำที่ตั้งไว้ (#rrggbb) ; offline = ข้อมูลไม่สด → น้ำเป็นสีเทา
   */
  setLevels(levels: (number | null)[], labels: LevelLabel[], color: string, offline: boolean) {
    const c = new THREE.Color(offline ? OFFLINE_COLOR : /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_WATER_COLOR);
    this.waterMat.color.copy(c);
    this.surfaceMat.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.2); // ผิวน้ำสว่างกว่าเนื้อน้ำเล็กน้อย ให้เห็นคลื่น
    const glow = c.clone().lerp(new THREE.Color('#ffffff'), 0.55);
    this.ringMat.color.copy(glow);
    this.nodes.forEach((n, i) => {
      if ('color' in (n.ring as THREE.Line).material) ((n.ring as THREE.Line).material as THREE.LineBasicMaterial).color.copy(glow);
      const v = levels[i];
      n.goal = v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(n.height, v));
      const l = labels[i] ?? { title: '', value: '', sub: '' };
      n.label.title.textContent = l.title;
      n.label.value.textContent = l.value;
      n.label.sub.textContent = l.sub;
      n.label.sub.style.display = l.sub ? '' : 'none';
    });
  }

  /** สถานะวาล์วเติมน้ำ (null = ไม่มีค่า → แสดงเป็นปิด) + ข้อความป้ายข้างวาล์ว */
  setValve(open: boolean | null, label: string) {
    this.valveOpen = open === true;
    if (this.valve) this.valve.label.text.textContent = label;
    this.applyValve();
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.8;
  }

  resetView = () => {
    this.userMoved = false;
    this.fit();
  };

  /** มุมกล้องเริ่มต้น: y = ความสูงของทิศมอง (ค่าเริ่มต้น 0.42 ; น้อย = มองจากด้านข้างมากขึ้น) */
  setViewElevation(y: number) {
    this.viewDir.set(VIEW_DIR_BASE.x, y, VIEW_DIR_BASE.z).normalize();
    if (!this.userMoved) this.fit();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.themeObserver.disconnect();
    this.renderer.domElement.removeEventListener('dblclick', this.resetView);
    this.controls.dispose();
    this.clearRoot();
    this.clearStage();
    this.sphereGeo.dispose();
    [this.streamTex, this.contactTex, this.floorTex, this.floorFade, this.env].forEach((t) => t.dispose());
    [
      this.waterMat,
      this.surfaceMat,
      this.ringMat,
      this.bubbleMat,
      this.streamMat,
      this.glassMat,
      this.steelMat,
      this.steelDarkMat,
      this.valveBodyMat,
      this.wheelMat,
      this.scaleMat,
      this.floorMat,
      this.contactMat,
    ].forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  /** แสงตามธีม: สว่าง = แสงขาวธรรมชาติ ; มืด = สปอตไลต์โทนส้ม-เหลืองจากด้านบน + แสงรอบข้างโทนอุ่น */
  private applyTheme() {
    const dark = document.documentElement.classList.contains('dark');
    this.dark = dark;
    if (dark) {
      // LED สีขาว: แสงรอบข้างน้อย ให้สปอตไลต์เป็นแสงหลัก เห็นวงแสงบนพื้น
      this.hemi.color.set('#e2e8f0');
      this.hemi.groundColor.set('#0f172a');
      this.hemi.intensity = 0.4;
      this.key.color.set('#f8fafc');
      this.key.intensity = 0.55;
      this.rim.color.set('#cbd5e1');
      this.rim.intensity = 0.55;
      this.scene.environmentIntensity = 0.5;
      this.renderer.toneMappingExposure = 1.1;
      this.floorMat.color.set('#7c818a');
    } else {
      this.hemi.color.set('#f8fafc');
      this.hemi.groundColor.set('#94a3b8');
      this.hemi.intensity = 0.7;
      this.key.color.set('#ffffff');
      this.key.intensity = 1.9;
      this.rim.color.set('#dbeafe');
      this.rim.intensity = 0.7;
      this.scene.environmentIntensity = 0.65;
      this.renderer.toneMappingExposure = 1.05;
      this.floorMat.color.set('#d3d8df'); // พื้นเทาอ่อน ให้เห็นกระเบื้องบนพื้นหลังสว่าง
    }
    this.placeSpot();
    this.applyValve();
  }

  /** วางสปอตไลต์เหนือกลางฉาก ส่องลงให้แสงครอบทุกใบ (ความแรงตามขนาดฉาก) */
  private placeSpot() {
    const b = this.fitBox;
    const center = b.getCenter(new THREE.Vector3());
    const r = Math.max(1, b.getSize(new THREE.Vector3()).length() / 2);
    this.spot.position.set(center.x + r * 0.35, b.max.y + r * 2.2, center.z + r * 0.9);
    this.spot.target.position.set(center.x, b.min.y, center.z);
    const dist = this.spot.position.distanceTo(this.spot.target.position);
    this.spot.angle = Math.min(Math.PI / 3, Math.atan((r * 1.25) / dist));
    this.spot.intensity = this.dark ? 3.4 : 0; // decay = 0 → ความสว่างไม่ลดตามระยะ จึงเท่ากันทุกขนาดฉาก
    // ธีมสว่างปิดสปอตไลต์ทั้งดวง (ไฟที่ความแรง 0 ยังทอดเงาบนพื้นได้)
    this.spot.visible = this.dark;
    this.spot.castShadow = this.dark;
    this.spot.shadow.camera.far = dist * 2;
  }

  /** พื้นรับเงา + เงาสัมผัสใต้วัตถุ + กรอบแสงเงาให้พอดีฉาก */
  private buildStage() {
    this.clearStage();
    const b = this.fitBox;
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const floor = b.min.y - 0.002;
    // พื้นกระเบื้องวงกลม (แผ่นละ 0.6 m) จางออกที่ขอบ — รับเงาและแสงสปอตไลต์
    const floorR = Math.max(size.x, size.z) * 0.95 + 2.5;
    this.floorTex.repeat.set((floorR * 2) / 0.6, (floorR * 2) / 0.6);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(floorR, 64).rotateX(-Math.PI / 2), this.floorMat);
    shadow.position.set(center.x, floor, center.z);
    shadow.receiveShadow = true;
    shadow.renderOrder = -1;
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.contactMat);
    contact.scale.set(size.x * 1.35 + 0.8, 1, size.z * 1.6 + 0.8);
    contact.position.set(center.x, floor + 0.001, center.z);
    this.stage.add(shadow, contact);

    const r = Math.max(1, size.length() / 2);
    this.key.position.set(center.x + r * 0.9, center.y + r * 2.2, center.z + r * 1.4);
    this.key.target.position.copy(center);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -r * 1.3;
    cam.right = cam.top = r * 1.3;
    cam.near = 0.1;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
    this.placeSpot();
  }

  private clearStage() {
    this.stage.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.stage.clear();
  }

  /** ท่อเติมน้ำ: ท่อตั้งจากพื้น → ท่อนอนเหนือถัง (วาล์ว + พวงมาลัย) → ปากท่อลงถัง + สายน้ำ/ฟองอากาศ (แสดงเมื่อวาล์วเปิด) */
  private buildValve(vessel: THREE.Group, tank: number, w: number, h: number, lift: number, steelTank: boolean, halfOuter: number): ValveNode {
    const pr = clamp(w * 0.025, 0.03, 0.07); // รัศมีท่อ
    const spoutX = halfOuter - clamp(halfOuter * 0.5, 0.15, 0.5);
    const outX = halfOuter + 0.45;
    // ถังมีฝาโค้ง: ท่อเดินเหนือฝาแล้วทะลุลง ; แบบเปิดบน: ปากท่ออยู่เหนือขอบ
    const topY = steelTank ? h + (w / 2) * 0.22 + 0.25 : h + 0.45;
    const spoutY = steelTank ? h - 0.03 : h + 0.12;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      vessel.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(pr, pr, topY - spoutY, 16).translate(spoutX, (topY + spoutY) / 2, 0), this.steelMat); // ปากท่อลงถัง
    add(new THREE.CylinderGeometry(pr, pr, outX - spoutX, 16).rotateZ(Math.PI / 2).translate((outX + spoutX) / 2, topY, 0), this.steelMat); // ท่อนอน
    add(new THREE.CylinderGeometry(pr, pr, topY + lift, 16).translate(outX, (topY - lift) / 2, 0), this.steelMat); // ท่อตั้งจากพื้น
    for (const px of [spoutX, outX]) add(new THREE.SphereGeometry(pr * 1.18, 14, 12).translate(px, topY, 0), this.steelMat); // ข้องอ
    for (const fx of [-1, 1])
      add(
        new THREE.CylinderGeometry(pr * 1.7, pr * 1.7, pr * 0.5, 18).rotateZ(Math.PI / 2).translate((spoutX + outX) / 2 + fx * pr * 2.3, topY, 0),
        this.steelDarkMat
      ); // หน้าแปลน
    // ตัววาล์ว + ก้าน + พวงมาลัย (แดง = ปิด, เขียว = เปิด)
    const vx = (spoutX + outX) / 2;
    add(new THREE.SphereGeometry(pr * 1.8, 18, 14).translate(vx, topY, 0), this.valveBodyMat);
    add(new THREE.CylinderGeometry(pr * 0.35, pr * 0.35, pr * 3.2, 10).translate(vx, topY + pr * 2.6, 0), this.steelDarkMat);
    const wheel = add(new THREE.TorusGeometry(pr * 2.4, pr * 0.45, 10, 28).rotateX(Math.PI / 2), this.wheelMat);
    wheel.position.set(vx, topY + pr * 4.2, 0);
    for (const a of [0, Math.PI / 2]) wheel.add(new THREE.Mesh(new THREE.BoxGeometry(pr * 4.8, pr * 0.35, pr * 0.35).rotateY(a), this.wheelMat));

    // สายน้ำ: ทรงกระบอกยาว 1 หน่วย จุดอ้างอิงอยู่ด้านบน (ปากท่อ) ยืดลงถึงผิวน้ำ
    const stream = add(new THREE.CylinderGeometry(pr * 0.8, pr * 0.8, 1, 16, 1, true).translate(0, -0.5, 0), this.streamMat, false);
    stream.position.set(spoutX, spoutY, 0);
    stream.visible = false;
    stream.renderOrder = 1;
    const splash: ValveNode['splash'] = [];
    for (let i = 0; i < SPLASH; i++) {
      const mesh = add(this.sphereGeo, this.bubbleMat, false);
      mesh.scale.setScalar(pr * (0.35 + Math.random() * 0.45));
      mesh.visible = false;
      mesh.renderOrder = 3;
      splash.push({ mesh, phase: Math.random(), angle: Math.random() * Math.PI * 2 });
    }
    // ป้ายแคปซูล ขนาดตัวหนังสือคงที่ (ไม่ย่อตามการซูม) — สีตามสถานะและธีมใน applyValve()
    // CSS2DRenderer เขียนทับ style.display ของ element หลัก จึงวางแคปซูลไว้ใน element ชั้นใน
    const labelObj = this.domLabel('', new THREE.Vector3(vx, topY + pr * 4.2 + 0.3, 0), {});
    const pill = document.createElement('div');
    Object.assign(pill.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px 4px 8px',
      borderRadius: '999px',
      border: '1px solid',
      font: '600 11.5px/1.2 ui-sans-serif, system-ui, sans-serif',
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(15,23,42,0.18)',
      backdropFilter: 'blur(6px)',
    } satisfies Partial<CSSStyleDeclaration>);
    const dot = document.createElement('span');
    Object.assign(dot.style, { display: 'block', width: '7px', height: '7px', borderRadius: '999px', flexShrink: '0' });
    const text = document.createElement('span');
    pill.append(dot, text);
    labelObj.element.appendChild(pill);
    vessel.add(labelObj);
    return { tank, wheel, stream, splash, x: spoutX, spoutY, label: { root: pill, dot, text } };
  }

  private applyValve() {
    this.wheelMat.color.set(this.valveOpen ? '#22c55e' : '#ef4444');
    if (!this.valve) return;
    // [พื้น, ขอบ, ตัวหนังสือ, จุด]
    const [bg, border, ink, dot] = this.valveOpen
      ? this.dark
        ? ['rgba(6,78,59,0.85)', '#047857', '#d1fae5', '#34d399']
        : ['rgba(236,253,245,0.95)', '#a7f3d0', '#047857', '#10b981']
      : this.dark
        ? ['rgba(15,23,42,0.85)', '#334155', '#e2e8f0', '#f87171']
        : ['rgba(255,255,255,0.95)', '#e2e8f0', '#334155', '#ef4444'];
    const { root } = this.valve.label;
    root.style.background = bg;
    root.style.borderColor = border;
    root.style.color = ink;
    this.valve.label.dot.style.background = dot;
    this.valve.label.dot.style.boxShadow = this.valveOpen ? `0 0 0 3px ${dot}33` : 'none';
  }

  private domLabel(text: string, position: THREE.Vector3, style: Partial<CSSStyleDeclaration>): CSS2DObject {
    const el = document.createElement('div');
    Object.assign(el.style, style);
    el.textContent = text;
    this.domLabels.push(el);
    const obj = new CSS2DObject(el);
    obj.position.copy(position);
    return obj;
  }

  private clearRoot() {
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.sphereGeo) m.geometry.dispose(); // sphereGeo ใช้ร่วมกันหลายชิ้น ทิ้งตอน dispose()
      // วัสดุที่สร้างเฉพาะชิ้น (เส้นระดับของถังสี่เหลี่ยม) — วัสดุหลักของคลาสไม่ทิ้งที่นี่
      if (o instanceof THREE.Line && !(o instanceof THREE.LineSegments)) mats.add(o.material as THREE.Material);
    });
    mats.forEach((m) => m.dispose());
    this.domLabels.forEach((el) => el.remove());
    this.domLabels = [];
    this.root.clear();
    this.nodes = [];
    this.valve = null;
  }

  /**
   * วางกล้องให้เห็นวัตถุทั้งหมดพอดีช่อง: หาระยะใกล้ที่สุดที่มุมทั้ง 8 ของกล่องครอบวัตถุยังอยู่ในจอ
   * (มุมกล่องอยู่นอกตัววัตถุจริงอยู่แล้ว จึงยอมให้ชิดขอบจอได้ → ภาพเริ่มต้นใหญ่เต็มช่อง)
   */
  private fit() {
    const b = this.fitBox;
    const center = b.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, b.getSize(new THREE.Vector3()).length() / 2);
    const corners: THREE.Vector3[] = [];
    for (const cx of [b.min.x, b.max.x])
      for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(cx, cy, cz));
    const fits = (dist: number) => {
      this.camera.position.copy(center).addScaledVector(this.viewDir, dist);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld(true);
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) <= 1.04 && Math.abs(p.y) <= 1.04 && p.z < 1;
      });
    };
    let lo = radius * 0.5;
    let hi = radius * 12;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.camera.position.copy(center).addScaledVector(this.viewDir, hi);
    this.controls.target.copy(center);
    this.controls.update();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.fit(); // ยังไม่ได้หมุนเอง → จัดให้พอดีช่องใหม่
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const t = this.time;

    this.nodes.forEach((n, i) => {
      n.level = damp(n.level, n.goal, 3, dt);
      const has = n.level > 0.01;
      // วาล์วเปิดลงใบนี้ → คลื่นแรงขึ้น
      const amp = Math.min(n.level * 0.5, n.amp * (this.valveOpen && this.valve?.tank === i ? 2.5 : 1));
      n.water.visible = has;
      n.water.scale.y = Math.max(0.002, n.level - amp);
      n.surface.visible = has;
      n.ring.visible = has;
      if (has) {
        n.ring.position.y = n.level;
        // ผิวน้ำกระเพื่อม: ขยับความสูงของแต่ละจุดด้วยคลื่น 2 ชุดที่วิ่งคนละทิศ
        n.surface.position.y = n.level;
        const pos = n.surface.geometry.attributes.position as THREE.BufferAttribute;
        const k = (Math.PI * 9) / n.span; // ประมาณ 4–5 ลูกคลื่นตลอดความกว้าง
        for (let v = 0; v < pos.count; v++) {
          const px = pos.getX(v);
          const pz = pos.getZ(v);
          pos.setY(v, amp * (0.6 * Math.sin(px * k + t * 1.7) + 0.4 * Math.sin(pz * k * 0.8 - t * 2.3 + 1.3)));
        }
        pos.needsUpdate = true;
        n.surface.geometry.computeVertexNormals();
      }
      // ฟองอากาศลอยขึ้นแล้ววนใหม่ (ส่ายเล็กน้อย)
      const rise = Math.max(0.05, n.level - amp * 2);
      for (const b of n.bubbles) {
        b.mesh.visible = n.level > 0.12;
        if (!b.mesh.visible) continue;
        const f = (b.phase + (t * b.speed) / rise) % 1;
        b.mesh.position.set(b.x + Math.sin(t * 2.5 + b.phase * 20) * 0.02, f * rise, b.z + Math.cos(t * 2.1 + b.phase * 14) * 0.02);
      }
    });

    // วาล์วเปิด: สายน้ำต่อเนื่องจากปากท่อถึงผิวน้ำ + ฟองอากาศใต้จุดที่น้ำตก + พวงมาลัยหมุน
    const valve = this.valve;
    if (valve) {
      const level = this.nodes[valve.tank]?.level ?? 0;
      const drop = valve.spoutY - level;
      const flowing = this.valveOpen && drop > 0.02;
      valve.stream.visible = flowing;
      if (flowing) {
        valve.stream.scale.set(1, drop, 1);
        this.streamTex.repeat.set(1, Math.max(0.5, drop * 1.2));
        this.streamTex.offset.y = (t * 2.2) % 1;
        valve.wheel.rotation.y = t * 1.5;
      }
      const depth = Math.min(level * 0.6, 0.45);
      for (const sp of valve.splash) {
        sp.mesh.visible = flowing && level > 0.1;
        if (!sp.mesh.visible) continue;
        const f = (sp.phase + t * 0.9) % 1;
        const spread = 0.03 + f * 0.12;
        sp.mesh.position.set(valve.x + Math.cos(sp.angle) * spread, level - (1 - f) * depth, Math.sin(sp.angle) * spread);
      }
    }

    this.controls.update();

    // ขนาดตัวหนังสือตามขนาดของใบบนจอ: ซูมออก/ใบเล็ก → ตัวหนังสือเล็กลง (ป้ายระดับ 7–16px, ตัวเลขสเกล 6–11px)
    const pxPerMeterAt1 = (this.host.clientHeight || 1) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const n of this.nodes) {
      const dist = this.camera.position.distanceTo(n.anchor.getWorldPosition(this.tmp));
      const px = clamp(((n.labelRef * pxPerMeterAt1) / Math.max(0.1, dist)) * 0.085, 7, 16);
      if (Math.abs(px - n.fontPx) < 0.25) continue;
      n.fontPx = px;
      n.label.root.style.fontSize = `${px.toFixed(1)}px`;
      const minorPx = clamp(px * 0.5, 5.5, 9).toFixed(1);
      for (const el of n.minor) el.style.fontSize = `${minorPx}px`;
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
}
