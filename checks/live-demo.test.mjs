import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm, lstat, chmod, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { BudgetLedger, initializeBudget, persistRegression, createController, checkRequest,
  buildRunnerEnvironment, exportRegression, ruleTotal, createLifecycle, museProposal, closeProviderRequests,
  feedbackContext, feedbackFromResponse, validateRetainedCheckpoint, loadRetainedCheckpoint,
  createFeedbackAttempts, museFeedback, prepareSession, loadOwnerSession,
  validateSessionWindow, startupHint, exportArtifactPath, RUNTIME_FILES, ORIGIN } from "../tools/live-demo.mjs";

// All providers/runners/reviewer decisions in this file are synthetic offline fixtures.
const TEMP = fileURLToPath(new URL("../evidence/live-tests/", import.meta.url));
const NOW = Date.parse("2026-10-27T00:00:00.000Z");
const scope = { id: "fixture-scope", issuedAt: "2026-10-27T00:00:00.000Z",
  deadline: "2026-10-27T00:20:00.000Z", limit: 6 };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const EXPORT_ID = "11111111-1111-4111-8111-111111111111";
async function owned(fn) {
  await mkdir(TEMP, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(TEMP, "unit-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("durable reservation survives normal restart; six is a hard local dispatch count", async () => {
  await owned(async (root) => {
    const path = join(root, "budget.json");
    await initializeBudget(path, scope);
    const first = new BudgetLedger(path, scope, { now: () => NOW });
    assert.equal(await first.reserve("request-1"), 1);
    const restarted = new BudgetLedger(path, scope, { now: () => NOW });
    assert.equal((await restarted.ready()).reservations.length, 1);
    for (let i = 2; i <= 6; i++) assert.equal(await restarted.reserve("request-" + i), i);
    await assert.rejects(() => restarted.reserve("request-7"), /REQUEST_BUDGET_EXHAUSTED/);
    await assert.rejects(() => restarted.reserve("request-1"), /DUPLICATE_REQUEST/);
    assert.equal((await restarted.ready()).reservations.length, 6);
    await assert.rejects(() => initializeBudget(path, scope), /EEXIST/);
  });
});

test("missing, corrupt, linked or nonprivate established state never initializes itself", async () => {
  await owned(async (root) => {
    const path = join(root, "budget.json");
    const ledger = new BudgetLedger(path, scope, { now: () => NOW });
    await assert.rejects(() => ledger.ready(), /ENOENT/);
    await writeFile(path, "{", { mode: 0o600 });
    await assert.rejects(() => ledger.ready());
    await rm(path); await initializeBudget(path, scope); await chmod(path, 0o644);
    await assert.rejects(() => ledger.ready(), /PRIVATE_FILE_REQUIRED/);
    await chmod(path, 0o600); await rm(path);
    await writeFile(join(root, "other.json"), "{}", { mode: 0o600 });
    await symlink("other.json", path); await assert.rejects(() => ledger.ready());
  });
});

test("interrupted persistence leaves durable lock; restart refuses and no reset occurs", async () => {
  await owned(async (root) => {
    const path = join(root, "budget.json"); await initializeBudget(path, scope);
    const interrupted = new BudgetLedger(path, scope, { now: () => NOW,
      beforeRename: () => { throw new Error("synthetic interrupted commit"); } });
    await assert.rejects(() => interrupted.reserve("request-crash"), /synthetic/);
    assert.ok((await lstat(path + ".lock")).isFile());
    await assert.rejects(() => interrupted.reserve("request-next"), /BUDGET_UNCERTAIN/);
    const restarted = new BudgetLedger(path, scope, { now: () => NOW });
    await assert.rejects(() => restarted.ready(), /BUDGET_LOCKED/);
    assert.equal(JSON.parse(await readFile(path, "utf8")).reservations.length, 0);
  });
});

test("competing reservations cannot consume the same counter slot", async () => {
  await owned(async (root) => {
    const path = join(root, "budget.json"); await initializeBudget(path, scope);
    const a = new BudgetLedger(path, scope, { now: () => NOW });
    const b = new BudgetLedger(path, scope, { now: () => NOW });
    const result = await Promise.allSettled([a.reserve("request-first"), b.reserve("request-second")]);
    assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await a.ready()).reservations.length, 1);
  });
});

test("expired scope refuses without consuming or dispatching", async () => {
  await owned(async (root) => {
    const path = join(root, "budget.json"); await initializeBudget(path, scope);
    const ledger = new BudgetLedger(path, scope, { now: () => Date.parse(scope.deadline) });
    await assert.rejects(() => ledger.reserve("request-expired"), /WINDOW_ENDED/);
    assert.equal((await ledger.ready()).reservations.length, 0);
  });
});

test("Host, Origin, nonce, type, method and closed routes are mandatory", () => {
  const good = { host: "127.0.0.1:48761", origin: ORIGIN,
    "x-demo-token": "fixture-nonce", "content-type": "application/json" };
  checkRequest("POST", "/api/propose", good, "fixture-nonce");
  for (const headers of [{ ...good, host: "evil.invalid:48761" }, { ...good, origin: "https://evil.invalid" },
    { ...good, origin: undefined }, { ...good, "x-demo-token": "wrong" }, { ...good, "content-type": "text/plain" }]) {
    assert.throws(() => checkRequest("POST", "/api/propose", headers, "fixture-nonce"));
  }
  for (const path of ["/api/propose", "/../pricing/original.ts", "https://evil.invalid", "/api/session?key=x"]) {
    assert.throws(() => checkRequest("GET", path, good, "fixture-nonce"));
  }
  assert.throws(() => checkRequest("PUT", "/api/propose", good, "fixture-nonce"));
});

test("released Ota's bare loopback Host is accepted only for GET /health", () => {
  const bare = { host: "127.0.0.1", origin: ORIGIN,
    "x-demo-token": "fixture-nonce", "content-type": "application/json" };
  checkRequest("GET", "/health", bare, "fixture-nonce");
  checkRequest("GET", "/health", { host: "127.0.0.1:48761" }, "fixture-nonce");
  for (const path of ["/", "/app.js", "/styles.css", "/api/session", "/health?extra=1"]) {
    assert.throws(() => checkRequest("GET", path, bare, "fixture-nonce"), /HOST_REFUSED/);
  }
  for (const path of ["/api/propose", "/api/accept", "/api/compare", "/api/export", "/health"]) {
    assert.throws(() => checkRequest("POST", path, bare, "fixture-nonce"), /HOST_REFUSED/);
  }
  for (const host of [undefined, "localhost", "localhost:48761", "evil.invalid", "127.0.0.1:80", "127.0.0.1.evil.invalid"]) {
    assert.throws(() => checkRequest("GET", "/health", { host }, "fixture-nonce"), /HOST_REFUSED/);
  }
});

