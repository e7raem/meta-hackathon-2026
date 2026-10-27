import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES, createLifecycle, createPricingVerification,
  runDeclaredVerification, parseTaskExecution, exportRegression, persistRegression, fixedRunner } from "../tools/live-demo.mjs";

// Authored offline integration fixtures, never new Muse or customer evidence.
const SOURCE = fileURLToPath(new URL("..", import.meta.url));
const TEMP = join(SOURCE, "evidence/delivery-tests");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const cases = [
  { lines: [{ amount: 11000, discountEligible: true }], expectedTotal: 9900 },
  { lines: [{ amount: 20000, discountEligible: true }], expectedTotal: 17500 },
];

function tap({ tests = 2, passed = 0, failed = 2, skipped = 0, cancelled = 0, assertion = true } = {}) {
  let text = "TAP version 13\n";
  for (let i = 1; i <= passed; i++) text += `ok ${i} - accepted case ${i}\n`;
  for (let i = 1; i <= failed; i++) text += `not ok ${passed + i} - accepted case ${passed + i}\n  ---\n  code: '${assertion ? "ERR_ASSERTION" : "ERR_MODULE_NOT_FOUND"}'\n  ...\n`;
  return `\n${text}1..${tests}\n# tests ${tests}\n# pass ${passed}\n# fail ${failed}\n# skipped ${skipped}\n# cancelled ${cancelled}\n`;
}

async function owned(operation) {
  await mkdir(TEMP, { recursive: true, mode: 0o700 });
  const owner = await mkdtemp(join(TEMP, "owned-"));
  const root = join(owner, "source"), scopeId = "delivery-fixture";
  const runDirectory = join(root, "evidence/live", scopeId);
  const exportId = randomUUID(), runId = "delivery-run", scenarioId = "a";
  const sourceHashes = {};
  try {
    await mkdir(root, { mode: 0o700 }); await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    for (const file of RUNTIME_FILES) {
      const data = await readFile(join(SOURCE, file)); sourceHashes[file] = sha(data);
      await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
      await writeFile(join(root, file), data, { mode: 0o600, flag: "wx" });
    }
    const testSource = exportRegression("a", cases), testSha256 = sha(testSource);
    const exported = await persistRegression({ root, runDirectory, scopeId, runId, scenarioId, exportId, source: testSource });
    const verifySources = async () => {
      for (const file of RUNTIME_FILES) assert.equal(sha(await readFile(join(root, file))), sourceHashes[file]);
    };
    await operation({ root, runDirectory, sourceHashes, verifySources, testSource, testSha256, scopeId, exportId, runId, scenarioId });
    await verifySources();
    assert.equal(sha(await readFile(join(root, exported.path))), testSha256);
    assert.deepEqual(await readdir(runDirectory), ["exports"], "only the frozen export remains; owned verification copies were removed");
  } finally { await rm(owner, { recursive: true, force: true }); }
}

test("TAP counts reject missing, duplicate and contradictory summaries", () => {
  assert.equal(parseTaskExecution({ exitCode: 1, stdout: tap(), stderr: "" }).counts.failed, 2);
  for (const stdout of ["", tap() + "# tests 2\n", tap().replace("# tests 2", "# tests 3"),
    tap().replace("1..2", "1..3"), tap().replace("# pass 0", "# pass 1")]) {
    assert.equal(parseTaskExecution({ exitCode: 1, stdout, stderr: "" }).counts, null);
  }
});

test("the fixed native runner executes identical selected cases against faulty A and correct B", async () => {
  const lifecycle = createLifecycle();
  const baskets = cases.map((c) => c.lines);
  const a = await fixedRunner(process.execPath, "a", baskets, lifecycle);
  const b = await fixedRunner(process.execPath, "b", baskets, lifecycle);
  assert.deepEqual(a.rows.map((r) => r.original.value), [9900, 17500]);
  assert.deepEqual(a.rows.map((r) => r.candidate.value), [9450, 17550]);
  assert.deepEqual(b.rows.map((r) => r.original.value), [9900, 17500]);
  assert.deepEqual(b.rows.map((r) => r.candidate.value), [9900, 17500]);
  assert.ok([...a.rows, ...b.rows].every((r) => r.original.error === null && r.candidate.error === null));
});

