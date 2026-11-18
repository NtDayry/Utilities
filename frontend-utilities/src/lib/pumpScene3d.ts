// ฉาก 3 มิติของระบบบ่อน้ำประปา + บูสเตอร์ปั๊ม (three.js)
// ข้อมูลทั้งหมดมาจาก MQTT topic water-system: ระดับน้ำ, วาล์ว, ปั๊ม 1/2 (Hz/A/alarm), แรงดัน, สถานะการสื่อสาร
// ขนาดบ่อจริงมาจาก TankConfig (หน่วยเมตร) — ฉากถูกสร้างใหม่เมื่อเปลี่ยนขนาดบ่อ
// ลากเมาส์ซ้าย = หมุน · ลากขวา = เลื่อน · ล้อเมาส์ = ซูม · ดับเบิลคลิก = รีเซ็ตมุมกล้อง
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { DisplayUnit, TankCalculations, TankConfig, TankData } from '@/types/waterSupply.types';
import { DEFAULT_TANK_CONFIG, calculateTanks } from '@/lib/tankCalculations';
import i18n from '@/i18n';

export interface SceneInput {
  data: TankData;
  percent: number;
  low: boolean;
  high: boolean;
  tankConfig?: TankConfig;
  displayUnit?: DisplayUnit;
  tankCalculations?: TankCalculations;
}

type PumpState = 'run' | 'stop' | 'sleep' | 'alarm' | 'offline';
type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

/* ---------- ค่าคงที่ของฉาก (เมตร) ---------- */
const WALL = 0.2; // ระยะเผื่อโครงบ่อ (เสาสแตนเลส + กระจก) รอบบ่อ
const GAP = 1.4; // ระยะห่างระหว่างบ่อ 1 และ 2
const PIPE_R = 0.085; // รัศมีท่อหลัก
const SHAFT_Y = 0.62; // ความสูงแกนปั๊ม (จากพื้น)
const DIS_Y = 1.6; // ความสูงท่อจ่าย (discharge header)
const PUMP_Z = 1.35; // ระยะปั๊มจากแนวกลาง
const GAUGE_MAX_BAR = 6;

const COLORS = {
  run: new THREE.Color('#22c55e'),
  stop: new THREE.Color('#64748b'),
  sleep: new THREE.Color('#f59e0b'),
  alarm: new THREE.Color('#ef4444'),
  offline: new THREE.Color('#334155'),
  flow: new THREE.Color('#67e8f9'),
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const damp = (cur: number, goal: number, k: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-k * dt));

/* ---------- ท่อ + อนุภาคน้ำไหล ---------- */
interface PipeRun {
  pts: THREE.Vector3[];
  cum: number[];
  total: number;
  mat: THREE.MeshStandardMaterial;
  core: THREE.Group; // แกนน้ำไหลภายในท่อ (แสดงเฉพาะตอนมีน้ำไหล)
  coreMat: THREE.MeshStandardMaterial;
  coreTex: THREE.Texture;
  perp: [THREE.Vector3, THREE.Vector3][]; // แกนตั้งฉากของแต่ละช่วงท่อ (ใช้วางฟองอากาศรอบแกน)
  r: number;
  flow: THREE.InstancedMesh | null;
  active: boolean;
  speed: number;
  phase: number;
}

interface PumpRig {
  ring: THREE.MeshStandardMaterial;
  rotors: THREE.Object3D[];
  omega: number;
  state: PumpState;
  freq: number;
  led: THREE.MeshStandardMaterial;
}

interface TankRig {
  body: THREE.Mesh;
  surface: THREE.Mesh;
  bodyMat: THREE.MeshPhysicalMaterial;
  surfMat: THREE.MeshPhysicalMaterial;
  floorY: number;
  heightM: number;
  level: number; // m (smoothed)
  goal: number; // m
  plate: THREE.CanvasTexture;
  plateKey: string;
  idx: number;
  dims: string;
  cx: number;
  W: number;
  L: number;
  caustics: THREE.Mesh[];
  foam: THREE.Group;
  bubbles: THREE.InstancedMesh;
  bub: { x: number; z: number; y: number; v: number; ph: number; s: number }[];
  inlet: { x: number; z: number } | null;
}

export class PumpScene3D {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  private controls: OrbitControls;
  private env: THREE.Texture;
  private root = new THREE.Group();
  private labelGroup = new THREE.Group();
  private ground: THREE.Mesh;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private floorTex: THREE.CanvasTexture;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  /** ไฟ LED สีขาวส่องลงจากด้านบน — เปิดเฉพาะธีม dark */
  private spot: THREE.SpotLight;
  private dark = false;
  private clock = new THREE.Clock();
  private raf = 0;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private visible = true;
  private t = 0;

  private input: SceneInput | null = null;
  private cfgKey = '';
  private cfg: TankConfig = DEFAULT_TANK_CONFIG;
  private lang = 'th';
  private showLabels = true;
  private home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private flyTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private bounds = new THREE.Box3();
  private userMoved = false;

  // วัตถุที่เปลี่ยนตามข้อมูล
  private runs: Record<string, PipeRun> = {};
  private pumps: PumpRig[] = [];
  private tanks: TankRig[] = [];
  private labels: Record<string, { obj: CSS2DObject; el: HTMLDivElement; inner: HTMLDivElement; down: boolean; stem: number }> = {};
  private homeDist = 20;
  private valveFlag: THREE.Object3D | null = null;
  private valveOpen = 0;
  private valveLed: THREE.MeshStandardMaterial | null = null;
  private needle: THREE.Object3D | null = null;
  private needleBar = 0;
  private gaugeTex: THREE.CanvasTexture | null = null;
  private gaugeSet = -1;
  private hmiTex: THREE.CanvasTexture | null = null;
  private hmiKey = '';
  private beaconRed: THREE.MeshStandardMaterial | null = null;
  private beaconGreen: THREE.MeshStandardMaterial | null = null;
  private pilot: Record<string, THREE.MeshStandardMaterial> = {};
  private psLed: THREE.MeshStandardMaterial | null = null;
  private sensorLed: THREE.MeshStandardMaterial | null = null;
  private beam: THREE.Mesh | null = null;
  private beamTop = 0;
  private sensorTank = 0;
  private flowMeterLcd: THREE.MeshStandardMaterial | null = null;