async function fixture(overrides = {}, { prepareBaseline = true } = {}) {
  const lines = [{ amount: 10000, discountEligible: true }];
  const calls = { provider: 0, feedback: [], runner: 0, reservations: 0, baseline: 0, baselineSelections: [], regressions: [], exports: [], retained: [], markers: new Set() };
  const raw = { status: "completed", error: null, model: "muse-spark-1.3",
    usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: "message", content: [{ type: "output_text",
      text: JSON.stringify({ cases: [{ lines, expectedTotal: 9000, rationale: "Synthetic boundary case." }] }) }] }] };
  const controller = createController({ changes: ["a", "c"].map((id) => ({ id, title: `Prepared change ${id.toUpperCase()}`,
    originalSource: "neutral original", candidateSource: "neutral proposed", rule: { text: "Independent fixture rule" },
    originalSha256: "a".repeat(64), candidateSha256: (id === "a" ? "b" : "c").repeat(64), diff: "neutral diff" })),
  scope, now: () => NOW, nonce: "fixture-nonce",
  baselineCoverage: { label: "Synthetic public ordinary coverage", cases: [] },
  baselineIdentity: "c".repeat(64),
  ruleIdentity: "d".repeat(64), controlIdentity: "e".repeat(64),
  feedbackAttempts: { has: async (root) => calls.markers.has(root),
    claim: async (root) => { assert.equal(calls.markers.has(root), false); calls.markers.add(root); } },
  feedbackProvider: async (packet) => {
    calls.feedback.push(packet);
    return feedbackRaw(packet);
  },
  verification: {
    baseline: async (id) => { calls.baseline++; calls.baselineSelections.push(id); return { status: "PASS", cleanup: { ownedCopiesRemoved: true },
      execution: { exitCode: 0, counts: { tests: 6, passed: 6, failed: 0, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" } }; },
    regression: async (input) => {
      calls.regressions.push(input);
      return { status: "RED_THEN_GREEN", sameTest: true, testSha256: input.testSha256,
        red: { exitCode: 1, counts: { tests: 1, passed: 0, failed: 1, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" },
        green: { exitCode: 0, counts: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" },
        correction: { kind: "PRE_REVIEWED_FIXED", label: "Synthetic reviewed correction",
          faultySha256: (input.scenarioId === "c" ? "c" : "a").repeat(64), correctedSha256: "b".repeat(64) },
        cleanup: { ownedCopiesRemoved: true } };
    },
  },
  ledger: { ready: async () => ({ reservations: Array(calls.reservations) }),
    reserve: async () => ++calls.reservations },
  provider: async (packet) => {
    calls.provider++; assert.deepEqual(Object.keys(packet).sort(), ["originalSource", "proposedSource", "rule"]);
    assert.doesNotMatch(JSON.stringify(packet), /private-witness|reference-repair|Authorization|MODEL_API_KEY/);
    return raw;
  },
  runner: async (id, baskets) => { calls.runner++; return { rows: baskets.map((lines) => ({ original: { value: ruleTotal(lines), error: null },
    candidate: { value: id === "b" ? ruleTotal(lines) : 8550, error: null } })) }; },
  verifySources: async () => {}, retain: async (name, value) => calls.retained.push({ name, value }),
  persistExport: async (source, { exportId }) => {
    calls.exports.push(source); return { sha256: sha(source), exportId, path: exportArtifactPath(scope.id, exportId) };
  },
  ...overrides });
  if (prepareBaseline) {
    // Explicit synthetic baseline setup; model/runner counts remain independent.
    await controller.action("/api/baseline", { changeId: "a", requestId: "fixture-baseline" });
    calls.retained.length = 0;
  }
  return { controller, calls, raw };
}

async function accepted(controller, expectedTotal = 9000) {
  const proposal = await controller.action("/api/propose", { changeId: "a", requestId: "request-propose" });
  const result = await controller.action("/api/accept", { proposalId: proposal.proposalId,
    expectations: [{ caseId: "case-1", expectedTotal }], reviewed: true, requestId: "request-accept" });
  return { proposal, result };
}

test("actual controller ordering uses frozen expectations before any runner invocation", async () => {
  const { controller, calls } = await fixture();
  await assert.rejects(() => controller.action("/api/compare", { acceptedId: "unknown", requestId: "request-early" }), /ACCEPTED_CASES_REQUIRED/);
  const { result } = await accepted(controller);
  assert.equal(calls.runner, 0); assert.equal(result.acceptedCases[0].expectationOrigin, "META_ACCEPTED");
  assert.equal(Object.hasOwn(result, "rows"), false);
  const run = await controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  assert.equal(run.status, "REPRODUCED"); assert.equal(calls.runner, 1);
  const exported = await controller.action("/api/export", { runId: run.runId, requestId: "request-export" });
  assert.equal(exported.sha256, sha(calls.exports[0]));
  assert.equal(exported.command, "ota run verify:export --agent");
  await assert.rejects(() => controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" }), /DUPLICATE_REQUEST/);
  assert.equal(calls.runner, 1);
});

test("a real passing baseline is required before any model reservation", async () => {
  const f = await fixture({}, { prepareBaseline: false });
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "before-baseline" }), /PASSING_BASELINE_REQUIRED/);
  assert.equal(f.calls.provider, 0); assert.equal(f.calls.reservations, 0);
  const baseline = await f.controller.action("/api/baseline", { changeId: "a", requestId: "baseline-check" });
  assert.equal(baseline.origin, "LOCAL_EXECUTION"); assert.equal(baseline.execution.counts.passed, 6);
  assert.equal(f.calls.reservations, 0);
  await f.controller.action("/api/propose", { changeId: "a", requestId: "after-baseline" });
  assert.equal(f.calls.provider, 1);
});

test("same-test regression requires a reproduced export and never accepts caller paths or code", async () => {
  const f = await fixture();
  await assert.rejects(() => f.controller.action("/api/regression", { runId: "unknown", exportId: EXPORT_ID, requestId: "early-regression" }), /REPRODUCED_EXPORT_REQUIRED/);
  const { result } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, exportId: EXPORT_ID, requestId: "no-export" }), /REPRODUCED_EXPORT_REQUIRED/);
  const exported = await f.controller.action("/api/export", { runId: run.runId, requestId: "request-export" });
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, requestId: "path-injection", path: "elsewhere" }), /INVALID_FIELDS/);
  await assert.rejects(() => f.controller.action("/api/export", { runId: run.runId, requestId: "repeat-export" }), /RUN_ALREADY_EXPORTED/);
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, exportId: EXPORT_ID, requestId: "cross-export" }), /REPRODUCED_EXPORT_REQUIRED/);
  const proof = await f.controller.action("/api/regression", { runId: run.runId, exportId: exported.exportId, requestId: "request-regression" });
  assert.equal(proof.status, "RED_THEN_GREEN"); assert.equal(proof.origin, "LOCAL_EXECUTION");
  assert.equal(proof.testSha256, exported.sha256);
  assert.equal(f.calls.regressions[0].testSource, exported.testSource);
  assert.equal(f.calls.regressions[0].expectedTests, 1); assert.equal(f.calls.regressions[0].expectedFailures, 1);
  assert.equal(f.calls.provider, 1, "red-green does not make a second model request");
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, exportId: exported.exportId, requestId: "repeat-regression" }), /REGRESSION_ALREADY_RUN/);
});

test("C keeps selected baseline, source and scenario binding through export, control, feedback and regression", async () => {
  const f = await fixture({ runner: async (id, baskets) => ({ rows: baskets.map((lines) => ({
    original: { value: ruleTotal(lines), error: null },
    candidate: { value: id === "c" ? 9700 : ruleTotal(lines), error: null },
  })) }) }, { prepareBaseline: false });
  f.raw.output[0].content[0].text = JSON.stringify({ cases: [{
    lines: [{ amount: 8000, discountEligible: true }, { amount: 3000, discountEligible: false }],
    expectedTotal: 10200, rationale: "Synthetic authored mixed basket, not Muse evidence.",
  }] });
  await f.controller.action("/api/baseline", { changeId: "a", requestId: "only-a-baseline" });
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "c", requestId: "c-before-baseline" }), /PASSING_BASELINE_REQUIRED/);
  assert.equal(f.calls.reservations, 0);
  const baseline = await f.controller.action("/api/baseline", { changeId: "c", requestId: "selected-c-baseline" });
  assert.equal(baseline.changeId, "c"); assert.equal(baseline.sourceIdentities.candidate, "c".repeat(64));
  assert.deepEqual(f.calls.baselineSelections, ["a", "c"]);
  const proposal = await f.controller.action("/api/propose", { changeId: "c", requestId: "c-initial-proposal" });
  const acceptance = await f.controller.action("/api/accept", { proposalId: proposal.proposalId, reviewed: true,
    expectations: proposal.cases.map((c) => ({ caseId: c.id, expectedTotal: c.expectedTotal })), requestId: "c-accept-expectations" });
  const run = await f.controller.action("/api/compare", { acceptedId: acceptance.acceptedId, requestId: "c-compare-prices" });
  assert.equal(run.status, "REPRODUCED"); assert.equal(run.sourceIdentities.candidate, "c".repeat(64));
  const exported = await f.controller.action("/api/export", { runId: run.runId, requestId: "c-export-test" });
  assert.match(exported.testSource, /pricing\/change-c\.ts/); assert.doesNotMatch(exported.testSource, /change-a\.ts/);
  const proof = await f.controller.action("/api/regression", { runId: run.runId, exportId: exported.exportId, requestId: "c-regression-proof" });
  assert.equal(f.calls.regressions[0].scenarioId, "c");
  assert.equal(proof.correction.faultySha256, "c".repeat(64));
  const control = await f.controller.action("/api/control", { runId: run.runId, requestId: "c-control-b" });
  assert.equal(control.status, "NO_COUNTEREXAMPLE");
  const feedback = await f.controller.action("/api/feedback", { runId: run.runId, controlId: control.controlId, requestId: "c-feedback-turn" });
  assert.equal(f.calls.feedback[0].binding.scenarioId, "c");
  for (const record of [proposal, acceptance, run, exported, proof, control, feedback, feedback.proposal]) {
    assert.equal(record.scenarioId, "c");
  }
  const session = await f.controller.session();
  assert.equal(session.callsUsed, 2); assert.equal(session.limit, 6);
  assert.deepEqual(session.changes.map((c) => c.id), ["a", "c"]);
  const next = await f.controller.action("/api/propose", { changeId: "a", requestId: "a-after-c-proposal" });
  assert.equal(next.scenarioId, "a"); assert.equal(next.callsUsed, 3);
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "b", requestId: "not-a-scenario" }), /CHANGE_NOT_FOUND/);
});

