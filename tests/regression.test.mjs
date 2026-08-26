import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/index.html", import.meta.url), "utf8");

test("loads the validated core before application code", () => {
  assert.match(source, /<script src="core\.js"><\/script>/);
  assert.match(source, /RumiCore\.loadDatabase\(localStorage/);
  assert.match(source, /RumiCore\.commitDatabase\(localStorage/);
});

test("shift finalization downloads before mutating persisted history", () => {
  const start = source.indexOf("finalizarTurno() {");
  const end = source.indexOf("seleccionarRespaldo()", start);
  const block = source.slice(start, end);
  assert.ok(block.indexOf("this.descargar(backup)") < block.indexOf("RumiCore.finalizeShift"));
  assert.match(block, /confirm\(`/);
});

test("recovery is wired to an explicit JSON file input", () => {
  assert.match(source, /id="backup-file"/);
  assert.match(source, /RumiCore\.recoverBackup/);
  assert.match(source, /addEventListener\('change'/);
});

test("unsent kitchen items block table closure", () => {
  const start = source.indexOf("handleCloseMesa() {");
  const end = source.indexOf("\n                reset(m)", start);
  assert.match(source.slice(start, end), /some\(item => !item\.enviadoCocina\)/);
});

test("cross-tab storage changes are handled", () => {
  assert.match(source, /addEventListener\('storage'/);
  assert.match(source, /refreshed\.db\.revision > persistedSnapshot\.revision/);
});

test("operational events use ISO timestamps and collision-resistant IDs", () => {
  assert.match(source, /cerradoEn: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /creadoEn: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /uniqueId\('sale'\)/);
  assert.match(source, /uniqueId\('kitchen'\)/);
  assert.doesNotMatch(source, /id: Date\.now\(\)/);
});
