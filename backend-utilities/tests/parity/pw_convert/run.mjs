import fs from 'node:fs';
import { convertPwRaw, readPwField } from './pwConvert.mjs';
const { cases, paths } = JSON.parse(fs.readFileSync('cases.json', 'utf8'));
let bad = 0;
for (const c of cases) {
  const got = convertPwRaw(c.raw, c.cfg);
  const exp = c.out;
  const same = (got === null && exp === null) || (got && exp && got.status === exp.status && Object.is(got.value + 0, exp.value + 0) && got.raw === exp.raw);
  if (!same) { bad++; if (bad <= 10) console.log('DIFF', JSON.stringify(c.raw), JSON.stringify(c.cfg), 'py', JSON.stringify(exp), 'ts', JSON.stringify(got)); }
}
for (const p of paths) { const g = readPwField(p.p, p.path); const e = p.out === null ? undefined : p.out; if (JSON.stringify(g) !== JSON.stringify(e)) { bad++; console.log('PATH DIFF', p.path, g, e); } }
console.log(`${cases.length + paths.length} cases, ${bad} differences`);
process.exit(bad ? 1 : 0);