test("source-derived rule check rejects unchecked or wrong expectations; corrections are REVIEWER not human identity", async () => {
  const { controller, calls, raw } = await fixture();
  raw.output[0].content[0].text = JSON.stringify({ cases: [{ lines: [{ amount: 10000, discountEligible: true }],
    expectedTotal: 8000, rationale: "Synthetic wrong proposed expectation" }] });
  const proposal = await controller.action("/api/propose", { changeId: "a", requestId: "request-propose" });
  for (const [reviewed, expectedTotal] of [[false, 9000], [true, 8000]]) {
    await assert.rejects(() => controller.action("/api/accept", { proposalId: proposal.proposalId,
      expectations: [{ caseId: "case-1", expectedTotal }], reviewed,
      requestId: "request-wrong-" + String(reviewed) }));
  }
  assert.equal(calls.runner, 0);
  const result = await controller.action("/api/accept", { proposalId: proposal.proposalId,
    expectations: [{ caseId: "case-1", expectedTotal: 9000 }], reviewed: true, requestId: "request-corrected" });
  assert.equal(result.acceptedCases[0].expectationOrigin, "REVIEWER_CORRECTED");
  assert.equal(calls.runner, 0);
});

test("correct-change agreement and baseline/spec contradiction have narrow distinct outcomes", async () => {
  for (const [original, candidate, status] of [[9000, 9000, "NO_COUNTEREXAMPLE"], [8000, 8550, "INCONCLUSIVE"]]) {
    const { controller } = await fixture({ runner: async () => ({ rows: [{ original: { value: original, error: null },
      candidate: { value: candidate, error: null } }] }) });
    const { result } = await accepted(controller);
    const run = await controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
    assert.equal(run.status, status);
  }
});

test("runner failure is retained as inconclusive rows, never a reproduced regression", async () => {
  const { controller } = await fixture({ runner: async () => { throw new Error("synthetic runner error"); } });
  const { result } = await accepted(controller);
  const run = await controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  assert.equal(run.status, "INCONCLUSIVE"); assert.equal(run.rows[0].original.value, null);
  await assert.rejects(() => controller.action("/api/export", { runId: run.runId, requestId: "request-export" }), /MEANINGFUL_RUN_REQUIRED/);
});

test("failed durable reservation never invokes provider; provider failure remains consumed", async () => {
  let provider = 0;
  const failed = await fixture({ ledger: { reserve: async () => { throw new Error("synthetic persistence failure"); } },
    provider: async () => { provider++; } });
  await assert.rejects(() => failed.controller.action("/api/propose", { changeId: "a", requestId: "request-failed" }));
  assert.equal(provider, 0);
  const stopped = await fixture({ provider: async () => { throw new Error("synthetic transport failure"); } });
  await assert.rejects(() => stopped.controller.action("/api/propose", { changeId: "a", requestId: "request-failed" }), /PROVIDER_FAILED_CONSUMED/);
  assert.equal(stopped.calls.reservations, 1);
  assert.equal(stopped.calls.retained[0].value.outcome, "FAILED_OR_UNKNOWN_CONSUMED");
});

test("malformed/empty/incomplete model data and arbitrary dispatch fields cannot become executable input", async () => {
  for (const kind of ["incomplete", "empty", "command"]) {
    const f = await fixture();
    if (kind === "incomplete") f.raw.status = "incomplete";
    if (kind === "empty") f.raw.output[0].content[0].text = '{"cases":[]}';
    if (kind === "command") f.raw.output[0].content[0].text = '{"cases":[],"command":"bad"}';
    await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "request-invalid" }));
    assert.equal(f.calls.runner, 0);
  }
  const f = await fixture();
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "../../private", requestId: "request-path" }));
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "request-extra", command: "bad" }));
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: 12345678 }));
  assert.equal(f.calls.provider, 0);
});

test("valid empty model cases are inconclusive, not malformed or a meaningful comparison", async () => {
  const f = await fixture();
  f.raw.output[0].content[0].text = '{"cases":[]}';
  await assert.rejects(() => f.controller.action("/api/propose", {
    changeId: "a", requestId: "request-no-cases",
  }), (error) => error.code === "NO_CASES_PROPOSED" && error.status === 422);
  assert.equal(f.calls.provider, 1); assert.equal(f.calls.reservations, 1);
  assert.equal(f.calls.runner, 0); assert.equal(f.calls.exports.length, 0);
  assert.equal(f.calls.retained.length, 1, "completed empty response is retained, not relabelled transport failure");
  assert.deepEqual(f.calls.retained[0].value, f.raw);
  await assert.rejects(() => f.controller.action("/api/compare", {
    acceptedId: "not-created", requestId: "request-empty-compare",
  }), /ACCEPTED_CASES_REQUIRED/);
  assert.equal(f.calls.runner, 0);
});

test("concurrent action is refused, not another model call or hidden retry", async () => {
  let release;
  let blocked = false;
  const wait = new Promise((done) => { release = done; });
  const f = await fixture({ verifySources: () => blocked ? wait : Promise.resolve() });
  blocked = true;
  const first = f.controller.action("/api/propose", { changeId: "a", requestId: "request-first" });
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "request-second" }), /BUSY/);
  release(); await first; assert.equal(f.calls.provider, 1);
});

test("runner environment is an explicit allowlist and export uses data, not model code", () => {
  const env = buildRunnerEnvironment("/qualified/node/bin/node");
  assert.deepEqual(Object.keys(env).sort(), ["LANG", "NODE_DISABLE_COMPILE_CACHE", "NODE_OPTIONS", "NO_COLOR", "PATH"].sort());
  assert.equal(env.NODE_OPTIONS, "");
  assert.equal(ruleTotal([{ amount: 12000, discountEligible: true }]), 10300);
  const source = exportRegression("a", [{ lines: [{ amount: 12000, discountEligible: true }], expectedTotal: 10300,
    rationale: '<script>not executable</script>' }]);
  assert.ok(source.includes('../pricing/change-a.ts')); assert.ok(!source.includes("script"));
  assert.throws(() => exportRegression("../../private", []));
  assert.throws(() => exportRegression("a", [{ lines: [{ amount: '1;bad()', discountEligible: true }], expectedTotal: 0 }]));
});

test("exports are private append-only session artifacts and never overwrite legacy or earlier exports", async () => {
  await owned(async (root) => {
    const runDirectory = join(root, "evidence/live", scope.id);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(root, "evidence/regression.test.mjs");
    await writeFile(legacy, "// legacy unchanged\n", { mode: 0o600 });
    const input = { root, runDirectory, scopeId: scope.id, runId: "run-first", scenarioId: "a",
      exportId: EXPORT_ID, source: "// fixed synthetic test\n" };
    const first = await persistRegression(input);
    const artifact = join(root, first.path);
    assert.equal(await readFile(artifact, "utf8"), input.source);
    assert.equal(first.sha256, sha(input.source)); assert.equal((await lstat(artifact)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(artifact, ".."))).mode & 0o777, 0o700);
    assert.deepEqual(JSON.parse(await readFile(join(artifact, "../record.json"))),
      { version: 2, scopeId: scope.id, runId: "run-first", scenarioId: "a", exportId: EXPORT_ID, sha256: first.sha256 });
    const second = await persistRegression({ ...input, exportId: "22222222-2222-4222-8222-222222222222",
      runId: "run-second", source: "// another fixed synthetic test\n" });
    assert.notEqual(first.path, second.path);
    assert.equal(second.sha256, sha(await readFile(join(root, second.path))));
    await assert.rejects(() => persistRegression(input), /EEXIST/);
    assert.equal(await readFile(artifact, "utf8"), input.source);
    assert.equal(await readFile(legacy, "utf8"), "// legacy unchanged\n");
    const laterScope = "later-fixture-scope", laterDirectory = join(root, "evidence/live", laterScope);
    await mkdir(laterDirectory, { mode: 0o700 });
    const later = await persistRegression({ ...input, scopeId: laterScope, runDirectory: laterDirectory });
    assert.notEqual(later.path, first.path);
    assert.equal(await readFile(artifact, "utf8"), input.source);
    assert.throws(() => exportArtifactPath(scope.id, "../escape"), /EXPORT_ID_INVALID/);
  });
});

