import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm, lstat, chmod, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { BudgetLedger, initializeBudget, persistRegression, createController, checkRequest,
  buildRunnerEnvironment, exportRegression, ruleTotal, createLifecycle, museProposal, closeProviderRequests,
  ORIGIN } from "../tools/live-demo.mjs";

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

function fixture(overrides = {}) {
  const lines = [{ amount: 10000, discountEligible: true }];
  const calls = { provider: 0, runner: 0, reservations: 0, exports: [], retained: [] };
  const raw = { status: "completed", error: null, model: "muse-spark-1.3",
    usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: "message", content: [{ type: "output_text",
      text: JSON.stringify({ cases: [{ lines, expectedTotal: 9000, rationale: "Synthetic boundary case." }] }) }] }] };
  const controller = createController({ changes: [{ id: "a", title: "Prepared change A",
    originalSource: "neutral original", candidateSource: "neutral proposed", rule: { text: "Independent fixture rule" },
    originalSha256: "a".repeat(64), candidateSha256: "b".repeat(64), diff: "neutral diff" }],
  scope, now: () => NOW, nonce: "fixture-nonce",
  ledger: { ready: async () => ({ reservations: Array(calls.reservations) }),
    reserve: async () => ++calls.reservations },
  provider: async (packet) => {
    calls.provider++; assert.deepEqual(Object.keys(packet).sort(), ["originalSource", "proposedSource", "rule"]);
    assert.doesNotMatch(JSON.stringify(packet), /private-witness|reference-repair|Authorization|MODEL_API_KEY/);
    return raw;
  },
  runner: async () => { calls.runner++; return { rows: [{ original: { value: 9000, error: null },
    candidate: { value: 8550, error: null } }] }; },
  verifySources: async () => {}, retain: async (name, value) => calls.retained.push({ name, value }),
  persistExport: async (source) => { calls.exports.push(source); return { sha256: sha(source) }; },
  ...overrides });
  return { controller, calls, raw };
}

async function accepted(controller, expectedTotal = 9000) {
  const proposal = await controller.action("/api/propose", { changeId: "a", requestId: "request-propose" });
  const result = await controller.action("/api/accept", { proposalId: proposal.proposalId,
    expectations: [{ caseId: "case-1", expectedTotal }], reviewed: true, requestId: "request-accept" });
  return { proposal, result };
}

test("actual controller ordering uses frozen expectations before any runner invocation", async () => {
  const { controller, calls } = fixture();
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

test("source-derived rule check rejects unchecked or wrong expectations; corrections are REVIEWER not human identity", async () => {
  const { controller, calls, raw } = fixture();
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
    const { controller } = fixture({ runner: async () => ({ rows: [{ original: { value: original, error: null },
      candidate: { value: candidate, error: null } }] }) });
    const { result } = await accepted(controller);
    const run = await controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
    assert.equal(run.status, status);
  }
});

test("runner failure is retained as inconclusive rows, never a reproduced regression", async () => {
  const { controller } = fixture({ runner: async () => { throw new Error("synthetic runner error"); } });
  const { result } = await accepted(controller);
  const run = await controller.action("/api/compare", { acceptedId: result.acceptedId, requestId: "request-compare" });
  assert.equal(run.status, "INCONCLUSIVE"); assert.equal(run.rows[0].original.value, null);
  await assert.rejects(() => controller.action("/api/export", { runId: run.runId, requestId: "request-export" }), /MEANINGFUL_RUN_REQUIRED/);
});

test("failed durable reservation never invokes provider; provider failure remains consumed", async () => {
  let provider = 0;
  const failed = fixture({ ledger: { reserve: async () => { throw new Error("synthetic persistence failure"); } },
    provider: async () => { provider++; } });
  await assert.rejects(() => failed.controller.action("/api/propose", { changeId: "a", requestId: "request-failed" }));
  assert.equal(provider, 0);
  const stopped = fixture({ provider: async () => { throw new Error("synthetic transport failure"); } });
  await assert.rejects(() => stopped.controller.action("/api/propose", { changeId: "a", requestId: "request-failed" }), /PROVIDER_FAILED_CONSUMED/);
  assert.equal(stopped.calls.reservations, 1);
  assert.equal(stopped.calls.retained[0].value.outcome, "FAILED_OR_UNKNOWN_CONSUMED");
});

test("malformed/empty/incomplete model data and arbitrary dispatch fields cannot become executable input", async () => {
  for (const kind of ["incomplete", "empty", "command"]) {
    const f = fixture();
    if (kind === "incomplete") f.raw.status = "incomplete";
    if (kind === "empty") f.raw.output[0].content[0].text = '{"cases":[]}';
    if (kind === "command") f.raw.output[0].content[0].text = '{"cases":[],"command":"bad"}';
    await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "request-invalid" }));
    assert.equal(f.calls.runner, 0);
  }
  const f = fixture();
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "../../private", requestId: "request-path" }));
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: "request-extra", command: "bad" }));
  await assert.rejects(() => f.controller.action("/api/propose", { changeId: "a", requestId: 12345678 }));
  assert.equal(f.calls.provider, 0);
});

test("concurrent action is refused, not another model call or hidden retry", async () => {
  let release;
  const wait = new Promise((done) => { release = done; });
  const f = fixture({ verifySources: () => wait });
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
  const f = fixture({ persistExport: async () => { throw new Error("synthetic disk failure"); } });
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
    const f = fixture({ lifecycle, verifySources: async () => {
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
    let dispatches = 0, destroyed = false;
    req.destroy = () => {
      if (!destroyed) { destroyed = true; queueMicrotask(() => req.emit("close")); }
    };
    req.end = () => {};
    res.statusCode = 200; res.complete = false;
    const f = fixture({ provider: (packet) => museProposal("unused-fixture-path", packet, scope.deadline, {
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
  const f = fixture();
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
