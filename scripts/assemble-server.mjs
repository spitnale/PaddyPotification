#!/usr/bin/env node
// Assembles the Next.js standalone server into src-tauri/server-bundle/ so Tauri
// can bundle it as a resource. Run AFTER `next build`.
//
// Next's standalone output ships server.js + a pruned node_modules, but NOT the
// static assets or public/ — those must be copied in alongside it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');
const out = path.join(root, 'src-tauri', 'server-bundle');

if (!fs.existsSync(standalone)) {
  console.error('✗ .next/standalone not found — run `next build` first (output:"standalone").');
  process.exit(1);
}

// Fresh copy each time.
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true });

// Static assets → server-bundle/.next/static
const staticSrc = path.join(root, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, path.join(out, '.next', 'static'), { recursive: true });
}

// public/ → server-bundle/public
const publicSrc = path.join(root, 'public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, path.join(out, 'public'), { recursive: true });
}

console.log('✓ Assembled self-contained server → src-tauri/server-bundle');
console.log('  entry: server-bundle/server.js  (run with PORT + HOSTNAME env)');