test("export persistence failure returns no successful command or missing-artifact claim", async () => {
  const f = await fixture({ persistExport: async () => { throw new Error("synthetic disk failure"); } });
  const { result } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  await assert.rejects(() => f.controller.action("/api/export", { runId: run.runId, requestId: "request-export" }), /synthetic disk/);
  await owned(async (root) => {
    const runDirectory = join(root, "evidence/live", scope.id);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const input = { root, runDirectory, scopeId: scope.id, runId: "interrupted-run", scenarioId: "a",
      exportId: EXPORT_ID, source: "// test\n" };
    await assert.rejects(() => persistRegression({ ...input,
      beforeCommit: () => { throw new Error("synthetic interrupted export"); } }), /synthetic/);
    const artifact = join(root, exportArtifactPath(scope.id, EXPORT_ID));
    assert.equal(await readFile(artifact, "utf8"), input.source);
    await assert.rejects(() => lstat(join(artifact, "../record.json")), /ENOENT/);
    await assert.rejects(() => persistRegression(input), /EEXIST/);
  });
});

test("shutdown drains blocked source verification without dispatching provider or runner", async () => {
  for (const operation of ["propose", "compare"]) {
    const lifecycle = createLifecycle();
    let blocked = false, entered, release;
    const waiting = new Promise((done) => { entered = done; });
    const gate = new Promise((done) => { release = done; });
    const f = await fixture({ lifecycle, verifySources: async () => {
      if (blocked) { entered(); await gate; }
    } });
    const acceptedId = operation === "compare" ? (await accepted(f.controller)).result.acceptedId : null;
    const before = { provider: f.calls.provider, runner: f.calls.runner, reservations: f.calls.reservations };
    blocked = true;
    const pending = f.controller.action("/api/" + operation, operation === "propose"
      ? { changeId: "a", requestId: "shutdown-propose" }
      : { acceptedId, requestId: "shutdown-compare" });
    const refused = assert.rejects(pending, /STOPPING/);
    await waiting; lifecycle.beginStop();
    let drained = false;
    const drain = lifecycle.drain().then(() => { drained = true; });
    await Promise.resolve(); assert.equal(drained, false);
    release(); await refused; await drain;
    assert.deepEqual({ provider: f.calls.provider, runner: f.calls.runner,
      reservations: f.calls.reservations }, before);
    await assert.rejects(() => f.controller.action("/api/propose",
      { changeId: "a", requestId: "after-shutdown" }), /STOPPING/);
  }
});

test("shutdown during credential loading prevents HTTPS dispatch and clears owned key buffer", async () => {
  const lifecycle = createLifecycle();
  let entered, release, dispatches = 0;
  const waiting = new Promise((done) => { entered = done; });
  const gate = new Promise((done) => { release = done; });
  const key = Buffer.from("synthetic-test-credential-never-real");
  const pending = lifecycle.run(() => museProposal("unused-fixture-path", {}, scope.deadline, {
    lifecycle, now: () => NOW,
    readCredential: async () => { entered(); await gate; return key; },
    request: () => { dispatches++; throw new Error("must not dispatch"); },
  }));
  const refused = assert.rejects(pending, /STOPPING/);
  await waiting; lifecycle.beginStop(); release();
  await refused; await lifecycle.drain();
  assert.equal(dispatches, 0); assert.ok(key.every((byte) => byte === 0));
});

test("response error, aborted and premature close settle once and retain consumed reservation", async () => {
  for (const event of ["error", "aborted", "close"]) {
    const req = new EventEmitter(), res = new EventEmitter();
    let dispatches = 0, destroyed = false, requestBody;
    req.destroy = () => {
      if (!destroyed) { destroyed = true; queueMicrotask(() => req.emit("close")); }
    };
    req.end = (body) => { requestBody = JSON.parse(body); };
    res.statusCode = 200; res.complete = false;
    const f = await fixture({ provider: (packet) => museProposal("unused-fixture-path", packet, scope.deadline, {
      now: () => NOW,
      readCredential: async () => Buffer.from("synthetic-test-credential-never-real"),
      request: (_url, _options, response) => {
        dispatches++;
        queueMicrotask(() => {
          response(res); res.emit("data", Buffer.from("{partial"));
          res.emit(event, event === "error" ? new Error("synthetic stream failure") : undefined);
          res.emit("error", new Error("late synthetic error"));
          res.emit("end");
        });
        return req;
      },
    }) });
    await assert.rejects(() => f.controller.action("/api/propose",
      { changeId: "a", requestId: "stream-" + event }), /PROVIDER_FAILED_CONSUMED/);
    assert.equal(dispatches, 1); assert.equal(f.calls.reservations, 1);
    assert.equal(requestBody.max_output_tokens, 4096);
    assert.equal(requestBody.model, "muse-spark-1.3");
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.stream, false);
    assert.deepEqual(requestBody.tools, []);
    assert.deepEqual(Object.keys(requestBody).sort(),
      ["model", "input", "store", "stream", "tools", "max_output_tokens", "text"].sort());
    assert.equal(Object.hasOwn(requestBody, "reasoning"), false, "initial discovery keeps its existing reasoning policy");
    assert.equal(requestBody.text.format.name, "pricing_cases");
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(f.calls.retained[0].value.outcome, "FAILED_OR_UNKNOWN_CONSUMED");
    assert.equal(destroyed, true);
  }
});

test("provider shutdown waits for delayed close before cleanup can complete", async () => {
  const req = new EventEmitter();
  const requests = new Set([req]);
  let destroyed = false, completed = false;
  req.destroy = () => { destroyed = true; };
  req.once("close", () => requests.delete(req));
  const closing = closeProviderRequests(requests).then(() => { completed = true; });
  assert.equal(destroyed, true);
  await Promise.resolve(); assert.equal(completed, false); assert.equal(requests.size, 1);
  req.emit("close"); await closing;
  assert.equal(completed, true); assert.equal(requests.size, 0);

  const immediate = new EventEmitter(), immediateSet = new Set([immediate]);
  immediate.once("close", () => immediateSet.delete(immediate));
  immediate.destroy = () => immediate.emit("close");
  await closeProviderRequests(immediateSet);
  assert.equal(immediateSet.size, 0);
});

test("a proposal accepts only once; comparison cannot be followed by re-authored expectations", async () => {
  const f = await fixture();
  const { proposal, result } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: result.acceptedId,
    requestId: "request-compare" });
  const retainedCount = f.calls.retained.length;
  await assert.rejects(() => f.controller.action("/api/accept", {
    proposalId: proposal.proposalId,
    expectations: [{ caseId: "case-1", expectedTotal: 9000 }], reviewed: true,
    requestId: "request-reaccept",
  }), /PROPOSAL_ALREADY_ACCEPTED/);
  assert.equal(f.calls.retained.length, retainedCount);
  assert.equal(run.acceptedId, result.acceptedId);
  assert.equal(run.status, "REPRODUCED");
  assert.equal(f.calls.runner, 1);
});

function feedbackRaw(packet, edit = {}) {
  return { status: "completed", model: "muse-spark-1.3", error: null,
    usage: { input_tokens: 20, output_tokens: 30 }, output: [{ type: "message", content: [{ type: "output_text",
      text: JSON.stringify({ bindingId: packet.bindingId, runId: packet.runId,
        explanation: "The proposed implementation charges a different total for the observed voucher-boundary basket.",
        observedFaultCaseIds: packet.initialRows.filter((r) => r.candidate.value !== r.expectedTotal).map((r) => r.caseId),
        decision: "PROPOSE_CASES", cases: [{ lines: [{ amount: 11000, discountEligible: true }],
          expectedTotal: 9900, rationale: "An adjacent threshold case, informed by the observed results." }], ...edit }) }] }] };
}

