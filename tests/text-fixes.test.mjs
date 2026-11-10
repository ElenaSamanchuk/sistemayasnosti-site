import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('точечные правки текстов не потеряны после пересборки', () => {
  const run = spawnSync(process.execPath, ['tools/apply-text-fixes.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
