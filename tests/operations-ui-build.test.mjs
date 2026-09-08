import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildOperationsUi } from '../scripts/build-operations-ui.mjs';

function inlineScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'generated artifact must keep one classic inline script');
  return scripts[0][1];
}

test('build generates one offline HTML without mutating the production source', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'rumi-ops-build-'));
  const outputPath = path.join(temp, 'rumi.html');
  const sourcePath = new URL('../app/index.html', import.meta.url);
  const before = await readFile(sourcePath, 'utf8');

  try {
    const result = await buildOperationsUi({ sourcePath, outputPath });
    const built = await readFile(outputPath, 'utf8');
    const after = await readFile(sourcePath, 'utf8');

    assert.equal(after, before);
    assert.equal(result.html, built);
    assert.ok(result.bytes > Buffer.byteLength(before));
    assert.ok(built.includes('OPERATIONS_UI_V0_1'));
    assert.ok(built.includes('OPERATIONS_BOOTSTRAP_V0_1'));
    assert.ok(built.includes('onclick="operationsManager.open()"'));
    assert.ok(built.includes('Todo bajo control'));
    assert.ok(built.includes('+ Registrar compra'));
    assert.ok(built.includes('recordPhysicalCount'));
    assert.ok(built.includes('recordPurchase'));
    assert.ok(!/^\s*import\s/m.test(inlineScript(built)));
    assert.ok(!/^\s*export\s/m.test(inlineScript(built)));
    assert.doesNotThrow(() => new Function(inlineScript(built)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('build is deterministic for the same source state', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'rumi-ops-determinism-'));
  const first = path.join(temp, 'first.html');
  const second = path.join(temp, 'second.html');

  try {
    await buildOperationsUi({ outputPath: first });
    await buildOperationsUi({ outputPath: second });
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('build refuses to inject twice into an already-integrated source', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'rumi-ops-double-'));
  const first = path.join(temp, 'first.html');
  const second = path.join(temp, 'second.html');

  try {
    await buildOperationsUi({ outputPath: first });
    await assert.rejects(
      buildOperationsUi({ sourcePath: first, outputPath: second }),
      /already contains Operations UI markers/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