async function preparedRun(f) {
  const { proposal, result: acceptance } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: acceptance.acceptedId, requestId: "initial-compare" });
  const control = await f.controller.action("/api/control", { runId: run.runId, requestId: "initial-control" });
  return { proposal, acceptance, run, control };
}

test("feedback follows actual original/A/B execution, durable root claim and reservation; followups require review", async () => {
  const f = await fixture();
  const { proposal, acceptance, run, control } = await preparedRun(f);
  assert.equal(control.status, "NO_COUNTEREXAMPLE"); assert.equal(control.origin, "LOCAL_EXECUTION");
  assert.equal(control.acceptedId, acceptance.acceptedId);
  assert.equal(control.sourceIdentities.candidate, "e".repeat(64));
  const feedback = await f.controller.action("/api/feedback", { runId: run.runId, controlId: control.controlId,
    requestId: "initial-feedback" });
  assert.equal(feedback.status, "FOLLOW_UP_PROPOSED");
  assert.equal(f.calls.markers.has(proposal.proposalId), true);
  assert.equal(f.calls.reservations, 2); assert.equal(f.calls.feedback.length, 1);
  const packet = f.calls.feedback[0];
  assert.equal(packet.binding.acceptedCases, run.sourceIdentities.acceptedCases);
  assert.deepEqual(packet.initialRows, run.rows); assert.deepEqual(packet.controlRows, control.rows);
  assert.equal(packet.initialProvenance.origin, "LIVE_INITIAL");
  assert.equal(Object.hasOwn(packet, "controlSource"), false, "no correction source or repair sent to model");
  assert.equal(feedback.proposal.cases.length, 1);
  const before = f.calls.runner;
  await assert.rejects(() => f.controller.action("/api/compare", { acceptedId: feedback.proposal.proposalId,
    requestId: "unreviewed-followup" }), /ACCEPTED_CASES_REQUIRED/);
  await assert.rejects(() => f.controller.action("/api/accept", { proposalId: feedback.proposal.proposalId,
    reviewed: true, expectations: [{ caseId: "feedback-case-1", expectedTotal: 10000 }], requestId: "wrong-followup-total" }), /EXPECTATION_RULE_MISMATCH/);
  assert.equal(f.calls.runner, before);
  const reviewed = await f.controller.action("/api/accept", { proposalId: feedback.proposal.proposalId,
    reviewed: true, expectations: [{ caseId: "feedback-case-1", expectedTotal: 9900 }], requestId: "review-followup" });
  const next = await f.controller.action("/api/compare", { acceptedId: reviewed.acceptedId, requestId: "compare-followup" });
  const nextControl = await f.controller.action("/api/control", { runId: next.runId, requestId: "control-followup" });
  assert.equal(next.status, "REPRODUCED"); assert.equal(nextControl.status, "NO_COUNTEREXAMPLE");
  await assert.rejects(() => f.controller.action("/api/feedback", { runId: next.runId, controlId: nextControl.controlId,
    requestId: "recursive-feedback" }), /INITIAL_REPRODUCED_RUN_REQUIRED/);
  // Initial regression stays independently usable after follow-up execution.
  const exported = await f.controller.action("/api/export", { runId: run.runId, requestId: "keep-root-regression" });
  assert.ok(exported.testSource.includes('"amount": 10000'));
});

test("a new comparison/control/request cannot reopen the same root feedback allowance", async () => {
  const f = await fixture(); const { acceptance, run, control } = await preparedRun(f);
  await f.controller.action("/api/feedback", { runId: run.runId, controlId: control.controlId, requestId: "feedback-once" });
  const next = await f.controller.action("/api/compare", { acceptedId: acceptance.acceptedId, requestId: "recompare-root" });
  const b = await f.controller.action("/api/control", { runId: next.runId, requestId: "recontrol-root" });
  await assert.rejects(() => f.controller.action("/api/feedback", { runId: next.runId,
    controlId: b.controlId, requestId: "feedback-twice" }), /FEEDBACK_ALREADY_ATTEMPTED/);
  assert.equal(f.calls.feedback.length, 1); assert.equal(f.calls.reservations, 2);
});

test("feedback refuses missing/mismatched/inconclusive B control and source drift before dispatch", async () => {
  const f = await fixture(); const { run, control } = await preparedRun(f);
  for (const body of [{ runId: run.runId, controlId: "other-control", requestId: "mismatch-control" },
    { runId: run.runId, controlId: control.controlId, requestId: "injected-feedback", command: "bad" }]) {
    await assert.rejects(() => f.controller.action("/api/feedback", body));
  }
  assert.equal(f.calls.feedback.length, 0); assert.equal(f.calls.reservations, 1);
  let dirty = false;
  const changed = await fixture({ verifySources: async () => { if (dirty) throw new Error("SOURCE_IDENTITY_CHANGED"); } });
  const prior = await preparedRun(changed); dirty = true;
  await assert.rejects(() => changed.controller.action("/api/feedback", { runId: prior.run.runId,
    controlId: prior.control.controlId, requestId: "changed-feedback" }), /SOURCE_IDENTITY_CHANGED/);
  assert.equal(changed.calls.reservations, 1); assert.equal(changed.calls.feedback.length, 0);
  const badB = await fixture({ runner: async () => ({ rows: [{ original: { value: 9000, error: null },
    candidate: { value: 8550, error: null } }] }) });
  const bad = await preparedRun(badB);
  await assert.rejects(() => badB.controller.action("/api/feedback", { runId: bad.run.runId,
    controlId: bad.control.controlId, requestId: "bad-b-feedback" }), /MATCHING_CONTROL_REQUIRED/);
});

test("uncertain root marker, reservation or provider failures do not permit another feedback attempt", async () => {
  for (const kind of ["lookup", "marker", "reservation", "provider", "malformed"]) {
    let reservations = 0, providers = 0;
    const overrides = {
      ledger: { ready: async () => ({ reservations: [] }), reserve: async () => {
        reservations++; if (kind === "reservation" && reservations > 1) throw new Error("uncertain reservation"); return reservations;
      } },
      feedbackProvider: async (packet) => { providers++; if (kind === "provider") throw new Error("provider failed");
        return feedbackRaw(packet, { bindingId: "wrong-binding" }); },
    };
    if (kind === "marker") overrides.feedbackAttempts = { has: async () => false,
      claim: async () => { throw new Error("uncertain marker"); } };
    if (kind === "lookup") overrides.feedbackAttempts = { has: async () => { throw new Error("uncertain marker lookup"); },
      claim: async () => { throw new Error("must not claim"); } };
    const f = await fixture(overrides); const { run, control } = await preparedRun(f);
    const body = { runId: run.runId, controlId: control.controlId, requestId: "first-feedback" };
    await assert.rejects(() => f.controller.action("/api/feedback", body));
    await assert.rejects(() => f.controller.action("/api/feedback", { ...body, requestId: "retry-feedback" }), /FEEDBACK_ALREADY_ATTEMPTED/);
    assert.equal(providers, ["provider", "malformed"].includes(kind) ? 1 : 0);
    assert.equal(reservations, ["lookup", "marker"].includes(kind) ? 1 : 2);
  }
});

test("feedback final-output validator locks exact bound faults, STOP and 1-2 new data-only cases", async () => {
  const f = await fixture(); const { run, control } = await preparedRun(f);
  await f.controller.action("/api/feedback", { runId: run.runId, controlId: control.controlId, requestId: "obtain-packet" });
  const packet = f.calls.feedback[0];
  assert.equal(feedbackFromResponse(feedbackRaw(packet, { decision: "STOP", cases: [] }), packet).status, "STOPPED");
  for (const edit of [{ bindingId: "f".repeat(64) }, { runId: "other-run" }, { explanation: "x".repeat(601) },
    { observedFaultCaseIds: ["made-up-fault"] }, { observedFaultCaseIds: [] }, { decision: "STOP" },
    { cases: [] }, { command: "bad" }, { cases: Array(3).fill({}) }]) {
    assert.throws(() => feedbackFromResponse(feedbackRaw(packet, edit), packet));
  }
  const duplicate = feedbackRaw(packet, { cases: [{ lines: packet.acceptedCases[0].lines,
    expectedTotal: 9000, rationale: "Repeats prior case." }] });
  assert.equal(feedbackFromResponse(duplicate, packet).status, "INCONCLUSIVE");
  const bad = feedbackRaw(packet); bad.status = "incomplete";
  assert.throws(() => feedbackFromResponse(bad, packet), /MODEL_INCOMPLETE/);
  const altered = { ...packet, binding: { ...packet.binding, control: "f".repeat(64) } };
  const selected = { record: { proposalId: packet.binding.proposalId, acceptedCases: packet.acceptedCases },
    change: { id: packet.binding.scenarioId, originalSha256: packet.binding.original, candidateSha256: packet.binding.candidate,
      rule: packet.rule, originalSource: packet.originalSource, candidateSource: packet.proposedSource } };
  const rebound = feedbackContext({ run, control, selected, ruleSha256: packet.binding.rule,
    controlSha256: altered.binding.control, provenance: packet.initialProvenance });
  assert.notEqual(rebound.bindingId, packet.bindingId);
});

