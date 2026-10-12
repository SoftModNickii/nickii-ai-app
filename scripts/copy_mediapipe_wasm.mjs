// Copies MediaPipe's WebAssembly files next to the face-capture page, so it does not depend
// on a CDN during the performance. Runs before `dev` and `build` of apps/face-capture.
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
// The package does not export package.json, so locate it through its main file.
const pkg = dirname(require.resolve('@mediapipe/tasks-vision'));
const out = join(process.cwd(), 'public', 'mediapipe');
mkdirSync(out, { recursive: true });
cpSync(join(pkg, 'wasm'), out, { recursive: true });
console.log('MediaPipe wasm copied to', out);
