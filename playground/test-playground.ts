import path from 'path';
import fs from 'fs/promises';
import { launch, build, launchFromBuild } from '@antelopejs/core';

const PLAYGROUND_DIR = path.resolve(__dirname);
const ANTELOPE_DIR = path.join(PLAYGROUND_DIR, '.antelope');

async function phaseLaunch(): Promise<void> {
  console.log('[playground] Phase 1: Launch...');
  const manager = await launch(PLAYGROUND_DIR);
  manager.stopAll();
  await manager.destroyAll();
  console.log('[playground] Phase 1: OK');
}

async function phaseBuild(): Promise<void> {
  console.log('[playground] Phase 2: Build...');
  await build(PLAYGROUND_DIR);
  console.log('[playground] Phase 2: OK');
}

async function phaseLaunchFromBuild(): Promise<void> {
  console.log('[playground] Phase 3: Launch from build...');
  const manager = await launchFromBuild(PLAYGROUND_DIR);
  manager.stopAll();
  await manager.destroyAll();
  console.log('[playground] Phase 3: OK');
}

async function cleanup(): Promise<void> {
  await fs.rm(ANTELOPE_DIR, { recursive: true, force: true });
}

async function run(): Promise<void> {
  try {
    await phaseLaunch();
    await phaseBuild();
    await phaseLaunchFromBuild();
    console.log('[playground] All phases passed!');
  } finally {
    await cleanup();
  }
}

run().catch((error) => {
  console.error('[playground] Failed:', error);
  process.exit(1);
});
