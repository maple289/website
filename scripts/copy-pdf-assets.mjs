import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
// Package assets only; user documents and cached previews never go in public/.
const target = path.resolve('public/pdfjs');
await mkdir(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.resolve('node_modules/pdfjs-dist', directory), path.join(target, directory), { recursive: true });
}
await cp(path.resolve('node_modules/pdfjs-dist/LICENSE'), path.join(target, 'LICENSE'));