test("actual nested declared Ota tasks prove baseline and identical-test red-green in owned copies", async () => {
  const otaExecutable = process.env.OTA_DEMO_TEST_OTA;
  const expected = process.env.OTA_DEMO_TEST_OTA_SHA256;
  assert.ok(isAbsolute(otaExecutable ?? ""), "provide the already-qualified released Ota executable");
  assert.match(expected ?? "", /^[a-f0-9]{64}$/);
  assert.equal(sha(await readFile(otaExecutable)), expected);
  await owned(async (input) => {
    const lifecycle = createLifecycle(); const calls = [];
    const verification = createPricingVerification({ ...input, lifecycle,
      execute: async (task, cwd) => {
        const result = await runDeclaredVerification({ task, cwd, nodeExecutable: process.execPath, otaExecutable, lifecycle });
        calls.push({ task, ...result }); return result;
      } });
    const baseline = await verification.baseline();
    assert.equal(baseline.status, "PASS"); assert.equal(baseline.execution.counts.passed, 6);
    const proof = await verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 });
    assert.equal(proof.status, "RED_THEN_GREEN"); assert.equal(proof.sameTest, true);
    assert.equal(proof.red.exitCode, 1); assert.equal(proof.red.counts.failed, 2);
    assert.equal(proof.green.exitCode, 0); assert.equal(proof.green.counts.passed, 2);
    assert.equal(proof.testSha256, input.testSha256);
    assert.equal(proof.correction.faultySha256, input.sourceHashes["pricing/change-a.ts"]);
    assert.equal(proof.correction.correctedSha256, input.sourceHashes["pricing/change-b.ts"]);
    assert.equal(proof.cleanup.ownedCopiesRemoved, true);
    assert.deepEqual(calls.map((call) => call.task), ["verify:baseline", "verify:export", "verify:export"]);
    await writeFile(join(TEMP, "proof-" + randomUUID() + ".json"), JSON.stringify({
      scope: "offline_authored_fixture_not_live_Muse", baseline, proof, calls,
      sourceIdentities: input.sourceHashes, testSha256: input.testSha256,
    }, null, 2), { mode: 0o600, flag: "wx" });
  });
});

test("setup failures, skipped checks and interrupted exits cannot establish red-green", async () => {
  for (const result of [
    { exitCode: 1, stdout: tap({ assertion: false }), stderr: "" },
    { exitCode: 1, stdout: tap({ tests: 2, failed: 1, skipped: 1 }), stderr: "" },
    { exitCode: null, stdout: tap(), stderr: "" },
  ]) {
    await owned(async (input) => {
      let calls = 0;
      const verification = createPricingVerification({ ...input, lifecycle: createLifecycle(),
        execute: async () => { calls++; return parseTaskExecution(result); } });
      const proof = await verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 });
      assert.equal(proof.status, "INCONCLUSIVE"); assert.equal(proof.green, null);
      assert.equal(calls, 1, "a setup/partial red does not proceed to green");
    });
  }
});

test("a changed generated test cannot be called unchanged red-green", async () => {
  await owned(async (input) => {
    const verification = createPricingVerification({ ...input, lifecycle: createLifecycle(),
      execute: async (_task, cwd) => {
        await writeFile(join(cwd, "evidence/regression.test.mjs"), "// synthetic changed test\n");
        return parseTaskExecution({ exitCode: 1, stdout: tap(), stderr: "" });
      } });
    const proof = await verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 });
    assert.equal(proof.sameTest, false); assert.equal(proof.status, "INCONCLUSIVE");
  });
});

test("export identity, committed record and frozen bytes are checked before any verification copy runs", async () => {
  await owned(async (input) => {
    let calls = 0;
    const verification = createPricingVerification({ ...input, lifecycle: createLifecycle(),
      execute: async () => { calls++; throw new Error("must not execute"); } });
    for (const changed of [{ runId: "another-run" }, { scopeId: "another-scope" }, { scenarioId: "b" }]) {
      const selected = changed.scopeId ? createPricingVerification({ ...input, ...changed, lifecycle: createLifecycle() }) : verification;
      await assert.rejects(() => selected.regression({ ...input, ...changed, expectedTests: 2, expectedFailures: 2 }), /EXPORT_BINDING_CHANGED/);
    }
    const artifact = join(input.runDirectory, "exports", input.exportId, "regression.test.mjs");
    const recordPath = join(artifact, "../record.json"), record = await readFile(recordPath);
    await rm(recordPath);
    await assert.rejects(() => verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 }), /ENOENT/);
    await writeFile(recordPath, record, { mode: 0o600 });
    await writeFile(artifact, "// altered fixture\n");
    await assert.rejects(() => verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 }), /PERSISTED_TEST_CHANGED/);
    await writeFile(artifact, input.testSource);
    assert.equal(calls, 0);
  });
});

test("a changed source in a disposable copy refuses and still cleans up", async () => {
  await owned(async (input) => {
    const verification = createPricingVerification({ ...input, lifecycle: createLifecycle(),
      execute: async (_task, cwd) => {
        await writeFile(join(cwd, "pricing/original.ts"), "// synthetic unauthorized source edit\n");
        return parseTaskExecution({ exitCode: 1, stdout: tap(), stderr: "" });
      } });
    await assert.rejects(() => verification.regression({ ...input, expectedTests: 2, expectedFailures: 2 }), /COPY_SOURCE_CHANGED/);
  });
});