async function checkpointFixture() {
  const f = await fixture(); const { proposal, acceptance, run } = await preparedRun(f);
  // These are synthetic legacy V1 records, deliberately not the current API shape.
  delete proposal.scenarioId; delete acceptance.scenarioId; delete run.scenarioId;
  return { version: 1, scopeId: scope.id, recordedAt: new Date(NOW - 1000).toISOString(),
    sourceIdentities: { rule: "d".repeat(64), original: "a".repeat(64), candidate: "b".repeat(64), control: "e".repeat(64) },
    model: { responseId: "resp_synthetic_fixture", recordSha256: "f".repeat(64), createdAt: Math.floor(NOW / 1000) - 2 },
    sourceRecordHashes: { accepted: "1".repeat(64), comparison: "2".repeat(64) },
    proposalProvenance: "DERIVED_FROM_RETAINED_MODEL_AND_ACCEPTANCE",
    proposal, accepted: acceptance, comparison: run,
    recordHashes: { proposal: sha(JSON.stringify(proposal)), accepted: sha(JSON.stringify(acceptance)), comparison: sha(JSON.stringify(run)) },
    reviewEvidence: "operator declaration, not independently attested human identity" };
}

function checkpointContext(checkpoint) {
  return { scopeId: scope.id, sources: checkpoint.sourceIdentities, now: NOW,
    change: { originalSha256: "a".repeat(64), candidateSha256: "b".repeat(64) } };
}

test("owner checkpoint is a pinned private bounded projection with exact sources/records/linkage, not an import endpoint", async () => {
  const c = await checkpointFixture(); const context = checkpointContext(c);
  assert.deepEqual(validateRetainedCheckpoint(c, context), c);
  for (const edit of [v => { v.scopeId = "other-scope"; }, v => { v.recordHashes.accepted = "0".repeat(64); },
    v => { v.sourceIdentities.control = "0".repeat(64); }, v => { v.recordedAt = "2027-01-01T00:00:00Z"; },
    v => { v.baseline = { status: "PASS" }; }, v => { v.reviewEvidence = "Bobai approved"; }]) {
    const v = structuredClone(c); edit(v); assert.throws(() => validateRetainedCheckpoint(v, context));
  }
  for (const edit of [v => { v.accepted.proposalId = "wrong-proposal"; },
    v => { v.accepted.acceptedCases[0].expectedTotal = 8000; },
    v => { v.comparison.rows[0].candidate.value = 9000; }, v => { v.comparison.sourceIdentities.acceptedCases = "0".repeat(64); }]) {
    const v = structuredClone(c); edit(v);
    for (const k of ["proposal", "accepted", "comparison"]) v.recordHashes[k] = sha(JSON.stringify(v[k]));
    assert.throws(() => validateRetainedCheckpoint(v, context));
  }
  await owned(async (root) => {
    const path = join(root, "checkpoint.json"), bytes = JSON.stringify(c);
    await writeFile(path, bytes, { mode: 0o400 });
    const pin = { path, sha256: sha(bytes) };
    assert.deepEqual(await loadRetainedCheckpoint(pin, context), c);
    await assert.rejects(() => loadRetainedCheckpoint({ ...pin, sha256: "0".repeat(64) }, context), /CHECKPOINT_PIN_MISMATCH/);
    await chmod(path, 0o644); await assert.rejects(() => loadRetainedCheckpoint(pin, context), /PRIVATE_FILE_REQUIRED/);
    await chmod(path, 0o400); await symlink(path, join(root, "linked.json"));
    await assert.rejects(() => loadRetainedCheckpoint({ ...pin, path: join(root, "linked.json") }, context));
    await chmod(path, 0o600); await writeFile(path, "x".repeat(32769)); await chmod(path, 0o400);
    await assert.rejects(() => loadRetainedCheckpoint(pin, context), /PRIVATE_FILE_REQUIRED/);
  });
  assert.throws(() => checkRequest("POST", "/api/import", { host: "127.0.0.1:48761" }, "x"), /NOT_FOUND/);
});

test("retained initial evidence requires fresh baseline and B control, preserves provenance and uses only one new reservation", async () => {
  const checkpoint = await checkpointFixture(); let reservations = 1;
  const f = await fixture({ retainedCheckpoint: checkpoint,
    ledger: { ready: async () => ({ reservations: Array(reservations) }), reserve: async () => ++reservations } },
  { prepareBaseline: false });
  const session = await f.controller.session();
  assert.deepEqual(session.retainedInitial.proposal, checkpoint.proposal);
  assert.equal(session.retainedInitial.recordedAt, checkpoint.recordedAt);
  assert.equal(session.feedbackAttempted, false); assert.equal(f.calls.baseline, 0); assert.equal(f.calls.provider, 0);
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "retained-no-propose" }), /RETAINED_INITIAL_MODE/);
  assert.equal(reservations, 1); assert.equal(f.calls.provider, 0);
  const runId = checkpoint.comparison.runId;
  await assert.rejects(() => f.controller.action("/api/control", { runId, requestId: "early-retained-control" }), /PASSING_BASELINE_REQUIRED/);
  await f.controller.action("/api/baseline", { changeId: "a", requestId: "new-baseline" });
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "retained-no-propose-after-pass" }), /RETAINED_INITIAL_MODE/);
  assert.equal(reservations, 1); assert.equal(f.calls.provider, 0, "retained mode cannot spend the last call on another initial proposal");
  const control = await f.controller.action("/api/control", { runId, requestId: "new-retained-control" });
  const feedback = await f.controller.action("/api/feedback", { runId, controlId: control.controlId, requestId: "retained-feedback" });
  assert.equal(feedback.callsUsed, 2); assert.equal(f.calls.provider, 0); assert.equal(f.calls.feedback.length, 1);
  assert.equal(f.calls.feedback[0].initialProvenance.origin, "RETAINED_LIVE");
  assert.equal(f.calls.feedback[0].initialProvenance.recordedAt, checkpoint.recordedAt);
  assert.deepEqual(f.calls.feedback[0].initialProvenance.recordHashes, checkpoint.recordHashes);
  assert.equal((await f.controller.session()).feedbackAttempted, true);
});

test("durable root attempt survives restart and corrupt/linked marker is not absence", async () => {
  await owned(async (root) => {
    const attempts = createFeedbackAttempts(root), id = "fixture-root-proposal";
    const record = { runId: "fixture-run-id", requestId: "fixture-request-id", bindingId: "a".repeat(64) };
    assert.equal(await attempts.has(id), false); await attempts.claim(id, record);
    assert.equal(await createFeedbackAttempts(root).has(id), true);
    await assert.rejects(() => attempts.claim(id, record), /FEEDBACK_ALREADY_ATTEMPTED/);
    const path = join(root, "feedback-attempt-" + id + ".json");
    await writeFile(path, "{"); await assert.rejects(() => attempts.has(id));
    await rm(path); await symlink("missing-file", path); await assert.rejects(() => attempts.has(id));
  });
});

