#!/usr/bin/env node
// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIVEBRIDGE_DIR = process.env.LIVEBRIDGE_DIR
  ? resolve(process.env.LIVEBRIDGE_DIR)
  : resolve(ROOT, '../livebridge');

const FRONTENDS = [
  'samples/visual-concierge/frontend',
  'samples/whiteboard-architect/frontend',
  'samples/bilingual-coach/frontend',
  'samples/antigravity-voice-desk/frontend',
];

const mode = process.argv[2];
const args = process.argv.slice(3);
const skipInstall = args.includes('--no-install');
const explicitVersion = args.find((a) => !a.startsWith('--'));

if (!['local', 'tarball', 'npm'].includes(mode ?? '')) {
  console.error(
    'Usage: node scripts/switch-ts-source.mjs <local|tarball|npm> [version] [--no-install]',
  );
  process.exit(1);
}

let depSpec = '';

if (mode === 'local') {
  if (!existsSync(LIVEBRIDGE_DIR)) {
    console.error(`Local livebridge directory not found at ${LIVEBRIDGE_DIR}`);
    process.exit(1);
  }
  depSpec = 'file:../../../../livebridge';
} else if (mode === 'tarball') {
  if (!existsSync(LIVEBRIDGE_DIR)) {
    console.error(`Local livebridge directory not found at ${LIVEBRIDGE_DIR}`);
    process.exit(1);
  }
  const vendorDir = resolve(ROOT, '.vendor');
  mkdirSync(vendorDir, { recursive: true });
  console.log(`Packing @ghchinoy/livebridge from ${LIVEBRIDGE_DIR}...`);
  const out = execFileSync(
    'npm',
    ['pack', '--quiet', '--pack-destination', vendorDir],
    { cwd: LIVEBRIDGE_DIR, encoding: 'utf8' },
  ).trim();
  const tgzName = out.split(/\r?\n/).pop();
  depSpec = `file:../../../.vendor/${tgzName}`;
} else {
  let ver = explicitVersion;
  if (!ver && existsSync(resolve(LIVEBRIDGE_DIR, 'package.json'))) {
    ver = JSON.parse(
      readFileSync(resolve(LIVEBRIDGE_DIR, 'package.json'), 'utf8'),
    ).version;
  }
  const targetVer = ver || '0.1.1';
  if (!skipInstall) {
    try {
      execFileSync(
        'npm',
        ['view', `@ghchinoy/livebridge@${targetVer}`, 'version'],
        { stdio: 'pipe', encoding: 'utf8' },
      );
    } catch {
      console.error(
        `@ghchinoy/livebridge@${targetVer} is not yet visible on the npm registry CDN. Keeping current setup intact — retry 'make use-npm VERSION=${targetVer}' in a minute.`,
      );
      process.exit(1);
    }
  }
  depSpec = `^${targetVer}`;
}

for (const relFe of FRONTENDS) {
  const feDir = resolve(ROOT, relFe);
  const pkgPath = resolve(feDir, 'package.json');
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies['@ghchinoy/livebridge'] = depSpec;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[${relFe}] @ghchinoy/livebridge -> ${depSpec}`);

  if (!skipInstall) {
    // Remove both node_modules and package-lock.json when switching package
    // sources so npm resolves all cross-platform optional bindings cleanly
    // without triggering https://github.com/npm/cli/issues/4828.
    rmSync(resolve(feDir, 'node_modules'), {
      recursive: true,
      force: true,
    });
    rmSync(resolve(feDir, 'package-lock.json'), { force: true });
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: feDir,
      stdio: 'inherit',
    });
  }
}
