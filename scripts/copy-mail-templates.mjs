import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src', 'mail', 'templates');
const dest = join(process.cwd(), 'dist', 'mail', 'templates');

if (!existsSync(src)) {
  console.error(`Mail templates missing at ${src}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied mail templates → ${dest}`);