test("retained-root export and regression append fresh request records without clobbering historical proof", async () => {
  const checkpoint = await checkpointFixture(), runId = checkpoint.comparison.runId;
  await owned(async (root) => {
    const oldNames = ["export-" + runId, "regression-" + runId];
    for (const name of oldNames) await writeFile(join(root, name + ".json"), "historical proof\n", { mode: 0o600, flag: "wx" });
    const f = await fixture({ retainedCheckpoint: checkpoint,
      retain: async (name, data) => writeFile(join(root, name + ".json"), JSON.stringify(data), { mode: 0o600, flag: "wx" }) });
    const exported = await f.controller.action("/api/export", { runId, requestId: "fresh-retained-export" });
    const proof = await f.controller.action("/api/regression", { runId, exportId: exported.exportId, requestId: "fresh-retained-regression" });
    assert.equal(proof.status, "RED_THEN_GREEN"); assert.equal(proof.testSha256, exported.sha256);
    for (const name of oldNames) assert.equal(await readFile(join(root, name + ".json"), "utf8"), "historical proof\n");
    assert.equal(JSON.parse(await readFile(join(root, "export-" + runId + "-fresh-retained-export.json"))).sha256, exported.sha256);
    assert.equal(JSON.parse(await readFile(join(root, "regression-" + runId + "-fresh-retained-regression.json"))).testSha256, exported.sha256);
  });
});

test("feedback alone uses fixed low reasoning with the same model/4096 cap, closed schema and no tools", async () => {
  let body, options, url; const req = new EventEmitter(), res = new EventEmitter();
  const keyText = "synthetic-test-credential-never-real", key = Buffer.from(keyText);
  req.destroy = () => req.emit("close");
  req.end = (value) => { body = JSON.parse(value); };
  res.statusCode = 200; res.complete = true;
  const raw = await museFeedback("unused", { public: "synthetic outputs" }, scope.deadline, {
    now: () => NOW, readCredential: async () => key,
    reasoning: { effort: "max" }, reasoning_effort: "high", max_output_tokens: 99999,
    request: (u, o, callback) => {
      url = u; options = o;
      queueMicrotask(() => { callback(res); res.emit("data", Buffer.from(JSON.stringify({ echo: keyText })));
        res.emit("end"); req.emit("close"); }); return req;
    },
  });
  assert.equal(url, "https://api.meta.ai/v1/responses"); assert.equal(options.method, "POST");
  assert.equal(body.max_output_tokens, 4096); assert.equal(body.model, "muse-spark-1.3");
  assert.equal(body.store, false); assert.equal(body.stream, false); assert.deepEqual(body.tools, []);
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.deepEqual(Object.keys(body).sort(),
    ["model", "input", "store", "stream", "tools", "reasoning", "max_output_tokens", "text"].sort());
  assert.equal(Object.hasOwn(body, "reasoning_effort"), false, "no Chat Completions syntax or caller wire override");
  assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, "pricing_feedback"); assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(raw.echo, "[REDACTED]"); assert.ok(key.every((x) => x === 0));
});

test("reasoning-heavy incomplete feedback is retained, refused and consumed once without retry", async () => {
  const incomplete = { status: "incomplete", model: "muse-spark-1.3", error: null,
    incomplete_details: { reason: "max_output_tokens" },
    usage: { input_tokens: 1547, output_tokens: 4096, output_tokens_details: { reasoning_tokens: 4094 } },
    output: [{ type: "message", content: [{ type: "output_text", text: '{"bindingId":' }] }] };
  let dispatches = 0, body;
  const key = Buffer.from("synthetic-test-credential-never-real");
  const f = await fixture({ feedbackProvider: (packet) => museFeedback("unused-fixture-path", packet, scope.deadline, {
    now: () => NOW, readCredential: async () => key,
    request: (_url, _options, callback) => {
      dispatches++;
      const req = new EventEmitter(), res = new EventEmitter();
      req.destroy = () => req.emit("close");
      req.end = (value) => { body = JSON.parse(value); };
      res.statusCode = 200; res.complete = true;
      queueMicrotask(() => {
        callback(res); res.emit("data", Buffer.from(JSON.stringify(incomplete)));
        res.emit("end"); req.emit("close");
      });
      return req;
    },
  }) });
  const { proposal, run, control } = await preparedRun(f);
  const request = { runId: run.runId, controlId: control.controlId, requestId: "feedback-incomplete-once" };
  await assert.rejects(() => f.controller.action("/api/feedback", request), /MODEL_INCOMPLETE/);
  assert.deepEqual(body.reasoning, { effort: "low" }); assert.equal(body.max_output_tokens, 4096);
  assert.deepEqual(f.calls.retained.find((entry) => entry.name === "feedback-model-2").value, incomplete);
  assert.equal(f.calls.retained.some((entry) => entry.name === "feedback-" + proposal.proposalId), false);
  assert.equal(f.calls.reservations, 2); assert.equal(f.calls.markers.size, 1);
  await assert.rejects(() => f.controller.action("/api/feedback", { ...request, requestId: "feedback-no-retry" }),
    /FEEDBACK_ALREADY_ATTEMPTED/);
  assert.equal(dispatches, 1); assert.equal(f.calls.reservations, 2);
  assert.ok(key.every((byte) => byte === 0));
});

async function sessionFixture(operation) {
  await owned(async (parent) => {
    const root = join(parent, "checkout"); await mkdir(root, { mode: 0o700 });
    for (const name of RUNTIME_FILES) {
      await mkdir(join(root, name, ".."), { recursive: true, mode: 0o700 });
      await writeFile(join(root, name), "synthetic source: " + name, { mode: 0o600 });
    }
    const key = join(parent, "fake-key"), node = join(parent, "fake-node"), ota = join(parent, "fake-ota");
    await writeFile(key, "fake-only-not-a-real-credential", { mode: 0o600 });
    await writeFile(node, "synthetic never-executed node", { mode: 0o700 });
    await writeFile(ota, "synthetic never-executed ota", { mode: 0o700 });
    const environment = { META_DEMO_APPROVAL_FILE: join(root, "evidence/live/recording-fixture/approval.json"),
      META_DEMO_KEY_FILE: key, META_DEMO_OTA_EXECUTABLE: ota,
      META_DEMO_SESSION_MINUTES: "20", META_DEMO_REQUEST_LIMIT: "2" };
    const prepare = () => prepareSession({ root, environment, nodeExecutable: node, now: () => NOW });
    const load = (now = NOW) => loadOwnerSession({ root, approvalFile: environment.META_DEMO_APPROVAL_FILE, now: () => now });
    await operation({ root, environment, key, node, ota, prepare, load });
    assert.equal(await readFile(key, "utf8"), "fake-only-not-a-real-credential");
  });
}

test("fresh explicit session preparation auto-pins sources/binaries, creates a private V2 pair and does not run anything", async () => {
  await sessionFixture(async ({ environment, node, ota, prepare, load }) => {
    const before = JSON.stringify(environment);
    const result = await prepare();
    assert.equal(result.requestLimit, 2); assert.equal(result.deadline, scope.deadline);
    const { approval, ledger, scope: actualScope } = await load();
    assert.equal(approval.version, 2); assert.equal(approval.requestLimit, 2);
    assert.equal(approval.nodeSha256, sha(await readFile(node))); assert.equal(approval.otaSha256, sha(await readFile(ota)));
    assert.deepEqual(Object.keys(approval.sourceHashes), RUNTIME_FILES);
    assert.equal((await lstat(environment.META_DEMO_APPROVAL_FILE)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(environment.META_DEMO_APPROVAL_FILE, ".."))).mode & 0o777, 0o700);
    assert.equal((await ledger.ready()).version, 2); assert.equal((await ledger.ready()).reservations.length, 0);
    assert.equal(actualScope.limit, 2); assert.equal(JSON.stringify(environment), before);
    await ledger.reserve("fresh-request-1");
    const restarted = await load(); assert.equal((await restarted.ledger.ready()).reservations.length, 1);
    await restarted.ledger.reserve("fresh-request-2");
    await assert.rejects(load, /REQUEST_BUDGET_EXHAUSTED/);
    await assert.rejects(prepare, /SESSION_ALREADY_EXISTS/);
    assert.equal((await restarted.ledger.ready()).reservations.length, 2);
  });
});