  // วัสดุพื้นฐาน
  private M = {
    pondGlass: new THREE.MeshPhysicalMaterial({ color: '#e8f4fb', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide }),
    concreteTop: new THREE.MeshStandardMaterial({ color: '#b9bec5', roughness: 0.85 }),
    floor: new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.9 }),
    facade: new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.8 }),
    facadeDark: new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.7, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: '#1e293b', emissive: '#fcd34d', emissiveIntensity: 0.05, roughness: 0.1, metalness: 0.6 }),
    epoxy: new THREE.MeshStandardMaterial({ color: '#4d7c6f', roughness: 0.45, metalness: 0.05 }),
    safety: new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b6bfca', roughness: 0.32, metalness: 0.85 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.45, metalness: 0.7 }),
    paint: new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.38, metalness: 0.35 }),
    motor: new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.42, metalness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.6, metalness: 0.2 }),
    cabinet: new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.55, metalness: 0.25 }),
    vessel: new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.3, metalness: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.5 }),
    flow: new THREE.MeshStandardMaterial({ color: '#a5f3fc', emissive: '#22d3ee', emissiveIntensity: 1.4, roughness: 0.3 }),
    foam: new THREE.MeshBasicMaterial({ color: '#d5f5f8', transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }),
    stream: new THREE.MeshStandardMaterial({ color: '#7de8f5', emissive: '#22d3ee', emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false, toneMapped: false }),
    drop: new THREE.MeshStandardMaterial({ color: '#eaf7fa', emissive: '#cfeef4', emissiveIntensity: 0.2, transparent: true, opacity: 0.85, roughness: 0.1, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ color: '#e6f7fa', transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    bubble: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e6f4f7', emissiveIntensity: 0.2, roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false }),
    beam: new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    limit: new THREE.LineDashedMaterial({ color: '#ef4444', dashSize: 0.25, gapSize: 0.12 }),
  };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
    host.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(this.labelRenderer.domElement);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.Fog('#0b1220', 55, 190);

    this.hemi = new THREE.HemisphereLight('#dbeafe', '#334155', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.1);
    this.sun.position.set(-10, 18, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    this.scene.add(this.sun, this.sun.target);
    this.spot = new THREE.SpotLight('#f5f8ff', 0, 0, Math.PI / 5, 0.55, 0);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(2048, 2048);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.02;
    this.spot.visible = false;
    this.scene.add(this.spot, this.spot.target);

    // ท้องฟ้าแบบไล่สี (โดมรอบกล้อง) ให้ฉากมีความลึก
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.7)) : mix(horizon, bottom, smoothstep(0.0, 0.15, -h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          }`,
      })
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // พื้นคอนกรีตปูแผ่น (texture วาดเอง: แผ่นละ 2 ม. + ร่องยาแนว + เม็ดผิว)
    this.floorTex = this.makeFloorTexture();
    this.M.floor.map = this.floorTex;
    this.M.floor.needsUpdate = true;
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(400, 96), this.M.floor);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.scene.add(this.root, this.labelGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener('start', () => {
      this.flyTo = null;
      this.userMoved = true;
      this.renderer.domElement.style.cursor = 'grabbing';
    });
    this.controls.addEventListener('end', () => (this.renderer.domElement.style.cursor = 'grab'));
    this.renderer.domElement.addEventListener('dblclick', this.resetView);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver(([e]) => (this.visible = e?.isIntersecting ?? true));
    this.io.observe(host);

    this.setTheme(document.documentElement.classList.contains('dark'));
    this.resize();
    this.build(DEFAULT_TANK_CONFIG, true);
    this.raf = requestAnimationFrame(this.loop);
    document.fonts?.ready.then(() => {
      this.tanks.forEach((t) => (t.plateKey = ''));
      if (this.input) this.applyData(this.input);
    });
  }

  /* ================= API ================= */
  setTheme(isDark: boolean) {

    const sky = isDark ? { top: '#020617', horizon: '#273449', bottom: '#111827' } : { top: '#6fa8dc', horizon: '#e3e9f0', bottom: '#c3cbd5' };
    const u = this.sky.material.uniforms;
    u.top.value.set(sky.top);
    u.horizon.value.set(sky.horizon);
    u.bottom.value.set(sky.bottom);
    const bg = new THREE.Color(sky.horizon);
    this.scene.background = bg;
    (this.scene.fog as THREE.Fog).color.copy(bg);
    // พื้นลานโทนเทาเข้มอมฟ้า
    this.M.floor.color.set(isDark ? '#3a4352' : '#7f8a98');
    this.M.facade.color.set(isDark ? '#8a94a3' : '#dfe4ea');
    this.M.glass.emissiveIntensity = isDark ? 0.28 : 0.02;
    this.hemi.intensity = isDark ? 0.45 : 1.0;
    this.sun.intensity = isDark ? 0.6 : 2.4;
    this.scene.environmentIntensity = isDark ? 0.4 : 0.55;
    this.dark = isDark;
    this.placeSpot();
  }

  /** วางไฟ LED เหนือกึ่งกลางระบบ ให้ลำแสงครอบทั้งบ่อและห้องปั๊ม */
  private placeSpot() {
    const on = this.dark && !this.bounds.isEmpty();
    this.spot.visible = on;
    this.spot.castShadow = on;
    if (!on) return;
    const ctr = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const r = Math.hypot(size.x, size.z) / 2;
    const dist = Math.max(14, r * 1.6);
    this.spot.position.set(ctr.x + r * 0.15, this.bounds.max.y + dist, ctr.z + r * 0.35);
    this.spot.target.position.set(ctr.x, 0, ctr.z);
    this.spot.target.updateMatrixWorld();
    const h = this.spot.position.distanceTo(this.spot.target.position);
    this.spot.angle = Math.min(Math.PI / 2.6, Math.atan((r * 1.25) / h));
    this.spot.penumbra = 0.55;
    this.spot.intensity = 3.6;
    const sc = this.spot.shadow.camera;
    sc.near = Math.max(1, h - r * 2 - 10);
    sc.far = h + r * 2 + 10;
    sc.updateProjectionMatrix();
  }

  setLang(lang: string) {
    this.lang = lang;
    this.hmiKey = '';
    if (this.input) this.applyData(this.input);
  }

  setAutoRotate(v: boolean) {
    this.controls.autoRotate = v;
  }

  setLabelsVisible(v: boolean) {
    this.showLabels = v;
    this.labelGroup.visible = v;
    Object.values(this.labels).forEach((l) => (l.obj.visible = v));
    // ซ่อนทั้งชั้น HTML ทันที (เดิมข้ามการ render ทำให้ป้ายค้างอยู่บนจอ)
    this.labelRenderer.domElement.style.display = v ? '' : 'none';
  }

  resetView = () => {
    this.userMoved = false;
    this.flyTo = { pos: this.home.pos.clone(), target: this.home.target.clone() };
  };

  update(input: SceneInput) {
    this.input = input;
    const cfg = input.tankConfig ?? DEFAULT_TANK_CONFIG;
    const key = JSON.stringify(cfg);
    if (key !== this.cfgKey) this.build(cfg, this.cfgKey === '');
    this.applyData(input);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    this.renderer.domElement.removeEventListener('dblclick', this.resetView);
    this.controls.dispose();
    this.clearRoot();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    Object.values(this.M).forEach((m) => mats.add(m));
    mats.forEach((m) => m.dispose());
    this.env.dispose();
    this.floorTex.dispose();
    this.flowTexBase?.dispose();
    this.causticTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  private makeFloorTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 4, t = 512 / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 206 + Math.round(rnd() * 12);
        g.fillStyle = `rgb(${v},${v},${v + 3})`;
        g.fillRect(i * t, j * t, t, t);
      }
    for (let k = 0; k < 9000; k++) {
      const v = 170 + Math.round(rnd() * 85);
      g.fillStyle = `rgba(${v},${v},${v},${0.1 + rnd() * 0.12})`;
      g.fillRect(rnd() * 512, rnd() * 512, 1.5, 1.5);
    }
    g.fillStyle = 'rgba(90,98,110,0.35)';
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * t - 1, 0, 2, 512);
      g.fillRect(0, i * t - 1, 512, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(100, 100); // วงกลมรัศมี 400 ม. → แผ่นละ 2 ม.
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  /** อาคารโรงงานด้านหลังฉาก: ผนัง เสา แถบหน้าต่าง ประตูม้วน และหลังคา (ให้ฉากมีมิติ) */
  private facade(x0: number, x1: number, z: number) {
    const g = this.add(new THREE.Group());
    const len = x1 - x0, cx = (x0 + x1) / 2, H = 6.5;
    this.box(len, H, 0.4, this.M.facade, cx, H / 2, z, g);
    this.box(len, 0.7, 0.5, this.M.facadeDark, cx, 0.35, z + 0.05, g);
    this.box(len + 0.4, 0.45, 0.8, this.M.facadeDark, cx, H + 0.22, z + 0.1, g);
    const bay = 4.5;
    const nb = Math.max(2, Math.round(len / bay));
    const step = len / nb;
    for (let i = 0; i <= nb; i++) this.box(0.45, H, 0.65, this.M.facade, x0 + i * step, H / 2, z + 0.12, g);
    for (let i = 0; i < nb; i++) {
      const bx = x0 + (i + 0.5) * step;
      this.box(step - 1.1, 1.1, 0.06, this.M.glass, bx, 4.6, z + 0.23, g);
      for (let k = 1; k < 4; k++) this.box(0.05, 1.1, 0.08, this.M.facadeDark, bx - (step - 1.1) / 2 + ((step - 1.1) * k) / 4, 4.6, z + 0.25, g);
    }
    // ประตูม้วนหลังห้องปั๊ม
    const dx = x1 - step * 1.5;
    this.box(3.2, 3.4, 0.06, this.M.steel, dx, 1.7, z + 0.23, g);
    for (let y = 0.25; y < 3.4; y += 0.22) this.box(3.2, 0.025, 0.08, this.M.darkSteel, dx, y, z + 0.25, g);
    this.box(3.5, 0.3, 0.3, this.M.facadeDark, dx, 3.55, z + 0.3, g);
  }

  /* ================= ตัวช่วยสร้างรูปทรง ================= */
  private add<T extends THREE.Object3D>(o: T, parent: THREE.Object3D = this.root): T {
    parent.add(o);
    return o;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return this.add(m, parent);
  }

  /** ทรงกระบอกตามแกน (x/y/z) จุดกึ่งกลาง c */
  private cyl(r: number, len: number, axis: 'x' | 'y' | 'z', mat: THREE.Material, c: THREE.Vector3Like, parent?: THREE.Object3D, seg = 28, r2 = r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
    if (axis === 'x') m.rotation.z = -Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    m.position.set(c.x, c.y, c.z);
    return this.add(m, parent);
  }

  private flange(c: THREE.Vector3, axis: 'x' | 'y' | 'z', r = PIPE_R) {
    this.cyl(r * 1.75, 0.05, axis, this.M.steel, c);
  }

  private matStd(color: string, emissive = '#000000', ei = 0) {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.35, metalness: 0.1 });
  }

  /** ท่อแบบหักมุม (polyline) + ข้อต่อ + อนุภาคน้ำไหล */
  /** texture ลายน้ำไหล (แถบสว่าง-มืดไล่ระดับ) ใช้ร่วมกันทุกท่อ แต่ละท่อ clone เพื่อเลื่อน offset แยกกัน */
  private flowTexBase: THREE.CanvasTexture | null = null;
  private flowTexture() {
    if (!this.flowTexBase) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 256;
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, '#6aa9b8');
      grd.addColorStop(0.35, '#93c9d5');
      grd.addColorStop(0.5, '#d9eff4');
      grd.addColorStop(0.65, '#93c9d5');
      grd.addColorStop(1, '#6aa9b8');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 256);
      // ริ้วน้ำเฉียงเล็ก ๆ
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(i * 12, 40 + i * 30);
        g.quadraticCurveTo(32, 20 + i * 30, 64, 60 + i * 30);
        g.stroke();
      }
      this.flowTexBase = new THREE.CanvasTexture(c);
      this.flowTexBase.colorSpace = THREE.SRGBColorSpace;
      this.flowTexBase.wrapS = this.flowTexBase.wrapT = THREE.RepeatWrapping;
    }
    const t = this.flowTexBase.clone();
    t.needsUpdate = true;
    return t;
  }

  /** ท่อแบบหักมุม (polyline) + ข้อต่อ + แกนน้ำไหล + ฟองอากาศ */
  private pipe(key: string, pts: THREE.Vector3[], r = PIPE_R, flow = true): PipeRun {
    const mat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.35, metalness: 0.75 });
    const coreTex = this.flowTexture();
    const coreMat = new THREE.MeshStandardMaterial({ map: coreTex, emissiveMap: coreTex, emissive: '#ffffff', emissiveIntensity: 0.1, roughness: 0.3, transparent: true, opacity: 0.85 });
    const g = new THREE.Group();
    const core = new THREE.Group();
    core.visible = false;
    const cum = [0];
    const perp: [THREE.Vector3, THREE.Vector3][] = [];
    const Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = a.distanceTo(b);
      cum.push(cum[i] + len);
      const dir = b.clone().sub(a).normalize();
      const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
      perp.push([u, new THREE.Vector3().crossVectors(dir, u).normalize()]);
      if (len < 1e-4) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24, 1, true), mat);
      m.position.copy(mid);
      m.quaternion.copy(q);
      g.add(m);
      // แกนน้ำ: UV ตามความยาวจริง ให้ลายมีขนาดเท่ากันทุกช่วง (1 รอบลาย = 0.6 ม.)
      const cg = new THREE.CylinderGeometry(r * 0.62, r * 0.62, len, 16, 1, true);
      const uv = cg.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, (uv.getY(k) * len + cum[i]) / 0.6);
      const cm = new THREE.Mesh(cg, coreMat);
      cm.position.copy(mid);
      cm.quaternion.copy(q);
      cm.renderOrder = 1;
      core.add(cm);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const j = new THREE.Mesh(new THREE.SphereGeometry(r * 1.18, 20, 14), mat);
      j.position.copy(pts[i]);
      g.add(j);
      const jc = new THREE.Mesh(new THREE.SphereGeometry(r * 0.66, 14, 10), coreMat);
      jc.position.copy(pts[i]);
      core.add(jc);
    }
    this.add(g);
    this.add(core);
    const total = cum[cum.length - 1];
    let inst: THREE.InstancedMesh | null = null;
    if (flow) {
      const n = Math.max(3, Math.ceil(total / 0.22));
      inst = new THREE.InstancedMesh(new THREE.SphereGeometry(r * 0.16, 8, 6), this.M.bubble, n);
      inst.frustumCulled = false;
      inst.count = 0;
      inst.castShadow = false;
      inst.renderOrder = 2;
      this.add(inst);
    }
    const run: PipeRun = { pts, cum, total, mat, core, coreMat, coreTex, perp, r, flow: inst, active: false, speed: 1, phase: Math.random() * 3 };
    this.runs[key] = run;
    return run;
  }

  private pointAt(run: PipeRun, d: number, out: THREE.Vector3) {
    const { pts, cum } = run;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    out.copy(pts[i - 1]).lerp(pts[i], (d - cum[i - 1]) / seg);
    return i - 1;
  }

  /** ป้ายข้อมูล (HTML) แบบเม็ดยา — down = ห้อยลงใต้จุดยึด, stem = ความยาวเส้นโยง (px), align = ป้ายอยู่ซ้าย/ขวาของจุดยึด */
  private label(key: string, pos: THREE.Vector3, down = false, stem = 14, align: 'left' | 'center' | 'right' = 'center') {
    const el = document.createElement('div');
    el.className = 'pointer-events-none select-none';
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    const cxk = align === 'left' ? 0.9 : align === 'right' ? 0.1 : 0.5;
    obj.center.set(cxk, down ? 0 : 1);
    el.dataset.align = align;
    // inner: ย่อ/ขยายตามระยะกล้อง (CSS2DRenderer ใช้ transform ของ el เอง จึงต้องสเกลที่ชั้นใน)
    const inner = document.createElement('div');
    inner.style.transformOrigin = `${cxk * 100}% ${down ? 0 : 100}%`;
    inner.style.willChange = 'transform';
    el.appendChild(inner);
    obj.visible = this.showLabels;
    this.labelGroup.add(obj);
    this.labels[key] = { obj, el, inner, down, stem };
  }

  private canvasTex(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private clearRoot() {
    const mats = new Set<THREE.Material>();
    const keep = new Set<THREE.Material>(Object.values(this.M));
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => !keep.has(x) && mats.add(x));
    });
    mats.forEach((m) => {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      m.dispose();
    });
    this.root.clear();
    // CSS2DObject จะลบ element ของตัวเองเมื่อถูก remove ออกจาก parent โดยตรง
    [...this.labelGroup.children].forEach((c) => this.labelGroup.remove(c));
    this.runs = {};
    this.pour = null;
    this.pumps = [];
    this.tanks = [];
    this.labels = {};
    this.pilot = {};
  }

  /* ================= สร้างฉาก ================= */
  private build(cfg: TankConfig, fitCamera: boolean) {
    this.clearRoot();
    this.cfg = cfg;
    this.cfgKey = JSON.stringify(cfg);
    this.gaugeSet = -1;
    this.hmiKey = '';

    const t1 = cfg.tank1, t2 = cfg.tank2;
    const off = Math.max(-200, Math.min(200, cfg.tank2_offset_cm)) / 100;
    // บ่อ 2 ฐานต่ำกว่าบ่อ 1 = off (ม.) → ยกทั้งระบบให้ฐานที่ต่ำที่สุดอยู่บนพื้น
    const floor1 = Math.max(0, off);
    const floor2 = Math.max(0, -off);
    // บ่อวางแนวยาว: ความยาว (length_m) ตามแกน X หันด้านยาวเข้าหากล้อง, ความกว้าง (width_m) ตามแกน Z
    const W1 = t1.width_m, L1 = t1.length_m, H1 = t1.height_m;
    const W2 = t2.width_m, L2 = t2.length_m, H2 = t2.height_m;
    const x1 = -(L1 / 2 + WALL + GAP / 2);
    const x2 = L2 / 2 + WALL + GAP / 2;
    this.ground.position.y = 0;

    this.tanks = [this.basin(x1, floor1, L1, W1, H1, 0), this.basin(x2, floor2, L2, W2, H2, 1)];
    this.ladder(x1 - L1 / 2 - WALL, floor1, H1, W1 * 0.15);

    // แนวท่อ
    const topY = Math.max(floor1 + H1, floor2 + H2);
    const inY = topY + 0.85;
    // 1) ท่อน้ำประปาเข้า: ขึ้นจากพื้นหลังบ่อ 1 → วาล์ว → มิเตอร์ → ข้ามผนังหลังลงบ่อ 1
    const zBack = -(W1 / 2 + WALL + 0.9);
    const xr = x1 - L1 / 2 + 0.4;
    const xDrop = Math.max(xr + 2.9, x1 - L1 * 0.08);
    const xValve = xr + 0.95, xMeter = xr + 2.05;
    const outY = floor1 + H1 + 0.45; // ปลายท่อเติมน้ำ: สูงเหนือขอบบ่อ
    this.pipe('inlet', [
      new THREE.Vector3(xr, 0, zBack),
      new THREE.Vector3(xr, inY, zBack),
      new THREE.Vector3(xDrop, inY, zBack),
      new THREE.Vector3(xDrop, inY, -W1 * 0.25),
      new THREE.Vector3(xDrop, outY, -W1 * 0.25),
    ]);
    // ปากท่อหันลง (ยกสูงเหนือขอบบ่อ) + หน้าแปลน
    this.cyl(PIPE_R * 1.35, 0.12, 'y', this.M.steel, { x: xDrop, y: outY + 0.02, z: -W1 * 0.25 });
    this.cyl(PIPE_R * 1.75, 0.04, 'y', this.M.darkSteel, { x: xDrop, y: outY + 0.1, z: -W1 * 0.25 });
    this.cyl(0.13, 0.12, 'y', this.M.concreteTop, { x: xr, y: 0.06, z: zBack });
    this.buildPour(xDrop, outY - 0.04, -W1 * 0.25);
    this.tanks[0].inlet = { x: xDrop - x1, z: -W1 * 0.25 };
    this.valve(new THREE.Vector3(xValve, inY, zBack));
    this.flowMeter(new THREE.Vector3(xMeter, inY, zBack));
    this.label('valve', new THREE.Vector3(xValve, inY + 0.62, zBack), false, 18, 'left');
    this.label('meter', new THREE.Vector3(xMeter, inY + 0.5, zBack), false, 18, 'right');

    // 2) ท่อเชื่อมบ่อ 1 ↔ บ่อ 2 (communicating vessels) ผ่านช่องระหว่างบ่อ
    const linkY = Math.max(floor1, floor2) + 0.3;
    const linkZ = Math.min(W1, W2) * 0.2;
    const xa = x1 + L1 / 2, xb = x2 - L2 / 2, xm = (xa + xb) / 2;
    this.pipe('link', [new THREE.Vector3(xa, linkY, linkZ), new THREE.Vector3(xb, linkY, linkZ)], PIPE_R * 1.15);
    this.flange(new THREE.Vector3(xa + WALL + 0.03, linkY, linkZ), 'x', PIPE_R * 1.15);
    this.flange(new THREE.Vector3(xb - WALL - 0.03, linkY, linkZ), 'x', PIPE_R * 1.15);
    this.cyl(PIPE_R * 1.9, 0.22, 'x', this.M.darkSteel, { x: xm, y: linkY, z: linkZ }); // gate valve body
    this.cyl(0.02, 0.35, 'y', this.M.steel, { x: xm, y: linkY + 0.25, z: linkZ });
    this.cyl(0.12, 0.03, 'y', this.matStd('#dc2626'), { x: xm, y: linkY + 0.43, z: linkZ });

    // 3) ท่อดูด จากผนังท้ายบ่อ 2 → header → ปั๊ม 1/2
    const xw = x2 + L2 / 2;
    const xh = xw + WALL + 1.0;
    const xp = xh + 1.75; // ศูนย์กลางปั๊ม (ช่วงระหว่าง volute กับมอเตอร์)
    const pumpIn = xp - 0.9;
    const sY = Math.max(SHAFT_Y, floor2 + 0.3);
    this.pipe('suction', [new THREE.Vector3(xw, Math.min(sY, floor2 + 0.35), 0), new THREE.Vector3(xw + WALL + 0.25, Math.min(sY, floor2 + 0.35), 0), new THREE.Vector3(xw + WALL + 0.25, sY, 0), new THREE.Vector3(xh, sY, 0)], PIPE_R * 1.3);
    this.flange(new THREE.Vector3(xw + WALL + 0.03, Math.min(sY, floor2 + 0.35), 0), 'x', PIPE_R * 1.3);
    const xd = xp + 1.55; // discharge header
    [-1, 1].forEach((s, i) => {
      const z = s * PUMP_Z;
      this.pipe(`suc${i + 1}`, [new THREE.Vector3(xh, sY, 0), new THREE.Vector3(xh, sY, z), new THREE.Vector3(pumpIn, sY, z)]);
      this.flange(new THREE.Vector3(pumpIn - 0.02, sY, z), 'x');
      this.cyl(PIPE_R * 1.7, 0.18, 'x', this.M.darkSteel, { x: xh + 0.45, y: sY, z }); // isolating valve
      this.cyl(0.02, 0.28, 'y', this.M.steel, { x: xh + 0.45, y: sY + 0.2, z });
      this.cyl(0.1, 0.025, 'y', this.matStd('#dc2626'), { x: xh + 0.45, y: sY + 0.34, z });
      this.pumpUnit(xp, sY, z, i);
      // discharge ขึ้นจาก volute → check valve → header
      const vx = xp - 0.55;
      this.pipe(`dis${i + 1}`, [new THREE.Vector3(vx, sY + 0.38, z), new THREE.Vector3(vx, DIS_Y, z), new THREE.Vector3(xd, DIS_Y, z), new THREE.Vector3(xd, DIS_Y, 0)]);
      this.box(0.2, 0.24, 0.2, this.M.darkSteel, vx, sY + 0.72, z); // check valve
      this.flange(new THREE.Vector3(vx, sY + 0.58, z), 'y');
      this.flange(new THREE.Vector3(vx, sY + 0.86, z), 'y');
      // ปั๊ม 1 (ด้านหลัง) ป้ายอยู่บน · ปั๊ม 2 (ด้านหน้า) ป้ายห้อยลงด้านหน้าฐาน
      if (s < 0) this.label('pump1', new THREE.Vector3(xp + 0.55, sY + 0.5, z), false, 44);
      else this.label('pump2', new THREE.Vector3(xp + 0.3, 0.05, z + 0.5), true, 10);
    });

    // 4) ท่อจ่ายหลัก → โรงงาน + ถังแรงดัน + เกจ
    const xOut = xd + 3.2;
    this.pipe('main', [new THREE.Vector3(xd, DIS_Y, 0), new THREE.Vector3(xOut, DIS_Y, 0)], PIPE_R * 1.15);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 24), this.matStd('#0ea5e9', '#0284c7', 0.6));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(xOut + 0.2, DIS_Y, 0);
    this.add(arrow);

    const xVes = xd + 1.6, zVes = 1.25;
    this.pipe('vessel', [new THREE.Vector3(xVes, DIS_Y, 0), new THREE.Vector3(xVes, DIS_Y, zVes), new THREE.Vector3(xVes, 1.38, zVes)], PIPE_R * 0.6);
    this.pressureVessel(xVes, zVes);

    const xG = xd + 0.7;
    this.pipe('gauge', [new THREE.Vector3(xG, DIS_Y, 0), new THREE.Vector3(xG, DIS_Y + 0.42, 0)], 0.028, false);
    this.gauge(new THREE.Vector3(xG, DIS_Y + 0.62, 0));
    this.pressureSwitch(new THREE.Vector3(xG + 0.55, DIS_Y, 0));
    this.label('pressure', new THREE.Vector3(xG, DIS_Y + 0.82, 0), false, 18, 'right');

    // 5) พื้นห้องปั๊ม (epoxy) + เส้นความปลอดภัย + ตู้ควบคุม
    const padX0 = xw + WALL + 0.15, padX1 = xOut - 0.3, padZ0 = -3.6, padZ1 = 2.4;
    this.box(padX1 - padX0, 0.04, padZ1 - padZ0, this.M.epoxy, (padX0 + padX1) / 2, 0.02, (padZ0 + padZ1) / 2);
    const lw = 0.07;
    this.box(padX1 - padX0, 0.045, lw, this.M.safety, (padX0 + padX1) / 2, 0.022, padZ0 + lw / 2);
    this.box(padX1 - padX0, 0.045, lw, this.M.safety, (padX0 + padX1) / 2, 0.022, padZ1 - lw / 2);
    this.box(lw, 0.045, padZ1 - padZ0, this.M.safety, padX0 + lw / 2, 0.022, (padZ0 + padZ1) / 2);
    this.box(lw, 0.045, padZ1 - padZ0, this.M.safety, padX1 - lw / 2, 0.022, (padZ0 + padZ1) / 2);
    this.cabinet(new THREE.Vector3(xh + 0.05, 0.04, -2.9));

    // เซนเซอร์ระดับน้ำ (อัลตราโซนิก) บนคานพาดขวางบ่อที่ติดตั้ง
    this.sensorTank = cfg.sensor_tank === 2 ? 1 : 0;
    const st = this.tanks[this.sensorTank];
    const scx = this.sensorTank === 0 ? x1 : x2, sL = this.sensorTank === 0 ? L1 : L2, sW = this.sensorTank === 0 ? W1 : W2;
    this.levelSensor(scx + sL * 0.22, st.floorY + st.heightM, sW);
    this.limitLine(scx, sL, sW, st.floorY);

    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent || m instanceof THREE.InstancedMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });

    this.bounds.setFromObject(this.root);
    // อาคารด้านหลัง (ไม่นับรวมใน bounds สำหรับจัดกล้อง)
    this.facade(this.bounds.min.x - 6, this.bounds.max.x + 6, this.bounds.min.z - 7);
    this.root.children[this.root.children.length - 1].traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const ctr = this.bounds.getCenter(new THREE.Vector3());
    this.sun.target.position.copy(ctr);
    this.sun.position.set(ctr.x - 8, 20, ctr.z + 14);
    const sc = this.sun.shadow.camera;
    const half = this.bounds.getSize(new THREE.Vector3()).x / 2 + 3;
    sc.left = -half; sc.right = half; sc.top = 16; sc.bottom = -16; sc.far = 80;
    sc.updateProjectionMatrix();
    this.placeSpot();
    this.fitHome(fitCamera || !this.userMoved);
  }

  /** มุมกล้องเริ่มต้น: มองจากด้านหน้า ยกสูงเล็กน้อย ให้เห็นทั้งความกว้างของระบบตามสัดส่วนจอปัจจุบัน */
  private fitHome(apply: boolean) {
    if (this.bounds.isEmpty()) return;
    const ctr = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.6, this.camera.aspect);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const distW = (size.x / 2) / Math.tan(hfov / 2);
    const distH = (size.z * 0.6 + 2.5) / Math.tan(vfov / 2);
    const dist = Math.max(distW, distH) * 1.02 + size.z / 2;
    this.homeDist = dist;
    // ซูมออกได้ไม่เกินมุมเริ่มต้น (ซูมเข้าได้ตามปกติ)
    this.controls.maxDistance = dist + 0.05;
    const dir = new THREE.Vector3(0, 0.62, 1).normalize();
    this.home.target.set(ctr.x, 0.9, ctr.z + 0.3);
    this.home.pos.copy(this.home.target).addScaledVector(dir, dist);
    if (apply) {
      this.camera.position.copy(this.home.pos);
      this.controls.target.copy(this.home.target);
      this.controls.update();
    }
  }

  /** บ่อใสเปิดด้านบน (ผนังกระจก + โครงเสา/คานสแตนเลส) + น้ำ + ไม้วัดระดับ + ป้ายข้อมูลด้านหน้า — W = ขนาดตามแกน X, L = ขนาดตามแกน Z */
  private basin(cx: number, floorY: number, W: number, L: number, H: number, idx: number): TankRig {
    const g = this.add(new THREE.Group());
    const outW = W + WALL * 2, outL = L + WALL * 2;
    // ฐานรองใต้บ่อที่ยกสูง + ฐานบ่อ (สแตนเลสเข้ม)
    if (floorY > 0.01) this.box(outW, floorY, outL, this.M.darkSteel, cx, floorY / 2, 0, g);
    this.box(outW, 0.2, outL, this.M.darkSteel, cx, floorY - 0.1 + 0.001, 0, g);
    // ผนังกระจก 4 ด้าน (กึ่งกลางแนวโครง)
    const gx = W / 2 + WALL / 2, gz = L / 2 + WALL / 2, gt = 0.03;
    const pane = (w: number, d: number, x: number, z: number) => {
      const m = this.box(w, H, d, this.M.pondGlass, x, floorY + H / 2, z, g);
      m.renderOrder = 2;
    };
    pane(gt, L + WALL, cx - gx, 0);
    pane(gt, L + WALL, cx + gx, 0);
    pane(W + WALL, gt, cx, -gz);
    pane(W + WALL, gt, cx, gz);
    // เสามุม + คานบน/กลาง/ล่าง (สแตนเลส)
    const p = 0.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(p, H + p, p, this.M.steel, cx + sx * gx, floorY + H / 2, sz * gz, g);
    for (const [y, t] of [[floorY + 0.04, p], [floorY + H / 2, p * 0.5], [floorY + H, p]] as const) {
      for (const sz of [-1, 1]) this.box(W + WALL, t, t, this.M.steel, cx, y, sz * gz, g);
      for (const sx of [-1, 1]) this.box(t, t, L + WALL, this.M.steel, cx + sx * gx, y, 0, g);
    }
    // เสากลางเพิ่มตามความยาว (ทุก ~2.5 ม.)
    const nx = Math.max(0, Math.round((W + WALL) / 2.5) - 1);
    for (let k = 1; k <= nx; k++) {
      const x = cx - gx + ((2 * gx) * k) / (nx + 1);
      for (const sz of [-1, 1]) this.box(p * 0.6, H, p * 0.6, this.M.steel, x, floorY + H / 2, sz * gz, g);
    }
    // พื้นในบ่อสีเข้ม (ให้น้ำดูมีความลึก)
    this.box(W, 0.02, L, this.matStd('#1e293b'), cx, floorY + 0.01, 0, g);

    // ไม้วัดระดับบนผนังด้านหลัง (หันเข้าหากล้อง)
    const tex = this.canvasTex(96, 768);
    this.drawStaff(tex, H);
    const staff = new THREE.Mesh(new THREE.PlaneGeometry(0.16, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    staff.position.set(cx - W / 2 + 0.35, floorY + H / 2, -L / 2 + 0.005);
    g.add(staff);

    // ป้ายข้อมูลบ่อ: ตัวอักษรติดบนกระจกด้านหน้า (ไม่มีพื้นหลัง)
    const pw = Math.min(W * 0.62, 5.2);
    const ph = Math.min(pw * 0.36, H * 0.8);
    const plate = this.canvasTex(1024, Math.round((1024 * ph) / pw));
    const plateMat = new THREE.MeshStandardMaterial({ map: plate, transparent: true, roughness: 0.9, depthWrite: false });
    const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), plateMat);
    plateMesh.position.set(cx, floorY + H - ph / 2 - 0.14, gz + p / 2 + 0.012); // หน้าคานสแตนเลส
    plateMesh.receiveShadow = true;
    plateMesh.renderOrder = 4; // วาดหลังน้ำ/กระจก ไม่ให้ถูกบัง
    g.add(plateMesh);

    // น้ำ (โทนน้ำทะเล): ไล่สีตามความลึก — ก้นบ่อเขียวครามเข้ม → ผิวน้ำฟ้าอมเขียว
    const bg = new THREE.BoxGeometry(W - 0.01, 1, L - 0.01);
    const deep = new THREE.Color('#021c2e'), shallow = new THREE.Color('#0a5f78');
    const bp = bg.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(bp.count * 3);
    const tmpC = new THREE.Color();
    for (let k = 0; k < bp.count; k++) {
      tmpC.copy(deep).lerp(shallow, bp.getY(k) + 0.5);
      cols.set([tmpC.r, tmpC.g, tmpC.b], k * 3);
    }
    bg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    // toneMapped: false — ให้สีน้ำตรงตามที่กำหนด (ACES ทำให้น้ำเงินเพี้ยนไปทางม่วง)
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.86, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, envMapIntensity: 0.1, specularIntensity: 0.2 });
    const body = new THREE.Mesh(bg, bodyMat);
    body.renderOrder = 1;
    body.position.set(cx, floorY, 0);
    body.scale.y = 0.0001;
    g.add(body);

    // แสงคอสติกบนพื้นบ่อ (2 ชั้น เลื่อนสวนทางกัน)
    const caustics: THREE.Mesh[] = [];
    [0, 1].forEach((k) => {
      const tex = this.causticTexture();
      tex.repeat.set(W / (k ? 1.7 : 2.6), L / (k ? 1.7 : 2.6));
      const cm = new THREE.Mesh(
        new THREE.PlaneGeometry(W - 0.02, L - 0.02),
        new THREE.MeshBasicMaterial({ map: tex, color: k ? '#2dd4bf' : '#67e8f9', transparent: true, opacity: k ? 0.25 : 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      );
      cm.rotation.x = -Math.PI / 2;
      cm.position.set(cx, floorY + 0.025 + k * 0.004, 0);
      cm.renderOrder = 0;
      g.add(cm);
      caustics.push(cm);
    });

    // ผิวน้ำ: โปร่งแสงพอให้เห็นฟองและความลึก
    const sg = new THREE.PlaneGeometry(W - 0.01, L - 0.01, Math.max(10, Math.round(18 * (W / L))), 18);
    sg.rotateX(-Math.PI / 2);
    const surfMat = new THREE.MeshPhysicalMaterial({ color: '#0b6f8a', transparent: true, opacity: 0.7, roughness: 0.06, metalness: 0, specularIntensity: 0.8, envMapIntensity: 0.45, toneMapped: false, depthWrite: false });
    const surface = new THREE.Mesh(sg, surfMat);
    surface.renderOrder = 3;
    surface.position.set(cx, floorY, 0);
    surface.visible = false;
    g.add(surface);

    // ฟองคลื่นขาวเลียบผนังที่ผิวน้ำ
    const foam = new THREE.Group();
    const fm = this.M.foam;
    const fw = 0.12;
    [
      [W, fw, 0, -L / 2 + fw / 2],
      [W, fw, 0, L / 2 - fw / 2],
      [fw, L, -W / 2 + fw / 2, 0],
      [fw, L, W / 2 - fw / 2, 0],
    ].forEach(([sx, sz, ox, oz]) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), fm);
      f.rotation.x = -Math.PI / 2;
      f.position.set(ox, 0.012, oz);
      f.renderOrder = 4;
      foam.add(f);
    });
    foam.position.set(cx, floorY, 0);
    foam.visible = false;
    g.add(foam);

    // ฟองอากาศลอยขึ้น
    const nb = Math.round(Math.max(36, Math.min(150, W * L * 3)));
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.M.bubble, nb);
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 2;
    bubbles.count = 0;
    g.add(bubbles);
    const bub = Array.from({ length: nb }, () => ({
      x: (Math.random() - 0.5) * (W - 0.3),
      z: (Math.random() - 0.5) * (L - 0.3),
      y: Math.random(),
      v: 0.12 + Math.random() * 0.25,
      ph: Math.random() * Math.PI * 2,
      s: 0.012 + Math.random() * 0.03,
    }));

    return {
      body, surface, bodyMat, surfMat, floorY, heightM: H, level: 0, goal: 0, plate, plateKey: '', idx,
      dims: `${W.toFixed(1)} × ${L.toFixed(1)} × ${H.toFixed(1)} m`,
      cx, W, L, caustics, foam, bubbles, bub, inlet: null,
    };
  }

  private causticTexture() {
    if (!this.causticTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.shadowColor = '#ffffff';
      g.shadowBlur = 6;
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * 256, y = rnd() * 256, rx = 14 + rnd() * 26, ry = 10 + rnd() * 22;
        g.lineWidth = 1.2 + rnd() * 2.2;
        for (const dx of [-256, 0, 256])
          for (const dy of [-256, 0, 256]) {
            g.beginPath();
            g.ellipse(x + dx, y + dy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
            g.stroke();
          }
      }
      this.causticTex = new THREE.CanvasTexture(c);
      this.causticTex.wrapS = this.causticTex.wrapT = THREE.RepeatWrapping;
    }
    const t = this.causticTex.clone();
    t.needsUpdate = true;
    return t;
  }
  private causticTex: THREE.CanvasTexture | null = null;

  /* ---------- สายน้ำเติมลงบ่อ: ไหลออกจากปากท่อ → ตกกระทบผิวน้ำ (ละอองกระเซ็น + วงคลื่น) ---------- */
  private pour: {
    x: number; z: number; top: number;
    stream: THREE.Mesh; tex: THREE.Texture;
    head: number; tail: number; vHead: number; vTail: number; hit: boolean;
    drops: THREE.InstancedMesh; dd: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[];
    rings: THREE.Mesh[];
  } | null = null;

  private buildPour(x: number, top: number, z: number) {
    const geo = new THREE.CylinderGeometry(0.07, 0.095, 1, 20, 1, true);
    geo.translate(0, -0.5, 0); // จุดยึดอยู่ที่ปากท่อ ยืดลงด้านล่าง
    const tex = this.flowTexture();
    tex.repeat.set(1, 3);
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: '#d7eef3', emissive: '#bfe6ee', emissiveIntensity: 0.12, transparent: true, opacity: 0.62, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const stream = new THREE.Mesh(geo, mat);
    stream.position.set(x, top, z);
    stream.visible = false;
    stream.renderOrder = 5;
    this.add(stream);
    const n = 46;
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), this.M.drop, n);
    drops.frustumCulled = false;
    drops.count = 0;
    drops.renderOrder = 5;
    this.add(drops);
    const dd = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
    const rings = [0, 1, 2].map(() => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), this.M.ring.clone());
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      r.renderOrder = 5;
      this.add(r);
      return r;
    });
    this.pour = { x, z, top, stream, tex, head: 0, tail: 0, vHead: 0, vTail: 0, hit: false, drops, dd, rings };
  }

  /** อัปเดตแอนิเมชันสายน้ำ: เปิดวาล์ว = หัวน้ำตกลงด้วยแรงโน้มถ่วง · ปิดวาล์ว = ท้ายสายน้ำตกตามลงไปจนหมด */
  private updatePour(dt: number, t: number, on: boolean) {
    const p = this.pour;
    if (!p) return;
    const tk = this.tanks[0];
    const surfY = tk.floorY + Math.max(0, Math.min(tk.heightM, tk.level));
    const fall = Math.max(0.05, p.top - surfY);
    const G = 9.8;
    if (on) {
      if (p.tail > 0 && p.tail >= p.head - 0.01) { p.head = p.tail = 0; p.vHead = p.vTail = 0; }
      p.tail = 0; p.vTail = 0;
      p.vHead += G * dt;
      p.head = Math.min(fall, p.head + p.vHead * dt);
    } else if (p.head > 0) {
      p.vTail += G * dt;
      p.tail = Math.min(p.head, p.tail + p.vTail * dt);
      if (p.head < fall) { p.vHead += G * dt; p.head = Math.min(fall, p.head + p.vHead * dt); }
      if (p.tail >= p.head - 0.005) { p.head = p.tail = 0; p.vHead = p.vTail = 0; }
    }
    const len = p.head - p.tail;
    p.stream.visible = len > 0.01;
    if (p.stream.visible) {
      p.stream.position.y = p.top - p.tail;
      p.stream.scale.set(1 + Math.sin(t * 23) * 0.05, len, 1 + Math.cos(t * 19) * 0.05);
      p.tex.offset.y += dt * 2.4;
    }
    p.hit = len > 0.01 && p.head >= fall - 0.01;

    // ละอองกระเซ็นที่จุดตกกระทบ
    const n = p.dd.length;
    let alive = 0;
    for (let k = 0; k < n; k++) {
      const d = p.dd[k];
      if (d.life <= 0 && p.hit && Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2, sp = 0.35 + Math.random() * 0.7;
        Object.assign(d, { x: p.x, y: surfY + 0.02, z: p.z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.9 + Math.random() * 1.3, life: 1 });
      }
      if (d.life > 0) {
        d.vy -= G * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.life -= dt * 1.8;
        if (d.y < surfY) d.life = 0;
      }
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.scale.setScalar(d.life > 0 ? 0.018 + 0.016 * d.life : 0.0001);
      this.dummy.updateMatrix();
      p.drops.setMatrixAt(k, this.dummy.matrix);
      if (d.life > 0) alive++;
    }
    p.drops.count = alive > 0 || p.hit ? n : 0;
    p.drops.instanceMatrix.needsUpdate = true;

    // วงคลื่นขยายออกจากจุดตก
    p.rings.forEach((r, i) => {
      r.visible = p.hit;
      if (!p.hit) return;
      const ph = (t * 0.9 + i / p.rings.length) % 1;
      r.position.set(p.x, surfY + 0.03, p.z);
      r.scale.setScalar(0.12 + ph * 0.9);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ph);
    });
  }

  /** วาดป้ายบ่อ: ไอคอนหยดน้ำ, ชื่อ + ขนาดบ่อ, ค่าหลัก, ค่ารอง, วงแหวน %, สถานะเซนเซอร์ */
  private drawPlate(tk: TankRig, p: { title: string; big: string; unit: string; sub: string; pct: number; tone: string; tone2: string; foot: string; footOk: boolean }) {
    const key = JSON.stringify(p);
    if (key === tk.plateKey) return;
    tk.plateKey = key;
    const c = tk.plate.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const font = '"Noto Sans Thai", "Segoe UI", sans-serif';
    const pad = H * 0.11;
    g.clearRect(0, 0, W, H);

    // แผ่นป้ายอะคริลิกขาวขุ่นติดบนกระจกด้านหน้า (ให้อ่านง่ายเมื่อมีน้ำอยู่ด้านหลัง)
    const rr = H * 0.08;
    g.fillStyle = 'rgba(248,250,252,0.9)';
    g.beginPath();
    g.roundRect(H * 0.02, H * 0.02, W - H * 0.04, H - H * 0.04, rr);
    g.fill();
    g.strokeStyle = 'rgba(148,163,184,0.7)';
    g.lineWidth = H * 0.012;
    g.stroke();
    g.shadowColor = 'transparent';

    // ไอคอนหยดน้ำ
    const ir = H * 0.12, ix = pad + ir, iy = pad + ir;
    g.strokeStyle = p.tone;
    g.lineWidth = H * 0.018;
    g.beginPath();
    g.arc(ix, iy, ir, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = p.tone;
    g.beginPath();
    g.moveTo(ix, iy - ir * 0.62);
    g.bezierCurveTo(ix + ir * 0.55, iy - ir * 0.05, ix + ir * 0.45, iy + ir * 0.55, ix, iy + ir * 0.55);
    g.bezierCurveTo(ix - ir * 0.45, iy + ir * 0.55, ix - ir * 0.55, iy - ir * 0.05, ix, iy - ir * 0.62);
    g.fill();

    // ชื่อ + ขนาด
    const tx = ix + ir + H * 0.06;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#0f172a';
    g.font = `800 ${Math.round(H * 0.13)}px ${font}`;
    g.fillText(p.title, tx, iy - H * 0.005);
    g.fillStyle = '#334155';
    g.font = `600 ${Math.round(H * 0.08)}px ${font}`;
    g.fillText(tk.dims, tx, iy + H * 0.095);

    // วงแหวน %
    const R = H * 0.33, rx = W - pad - R, ry = H * 0.5;
    g.lineCap = 'round';
    g.lineWidth = H * 0.075;
    g.strokeStyle = 'rgba(15,23,42,0.16)';
    g.beginPath();
    g.arc(rx, ry, R - g.lineWidth / 2, 0, Math.PI * 2);
    g.stroke();
    const pc = Math.max(0, Math.min(100, p.pct));
    const ring = g.createLinearGradient(rx - R, ry - R, rx + R, ry + R);
    ring.addColorStop(0, p.tone);
    ring.addColorStop(1, p.tone2);
    g.strokeStyle = ring;
    g.beginPath();
    g.arc(rx, ry, R - g.lineWidth / 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pc) / 100);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#0f172a';
    g.font = `800 ${Math.round(H * 0.125)}px ${font}`;
    g.fillText(`${pc.toFixed(pc >= 99.95 ? 0 : 1)}%`, rx, ry + H * 0.03);
    g.fillStyle = '#475569';
    g.font = `600 ${Math.round(H * 0.065)}px ${font}`;
    g.fillText(this.tr('water_supply.scene3d.scene.level'), rx, ry + H * 0.12);
    g.textAlign = 'left';

    // ค่าหลัก + หน่วย
    const maxW = rx - R - pad - H * 0.08 - pad;
    let fs = Math.round(H * 0.27);
    g.font = `800 ${fs}px ${font}`;
    while (fs > 20 && g.measureText(p.big).width > maxW * 0.8) g.font = `800 ${--fs}px ${font}`;
    const by = H * 0.72;
    g.fillStyle = '#0f172a';
    g.fillText(p.big, pad, by);
    const bw = g.measureText(p.big).width;
    g.fillStyle = p.tone;
    g.font = `700 ${Math.round(H * 0.1)}px ${font}`;
    g.fillText(p.unit, pad + bw + H * 0.04, by);
    g.fillStyle = '#1e293b';
    g.font = `700 ${Math.round(H * 0.08)}px ${font}`;
    g.fillText(p.sub, pad + bw + H * 0.04, by - H * 0.12);

    // แถบสถานะเซนเซอร์ (เฉพาะบ่อที่ติดเซนเซอร์)
    if (p.foot) {
      let ff = Math.round(H * 0.08);
      g.font = `600 ${ff}px ${font}`;
      while (ff > 12 && g.measureText(p.foot).width > maxW - H * 0.12) g.font = `600 ${--ff}px ${font}`;
      const fw = g.measureText(p.foot).width + H * 0.14, fh = H * 0.12, fy = H - pad * 0.55 - fh;
      void fw;
      g.fillStyle = p.footOk ? '#059669' : '#dc2626';
      g.beginPath();
      g.arc(pad + fh / 2, fy + fh / 2, fh * 0.18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.footOk ? '#065f46' : '#991b1b';
      g.textBaseline = 'middle';
      g.fillText(p.foot, pad + fh * 0.95, fy + fh / 2 + 1);
      g.textBaseline = 'alphabetic';
    }
    g.shadowColor = 'transparent';
    tk.plate.needsUpdate = true;
  }

  private drawStaff(tex: THREE.CanvasTexture, H: number) {
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, c.width, c.height);
    const cm = H * 100;
    const step = cm > 250 ? 20 : 10;
    for (let v = 0; v <= cm; v += step) {
      const y = c.height - (v / cm) * c.height;
      const major = v % (step * 5) === 0;
      g.fillStyle = major ? '#dc2626' : '#0f172a';
      g.fillRect(0, y - 2, major ? c.width : c.width * 0.45, major ? 5 : 3);
      if (major && v > 0 && v < cm) {
        g.font = 'bold 22px sans-serif';
        g.fillText(String(v), c.width * 0.5, y + 22);
      }
    }
    tex.needsUpdate = true;
  }

  private ladder(x: number, floorY: number, H: number, z: number, right = false) {
    const g = this.add(new THREE.Group());
    const dx = right ? 0.06 : -0.06;
    const top = floorY + H + 0.9;
    [-0.22, 0.22].forEach((dz) => {
      this.cyl(0.022, top, 'y', this.M.steel, { x: x + dx, y: top / 2, z: z + dz }, g, 12);
    });
    for (let y = 0.3; y < top - 0.2; y += 0.3) this.cyl(0.015, 0.44, 'z', this.M.steel, { x: x + dx, y, z }, g, 10);
    // ราวจับโค้งบนขอบบ่อ
    [-0.22, 0.22].forEach((dz) => {
      this.cyl(0.022, 0.35, 'x', this.M.steel, { x: x + dx - Math.sign(dx) * 0.17, y: top, z: z + dz }, g, 12);
    });
  }

  private valve(c: THREE.Vector3) {
    this.cyl(PIPE_R * 1.65, 0.22, 'x', this.M.darkSteel, c);
    this.flange(c.clone().add(new THREE.Vector3(-0.14, 0, 0)), 'x');
    this.flange(c.clone().add(new THREE.Vector3(0.14, 0, 0)), 'x');
    this.cyl(0.03, 0.16, 'y', this.M.steel, { x: c.x, y: c.y + 0.2, z: c.z });
    const act = this.box(0.34, 0.24, 0.26, this.matStd('#2563eb'), c.x, c.y + 0.4, c.z);
    act.castShadow = true;
    this.valveLed = this.matStd('#334155', '#000000', 0);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), this.valveLed);
    led.position.set(c.x + 0.1, c.y + 0.4, c.z + 0.135);
    this.add(led);
    // ธงบอกตำแหน่งวาล์ว: ขนานท่อ = เปิด, ขวางท่อ = ปิด
    const flag = new THREE.Group();
    flag.position.set(c.x, c.y + 0.56, c.z);
    this.box(0.3, 0.035, 0.07, this.matStd('#fbbf24'), 0, 0, 0, flag);
    this.add(flag);
    this.valveFlag = flag;
  }

  private flowMeter(c: THREE.Vector3) {
    this.cyl(PIPE_R * 1.55, 0.46, 'x', this.matStd('#0f766e'), c);
    this.flange(c.clone().add(new THREE.Vector3(-0.25, 0, 0)), 'x');
    this.flange(c.clone().add(new THREE.Vector3(0.25, 0, 0)), 'x');
    this.cyl(0.035, 0.16, 'y', this.M.steel, { x: c.x, y: c.y + 0.2, z: c.z });
    this.cyl(0.13, 0.12, 'z', this.M.cabinet, { x: c.x, y: c.y + 0.36, z: c.z });
    this.flowMeterLcd = this.matStd('#0b1220', '#22d3ee', 0.2);
    const lcd = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), this.flowMeterLcd);
    lcd.position.set(c.x, c.y + 0.36, c.z + 0.062);
    this.add(lcd);
  }

  private pumpUnit(xp: number, y: number, z: number, i: number) {
    const s = new THREE.Group();
    this.add(s);
    // ฐานคอนกรีต + แท่นเหล็ก
    this.box(2.2, 0.16, 0.85, this.M.concreteTop, xp, 0.08, z, s);
    this.box(2.0, 0.1, 0.6, this.M.darkSteel, xp, 0.21, z, s);
    // Volute (ตัวเรือนปั๊ม)
    const vx = xp - 0.55;
    this.cyl(0.36, 0.3, 'x', this.M.paint, { x: vx, y, z }, s, 36);
    this.cyl(0.25, 0.05, 'x', this.M.steel, { x: vx - 0.17, y, z }, s);
    this.cyl(PIPE_R * 1.25, 0.2, 'x', this.M.paint, { x: xp - 0.8, y, z }, s); // suction nozzle
    this.cyl(PIPE_R * 1.2, 0.2, 'y', this.M.paint, { x: vx, y: y + 0.42, z }, s); // discharge nozzle
    this.box(0.16, y - 0.26, 0.4, this.M.paint, vx, 0.26 + (y - 0.26) / 2 - 0.02, z, s); // volute foot
    // Bearing frame + coupling guard
    this.cyl(0.13, 0.32, 'x', this.M.paint, { x: xp - 0.22, y, z }, s);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    guard.rotation.z = -Math.PI / 2;
    guard.position.set(xp + 0.02, y, z);
    s.add(guard);
    const coupling = new THREE.Group();
    coupling.position.set(xp + 0.02, y, z);
    this.cyl(0.11, 0.12, 'x', this.M.steel, { x: 0, y: 0, z: 0 }, coupling, 20);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      this.box(0.14, 0.035, 0.035, this.M.black, 0, Math.cos(a) * 0.1, Math.sin(a) * 0.1, coupling);
    }
    s.add(coupling);
    // มอเตอร์ + ครีบระบายความร้อน
    const mx = xp + 0.55;
    this.cyl(0.29, 0.62, 'x', this.M.motor, { x: mx, y, z }, s, 36);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const fin = this.box(0.6, 0.06, 0.025, this.M.motor, mx, y + Math.cos(a) * 0.3, z + Math.sin(a) * 0.3, s);
      fin.rotation.x = a;
    }
    this.box(0.62, y - 0.28, 0.12, this.M.motor, mx, 0.26 + (y - 0.28) / 2, z - 0.18, s);
    this.box(0.62, y - 0.28, 0.12, this.M.motor, mx, 0.26 + (y - 0.28) / 2, z + 0.18, s);
    this.box(0.24, 0.16, 0.24, this.M.motor, mx - 0.08, y + 0.36, z, s); // terminal box
    this.cyl(0.29, 0.18, 'x', this.M.darkSteel, { x: xp + 0.95, y, z }, s, 36, 0.24); // fan cowl
    const fan = new THREE.Group();
    fan.position.set(xp + 1.055, y, z);
    for (let k = 0; k < 6; k++) {
      const b = this.box(0.012, 0.2, 0.06, this.M.black, 0, 0, 0, fan);
      b.rotation.x = (k / 6) * Math.PI * 2;
      b.translateY(0.1);
      b.rotation.y = 0.35;
    }
    this.cyl(0.04, 0.03, 'x', this.M.steel, { x: 0, y: 0, z: 0 }, fan);
    s.add(fan);
    // แหวนไฟสถานะรอบมอเตอร์
    const ring = new THREE.MeshStandardMaterial({ color: '#0f172a', emissive: COLORS.stop, emissiveIntensity: 0.4, roughness: 0.4 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.026, 12, 48), ring);
    torus.rotation.y = Math.PI / 2;
    torus.position.set(xp + 0.26, y, z);
    s.add(torus);
    // ป้ายชื่อปั๊ม P1/P2 บน terminal box
    const tag = this.canvasTex(128, 64);
    const g = (tag.image as HTMLCanvasElement).getContext('2d')!;
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#0f172a';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`P${i + 1}`, 64, 34);
    tag.needsUpdate = true;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshStandardMaterial({ map: tag, roughness: 0.5 }));
    plate.position.set(mx - 0.08, y + 0.36, z + 0.122);
    s.add(plate);

    const led = this.matStd('#334155');
    this.pumps[i] = { ring, rotors: [coupling, fan], omega: 0, state: 'stop', freq: 0, led };
  }

  private pressureVessel(x: number, z: number) {
    const r = 0.36;
    this.cyl(r, 0.7, 'y', this.M.vessel, { x, y: 0.62, z }, undefined, 32);
    const top = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.M.vessel);
    top.position.set(x, 0.97, z);
    top.scale.y = 0.75;
    this.add(top);
    const bot = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.M.vessel);
    bot.position.set(x, 0.27, z);
    bot.scale.y = 0.6;
    this.add(bot);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      this.cyl(0.025, 0.3, 'y', this.M.darkSteel, { x: x + Math.cos(a) * 0.26, y: 0.15, z: z + Math.sin(a) * 0.26 });
    }
    this.cyl(0.05, 0.12, 'y', this.M.steel, { x, y: 1.3, z });
  }

  private gauge(c: THREE.Vector3) {
    this.cyl(0.18, 0.07, 'z', this.M.steel, c, undefined, 36);
    this.gaugeTex = this.canvasTex(256, 256);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.165, 40), new THREE.MeshStandardMaterial({ map: this.gaugeTex, roughness: 0.3 }));
    face.position.set(c.x, c.y, c.z + 0.037);
    this.add(face);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0, clearcoat: 1 }));
    glass.position.set(c.x, c.y, c.z + 0.05);
    this.add(glass);
    const n = new THREE.Group();
    n.position.set(c.x, c.y, c.z + 0.042);
    const needle = this.box(0.13, 0.008, 0.004, this.matStd('#dc2626'), 0.055, 0, 0, n);
    needle.castShadow = false;
    this.cyl(0.012, 0.01, 'z', this.M.black, { x: 0, y: 0, z: 0.003 }, n, 12);
    this.add(n);
    this.needle = n;
    this.drawGauge(0);
  }

  private gaugeAngle(bar: number) {
    const p = Math.max(0, Math.min(GAUGE_MAX_BAR, bar)) / GAUGE_MAX_BAR;
    return THREE.MathUtils.degToRad(225 - 270 * p);
  }

  private drawGauge(setBar: number) {
    if (!this.gaugeTex) return;
    const c = this.gaugeTex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const cx = 128, cy = 128;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    // โซนเขียวรอบค่า set
    if (setBar > 0) {
      g.strokeStyle = 'rgba(34,197,94,0.55)';
      g.lineWidth = 14;
      g.beginPath();
      const a0 = this.gaugeAngle(setBar * 0.9), a1 = this.gaugeAngle(setBar * 1.1);
      g.arc(cx, cy, 98, -a0, -a1);
      g.stroke();
    }
    g.strokeStyle = '#0f172a';
    g.fillStyle = '#0f172a';
    for (let v = 0; v <= GAUGE_MAX_BAR * 5; v++) {
      const a = this.gaugeAngle(v / 5);
      const major = v % 5 === 0;
      const r0 = major ? 86 : 94, r1 = 106;
      g.lineWidth = major ? 4 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy - Math.sin(a) * r1);
      g.stroke();
      if (major) {
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(v / 5), cx + Math.cos(a) * 66, cy - Math.sin(a) * 66);
      }
    }
    if (setBar > 0) {
      const a = this.gaugeAngle(setBar);
      g.strokeStyle = '#dc2626';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 80, cy - Math.sin(a) * 80);
      g.lineTo(cx + Math.cos(a) * 110, cy - Math.sin(a) * 110);
      g.stroke();
    }
    g.font = 'bold 20px sans-serif';
    g.fillStyle = '#475569';
    g.textAlign = 'center';
    g.fillText('bar', cx, cy + 52);
    this.gaugeTex.needsUpdate = true;
  }

  private pressureSwitch(c: THREE.Vector3) {
    this.cyl(0.02, 0.22, 'y', this.M.steel, { x: c.x, y: c.y + 0.11, z: c.z });
    this.box(0.16, 0.2, 0.12, this.matStd('#e2e8f0'), c.x, c.y + 0.32, c.z);
    this.psLed = this.matStd('#334155');
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), this.psLed);
    led.position.set(c.x, c.y + 0.36, c.z + 0.062);
    this.add(led);
  }

  private cabinet(base: THREE.Vector3) {
    const W = 1.15, H = 1.85, D = 0.45;
    this.box(W + 0.1, 0.1, D + 0.1, this.M.darkSteel, base.x, base.y + 0.05, base.z);
    this.box(W, H, D, this.M.cabinet, base.x, base.y + 0.1 + H / 2, base.z);
    this.box(W - 0.06, H - 0.06, 0.02, this.matStd('#f1f5f9'), base.x, base.y + 0.1 + H / 2, base.z + D / 2 + 0.01);
    this.box(0.03, 0.22, 0.04, this.M.darkSteel, base.x + W / 2 - 0.1, base.y + 1.0, base.z + D / 2 + 0.03); // handle
    // จอ HMI
    this.hmiTex = this.canvasTex(512, 320);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.44), new THREE.MeshBasicMaterial({ map: this.hmiTex, toneMapped: false }));
    scr.position.set(base.x - 0.05, base.y + 1.42, base.z + D / 2 + 0.022);
    this.add(scr);
    this.box(0.76, 0.5, 0.015, this.M.black, base.x - 0.05, base.y + 1.42, base.z + D / 2 + 0.014);
    // ไฟแสดงสถานะ
    const names = ['power', 'p1', 'p2', 'alarm'];
    names.forEach((k, i) => {
      const m = this.matStd('#334155');
      this.pilot[k] = m;
      const x = base.x - 0.36 + i * 0.24;
      this.cyl(0.045, 0.04, 'z', m, { x, y: base.y + 0.98, z: base.z + D / 2 + 0.035 }, undefined, 20);
      this.cyl(0.06, 0.02, 'z', this.M.steel, { x, y: base.y + 0.98, z: base.z + D / 2 + 0.022 }, undefined, 20);
    });
    // ไฟหมุนสัญญาณ (tower light) + เสาอากาศ WiFi
    const tx = base.x + W / 2 - 0.15, tz = base.z, ty = base.y + 0.1 + H;
    this.cyl(0.05, 0.08, 'y', this.M.darkSteel, { x: tx, y: ty + 0.04, z: tz });
    this.beaconGreen = this.matStd('#14532d', '#22c55e', 0);
    this.beaconRed = this.matStd('#7f1d1d', '#ef4444', 0);
    const gm = this.cyl(0.055, 0.12, 'y', this.beaconGreen, { x: tx, y: ty + 0.14, z: tz });
    const rm = this.cyl(0.055, 0.12, 'y', this.beaconRed, { x: tx, y: ty + 0.26, z: tz });
    gm.castShadow = rm.castShadow = false;
    this.cyl(0.055, 0.03, 'y', this.M.darkSteel, { x: tx, y: ty + 0.335, z: tz });
    this.cyl(0.012, 0.4, 'y', this.M.black, { x: base.x - W / 2 + 0.12, y: ty + 0.2, z: tz });
    this.label('cabinet', new THREE.Vector3(base.x - 0.3, ty + 0.05, base.z), false, 18, 'left');
  }

  /** คานเหล็กพาดขวางบ่อ (แนวแกน Z) + เซนเซอร์อัลตราโซนิก ที่ตำแหน่ง x */
  private levelSensor(x: number, topY: number, spanZ: number) {
    const z = 0;
    this.box(0.1, 0.08, spanZ + WALL * 2 + 0.1, this.M.steel, x, topY + 0.1, z);
    this.cyl(0.07, 0.22, 'y', this.matStd('#e2e8f0'), { x, y: topY - 0.02, z });
    this.cyl(0.075, 0.04, 'y', this.M.darkSteel, { x, y: topY + 0.1, z });
    this.box(0.12, 0.1, 0.08, this.matStd('#e2e8f0'), x, topY + 0.2, z);
    this.sensorLed = this.matStd('#334155');
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), this.sensorLed);
    led.position.set(x, topY + 0.2, z + 0.045);
    this.add(led);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 32, 1, true), this.M.beam);
    cone.renderOrder = 3;
    cone.position.set(x, topY - 0.13, z);
    this.add(cone);
    this.beam = cone;
    this.beamTop = topY - 0.13;
  }

  private limitLine(cx: number, W: number, L: number, floorY: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-W / 2, 0, -L / 2),
      new THREE.Vector3(W / 2, 0, -L / 2),
      new THREE.Vector3(W / 2, 0, L / 2),
      new THREE.Vector3(-W / 2, 0, L / 2),
      new THREE.Vector3(-W / 2, 0, -L / 2),
    ]);
    const line = new THREE.Line(geo, this.M.limit);
    line.computeLineDistances();
    line.position.set(cx, floorY, 0);
    line.name = 'limit';
    line.visible = false;
    this.add(line);
  }

  /* ================= ข้อมูล → ฉาก ================= */
  /** ข้อความจาก locales (water_supply.scene3d.scene.*) ตามภาษาที่ฉากใช้อยู่ */
  private tr(key: string, opts?: Record<string, unknown>) {
    return i18n.t(key, { lng: this.lang.startsWith('en') ? 'en' : 'th', ...opts });
  }

  private pumpState(d: TankData, i: 1 | 2): PumpState {
    const p = i === 1 ? d.pump1 : d.pump2;
    const c = d.controls;
    const alarm = p.alarm || (i === 1 ? c.pump1_alarm || c.pump1_overload : c.pump2_alarm || c.pump2_overload);
    if (alarm) return 'alarm';
    const running = p.running || (i === 1 ? c.pump1_on : c.pump2_on);
    if (running) return 'run';
    if (c.is_sleeping) return 'sleep';
    if (!(i === 1 ? d.system.pump1_comm_ok : d.system.pump2_comm_ok) && !p.modbus_ok) return 'offline';
    return 'stop';
  }

  private applyData(s: SceneInput) {
    const d = s.data, c = d.controls, sys = d.system;
    const calc = s.tankCalculations ?? calculateTanks(d.water_level.level_cm, this.cfg);
    this.tanks[0].goal = calc.tank1.level_cm / 100;
    this.tanks[1].goal = calc.tank2.level_cm / 100;

    // เส้นระดับต่ำสุด (lower_limit_cm) ในบ่อที่มีเซนเซอร์
    const limit = this.root.getObjectByName('limit');
    if (limit) {
      const st = this.tanks[this.sensorTank];
      limit.visible = c.lower_limit_cm > 0 && c.lower_limit_cm / 100 < st.heightM;
      limit.position.y = st.floorY + c.lower_limit_cm / 100;
    }

    const st1 = this.pumpState(d, 1), st2 = this.pumpState(d, 2);
    const pumpsFlow = [st1 === 'run', st2 === 'run'];
    const freqs = [d.pump1.freq || (pumpsFlow[0] ? 50 : 0), d.pump2.freq || (pumpsFlow[1] ? 50 : 0)];
    [st1, st2].forEach((st, i) => {
      const p = this.pumps[i];
      if (!p) return;
      p.state = st;
      p.freq = st === 'run' ? freqs[i] : 0;
    });
    const anyPump = pumpsFlow[0] || pumpsFlow[1];
    const fSpeed = (f: number) => 0.35 + (Math.min(60, f) / 50) * 1.5;
    const avgF = anyPump ? (freqs[0] * +pumpsFlow[0] + freqs[1] * +pumpsFlow[1]) / (+pumpsFlow[0] + +pumpsFlow[1]) : 0;
    const set = (k: string, active: boolean, speed = 1) => {
      const r = this.runs[k];
      if (!r) return;
      r.active = active;
      r.speed = speed;
      // มีน้ำไหล = ท่อแก้วใส สะท้อนแสง + แกนน้ำสีฟ้าไหลด้านใน · ไม่มีน้ำ = ท่อเหล็กทึบ
      r.core.visible = active;
      r.mat.color.set(active ? '#eef6f8' : '#94a3b8');
      r.mat.metalness = active ? 0.0 : 0.75;
      r.mat.roughness = active ? 0.04 : 0.35;
      r.mat.opacity = active ? 0.26 : 1;
      r.mat.envMapIntensity = active ? 1.1 : 1;
      r.mat.emissive.set('#000000');
      r.mat.emissiveIntensity = 0;
      if (r.mat.transparent !== active) {
        r.mat.transparent = active;
        r.mat.depthWrite = !active;
        r.mat.needsUpdate = true;
      }
    };
    set('inlet', c.valve_on, 1.1);
    set('link', c.valve_on || anyPump, 0.6);
    set('suction', anyPump, fSpeed(avgF));
    set('suc1', pumpsFlow[0], fSpeed(freqs[0]));
    set('suc2', pumpsFlow[1], fSpeed(freqs[1]));
    set('dis1', pumpsFlow[0], fSpeed(freqs[0]));
    set('dis2', pumpsFlow[1], fSpeed(freqs[1]));
    set('main', anyPump, fSpeed(avgF));
    set('vessel', anyPump, 0.25);
    set('gauge', anyPump);

    if (this.valveLed) {
      this.valveLed.emissive.copy(c.valve_on ? COLORS.run : COLORS.offline);
      this.valveLed.emissiveIntensity = c.valve_on ? 2 : 0.2;
    }
    if (this.psLed) {
      this.psLed.emissive.copy(c.pressure_switch ? COLORS.run : COLORS.offline);
      this.psLed.emissiveIntensity = c.pressure_switch ? 2 : 0.2;
    }
    if (this.sensorLed) {
      this.sensorLed.emissive.copy(sys.level_comm_ok ? COLORS.run : COLORS.alarm);
      this.sensorLed.emissiveIntensity = 2;
    }
    this.M.beam.color.set(sys.level_comm_ok ? '#4ade80' : '#f87171');
    if (this.flowMeterLcd) this.flowMeterLcd.emissiveIntensity = sys.meter_comm_ok ? 0.9 : 0.05;
    const pl = (k: string, on: boolean, col: THREE.Color) => {
      const m = this.pilot[k];
      if (!m) return;
      m.emissive.copy(on ? col : COLORS.offline);
      m.emissiveIntensity = on ? 2.2 : 0.15;
    };
    pl('power', sys.uptime_sec > 0, COLORS.run);
    pl('p1', st1 === 'run', COLORS.run);
    pl('p2', st2 === 'run', COLORS.run);
    pl('alarm', c.alarm_on, COLORS.alarm);

    if (Math.abs(c.set_pressure - this.gaugeSet) > 1e-3) {
      this.gaugeSet = c.set_pressure;
      this.drawGauge(c.set_pressure);
    }
    this.drawHmi(s);
    this.updateLabels(s, calc, st1, st2);
  }

  private drawHmi(s: SceneInput) {
    if (!this.hmiTex) return;
    const d = s.data, c = d.controls;
    const row = (p: TankData['pump1'], st: PumpState) => `${st.toUpperCase().padEnd(6)} ${fmt(p.freq, 1).padStart(5)} Hz ${fmt(p.current, 1).padStart(5)} A`;
    const lines = [
      `P1  ${row(d.pump1, this.pumps[0]?.state ?? 'stop')}`,
      `P2  ${row(d.pump2, this.pumps[1]?.state ?? 'stop')}`,
      `PRESS ${fmt(c.pressure_bar, 2)} / SP ${fmt(c.set_pressure, 2)} bar`,
      `LEVEL ${fmt(d.water_level.level_cm, 0)} cm  ${fmt(d.water_level.level_pct, 1)} %`,
      `FLOW  ${fmt(d.water_level.flow_rate, 3)} m3/h`,
    ];
    const head = `${c.auto_mode ? 'AUTO' : 'MANUAL'}${c.is_sleeping ? ' · SLEEP' : ''}  PID ${fmt(c.pid_target_freq, 1)}Hz`;
    const foot = `${d.system.ip}  ${d.system.wifi_rssi} dBm`;
    const key = [head, ...lines, foot, c.alarm_on].join('|');
    if (key === this.hmiKey) return;
    this.hmiKey = key;
    const cv = this.hmiTex.image as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, cv.height);
    grd.addColorStop(0, '#0f172a');
    grd.addColorStop(1, '#020617');
    g.fillStyle = grd;
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = c.alarm_on ? '#b91c1c' : '#0e7490';
    g.fillRect(0, 0, cv.width, 46);
    g.fillStyle = '#f8fafc';
    g.font = 'bold 24px monospace';
    g.textBaseline = 'middle';
    g.fillText(c.alarm_on ? `ALARM · ${head}` : head, 14, 24);
    g.font = '22px monospace';
    lines.forEach((ln, i) => {
      g.fillStyle = i < 2 ? (ln.includes('RUN') ? '#4ade80' : ln.includes('ALARM') ? '#f87171' : ln.includes('SLEEP') ? '#fbbf24' : '#94a3b8') : '#e2e8f0';
      g.fillText(ln, 14, 74 + i * 42);
    });
    g.fillStyle = '#64748b';
    g.font = '18px monospace';
    g.fillText(foot, 14, cv.height - 16);
    this.hmiTex.needsUpdate = true;
  }

  private static DOT: Record<Tone, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500 animate-pulse',
    idle: 'bg-slate-400',
    info: 'bg-sky-500',
  };

  /** การ์ดป้ายข้อมูล: หัว (จุดสถานะ + ชื่อ + ค่าหลัก) และรายละเอียดแสดงตลอด */
  private pill(title: string, value: string, tone: Tone, details: [string, string][], barPct?: number) {
    const ring = tone === 'bad' ? 'ring-2 ring-red-500/70' : 'ring-1 ring-slate-900/10 dark:ring-white/10';
    const accent = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', idle: 'bg-slate-400', info: 'bg-indigo-500' }[tone];
    const rows = details
      .map(([k, v]) => `<div class="flex items-baseline justify-between gap-3"><span class="text-slate-500 dark:text-slate-400">${esc(k)}</span><span class="font-semibold tabular-nums text-slate-800 dark:text-slate-100">${v}</span></div>`)
      .join('');
    const bar =
      barPct === undefined
        ? ''
        : `<div class="my-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div class="h-full rounded-full ${accent}" style="width:${Math.max(0, Math.min(100, barPct))}%"></div></div>`;
    return `<div class="relative w-max min-w-[150px] overflow-hidden rounded-xl bg-white/95 text-[10.5px] leading-[1.45] shadow-lg shadow-slate-900/15 backdrop-blur ${ring} dark:bg-slate-900/90">
      <span class="absolute inset-y-0 left-0 w-[3px] ${accent}"></span>
      <div class="flex items-center gap-1.5 border-b border-slate-200/80 py-1 pl-3 pr-2.5 dark:border-slate-700/70">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full ${PumpScene3D.DOT[tone]}"></span>
        <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">${esc(title)}</span>
        <span class="ml-auto pl-2 text-[11px] font-extrabold tabular-nums text-slate-900 dark:text-white">${value}</span>
      </div>
      ${rows || bar ? `<div class="py-1 pl-3 pr-2.5">${bar}${rows}</div>` : ''}
    </div>`;
  }

  private updateLabels(s: SceneInput, calc: TankCalculations, st1: PumpState, st2: PumpState) {
    const d = s.data, c = d.controls, sys = d.system, wl = d.water_level;
    const unit = s.displayUnit ?? 'cm';
    const ok = (v: boolean, okT = 'OK', badT = 'LOST') =>
      `<span class="${v ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">${v ? okT : badT}</span>`;
    const set = (k: string, title: string, value: string, tone: Tone, details: [string, string][] = [], barPct?: number) => {
      const l = this.labels[k];
      if (!l) return;
      const pos = l.el.dataset.align === 'left' ? 'ml-auto mr-[10%]' : l.el.dataset.align === 'right' ? 'mr-auto ml-[10%]' : 'mx-auto';
      const line = `<div class="${pos} w-px bg-slate-400/80" style="height:${l.stem}px"></div>`;
      const dot = `<div class="${pos} h-1.5 w-1.5 -translate-x-[2px] rounded-full bg-slate-400"></div>`;
      const body = `<div class="flex ${l.el.dataset.align === 'left' ? 'justify-end' : l.el.dataset.align === 'right' ? 'justify-start' : 'justify-center'}">${this.pill(title, value, tone, details, barPct)}</div>`;
      const html = l.down ? dot + line + body : body + line + dot;
      if (l.inner.innerHTML !== html) l.inner.innerHTML = html;
    };

    // ป้ายติดผนังบ่อ
    const tone = s.low ? '#dc2626' : s.high ? '#d97706' : '#0e7490';
    const tone2 = s.low ? '#f87171' : s.high ? '#fbbf24' : '#22d3ee';
    [calc.tank1, calc.tank2].forEach((t, i) => {
      const tk = this.tanks[i];
      if (!tk) return;
      const liter = unit === 'liter';
      const isSensor = i === this.sensorTank;
      const lim = c.lower_limit_cm > 0 ? ` · ${this.tr('water_supply.scene3d.scene.cut_off')} ${fmt(c.lower_limit_cm, 0)} cm` : '';
      this.drawPlate(tk, {
        title: this.tr('water_supply.scene3d.scene.water_tank_v', { v: i + 1 }),
        big: liter ? Math.round(t.volume_l).toLocaleString() : fmt(t.level_cm, 1),
        unit: liter ? this.tr('water_supply.scene3d.scene.l') : 'cm',
        sub: liter ? `${fmt(t.level_cm, 1)} cm` : `≈ ${Math.round(t.volume_l).toLocaleString()} ${this.tr('water_supply.scene3d.scene.l')}`,
        pct: t.percent,
        tone,
        tone2,
        foot: isSensor ? `${sys.level_comm_ok ? this.tr('water_supply.scene3d.scene.sensor_ok') : this.tr('water_supply.scene3d.scene.sensor_lost')}${lim}` : '',
        footOk: sys.level_comm_ok,
      });
    });

    set('valve', this.tr('water_supply.scene3d.scene.inlet_valve'), c.valve_on ? this.tr('water_supply.scene3d.scene.open') : this.tr('water_supply.scene3d.scene.closed'), c.valve_on ? 'ok' : 'idle', [
      [this.tr('water_supply.scene3d.scene.mode'), c.manual_valve ? 'MANUAL' : 'AUTO'],
      [this.tr('water_supply.scene3d.scene.source'), this.tr('water_supply.scene3d.scene.city_water')],
    ]);
    const flowAlarm = !!d.flow_meter?.flow_alarm;
    set('meter', this.tr('water_supply.scene3d.scene.flow_meter'), `${fmt(wl.flow_rate, 2)} m³/h`, flowAlarm ? 'bad' : sys.meter_comm_ok ? 'info' : 'warn', [
      [this.tr('water_supply.scene3d.scene.total'), `${fmt(wl.volumn, 3)} m³`],
      [this.tr('water_supply.scene3d.scene.comm'), ok(sys.meter_comm_ok)],
      ...(flowAlarm ? ([[this.tr('water_supply.flow_alarm'), '<span class="text-red-500">ALARM</span>']] as [string, string][]) : []),
    ]);

    const pumpPill = (i: 1 | 2, st: PumpState) => {
      const p = i === 1 ? d.pump1 : d.pump2;
      const auto = i === 1 ? c.auto_pump1 : c.auto_pump2;
      const comm = (i === 1 ? sys.pump1_comm_ok : sys.pump2_comm_ok) || p.modbus_ok;
      const value =
        st === 'run' ? this.tr('water_supply.scene3d.scene.run')
        : st === 'alarm' ? this.tr('water_supply.scene3d.scene.fault')
        : st === 'sleep' ? 'SLEEP'
        : st === 'offline' ? this.tr('water_supply.scene3d.scene.offline')
        : this.tr('water_supply.scene3d.scene.stop');
      const tn: Tone = st === 'run' ? 'ok' : st === 'alarm' ? 'bad' : st === 'sleep' ? 'warn' : 'idle';
      set(
        `pump${i}`,
        this.tr('water_supply.scene3d.scene.pump_i', { i }),
        value,
        tn,
        [
          [this.tr('water_supply.scene3d.scene.frequency'), `${fmt(p.freq, 1)} Hz`],
          [this.tr('water_supply.scene3d.scene.current'), `${fmt(p.current, 1)} A`],
          [this.tr('water_supply.scene3d.scene.mode'), auto ? 'AUTO' : `MANUAL ${fmt(i === 1 ? c.manual_speed_pump1 : c.manual_speed_pump2, 1)} Hz`],
          ['Modbus', ok(comm)],
        ],
        (p.freq / 50) * 100
      );
    };
    pumpPill(1, st1);
    pumpPill(2, st2);

    const usesSensor = c.sensor_type !== 'pressure_switch' && !c.sensor_type_switch;
    set('pressure', this.tr('water_supply.scene3d.scene.pressure'), `${fmt(c.pressure_bar, 2)} bar`, usesSensor && !c.pressure_sensor_ok ? 'warn' : 'info', [
      [this.tr('water_supply.scene3d.scene.setpoint'), `${fmt(c.set_pressure, 2)} bar`],
      [this.tr('water_supply.scene3d.scene.device'), c.sensor_type === 'pressure_switch' ? 'Pressure switch' : 'Transmitter'],
      ['Pressure switch', c.pressure_switch ? 'ON' : 'OFF'],
      [this.tr('water_supply.scene3d.scene.pt_signal'), ok(c.pressure_sensor_ok)],
    ]);

    const rssi = sys.wifi_rssi;
    set(
      'cabinet',
      this.tr('water_supply.scene3d.scene.panel'),
      `${c.auto_mode ? 'AUTO' : 'MANUAL'}${c.is_sleeping ? ' · SLEEP' : ''}${c.alarm_on ? ' · ALARM' : ''}`,
      c.alarm_on ? 'bad' : 'info',
      [
        ['PID target', `${fmt(c.pid_target_freq, 1)} Hz`],
        ['PID Kp / Ki', `${fmt(c.pid_kp, 2)} / ${fmt(c.pid_ki, 2)}`],
        ['IP', esc(sys.ip)],
        ['WiFi', `<span class="${rssi > -60 ? 'text-emerald-600 dark:text-emerald-400' : rssi > -70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}">${rssi} dBm</span>`],
        ['RS485 I/O', ok(sys.rs485_io_ok)],
      ]
    );
  }

  /* ================= ลูปแอนิเมชัน ================= */
  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && !this.flyTo) this.fitHome(true);
  }

  private tmp = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.visible || document.hidden) return;
    this.t += dt;
    const t = this.t;
    const alarmBlink = 0.5 + 0.5 * Math.sin(t * 8);

    // ระดับน้ำ + ผิวน้ำเป็นคลื่น + คอสติก + ฟองอากาศ + สายน้ำเข้า
    this.updatePour(dt, t, !!this.runs.inlet?.active);
    const inletOn = !!this.pour?.hit;
    this.tanks.forEach((tk, i) => {
      tk.level = damp(tk.level, tk.goal, 3, dt);
      const h = Math.max(0, Math.min(tk.heightM, tk.level));
      const wet = h > 0.01;
      tk.body.visible = tk.surface.visible = tk.foam.visible = wet;
      tk.caustics.forEach((c) => (c.visible = wet));
      tk.body.scale.y = Math.max(0.0001, h);
      tk.body.position.y = tk.floorY + h / 2;
      tk.surface.position.y = tk.floorY + h;
      tk.foam.position.y = tk.floorY + h;
      const agit = inletOn && tk.inlet ? 1.8 : 1;
      if (wet) {
        const pos = tk.surface.geometry.attributes.position as THREE.BufferAttribute;
        const ix = tk.inlet?.x ?? 1e9, iz = tk.inlet?.z ?? 1e9;
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k), z = pos.getZ(k);
          let y = Math.sin(x * 2.2 + t * 1.6 + i) * 0.018 + Math.cos(z * 2.7 - t * 1.25) * 0.014 + Math.sin((x + z) * 4.1 + t * 2.3) * 0.006;
          if (inletOn && tk.inlet) {
            const dd = Math.hypot(x - ix, z - iz);
            y += Math.sin(dd * 9 - t * 7) * 0.025 * Math.exp(-dd * 0.9); // วงคลื่นจากสายน้ำที่ตกลงมา
          }
          pos.setY(k, y * agit);
        }
        pos.needsUpdate = true;
        tk.surface.geometry.computeVertexNormals();
        (tk.caustics[0].material as THREE.MeshBasicMaterial).map!.offset.set(t * 0.03, t * 0.021);
        (tk.caustics[1].material as THREE.MeshBasicMaterial).map!.offset.set(-t * 0.024, t * 0.033);
        (tk.caustics[0].material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.08 * Math.sin(t * 1.3);
        // ฟองอากาศ: ลอยขึ้นจากก้นบ่อถึงผิวน้ำแล้วเกิดใหม่ (ส่วนหนึ่งเกิดที่จุดน้ำเข้าเมื่อเปิดวาล์ว)
        const n = tk.bub.length;
        for (let k = 0; k < n; k++) {
          const b = tk.bub[k];
          const near = inletOn && tk.inlet && k % 3 === 0;
          b.y += (dt * b.v * (near ? 2.2 : 1)) / Math.max(0.3, h);
          if (b.y > 1) {
            b.y = 0;
            if (near && tk.inlet) {
              b.x = tk.inlet.x + (Math.random() - 0.5) * 0.6;
              b.z = tk.inlet.z + (Math.random() - 0.5) * 0.6;
            } else {
              b.x = (Math.random() - 0.5) * (tk.W - 0.3);
              b.z = (Math.random() - 0.5) * (tk.L - 0.3);
            }
          }
          const wob = Math.sin(t * 3 + b.ph) * 0.03;
          this.dummy.position.set(tk.cx + b.x + wob, tk.floorY + 0.03 + b.y * (h - 0.06), b.z + Math.cos(t * 2.6 + b.ph) * 0.03);
          this.dummy.scale.setScalar(b.s * (0.7 + b.y * 0.6));
          this.dummy.updateMatrix();
          tk.bubbles.setMatrixAt(k, this.dummy.matrix);
        }
        tk.bubbles.count = n;
        tk.bubbles.instanceMatrix.needsUpdate = true;
      } else tk.bubbles.count = 0;
    });
    this.dummy.scale.setScalar(1);

    // ลำแสงเซนเซอร์ลงถึงผิวน้ำ
    if (this.beam) {
      const st = this.tanks[this.sensorTank];
      const len = Math.max(0.05, this.beamTop - (st.floorY + Math.max(0, st.level)));
      this.beam.scale.set(0.5 + len * 0.25, len, 0.5 + len * 0.25);
      this.beam.position.y = this.beamTop - len / 2;
      this.M.beam.opacity = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(t * 4));
    }

    // ปั๊ม: หมุนตามความถี่ + ไฟสถานะ
    this.pumps.forEach((p) => {
      const goal = p.state === 'run' ? p.freq * 0.36 : 0;
      p.omega = damp(p.omega, goal, 1.6, dt);
      p.rotors.forEach((r) => (r.rotation.x += p.omega * dt));
      const col = COLORS[p.state];
      p.ring.emissive.copy(col);
      p.ring.emissiveIntensity = p.state === 'alarm' ? 0.4 + 2.6 * alarmBlink : p.state === 'run' ? 1.6 + 0.4 * Math.sin(t * 3) : p.state === 'sleep' ? 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.5)) : 0.25;
    });

    // วาล์ว / เข็มเกจ / ไฟสัญญาณ
    const c = this.input?.data.controls;
    this.valveOpen = damp(this.valveOpen, c?.valve_on ? 1 : 0, 3, dt);
    if (this.valveFlag) this.valveFlag.rotation.y = (1 - this.valveOpen) * (Math.PI / 2);
    this.needleBar = damp(this.needleBar, c?.pressure_bar ?? 0, 4, dt);
    if (this.needle) this.needle.rotation.z = this.gaugeAngle(this.needleBar + (this.pumps.some((p) => p.state === 'run') ? Math.sin(t * 9) * 0.015 : 0));
    if (this.beaconRed) this.beaconRed.emissiveIntensity = c?.alarm_on ? 0.3 + 3 * alarmBlink : 0;
    if (this.beaconGreen) this.beaconGreen.emissiveIntensity = !c?.alarm_on && this.pumps.some((p) => p.state === 'run') ? 1.8 : 0;
    if (c?.alarm_on && this.pilot.alarm) this.pilot.alarm.emissiveIntensity = 0.2 + 2.4 * alarmBlink;

    // น้ำไหลในท่อ: เลื่อนลายแกนน้ำ + ฟองอากาศวนรอบแกน
    Object.values(this.runs).forEach((r) => {
      if (r.active) r.coreTex.offset.y -= (dt * r.speed) / 0.6;
      if (!r.flow) return;
      if (!r.active) {
        r.flow.count = 0;
        return;
      }
      const n = r.flow.instanceMatrix.count;
      const gap = r.total / n;
      r.phase = (r.phase + dt * r.speed * 1.15) % r.total;
      for (let k = 0; k < n; k++) {
        const dd = (k * gap + r.phase + Math.sin(k * 12.9) * gap * 0.4 + r.total) % r.total;
        const si = this.pointAt(r, dd, this.tmp);
        const [u, v] = r.perp[Math.min(si, r.perp.length - 1)];
        const ang = k * 2.39996 + t * 0.8;
        const rad = r.r * (0.7 + 0.12 * Math.sin(k * 7.1));
        this.dummy.position.copy(this.tmp).addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad);
        const sc = 0.7 + 0.5 * Math.abs(Math.sin(k * 3.7));
        this.dummy.scale.setScalar(sc);
        this.dummy.updateMatrix();
        r.flow.setMatrixAt(k, this.dummy.matrix);
      }
      r.flow.count = n;
      r.flow.instanceMatrix.needsUpdate = true;
    });
    this.dummy.scale.setScalar(1);

    // กล้องบินกลับมุมเริ่มต้น
    if (this.flyTo) {
      this.camera.position.lerp(this.flyTo.pos, 1 - Math.exp(-5 * dt));
      this.controls.target.lerp(this.flyTo.target, 1 - Math.exp(-5 * dt));
      if (this.camera.position.distanceTo(this.flyTo.pos) < 0.02) this.flyTo = null;
    }
    // จำกัดการเลื่อนกล้อง (pan) ให้อยู่ในขอบเขตของระบบ
    if (!this.bounds.isEmpty()) {
      const tg = this.controls.target, b = this.bounds;
      const cx = THREE.MathUtils.clamp(tg.x, b.min.x, b.max.x), cy = THREE.MathUtils.clamp(tg.y, 0, 3), cz = THREE.MathUtils.clamp(tg.z, b.min.z, b.max.z);
      if (cx !== tg.x || cy !== tg.y || cz !== tg.z) {
        const dx = cx - tg.x, dy = cy - tg.y, dz = cz - tg.z;
        tg.set(cx, cy, cz);
        this.camera.position.x += dx; this.camera.position.y += dy; this.camera.position.z += dz;
      }
    }
    this.controls.update();
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels) {
      // ป้ายเล็กลงเมื่อซูมออก / ใหญ่ขึ้นเมื่อซูมเข้า (อิงระยะมุมมองเริ่มต้น = 0.9 เท่า)
      Object.values(this.labels).forEach((l) => {
        const d = this.camera.position.distanceTo(l.obj.position);
        const k = THREE.MathUtils.clamp((this.homeDist * 0.9) / Math.max(d, 0.1), 0.45, 1.15);
        const v = k.toFixed(3);
        if (l.inner.dataset.k !== v) {
          l.inner.dataset.k = v;
          l.inner.style.transform = `scale(${v})`;
        }
      });
      this.labelRenderer.render(this.scene, this.camera);
    }
  };
}
