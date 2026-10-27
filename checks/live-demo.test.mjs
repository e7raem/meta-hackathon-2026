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
  createFeedbackAttempts, museFeedback, ORIGIN } from "../tools/live-demo.mjs";

// All providers/runners/reviewer decisions in this file are synthetic offline fixtures.
const TEMP = fileURLToPath(new URL("../evidence/live-tests/", import.meta.url));
const NOW = Date.parse("2026-10-27T00:00:00.000Z");
const scope = { id: "fixture-scope", deadline: "2026-10-27T03:50:52.000Z", limit: 6 };
const sha = (value) => createHash("sha256").update(value).digest("hex");
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
  const calls = { provider: 0, feedback: [], runner: 0, reservations: 0, baseline: 0, regressions: [], exports: [], retained: [], markers: new Set() };
  const raw = { status: "completed", error: null, model: "muse-spark-1.3",
    usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: "message", content: [{ type: "output_text",
      text: JSON.stringify({ cases: [{ lines, expectedTotal: 9000, rationale: "Synthetic boundary case." }] }) }] }] };
  const controller = createController({ changes: [{ id: "a", title: "Prepared change A",
    originalSource: "neutral original", candidateSource: "neutral proposed", rule: { text: "Independent fixture rule" },
    originalSha256: "a".repeat(64), candidateSha256: "b".repeat(64), diff: "neutral diff" }],
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
    baseline: async () => { calls.baseline++; return { status: "PASS", cleanup: { ownedCopiesRemoved: true },
      execution: { exitCode: 0, counts: { tests: 6, passed: 6, failed: 0, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" } }; },
    regression: async (input) => {
      calls.regressions.push(input);
      return { status: "RED_THEN_GREEN", sameTest: true, testSha256: input.testSha256,
        red: { exitCode: 1, counts: { tests: 1, passed: 0, failed: 1, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" },
        green: { exitCode: 0, counts: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }, stdout: "", stderr: "" },
        correction: { kind: "PRE_REVIEWED_FIXED", label: "Synthetic reviewed correction", faultySha256: "a".repeat(64), correctedSha256: "b".repeat(64) },
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
  persistExport: async (source) => { calls.exports.push(source); return { sha256: sha(source) }; },
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
  await assert.rejects(() => f.controller.action("/api/regression", { runId: "unknown", requestId: "early-regression" }), /REPRODUCED_EXPORT_REQUIRED/);
  const { result } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, requestId: "no-export" }), /REPRODUCED_EXPORT_REQUIRED/);
  const exported = await f.controller.action("/api/export", { runId: run.runId, requestId: "request-export" });
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, requestId: "path-injection", path: "elsewhere" }), /INVALID_FIELDS/);
  const proof = await f.controller.action("/api/regression", { runId: run.runId, requestId: "request-regression" });
  assert.equal(proof.status, "RED_THEN_GREEN"); assert.equal(proof.origin, "LOCAL_EXECUTION");
  assert.equal(proof.testSha256, exported.sha256);
  assert.equal(f.calls.regressions[0].testSource, exported.testSource);
  assert.equal(f.calls.regressions[0].expectedTests, 1); assert.equal(f.calls.regressions[0].expectedFailures, 1);
  assert.equal(f.calls.provider, 1, "red-green does not make a second model request");
  await assert.rejects(() => f.controller.action("/api/regression", { runId: run.runId, requestId: "repeat-regression" }), /REGRESSION_ALREADY_RUN/);
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

test("export atomically persists exact runnable bytes, preserves private mode, rejects unowned/changed preimages", async () => {
  await owned(async (root) => {
    const artifact = join(root, "regression.test.mjs"), record = join(root, "owned.json");
    const input = { artifact, record, scopeId: scope.id, source: "// fixed synthetic test\n" };
    const first = await persistRegression(input);
    assert.equal(await readFile(artifact, "utf8"), input.source);
    assert.equal(first.sha256, sha(input.source)); assert.equal((await lstat(artifact)).mode & 0o777, 0o600);
    const second = await persistRegression({ ...input, source: "// another fixed synthetic test\n" });
    assert.equal(second.sha256, sha(await readFile(artifact)));
    await writeFile(artifact, "external change");
    await assert.rejects(() => persistRegression(input), /EXPORT_PREIMAGE_CHANGED/);
  });
});

test("export persistence failure returns no successful command or missing-artifact claim", async () => {
  const f = await fixture({ persistExport: async () => { throw new Error("synthetic disk failure"); } });
  const { result } = await accepted(f.controller);
  const run = await f.controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  await assert.rejects(() => f.controller.action("/api/export", { runId: run.runId, requestId: "request-export" }), /synthetic disk/);
  await owned(async (root) => {
    const artifact = join(root, "regression.test.mjs"), record = join(root, "owned.json");
    await assert.rejects(() => persistRegression({ artifact, record, scopeId: scope.id, source: "// test\n",
      beforeCommit: () => { throw new Error("synthetic interrupted export"); } }), /synthetic/);
    await assert.rejects(() => lstat(artifact), /ENOENT/);
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
    change: { originalSha256: packet.binding.original, candidateSha256: packet.binding.candidate,
      rule: packet.rule, originalSource: packet.originalSource, candidateSource: packet.proposedSource } };
  const rebound = feedbackContext({ run, control, selected, ruleSha256: packet.binding.rule,
    controlSha256: altered.binding.control, provenance: packet.initialProvenance });
  assert.notEqual(rebound.bindingId, packet.bindingId);
});

async function checkpointFixture() {
  const f = await fixture(); const { proposal, acceptance, run } = await preparedRun(f);
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
    const proof = await f.controller.action("/api/regression", { runId, requestId: "fresh-retained-regression" });
    assert.equal(proof.status, "RED_THEN_GREEN"); assert.equal(proof.testSha256, exported.sha256);
    for (const name of oldNames) assert.equal(await readFile(join(root, name + ".json"), "utf8"), "historical proof\n");
    assert.equal(JSON.parse(await readFile(join(root, "export-" + runId + "-fresh-retained-export.json"))).sha256, exported.sha256);
    assert.equal(JSON.parse(await readFile(join(root, "regression-" + runId + "-fresh-retained-regression.json"))).testSha256, exported.sha256);
  });
});

test("feedback provider reuses the fixed model/4096 cap, closed schema and redaction without executable tools", async () => {
  let body, options, url; const req = new EventEmitter(), res = new EventEmitter();
  const keyText = "synthetic-test-credential-never-real", key = Buffer.from(keyText);
  req.destroy = () => req.emit("close");
  req.end = (value) => { body = JSON.parse(value); };
  res.statusCode = 200; res.complete = true;
  const raw = await museFeedback("unused", { public: "synthetic outputs" }, scope.deadline, {
    now: () => NOW, readCredential: async () => key,
    request: (u, o, callback) => {
      url = u; options = o;
      queueMicrotask(() => { callback(res); res.emit("data", Buffer.from(JSON.stringify({ echo: keyText })));
        res.emit("end"); req.emit("close"); }); return req;
    },
  });
  assert.equal(url, "https://api.meta.ai/v1/responses"); assert.equal(options.method, "POST");
  assert.equal(body.max_output_tokens, 4096); assert.equal(body.model, "muse-spark-1.3");
  assert.equal(body.store, false); assert.equal(body.stream, false); assert.deepEqual(body.tools, []);
  assert.equal(body.text.format.name, "pricing_feedback"); assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(raw.echo, "[REDACTED]"); assert.ok(key.every((x) => x === 0));
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