test("session preparation rejects missing/malformed inputs before writing approval or budget", async () => {
  const changes = [
    ["META_DEMO_APPROVAL_FILE", undefined], ["META_DEMO_APPROVAL_FILE", "/tmp/arbitrary-approval.json"],
    ["META_DEMO_SESSION_MINUTES", undefined], ["META_DEMO_SESSION_MINUTES", "0"], ["META_DEMO_SESSION_MINUTES", "61"],
    ["META_DEMO_SESSION_MINUTES", "1.5"], ["META_DEMO_REQUEST_LIMIT", "0"], ["META_DEMO_REQUEST_LIMIT", "7"],
    ["META_DEMO_REQUEST_LIMIT", " 2"], ["META_DEMO_KEY_FILE", undefined], ["META_DEMO_OTA_EXECUTABLE", undefined],
  ];
  for (const [name, value] of changes) {
    await sessionFixture(async ({ root, environment, prepare }) => {
      environment[name] = value;
      await assert.rejects(prepare);
      await assert.rejects(() => lstat(join(root, "evidence")), /ENOENT/);
    });
  }
});

test("bounded windows reject expired, future, reversed, oversized or unbounded records", () => {
  validateSessionWindow(scope, NOW);
  for (const change of [{ limit: 0 }, { limit: 7 }, { deadline: scope.issuedAt },
    { deadline: new Date(NOW + 61 * 60000).toISOString() }, { issuedAt: "not-a-date" },
    { deadline: "9999-01-01T00:00:00.000Z" }]) assert.throws(() => validateSessionWindow({ ...scope, ...change }, NOW));
  assert.throws(() => validateSessionWindow(scope, NOW - 1), /SESSION_WINDOW_EXPIRED_OR_FUTURE/);
  assert.throws(() => validateSessionWindow(scope, Date.parse(scope.deadline)), /SESSION_WINDOW_EXPIRED_OR_FUTURE/);
});

test("startup refuses missing/malformed/expired or partial established configuration without repairing it", async () => {
  await sessionFixture(async ({ environment, prepare, load }) => {
    await assert.rejects(load, /SESSION_NOT_PREPARED/);
    await prepare();
    await assert.rejects(() => load(NOW - 1), /SESSION_WINDOW_EXPIRED_OR_FUTURE/);
    await assert.rejects(() => load(Date.parse(scope.deadline)), /SESSION_WINDOW_EXPIRED_OR_FUTURE/);
    const file = environment.META_DEMO_APPROVAL_FILE, before = await readFile(file);
    await writeFile(file, "{"); await assert.rejects(load, /APPROVAL_INVALID/); await writeFile(file, before);
    const budget = join(file, "../budget.json"), old = await readFile(budget);
    await rm(budget); await assert.rejects(load, /SESSION_INCOMPLETE/);
    await assert.rejects(prepare, /SESSION_ALREADY_EXISTS/);
    await assert.rejects(() => lstat(budget), /ENOENT/);
    await writeFile(budget, old, { mode: 0o600 });
    const loaded = await load(); assert.equal((await loaded.ledger.ready()).reservations.length, 0);
  });
});

test("source/binary/private-key metadata mismatches refuse before a session can be used", async () => {
  for (const target of ["source", "node", "ota", "keymode", "keyinside", "linked-key"]) {
    await sessionFixture(async ({ root, environment, key, node, ota, prepare, load }) => {
      if (target === "keyinside") {
        environment.META_DEMO_KEY_FILE = join(root, "private-key");
        await writeFile(environment.META_DEMO_KEY_FILE, "fake-only-not-a-real-credential", { mode: 0o600 });
        await assert.rejects(prepare, /KEY_MUST_BE_OUTSIDE_REPOSITORY/); return;
      }
      if (target === "linked-key") {
        environment.META_DEMO_KEY_FILE = key + "-link"; await symlink(key, environment.META_DEMO_KEY_FILE);
        await assert.rejects(prepare); return;
      }
      await prepare();
      if (target === "source") await writeFile(join(root, "pricing/original.ts"), "tampered source");
      if (target === "node") await writeFile(node, "tampered executable");
      if (target === "ota") await writeFile(ota, "tampered executable");
      if (target === "keymode") await chmod(key, 0o644);
      await assert.rejects(load);
    });
  }
});

test("a case-insensitive filesystem alias cannot put the private key inside the checkout", async (t) => {
  await sessionFixture(async ({ root, environment, prepare }) => {
    const alias = join(root, "../CHECKOUT");
    let actual;
    try { actual = await lstat(alias); } catch (e) { if (e.code === "ENOENT") { t.skip("case-sensitive filesystem"); return; } throw e; }
    const expected = await lstat(root);
    assert.equal(actual.dev, expected.dev); assert.equal(actual.ino, expected.ino);
    await writeFile(join(root, "alias-fake-key"), "fake-only-not-a-real-credential", { mode: 0o600 });
    environment.META_DEMO_KEY_FILE = join(alias, "alias-fake-key");
    await assert.rejects(prepare, /KEY_MUST_BE_OUTSIDE_REPOSITORY/);
    await assert.rejects(() => lstat(join(root, "evidence")), /ENOENT/);
  });
});

test("historical V1 or exhausted ledgers cannot become fresh sessions or gain lock-side effects", async () => {
  await sessionFixture(async ({ environment, prepare, load }) => {
    await prepare();
    const file = environment.META_DEMO_APPROVAL_FILE, originalApproval = await readFile(file);
    const path = join(file, "../budget.json");
    const oldBudget = JSON.stringify({ version: 1, scopeId: "recording-fixture", deadline: scope.deadline,
      limit: 6, reservations: Array.from({ length: 6 }, (_, i) => ({ requestId: "historical-" + i, reservedAt: scope.issuedAt })) });
    await writeFile(path, oldBudget);
    await assert.rejects(load, /LEGACY_SESSION_READ_ONLY/);
    const ledger = new BudgetLedger(path, { ...scope, id: "recording-fixture", limit: 2 }, { now: () => NOW });
    await assert.rejects(() => ledger.reserve("must-not-dispatch"), /LEGACY_SESSION_READ_ONLY/);
    await assert.rejects(() => lstat(path + ".lock"), /ENOENT/);
    await assert.rejects(prepare, /SESSION_ALREADY_EXISTS/);
    assert.equal(await readFile(path, "utf8"), oldBudget);
    await writeFile(file, JSON.stringify({ version: 1 }));
    await assert.rejects(load, /LEGACY_SESSION_READ_ONLY/);
    assert.equal(await readFile(path, "utf8"), oldBudget);
    await writeFile(file, originalApproval);
  });
});

test("setup errors give actionable public configuration guidance, not a hidden hash checklist", () => {
  assert.match(startupHint("SESSION_NOT_PREPARED"), /ota run demo:live:budget --agent/);
  assert.match(startupHint("SESSION_MINUTES_INVALID"), /1 to 60/);
  assert.match(startupHint("REQUEST_LIMIT_INVALID"), /1 to 6/);
  assert.match(startupHint("LEGACY_SESSION_READ_ONLY"), /cannot be renewed or imported/);
});

test("controller session reports the actual configured request cap", async () => {
  const f = await fixture({ scope: { ...scope, limit: 1 } });
  assert.equal((await f.controller.session()).limit, 1);
});

// Explicit optional owner evidence input, never part of ordinary fixture proof or service startup.
if (process.env.OTA_DEMO_TEST_CHECKPOINT || process.env.OTA_DEMO_TEST_CHECKPOINT_SHA256) {
  test("the explicitly pinned owner checkpoint validates against current rule/original/A/B without service/provider adoption", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = { rule: "pricing/rule.json", original: "pricing/original.ts",
      candidate: "pricing/change-a.ts", control: "pricing/change-b.ts" };
    const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
      [key, sha(await readFile(join(root, file)))])));
    const checkpoint = await loadRetainedCheckpoint({ path: process.env.OTA_DEMO_TEST_CHECKPOINT,
      sha256: process.env.OTA_DEMO_TEST_CHECKPOINT_SHA256 }, {
      scopeId: "pricing-live-mvp-20261027-01", sources,
      change: { originalSha256: sources.original, candidateSha256: sources.candidate },
    });
    assert.equal(checkpoint.proposal.callsUsed, 5);
    assert.equal(checkpoint.model.responseId, "resp_6ae0777356302ca9d9a840a9");
    assert.equal(checkpoint.proposalProvenance, "DERIVED_FROM_RETAINED_MODEL_AND_ACCEPTANCE");
    assert.deepEqual(checkpoint.comparison.rows.map((r) => r.candidate.value), [8550, 17550]);
    assert.deepEqual(checkpoint.accepted.acceptedCases.map((c) => c.expectedTotal), [9000, 17500]);
  });
}
