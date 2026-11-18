// รัน model.ts ของ frontend กับ fixtures.json → JSON (ใช้กับ compare.py)
//   cd frontend-utilities && npx tsx ../backend-utilities/tests/parity/run.ts > /tmp/ts_out.json
import fs from 'fs';
import path from 'path';
import { normalizeSystem, readSystem, levelToCm, calcSystem, scanPayload, guessLevelPath, validateSystem } from '../../../frontend-utilities/src/lib/waterSystems/model';
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const out = fx.map((f: any) => {
  const c = normalizeSystem(f.cfg);
  if (!c) return null;
  const { createdAt, updatedAt, ...rest } = c as any;
  const r = readSystem(c, f.raw);
  const calc = r.levelRaw === null ? null : calcSystem(c, levelToCm(c, r.levelRaw));
  const pts = scanPayload(f.raw);
  return { cfg: rest, reading: r, calc, points: pts, guess: guessLevelPath(pts), errors: validateSystem(c) };
});
console.log(JSON.stringify(out));
