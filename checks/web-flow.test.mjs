/*
 * Node tests for the "Break This PR" web UI module (web/app.js).
 *
 * Every fixture in this file is SYNTHETIC test data invented for these
 * tests. Nothing here is an actual Muse/Meta request, model response, or
 * recorded execution result, and no network access happens: the fetch
 * implementation is injected and fully mocked. No fixture encodes the
 * prepared sample's known defect or any reference repair.
 *
 * Qualification results are retained separately; fixtures are not live evidence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  API_PATHS,
  NO_CASES_MESSAGE,
  createApiClient,
  createStore,
  initialState,
  getSelectedChange,
  getPendingPresentation,
  presentPendingButton,
  getSessionUsageText,
  getBaselineButtonPresentation,
  getFaultEvidence,
  getAcceptanceFailurePresentation,
  formatPence,
  describeChargeDifference,
  formatTokenUsage,
  isValidExpectedTotal,
  parsePoundsInput,
  penceToPoundsString,
  validateAccepted,
  validateBaseline,
  validateComparison,
  validateControl,
  validateExport,
  validateFeedback,
  validateProposal,
  validateRegression,
  validateRetainedInitial,
  validateSession,
} from "../web/app.js";

const HEX_A = "a1".repeat(32);
const HEX_B = "b2".repeat(32);
const HEX_C = "c3".repeat(32);
const HEX_D = "d4".repeat(32);
const HEX_E = "e5".repeat(32);
const HEX_F = "f1".repeat(32);

function changeEntry(id = "a") {
  return {
    id,
    title: id === "a" ? "Simplify checkout totals into a single pass" : "Restructure checkout subtotal calculation",
    rule: {
      id: "rule-a",
      title: "Synthetic pricing rule",
      text: "Synthetic rule text used only by these tests.",
      domain: "1-4 lines; integer amounts 100..100000 pence in multiples of 100; explicit boolean eligibility.",
    },
    diff: `--- a/original.ts\n+++ b/candidate-${id}.ts\n@@ synthetic test diff @@`,
    originalSha256: HEX_A,
    candidateSha256: id === "a" ? HEX_B : HEX_D,
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
    changes: [changeEntry(), changeEntry("c")],
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
    exportId: "11111111-1111-4111-8111-111111111111",
    scenarioId: "a",
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
    scenarioId: "a",
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
    scenarioId: "a",
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
    scenarioId: "a",
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
    runId: "run-1",
    exportId: "11111111-1111-4111-8111-111111111111",
    scenarioId: "a",
    path: "evidence/live/fixture-session/exports/11111111-1111-4111-8111-111111111111/regression.test.mjs",
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
  assert.deepEqual(JSON.parse(posts[5].options.body), {
    runId: "run-1", exportId: exportBody().exportId, requestId: "req-6",
  });

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

async function appAtAccepted(extraPlan, mode = "FIXTURE") {
  const app = makeApp([
    () => respond(200, sessionBody({ mode })),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody({ origin: mode })),
    () => respond(200, acceptedBody({ origin: mode })),
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
  const wrongExport = await atExported([
    () => respond(200, regressionBody({ exportId: "22222222-2222-4222-8222-222222222222" })),
  ]);
  assert.equal((await wrongExport.store.runRegression()).ok, false);
  assert.equal(wrongExport.store.getState().regression, null);
});

test("live A requests one repair for the retained export and reflects its budget", async () => {
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const app = await appAtAccepted([
    () => respond(200, comparisonBody({ status: "REPRODUCED", origin: "LIVE" })),
    () => respond(200, exportBody({ origin: "LIVE" })),
    () => response,
  ], "LIVE");
  await app.store.compare();
  await app.store.exportTest();
  const pending = app.store.runRegression(true);
  assert.equal(app.store.getState().inFlight, "repair");
  assert.equal(app.store.getState().budgetKnown, false);
  const last = app.calls.at(-1);
  assert.equal(last.url, API_PATHS.regression);
  assert.equal(JSON.parse(last.options.body).repair, true);
  finish(respond(200, regressionBody({ callsUsed: 2, baseline: executionRecord(),
    correction: { ...regressionBody().correction, kind: "MUSE_PROPOSED",
      before: "old expression", after: "new expression", explanation: "A bounded repair." } })));
  assert.deepEqual(await pending, { ok: true });
  assert.equal(app.store.getState().session.callsUsed, 2);
  assert.equal(app.store.getState().budgetKnown, true);
  assert.equal(app.store.getState().regression.correction.kind, "MUSE_PROPOSED");
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
    () => respond(200, sessionBody({ mode: "LIVE" })),
    () => respond(200, baselineBody({ origin: "FIXTURE" })),
  ]);
  await store.loadSession();
  const baselineResult = await store.runBaseline();
  assert.equal(baselineResult.ok, false,
    "a LIVE session refuses a fixture baseline");
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
  assert.equal(exported.path, exportBody().path,
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
  assert.equal(validateExport(exportBody({ exportId: "../../escape" })).ok, false);
  assert.equal(validateExport(exportBody({ path: "evidence/regression.test.mjs" })).ok, false);
  assert.equal(validateExport(exportBody({ exportId: "22222222-2222-4222-8222-222222222222" })).ok, false);
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
    "duplicate prepared change ids are refused");
  assert.equal(validateSession(sessionBody({ changes: [{ ...changeEntry(), id: "b" }] })).ok, false,
    "only the exact a/c pair is accepted");
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
  const repair = regressionBody({ callsUsed: 2, baseline: executionRecord(),
    correction: { ...regressionBody().correction, kind: "MUSE_PROPOSED",
      before: "old expression", after: "new expression", explanation: "A bounded repair." } });
  assert.equal(validateRegression(repair).ok, true);
  assert.equal(validateRegression({ ...repair, baseline: null }).ok, false);
  assert.equal(validateRegression({ ...repair, callsUsed: null }).ok, false);
  assert.equal(validateRegression({ ...repair, scenarioId: "c" }).ok, false);
  assert.equal(validateRegression({ ...repair, origin: "FIXTURE" }, { fixture: true }).ok, false);

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

/*
 * Feedback/refinement fixtures. All SYNTHETIC test data: no actual model
 * request, execution, private witness or reference repair is encoded here.
 */

function controlBody(overrides = {}) {
  return {
    kind: "control",
    scenarioId: "a",
    origin: "LOCAL_EXECUTION",
    controlId: "ctl-1",
    runId: "run-1",
    acceptedId: "acc-1",
    status: "NO_COUNTEREXAMPLE",
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
        candidate: { value: 2900, error: null },
      },
    ],
    sourceIdentities: { original: HEX_A, candidate: HEX_E, acceptedCases: HEX_C },
    limits: ["Synthetic fixture: control over the accepted baskets only."],
    ...overrides,
  };
}

function followUpProposalBody(overrides = {}) {
  return proposalBody({
    proposalId: "prop-2",
    callsUsed: 2,
    cases: [
      {
        id: "case-3",
        lines: [{ amount: 1500, discountEligible: true }],
        expectedTotal: 1350,
        rationale: "Synthetic: follow-up single eligible line.",
      },
    ],
    usage: { inputTokens: 5, outputTokens: 9 },
    ...overrides,
  });
}

function feedbackBody(overrides = {}) {
  return {
    kind: "feedback",
    scenarioId: "a",
    origin: "FIXTURE",
    feedbackId: "fb-1",
    runId: "run-1",
    controlId: "ctl-1",
    bindingId: HEX_F,
    status: "FOLLOW_UP_PROPOSED",
    explanation: "Synthetic test explanation: a model interpretation of verified outputs, not authority.",
    proposal: followUpProposalBody(),
    usage: { inputTokens: 5, outputTokens: 9 },
    callsUsed: 2,
    limits: ["Synthetic fixture: one bounded feedback interaction."],
    ...overrides,
  };
}

function retainedInitialBody(overrides = {}) {
  return {
    proposal: proposalBody(),
    accepted: acceptedBody(),
    comparison: comparisonBody({ status: "REPRODUCED" }),
    recordedAt: "2026-10-26T23:59:00Z",
    recordHashes: { proposal: HEX_A, accepted: HEX_B, comparison: HEX_C },
    ...overrides,
  };
}

function followUpAcceptedBody(overrides = {}) {
  return acceptedBody({
    acceptedId: "acc-2",
    proposalId: "prop-2",
    acceptedCases: [
      {
        caseId: "case-3",
        lines: [{ amount: 1500, discountEligible: true }],
        expectedTotal: 1300,
        expectationOrigin: "REVIEWER_CORRECTED",
      },
    ],
    ...overrides,
  });
}

function followUpComparisonBody(overrides = {}) {
  return comparisonBody({
    runId: "run-2",
    acceptedId: "acc-2",
    status: "NO_COUNTEREXAMPLE",
    rows: [
      {
        caseId: "case-3",
        expectedTotal: 1300,
        original: { value: 1350, error: null },
        candidate: { value: 1300, error: null },
      },
    ],
    ...overrides,
  });
}

function followUpControlBody(overrides = {}) {
  return controlBody({
    controlId: "ctl-2",
    runId: "run-2",
    acceptedId: "acc-2",
    rows: [
      {
        caseId: "case-3",
        expectedTotal: 1300,
        original: { value: 1300, error: null },
        candidate: { value: 1300, error: null },
      },
    ],
    ...overrides,
  });
}

// Journey through session, baseline, proposal, acceptance, comparison and
// a successful correct-B control. Five POSTs: req-1 .. req-5.
async function appAtControl(extraPlan = [], mode = "FIXTURE") {
  const app = makeApp([
    () => respond(200, sessionBody({ mode })),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody({ origin: mode })),
    () => respond(200, acceptedBody({ origin: mode })),
    () => respond(200, comparisonBody({ status: "REPRODUCED", origin: mode })),
    () => respond(200, controlBody()),
    ...extraPlan,
  ]);
  await app.store.loadSession();
  await app.store.runBaseline();
  await app.store.propose();
  app.store.confirmReview(true);
  await app.store.accept();
  await app.store.compare();
  assert.deepEqual(await app.store.runControl(), { ok: true });
  return app;
}

test("control is gated on baseline and comparison, runs once, and fails closed on mismatched echoes", async () => {
  const gated = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
  ]);
  assert.deepEqual(await gated.store.runControl(), { ok: false, reason: "no_session" });
  await gated.store.loadSession();
  assert.deepEqual(await gated.store.runControl(), { ok: false, reason: "baseline_required" });
  await gated.store.runBaseline();
  assert.deepEqual(await gated.store.runControl(), { ok: false, reason: "no_comparison" });
  assert.equal(gated.calls.length, 2, "no control fetch may happen while gated");

  const { store, calls } = await appAtControl();
  assert.deepEqual(JSON.parse(calls[5].options.body), { runId: "run-1", requestId: "req-5" });
  assert.equal(calls[5].url, API_PATHS.control);
  assert.equal(store.getState().control.status, "NO_COUNTEREXAMPLE");
  assert.deepEqual(await store.runControl(), { ok: false, reason: "already_run" });
  assert.equal(calls.length, 6, "a completed control is not re-run");

  const wrongAccepted = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    () => respond(200, comparisonBody()),
    () => respond(200, controlBody({ acceptedId: "acc-other" })),
  ]);
  await wrongAccepted.store.loadSession();
  await wrongAccepted.store.runBaseline();
  await wrongAccepted.store.propose();
  wrongAccepted.store.confirmReview(true);
  await wrongAccepted.store.accept();
  await wrongAccepted.store.compare();
  const mismatch = await wrongAccepted.store.runControl();
  assert.equal(mismatch.ok, false);
  assert.equal(wrongAccepted.store.getState().control, null, "a mismatched control is never stored");
  assert.match(wrongAccepted.store.getState().errors.control, /acceptedId/);

  const wrongRows = controlBody();
  wrongRows.rows[0].expectedTotal = 1000;
  const rowApp = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    () => respond(200, comparisonBody()),
    () => respond(200, wrongRows),
  ]);
  await rowApp.store.loadSession();
  await rowApp.store.runBaseline();
  await rowApp.store.propose();
  rowApp.store.confirmReview(true);
  await rowApp.store.accept();
  await rowApp.store.compare();
  assert.equal((await rowApp.store.runControl()).ok, false);
  assert.equal(rowApp.store.getState().control, null);
  assert.match(rowApp.store.getState().errors.control, /do not match/);

  const wrongRun = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    () => respond(200, comparisonBody()),
    () => respond(200, controlBody({ runId: "run-other" })),
  ]);
  await wrongRun.store.loadSession();
  await wrongRun.store.runBaseline();
  await wrongRun.store.propose();
  wrongRun.store.confirmReview(true);
  await wrongRun.store.accept();
  await wrongRun.store.compare();
  assert.equal((await wrongRun.store.runControl()).ok, false);
  assert.match(wrongRun.store.getState().errors.control, /runId/);
});

test("control and feedback validators reject out-of-domain shapes instead of coercing", () => {
  assert.equal(validateControl(controlBody()).ok, true);
  assert.equal(validateControl(controlBody({ origin: "LIVE" })).ok, false,
    "control origin must be LOCAL_EXECUTION, never a model origin");
  assert.equal(validateControl(controlBody({ status: "GREEN" })).ok, false);
  const missingIdentity = controlBody();
  delete missingIdentity.sourceIdentities.acceptedCases;
  assert.equal(validateControl(missingIdentity).ok, false);
  assert.equal(validateControl(controlBody({ rows: [] })).ok, false);
  assert.equal(validateControl(controlBody({ limits: "none" })).ok, false);

  assert.equal(validateFeedback(feedbackBody()).ok, true);
  assert.equal(validateFeedback(feedbackBody({ origin: "RECORDED" })).ok, false,
    "feedback origin stays literal LIVE or FIXTURE");
  assert.equal(validateFeedback(feedbackBody({ bindingId: HEX_F.toUpperCase() })).ok, false,
    "bindingId must be lowercase sha256");
  assert.equal(validateFeedback(feedbackBody({ explanation: "x".repeat(601) })).ok, false,
    "explanation is bounded at 600 characters");
  assert.equal(validateFeedback(feedbackBody({ explanation: "x".repeat(600) })).ok, true);
  assert.equal(validateFeedback(feedbackBody({ proposal: null })).ok, false,
    "FOLLOW_UP_PROPOSED requires a proposal");
  assert.equal(validateFeedback(feedbackBody({ status: "STOPPED", proposal: null })).ok, true);
  assert.equal(validateFeedback(feedbackBody({ status: "STOPPED" })).ok, false,
    "STOPPED must carry a null proposal");
  assert.equal(validateFeedback(feedbackBody({ status: "INCONCLUSIVE" })).ok, false,
    "INCONCLUSIVE must carry a null proposal");
  assert.equal(validateFeedback(
    feedbackBody({ proposal: followUpProposalBody({ cases: proposalBody().cases.concat([{
      id: "case-9",
      lines: [{ amount: 100, discountEligible: true }],
      expectedTotal: 90,
      rationale: "Synthetic: third case.",
    }]) }) }),
  ).ok, false, "a follow-up proposes at most 2 cases");
  assert.equal(validateFeedback(feedbackBody({ usage: { inputTokens: "5", outputTokens: 9 } })).ok, false);
  assert.equal(validateFeedback(feedbackBody({ usage: { inputTokens: null, outputTokens: null } })).ok, true,
    "null token usage means UNKNOWN and stays valid");
  assert.equal(validateFeedback(feedbackBody({ callsUsed: -1 })).ok, false);

  assert.equal(validateRetainedInitial(retainedInitialBody()).ok, true);
  assert.equal(validateRetainedInitial(
    retainedInitialBody({ comparison: comparisonBody({ acceptedId: "acc-other" }) }),
  ).ok, false, "retained comparison must reference the retained acceptance");
  assert.equal(validateRetainedInitial(
    retainedInitialBody({ accepted: acceptedBody({ proposalId: "prop-other" }) }),
  ).ok, false, "retained acceptance must reference the retained proposal");
  const badHash = retainedInitialBody();
  badHash.recordHashes.comparison = "nothex";
  assert.equal(validateRetainedInitial(badHash).ok, false);
  const badRow = retainedInitialBody();
  badRow.comparison.rows[0].expectedTotal = 1000;
  assert.equal(validateRetainedInitial(badRow).ok, false,
    "retained comparison rows must match the retained accepted totals");
});

test("feedback is a single attempt: a failed request consumes it and refresh never re-enables it", async () => {
  const noControl = makeApp([() => respond(200, sessionBody())]);
  await noControl.store.loadSession();
  assert.deepEqual(await noControl.store.requestFeedback(), { ok: false, reason: "no_control" });

  const { store, calls } = await appAtControl([
    () => respond(503, { error: { code: "provider_busy", message: "try later" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
  ]);
  const failed = await store.requestFeedback();
  assert.equal(failed.ok, false);
  const afterFail = store.getState();
  assert.equal(afterFail.feedback, null, "a failed feedback is never synthesized into a result");
  assert.equal(afterFail.feedbackAttempted, true, "the attempt is consumed on dispatch, even on failure");
  assert.equal(afterFail.budgetKnown, false, "a failed model call leaves the budget unknown");
  assert.match(afterFail.errors.feedback, /provider_busy/);

  assert.deepEqual(await store.requestFeedback(), { ok: false, reason: "already_attempted" });
  assert.equal(calls.length, 7, "a consumed attempt must not fetch again");

  assert.deepEqual(await store.refreshUsage(), { ok: true });
  assert.equal(store.getState().budgetKnown, true);
  assert.deepEqual(await store.requestFeedback(), { ok: false, reason: "already_attempted" },
    "an explicit usage refresh must not re-enable the consumed attempt");
  assert.equal(calls.length, 8, "only the read-only session refresh was added");
});

test("follow-up flow needs its own review, keeps root records, and never recurses into feedback", async () => {
  const { store, calls } = await appAtControl([
    () => respond(200, feedbackBody()),
    () => respond(200, followUpAcceptedBody()),
    () => respond(200, followUpComparisonBody()),
    () => respond(200, followUpControlBody()),
  ]);
  assert.deepEqual(await store.requestFeedback(), { ok: true });
  assert.deepEqual(JSON.parse(calls[6].options.body),
    { runId: "run-1", controlId: "ctl-1", requestId: "req-6" });
  const seeded = store.getState();
  assert.equal(seeded.session.callsUsed, 2, "feedback consumed a confirmed budget reservation");
  assert.equal(seeded.feedback.status, "FOLLOW_UP_PROPOSED");
  assert.equal(seeded.followUp.proposal.proposalId, "prop-2");
  assert.equal(seeded.followUp.reviewedConfirmed, false,
    "a follow-up starts unreviewed regardless of the earlier review");

  assert.deepEqual(await store.acceptFollowUp(), { ok: false, reason: "not_reviewed" });
  assert.deepEqual(store.setFollowUpExpectation("case-3", "nonsense"), { ok: true });
  store.confirmFollowUpReview(true);
  assert.deepEqual(await store.acceptFollowUp(), { ok: false, reason: "invalid_expectation" });
  assert.deepEqual(store.setFollowUpExpectation("case-3", "13.00"), { ok: true });
  assert.equal(store.getState().followUp.reviewedConfirmed, false,
    "editing a follow-up expectation resets its review confirmation");
  store.confirmFollowUpReview(true);
  assert.deepEqual(await store.acceptFollowUp(), { ok: true });
  assert.deepEqual(JSON.parse(calls[7].options.body), {
    proposalId: "prop-2",
    expectations: [{ caseId: "case-3", expectedTotal: 1300 }],
    reviewed: true,
    requestId: "req-7",
  });
  assert.equal(store.getState().followUp.accepted.acceptedCases[0].expectationOrigin,
    "REVIEWER_CORRECTED", "the edited value stays labelled as reviewer corrected");
  assert.deepEqual(store.setFollowUpExpectation("case-3", "14.00"),
    { ok: false, reason: "frozen" }, "follow-up acceptance freezes its expectations");

  assert.deepEqual(await store.compareFollowUp(), { ok: true });
  assert.deepEqual(JSON.parse(calls[8].options.body), { acceptedId: "acc-2", requestId: "req-8" });
  assert.deepEqual(await store.runFollowUpControl(), { ok: true });
  assert.deepEqual(JSON.parse(calls[9].options.body), { runId: "run-2", requestId: "req-9" });

  const state = store.getState();
  assert.equal(state.comparison.runId, "run-1", "the root comparison is never replaced");
  assert.equal(state.control.controlId, "ctl-1", "the root control is never replaced");
  assert.equal(state.followUp.comparison.runId, "run-2");
  assert.equal(state.followUp.control.controlId, "ctl-2");

  assert.deepEqual(await store.requestFeedback(), { ok: false, reason: "already_attempted" },
    "feedback is never requested recursively from a follow-up");
  assert.equal(calls.length, 10);
});

test("a STOP or mismatched feedback stays honest: no follow-up, no relabelling, fail closed", async () => {
  const stopped = await appAtControl([
    () => respond(200, feedbackBody({ status: "STOPPED", proposal: null })),
  ]);
  assert.deepEqual(await stopped.store.requestFeedback(), { ok: true });
  const stopState = stopped.store.getState();
  assert.equal(stopState.feedback.status, "STOPPED");
  assert.equal(stopState.followUp, null, "a stop produces no follow-up flow");
  assert.equal(stopState.feedbackAttempted, true);

  const mismatched = await appAtControl([
    () => respond(200, feedbackBody({ controlId: "ctl-other" })),
  ]);
  const result = await mismatched.store.requestFeedback();
  assert.equal(result.ok, false);
  assert.equal(mismatched.store.getState().feedback, null);
  assert.match(mismatched.store.getState().errors.feedback, /identities/);
  assert.equal(mismatched.store.getState().followUp, null, "a mismatched response seeds nothing");

  const badBinding = await appAtControl([
    () => respond(200, feedbackBody({ bindingId: "short" })),
  ]);
  assert.equal((await badBinding.store.requestFeedback()).ok, false);
  assert.equal(badBinding.store.getState().feedback, null);
});

test("retained initial evidence blocks a new initial proposal but still gates on a fresh baseline", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody({ retainedInitial: retainedInitialBody() })),
    () => respond(200, baselineBody()),
    () => respond(200, controlBody()),
    () => respond(200, feedbackBody({
      status: "INCONCLUSIVE",
      proposal: null,
      callsUsed: 1,
    })),
  ]);
  assert.deepEqual(await store.loadSession(), { ok: true });
  assert.equal(store.getState().session.retainedInitial.recordedAt, "2026-10-26T23:59:00Z");

  assert.deepEqual(await store.propose(), { ok: false, reason: "retained_initial" },
    "retained records never trigger a new initial model request");
  assert.deepEqual(await store.runControl(), { ok: false, reason: "baseline_required" },
    "retained evidence does not replace a fresh baseline PASS");
  assert.deepEqual(await store.runBaseline(), { ok: true });
  assert.deepEqual(await store.runControl(), { ok: true });
  assert.deepEqual(JSON.parse(calls[2].options.body), { runId: "run-1", requestId: "req-2" },
    "the control targets the retained comparison run");
  assert.deepEqual(await store.requestFeedback(), { ok: true });
  assert.deepEqual(JSON.parse(calls[3].options.body),
    { runId: "run-1", controlId: "ctl-1", requestId: "req-3" });
  const state = store.getState();
  assert.equal(state.feedback.status, "INCONCLUSIVE");
  assert.equal(state.followUp, null, "an inconclusive feedback manufactures no finding");

  const badSession = makeApp([
    () => respond(200, sessionBody({
      retainedInitial: retainedInitialBody({ comparison: comparisonBody({ acceptedId: "acc-other" }) }),
    })),
  ]);
  const rejected = await badSession.store.loadSession();
  assert.equal(rejected.ok, false, "broken retained linkage fails the whole session load");
  assert.equal(badSession.store.getState().session, null);
});

test("retained root evidence can export and prove a fresh same-test regression after fresh baseline", async () => {
  const app = makeApp([
    () => respond(200, sessionBody({ retainedInitial: retainedInitialBody() })),
    () => respond(200, baselineBody()),
    () => respond(200, exportBody()),
    () => respond(200, regressionBody()),
  ]);
  await app.store.loadSession();
  assert.deepEqual(await app.store.exportTest(), { ok: false, reason: "baseline_required" });
  await app.store.runBaseline();
  assert.deepEqual(await app.store.exportTest(), { ok: true });
  assert.equal(JSON.parse(app.calls[2].options.body).runId, "run-1");
  assert.deepEqual(await app.store.runRegression(), { ok: true });
  assert.equal(JSON.parse(app.calls[3].options.body).runId, "run-1");
  assert.equal(app.store.getState().regression.status, "RED_THEN_GREEN");
  assert.equal(app.store.getState().comparison, null, "historical comparison was not restamped as a new one");
});

test("server-persisted feedback attempt survives load and no contradictory control opens feedback", async () => {
  const app = makeApp([
    () => respond(200, sessionBody({ retainedInitial: retainedInitialBody(), feedbackAttempted: true })),
    () => respond(200, baselineBody()),
    () => respond(200, controlBody()),
  ]);
  await app.store.loadSession(); await app.store.runBaseline(); await app.store.runControl();
  assert.deepEqual(await app.store.requestFeedback(), { ok: false, reason: "already_attempted" });
  assert.equal(app.calls.length, 3);
  assert.equal(validateSession(sessionBody({ feedbackAttempted: "false" })).ok, false);
  const contradiction = controlBody(); contradiction.rows[0].candidate.value = 800;
  assert.equal(validateControl(contradiction).ok, false);
  const unknown = await appAtControl();
  unknown.store.getState().baseline.status = "FAIL";
  assert.deepEqual(await unknown.store.requestFeedback(), { ok: false, reason: "baseline_required" });
  assert.equal(unknown.store.getState().feedbackAttempted, false, "no attempt on a failed fresh baseline");
  unknown.store.getState().baseline.status = "PASS";
  unknown.store.getState().control.status = "INCONCLUSIVE";
  assert.deepEqual(await unknown.store.requestFeedback(), { ok: false, reason: "matching_control_required" });
  assert.equal(unknown.calls.length, 6);
});

test("configured one-to-six request limits validate and a one-request session cannot dispatch feedback", async () => {
  for (let limit = 1; limit <= 6; limit++) {
    assert.equal(validateSession(sessionBody({ limit, callsUsed: limit })).ok, true);
  }
  for (const limit of [0, 7, 1.5, "2"]) assert.equal(validateSession(sessionBody({ limit })).ok, false);
  assert.equal(validateSession(sessionBody({ limit: 1, callsUsed: 2 })).ok, false);
  const app = makeApp([
    () => respond(200, sessionBody({ limit: 1 })),
    () => respond(200, baselineBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    () => respond(200, comparisonBody({ status: "REPRODUCED" })),
    () => respond(200, controlBody()),
  ]);
  await app.store.loadSession(); await app.store.runBaseline(); await app.store.propose();
  app.store.confirmReview(true); await app.store.accept(); await app.store.compare(); await app.store.runControl();
  assert.deepEqual(await app.store.requestFeedback(), { ok: false, reason: "budget" });
  assert.equal(app.store.getState().feedbackAttempted, false);
  assert.equal(app.calls.length, 6);
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.ok(source.includes("${callsUsed} of ${limit} model requests used"), "the actual UI label uses the configured cap");
});

test("new source stays text-only: no unsafe rendering sinks, model text treated as plain data", async () => {
  const appSource = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
    assert.equal(appSource.includes(sink), false, `app.js must not use ${sink}`);
  }
  assert.equal(appSource.includes("eval" + "("), false, "app.js must not evaluate strings");

  const htmlSource = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.equal(/onclick=/i.test(htmlSource), false, "no inline handlers");
  assert.equal(/javascript:/i.test(htmlSource), false, "no javascript: URLs");
  assert.equal(htmlSource.includes('for="followup-reviewed-checkbox"'), true,
    "the follow-up review checkbox keeps an accessible label");

  const hostile = validateFeedback(feedbackBody({
    status: "STOPPED",
    proposal: null,
    explanation: "<script>synthetic</script> plain text explanation",
  }));
  assert.equal(hostile.ok, true,
    "markup in an explanation is accepted as bounded plain text, to be rendered via textContent only");
});

test("a fresh proposal gets its own feedback attempt without refunding the prior scenario's requests", async () => {
  const app = makeApp([
    () => respond(200, sessionBody({ callsUsed: 2, feedbackAttempted: true })),
    () => respond(200, baselineBody({ changeId: "c" })),
    () => respond(200, proposalBody({ scenarioId: "c", proposalId: "fresh-proposal-c", callsUsed: 3 })),
    () => respond(200, acceptedBody({ scenarioId: "c", proposalId: "fresh-proposal-c" })),
    () => respond(200, comparisonBody({ scenarioId: "c", status: "REPRODUCED", rows: [
      { caseId: "case-1", expectedTotal: 900, original: { value: 900, error: null }, candidate: { value: 900, error: null } },
      { caseId: "case-2", expectedTotal: 2900, original: { value: 2900, error: null }, candidate: { value: 2800, error: null } },
    ] })),
    () => respond(200, controlBody({ scenarioId: "c" })),
    () => respond(200, feedbackBody({ scenarioId: "c", callsUsed: 4, status: "STOPPED", proposal: null })),
  ]);
  await app.store.loadSession();
  const session = app.store.getState().session;
  app.store.selectChange("c");
  assert.equal(app.store.getState().feedbackAttempted, true, "a switch alone does not renew feedback");
  await app.store.runBaseline();
  assert.deepEqual(await app.store.propose(), { ok: true });
  assert.equal(app.store.getState().session, session);
  assert.equal(session.callsUsed, 3, "the new proposal consumed another shared request");
  assert.equal(app.store.getState().feedbackAttempted, false, "the new root has its own one-shot feedback");
  app.store.confirmReview(true);
  assert.deepEqual(await app.store.accept(), { ok: true });
  assert.deepEqual(await app.store.compare(), { ok: true });
  assert.deepEqual(await app.store.runControl(), { ok: true });
  assert.deepEqual(await app.store.requestFeedback(), { ok: true });
  assert.equal(session.callsUsed, 4);
  assert.equal(app.store.getState().feedbackAttempted, true);
  assert.deepEqual(await app.store.requestFeedback(), { ok: false, reason: "already_attempted" });
});

test("session requires precisely A/C and fresh records require explicit scenario provenance", () => {
  assert.equal(validateSession(sessionBody({ changes: [changeEntry("c"), changeEntry()] })).ok, true);
  assert.equal(validateSession(sessionBody({ changes: [changeEntry()] })).ok, false);
  assert.equal(validateSession(sessionBody({ changes: [changeEntry(), changeEntry("b")] })).ok, false);
  for (const [validator, body] of [
    [validateProposal, proposalBody], [validateAccepted, acceptedBody],
    [validateComparison, comparisonBody], [validateControl, controlBody],
    [validateExport, exportBody], [validateRegression, regressionBody],
  ]) {
    assert.equal(validator(body({ scenarioId: "c" })).ok, true);
    assert.equal(validator(body({ scenarioId: undefined })).ok, false, "no legacy fallback on fresh responses");
    assert.equal(validator(body({ scenarioId: "b" })).ok, false);
  }
  const followUp = feedbackBody({ scenarioId: "c", proposal: followUpProposalBody({ scenarioId: "c" }) });
  assert.equal(validateFeedback(followUp).ok, true);
  assert.equal(validateFeedback({ ...followUp, scenarioId: undefined }).ok, false);
  assert.equal(validateFeedback({ ...followUp, proposal: followUpProposalBody() }).ok, false,
    "nested feedback proposal must share the feedback scenario");

  const historical = retainedInitialBody();
  for (const key of ["proposal", "accepted", "comparison"]) delete historical[key].scenarioId;
  assert.equal(validateRetainedInitial(historical).ok, true, "only explicit historical A context tolerates absence");
  assert.equal(validateProposal(historical.proposal).ok, false);
  assert.equal(validateAccepted(historical.accepted).ok, false);
  assert.equal(validateComparison(historical.comparison).ok, false);
  historical.proposal.scenarioId = "c";
  assert.equal(validateRetainedInitial(historical).ok, false, "retained A cannot be relabelled C");
});

test("C completes a fully bound mocked review and switching clears only review-local state", async () => {
  const proposal = proposalBody({ scenarioId: "c", proposalId: "prop-c" });
  const accepted = acceptedBody({ scenarioId: "c", proposalId: "prop-c", acceptedId: "acc-c" });
  const comparison = comparisonBody({
    scenarioId: "c", acceptedId: "acc-c", runId: "run-c", status: "REPRODUCED",
    rows: [
      { caseId: "case-1", expectedTotal: 900, original: { value: 900, error: null }, candidate: { value: 900, error: null } },
      { caseId: "case-2", expectedTotal: 2900, original: { value: 2900, error: null }, candidate: { value: 2800, error: null } },
    ],
  });
  const feedback = feedbackBody({
    scenarioId: "c", runId: "run-c", controlId: "ctl-c",
    proposal: followUpProposalBody({ scenarioId: "c", proposalId: "prop-c-next" }),
  });
  const followUpAccepted = followUpAcceptedBody({
    scenarioId: "c", proposalId: "prop-c-next", acceptedId: "acc-c-next",
  });
  followUpAccepted.acceptedCases[0].expectedTotal = 1350;
  followUpAccepted.acceptedCases[0].expectationOrigin = "META_ACCEPTED";
  const followUpRows = [{
    caseId: "case-3", expectedTotal: 1350,
    original: { value: 1350, error: null }, candidate: { value: 1350, error: null },
  }];
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody({ changeId: "c" })),
    () => respond(200, proposal),
    () => respond(200, accepted),
    () => respond(200, comparison),
    () => respond(200, exportBody({ scenarioId: "c", runId: "run-c" })),
    () => respond(200, regressionBody({ scenarioId: "c", runId: "run-c" })),
    () => respond(200, controlBody({ scenarioId: "c", runId: "run-c", acceptedId: "acc-c", controlId: "ctl-c" })),
    () => respond(200, feedback),
    () => respond(200, followUpAccepted),
    () => respond(200, followUpComparisonBody({
      scenarioId: "c", acceptedId: "acc-c-next", runId: "run-c-next", rows: followUpRows,
    })),
    () => respond(200, followUpControlBody({
      scenarioId: "c", acceptedId: "acc-c-next", runId: "run-c-next", rows: followUpRows,
    })),
    () => respond(200, sessionBody({ callsUsed: 2, feedbackAttempted: true })),
  ]);
  await store.loadSession();
  assert.equal(store.getState().selectedChangeId, "a");
  assert.equal(getSelectedChange(store.getState()).candidateSha256, HEX_B);
  const session = store.getState().session;
  const epoch = store.getState().epoch;
  assert.deepEqual(store.selectChange("c"), { ok: true });
  assert.equal(store.getState().epoch, epoch + 1);
  assert.equal(getSelectedChange(store.getState()).candidateSha256, HEX_D);
  assert.match(getSelectedChange(store.getState()).diff, /candidate-c/);
  assert.equal(calls.length, 1, "selection is local, not a new session or API call");
  assert.deepEqual(await store.propose(), { ok: false, reason: "baseline_required" });
  assert.deepEqual(await store.runBaseline(), { ok: true });
  assert.deepEqual(await store.propose(), { ok: true });
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.deepEqual(await store.compare(), { ok: true });
  assert.deepEqual(await store.exportTest(), { ok: true });
  assert.deepEqual(await store.runRegression(), { ok: true });
  assert.deepEqual(await store.runControl(), { ok: true });
  assert.deepEqual(await store.requestFeedback(), { ok: true });
  store.confirmFollowUpReview(true);
  assert.deepEqual(await store.acceptFollowUp(), { ok: true });
  assert.deepEqual(await store.compareFollowUp(), { ok: true });
  assert.deepEqual(await store.runFollowUpControl(), { ok: true });
  assert.deepEqual(await store.refreshUsage(), { ok: true });
  assert.equal(store.getState().selectedChangeId, "c", "refresh preserves selection");
  assert.equal(store.getState().session, session, "refresh preserves the session nonce and budget object");
  for (const key of ["proposal", "accepted", "comparison", "exportResult", "regression", "control", "feedback"]) {
    assert.equal(store.getState()[key].scenarioId, "c");
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { changeId: "c", requestId: "req-1" });
  assert.deepEqual(JSON.parse(calls[2].options.body), { changeId: "c", requestId: "req-2" });
  assert.deepEqual(JSON.parse(calls[6].options.body), {
    runId: "run-c", exportId: exportBody().exportId, requestId: "req-6",
  }, "regression request shape stays bound by IDs, not new caller authority");
  const confirmed = { ...session };
  store.getState().errors.compare = "synthetic prior error";
  assert.deepEqual(store.selectChange("a"), { ok: true });
  const state = store.getState();
  assert.equal(state.session, session);
  for (const key of ["csrfToken", "deadline", "callsUsed", "limit"]) {
    assert.equal(state.session[key], confirmed[key], `switch preserves ${key}`);
  }
  assert.equal(state.session.callsUsed, 2, "no refund of either model request");
  assert.equal(state.budgetKnown, true);
  assert.equal(state.feedbackAttempted, true, "switching never reopens a consumed feedback request");
  for (const key of ["baseline", "proposal", "accepted", "comparison", "exportResult", "regression", "control", "feedback", "followUp"]) {
    assert.equal(state[key], null, `${key} must be cleared`);
  }
  assert.deepEqual(state.expectations, {});
  assert.equal(state.reviewedConfirmed, false);
  assert.equal(Object.values(state.errors).every((error) => error === null), true);
  assert.deepEqual(await store.propose(), { ok: false, reason: "baseline_required" });
  assert.equal(calls.length, 13);
});

test("selection refuses all pending actions including the independent proposalPending guard", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    async () => { await gate; return respond(200, proposalBody()); },
  ]);
  await store.loadSession();
  assert.deepEqual(store.selectChange("b"), { ok: false, reason: "unknown_change" });
  for (const action of ["session", "baseline", "usage", "accept", "compare", "export", "regression", "control", "feedback", "followup_accept", "followup_compare", "followup_control"]) {
    store.getState().inFlight = action;
    assert.deepEqual(store.selectChange("c"), { ok: false, reason: "busy" });
    assert.equal(store.getState().selectedChangeId, "a");
  }
  store.getState().inFlight = null;
  await store.runBaseline();
  const pending = store.propose();
  await tick();
  assert.deepEqual(store.selectChange("c"), { ok: false, reason: "busy" });
  store.getState().inFlight = null;
  assert.equal(store.getState().proposalPending, true);
  assert.deepEqual(store.selectChange("c"), { ok: false, reason: "busy" });
  release();
  assert.deepEqual(await pending, { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(store.getState().session.callsUsed, 1);
  assert.deepEqual(store.selectChange("c"), { ok: true });
  assert.equal(store.getState().session.callsUsed, 1);
});

test("an uncertain model count stays unknown across selection until same-session refresh", async () => {
  const app = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => respond(502, { error: { code: "PROVIDER_FAILED_CONSUMED", message: "synthetic consumed reservation" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
    () => respond(200, baselineBody({ changeId: "c" })),
    () => respond(200, proposalBody({ scenarioId: "c", callsUsed: 2 })),
    () => respond(200, sessionBody({ callsUsed: 1 })),
  ]);
  await app.store.loadSession(); await app.store.runBaseline();
  assert.equal((await app.store.propose()).ok, false);
  assert.deepEqual(app.store.selectChange("c"), { ok: true });
  assert.equal(app.store.getState().budgetKnown, false);
  assert.deepEqual(await app.store.refreshUsage(), { ok: true });
  assert.equal(app.store.getState().selectedChangeId, "c");
  assert.equal(app.store.getState().session.callsUsed, 1);
  await app.store.runBaseline();
  assert.deepEqual(await app.store.propose(), { ok: true });
  assert.equal(app.store.getState().session.callsUsed, 2);
  assert.equal((await app.store.refreshUsage()).ok, false, "a regressed durable count is refused");
  assert.equal(app.store.getState().selectedChangeId, "c");
  assert.equal(app.store.getState().session.callsUsed, 2);
  assert.equal(app.store.getState().budgetKnown, false);
});

test("switching never adopts historical A roots into C or back into a fresh A review", async () => {
  const app = makeApp([() => respond(200, sessionBody({ retainedInitial: retainedInitialBody() }))]);
  await app.store.loadSession();
  app.store.selectChange("c");
  assert.deepEqual(await app.store.exportTest(), { ok: false, reason: "no_comparison" });
  app.store.selectChange("a");
  assert.deepEqual(await app.store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.deepEqual(await app.store.propose(), { ok: false, reason: "baseline_required" });
  assert.equal(app.store.getState().session.retainedInitial.recordedAt, "2026-10-26T23:59:00Z",
    "history is retained without adopting it into the new review");
  assert.equal(app.calls.length, 1);
});

test("each fresh response rejects cross-scenario substitution even when parent IDs match", async () => {
  const cases = [
    ["baseline", async (reply) => makeApp([() => respond(200, sessionBody()), () => respond(200, reply)]),
      baselineBody({ changeId: "c" }), "runBaseline", "baseline"],
    ["proposal", async (reply) => {
      const app = makeApp([() => respond(200, sessionBody()), () => respond(200, baselineBody()), () => respond(200, reply)]);
      await app.store.loadSession(); await app.store.runBaseline(); return app;
    }, proposalBody({ scenarioId: "c" }), "propose", "proposal"],
    ["acceptance", async (reply) => {
      const app = makeApp([() => respond(200, sessionBody()), () => respond(200, baselineBody()),
        () => respond(200, proposalBody()), () => respond(200, reply)]);
      await app.store.loadSession(); await app.store.runBaseline(); await app.store.propose();
      app.store.confirmReview(true); return app;
    }, acceptedBody({ scenarioId: "c" }), "accept", "accepted"],
    ["comparison", async (reply) => appAtAccepted([() => respond(200, reply)]),
      comparisonBody({ scenarioId: "c" }), "compare", "comparison"],
    ["export", async (reply) => {
      const app = await appAtAccepted([() => respond(200, comparisonBody({ status: "REPRODUCED" })), () => respond(200, reply)]);
      await app.store.compare(); return app;
    }, exportBody({ scenarioId: "c" }), "exportTest", "exportResult"],
    ["regression", async (reply) => {
      const app = await appAtAccepted([() => respond(200, comparisonBody({ status: "REPRODUCED" })),
        () => respond(200, exportBody()), () => respond(200, reply)]);
      await app.store.compare(); await app.store.exportTest(); return app;
    }, regressionBody({ scenarioId: "c" }), "runRegression", "regression"],
    ["control", async (reply) => {
      const app = await appAtAccepted([() => respond(200, comparisonBody({ status: "REPRODUCED" })), () => respond(200, reply)]);
      await app.store.compare(); return app;
    }, controlBody({ scenarioId: "c" }), "runControl", "control"],
    ["feedback", async (reply) => appAtControl([() => respond(200, reply)]),
      feedbackBody({ scenarioId: "c", proposal: followUpProposalBody({ scenarioId: "c" }) }), "requestFeedback", "feedback"],
  ];
  for (const [label, setup, reply, method, field] of cases) {
    const app = await setup(reply);
    if (!app.store.getState().session) await app.store.loadSession();
    assert.equal((await app.store[method]()).ok, false, label);
    assert.equal(app.store.getState()[field], null, `${label} must not be adopted`);
    assert.equal(app.store.getState().selectedChangeId, "a");
  }
});

test("follow-up responses refuse another scenario or a different parent before adoption", async () => {
  for (const stage of ["accept", "compare", "control"]) {
    for (const substitution of ["scenario", "parent"]) {
      const accepted = followUpAcceptedBody();
      const comparison = followUpComparisonBody();
      const control = followUpControlBody();
      if (substitution === "scenario") {
        ({ accept: accepted, compare: comparison, control })[stage].scenarioId = "c";
      } else if (stage === "accept") accepted.proposalId = "prop-other";
      else if (stage === "compare") comparison.acceptedId = "acc-other";
      else control.runId = "run-other";
      const app = await appAtControl([
        () => respond(200, feedbackBody()),
        () => respond(200, accepted),
        () => respond(200, comparison),
        () => respond(200, control),
      ]);
      assert.deepEqual(await app.store.requestFeedback(), { ok: true });
      app.store.setFollowUpExpectation("case-3", "13.00");
      app.store.confirmFollowUpReview(true);
      const acceptance = await app.store.acceptFollowUp();
      if (stage === "accept") {
        assert.equal(acceptance.ok, false);
        assert.equal(app.store.getState().followUp.accepted, null);
        continue;
      }
      assert.equal(acceptance.ok, true);
      const compared = await app.store.compareFollowUp();
      if (stage === "compare") {
        assert.equal(compared.ok, false);
        assert.equal(app.store.getState().followUp.comparison, null);
        continue;
      }
      assert.equal(compared.ok, true);
      assert.equal((await app.store.runFollowUpControl()).ok, false);
      assert.equal(app.store.getState().followUp.control, null);
    }
  }
});

test("native labelled selector renders selected identities and refuses selection while pending", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(html, /<label for="change-selector">Prepared checkout change<\/label>/);
  assert.match(html, /<select id="change-selector" aria-describedby="change-selection-hint" disabled>/);
  assert.equal(source.includes("state.session.changes[0]"), false, "rendering must not be hard-coded to the first candidate");
  assert.equal(source.includes("nodes.changeSelector.disabled = !state.session || Boolean(state.inFlight) || state.proposalPending"), true);
  assert.equal(source.includes("const change = getSelectedChange(state)"), true);
});

test("prepared changes explain implementation differences without exposing the answer", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const controller = await readFile(new URL("../tools/live-demo.mjs", import.meta.url), "utf8");
  const definition = "Two prepared rewrites of the same checkout calculator. Both are meant to preserve the pricing rule below. We use Muse to look for a basket the existing tests missed, then run it to check the charge.";
  assert.equal(html.split(definition).length - 1, 1);
  assert.ok(controller.includes('title: id === "a" ? "Rework discounts and vouchers" : "Calculate totals in one pass"'));
  assert.match(html, /id="change-context" aria-live="polite" aria-atomic="true"/);
  assert.ok(html.includes("<strong>Pricing rule (unchanged):</strong>"));
  const renderer = source.slice(source.indexOf("function renderChange(state)"), source.indexOf("function renderBaseline(state)"));
  assert.match(renderer, /nodes\.changeContext\.textContent = change\?\.id === "a"\s*\? "Changes how eligible-item subtotals, the 10% discount and the £5 voucher are combined into the final charge\."\s*: change\?\.id === "c"\s*\? "Replaces separate passes over eligible and full-price items with a single loop that accumulates both totals\."\s*: ""/);
  assert.match(renderer, /el\("option", \{ value: entry\.id \}, entry\.title\)/);
  assert.match(renderer, /nodes\.prTitle\.textContent = change\?\.title \?\? ""/);
  assert.ok(renderer.indexOf("View proposed code changes (read-only)") < renderer.indexOf("Full rule and input units"));
  assert.match(renderer, /el\("pre", \{ class: "diff" \}, change\.diff\)/);
  assert.match(css, /\.endnote > details\s*\{\s*border-top: 0;\s*\}/);
  assert.match(css, /\.step\s*\{[^}]*border-bottom: 1px solid var\(--line\)/);
  assert.match(css, /\ndetails\s*\{\s*border-top: 1px solid var\(--line\)/);
});

function presentationButton() {
  return {
    textContent: "Ask Muse for breaking baskets",
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

test("every async store operation has a stage-specific accessible pending presentation", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const operations = new Set([...source.matchAll(/state\.inFlight = "([a-z_]+)"/g)].map((match) => match[1]));
  for (const match of source.matchAll(/state\.inFlight = \w+ \? "([a-z_]+)" : "([a-z_]+)"/g)) {
    operations.add(match[1]); operations.add(match[2]);
  }
  assert.equal(operations.size, 14);
  for (const operation of operations) {
    const presentation = getPendingPresentation(operation);
    assert.ok(presentation, operation);
    assert.ok(presentation.label.length > 0);
    assert.ok(presentation.detail.length > 0);
    assert.ok(["change", "basket", "test"].includes(presentation.step));
    assert.doesNotMatch(presentation.detail, /\d+%|complete|succeeded|approved/i);
    const button = presentationButton();
    presentPendingButton(button, presentation, "Idle");
    assert.equal(button.textContent, presentation.label);
    assert.equal(button.attributes["aria-busy"], "true");
    assert.equal(button.disabled, true);
    presentPendingButton(button, null, "Idle");
    assert.equal(button.textContent, "Idle");
    assert.equal(button.attributes["aria-busy"], "false");
    assert.equal(button.disabled, true, "presentation must not bypass the render/store eligibility guards");
  }
  assert.equal(getPendingPresentation(null), null);
  assert.equal(getPendingPresentation("toString"), null);
});

test("Ask Muse paints pending synchronously even while its budget becomes unknown", async () => {
  let resolveProposal;
  const app = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, baselineBody()),
    () => new Promise((resolve) => { resolveProposal = resolve; }),
  ]);
  await app.store.loadSession();
  await app.store.runBaseline();
  const button = presentationButton();
  app.store.subscribe((state) => {
    presentPendingButton(button, getPendingPresentation(state.inFlight),
      state.budgetKnown ? "Ask Muse for breaking baskets" : "Refresh usage (no model call)");
  });
  const request = app.store.propose();
  assert.equal(app.store.getState().inFlight, "propose");
  assert.equal(app.store.getState().budgetKnown, false);
  assert.equal(button.textContent, "Asking Muse...", "the pending request must not look like a usage refresh");
  assert.equal(button.attributes["aria-busy"], "true");
  assert.equal(button.disabled, true);
  assert.deepEqual(app.store.selectChange("c"), { ok: false, reason: "busy" });
  assert.deepEqual(await app.store.propose(), { ok: false, reason: "busy" });
  resolveProposal(respond(200, proposalBody()));
  assert.deepEqual(await request, { ok: true });
  assert.equal(button.attributes["aria-busy"], "false");
  assert.equal(button.textContent, "Ask Muse for breaking baskets");
  assert.equal(app.store.getState().session.callsUsed, 1);
  assert.equal(app.calls.length, 3, "no extra request or retry for presentation");
});

test("feedback shows pending before awaiting and clears it without reopening a consumed request", async () => {
  let resolveFeedback;
  const app = await appAtControl([
    () => new Promise((resolve) => { resolveFeedback = resolve; }),
  ]);
  const button = presentationButton();
  app.store.subscribe((state) => {
    presentPendingButton(button, getPendingPresentation(state.inFlight),
      state.budgetKnown ? "Send verified results back to Muse (one request)" : "Refresh usage (no model call)");
  });
  const callsBefore = app.calls.length;
  const request = app.store.requestFeedback();
  assert.equal(app.store.getState().inFlight, "feedback");
  assert.equal(button.textContent, "Waiting for Muse's feedback...");
  assert.equal(button.attributes["aria-busy"], "true");
  assert.equal(app.store.getState().feedbackAttempted, true);
  assert.deepEqual(app.store.selectChange("c"), { ok: false, reason: "busy" });
  await Promise.resolve(); // Let the mocked fetch install its deferred response.
  resolveFeedback(respond(502, {
    error: { code: "PROVIDER_FAILED_CONSUMED", message: "synthetic provider failure" },
  }));
  assert.equal((await request).ok, false);
  assert.equal(button.attributes["aria-busy"], "false");
  assert.equal(button.textContent, "Refresh usage (no model call)");
  assert.equal(app.store.getState().budgetKnown, false);
  assert.equal(app.store.getState().feedbackAttempted, true);
  assert.ok(app.store.getState().errors.feedback);
  assert.deepEqual(await app.store.requestFeedback(), { ok: false, reason: "already_attempted" });
  assert.equal(app.calls.length, callsBefore + 1);
});

test("long-response patience text stays presentation-only and never promises progress", () => {
  for (const operation of ["propose", "feedback", "baseline", "usage"]) {
    const initial = getPendingPresentation(operation);
    const slow = getPendingPresentation(operation, true);
    assert.equal(slow.label, initial.label);
    assert.equal(slow.step, initial.step);
    assert.match(slow.detail, /No automatic retry is being made/);
    assert.match(slow.detail, operation === "propose" || operation === "feedback"
      ? /Still waiting for Muse/ : /Still waiting for the local backend/);
    assert.doesNotMatch(slow.detail, /\d+%|almost done|complete|approved/i);
  }
});

test("session usage does not suggest refreshing during an active model request", () => {
  const state = { ...initialState(), session: sessionBody({ mode: "LIVE", callsUsed: 1, limit: 4 }), budgetKnown: false };
  for (const inFlight of ["propose", "feedback", "repair"]) {
    const text = getSessionUsageText({ ...state, inFlight });
    assert.equal(text, "Muse is working; request usage updates when it finishes.");
    assert.doesNotMatch(text, /refresh|used \(last confirmed\)/i);
  }
  assert.equal(getSessionUsageText({ ...state, inFlight: "usage" }),
    "Refreshing request usage; no model call is made.");
  assert.equal(getSessionUsageText(state), "Model usage unknown or pending; refresh before another request");
  assert.equal(getSessionUsageText({ ...state, budgetKnown: true }),
    "1 of 4 model requests used (last confirmed)");
  assert.equal(state.budgetKnown, false);
  assert.equal(state.session.callsUsed, 1);
});

test("review markup exposes the three-step path, live activity and reduced-motion busy state", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  for (const stage of ["change", "basket", "test"]) {
    assert.ok(html.includes(`href="#stage-${stage}" id="path-${stage}"`));
  }
  assert.match(html, /id="activity"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(css, /button\[aria-busy="true"\]::before/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(source, /el\("details", \{\},\s*el\("summary", \{\}, "View proposed code changes \(read-only\)"\)/);
  assert.match(source, /renderFollowUp\(state\);\s*renderActivity\(state\);/);
  assert.match(source, /clearTimeout\(patienceTimer\)/);
  assert.match(source, /current\.epoch.*current\.inFlight/);
});

async function acceptanceReview(followUp, responses) {
  const app = followUp ? await appAtControl([() => respond(200, feedbackBody()), ...responses]) : makeApp([
    () => respond(200, sessionBody()), () => respond(200, baselineBody()),
    () => respond(200, proposalBody()), ...responses,
  ]);
  if (followUp) await app.store.requestFeedback();
  else { await app.store.loadSession(); await app.store.runBaseline(); await app.store.propose(); }
  return {
    ...app,
    edit: (value) => followUp ? app.store.setFollowUpExpectation("case-3", value) : app.store.setExpectation("case-1", value),
    confirm: () => followUp ? app.store.confirmFollowUpReview(true) : app.store.confirmReview(true),
    accept: () => followUp ? app.store.acceptFollowUp() : app.store.accept(),
    compare: () => followUp ? app.store.compareFollowUp() : app.store.compare(),
    review: () => followUp ? app.store.getState().followUp : app.store.getState(),
  };
}

test("both review paths prominently classify confirmed expected-total rejection using typed codes and actual submissions", async () => {
  for (const followUp of [false, true]) {
    for (const code of ["EXPECTATION_RULE_MISMATCH", "FIXTURE_EXPECTATION_MISMATCH"]) {
      const app = await acceptanceReview(followUp, [
        () => respond(422, { error: { code, message: "The submitted total was rejected." } }),
      ]);
      app.edit("0.00"); app.confirm();
      assert.equal((await app.accept()).ok, false);
      const failure = app.review().acceptanceFailure;
      const submitted = JSON.parse(app.calls.at(-1).options.body).expectations;
      assert.deepEqual(failure.submitted, submitted, "display values come from the submitted request, not the model answer");
      assert.equal(failure.code, code);
      const view = getAcceptanceFailurePresentation(failure);
      assert.equal(view.title, "Expected total rejected");
      assert.equal(view.boundary, "Comparison blocked");
      assert.equal(view.rejected, true);
      assert.match(view.submitted, /£0\.00/);
      assert.doesNotMatch(view.submitted, /£9\.00|£13\.50/);
      assert.match(view.explanation, /review-input rejection, not a new checkout-code failure/);
      const calls = app.calls.length;
      assert.equal((await app.compare()).ok, false);
      assert.equal(app.calls.length, calls, "a rejected expectation cannot start comparison or trigger a retry");
      assert.equal(app.review().accepted, null);
    }
  }
});

test("network, other server errors and untrusted acceptance echoes never masquerade as a wrong expected total", async () => {
  for (const followUp of [false, true]) {
    const altered = followUp ? followUpAcceptedBody() : acceptedBody();
    altered.acceptedCases[0].expectedTotal = 1234;
    for (const response of [
      () => { throw new Error("EXPECTATION_RULE_MISMATCH in a transport message is not a server rejection"); },
      () => respond(500, { error: { code: "SERVER_UNAVAILABLE", message: "Acceptance could not be confirmed." } }),
      () => respond(200, altered),
    ]) {
      const app = await acceptanceReview(followUp, [response]);
      app.confirm();
      assert.equal((await app.accept()).ok, false);
      const view = getAcceptanceFailurePresentation(app.review().acceptanceFailure);
      assert.equal(view.rejected, false);
      assert.equal(view.title, "Acceptance not confirmed");
      assert.equal(view.boundary, "Comparison blocked");
      assert.match(view.explanation, /does not establish that your totals are wrong/);
      assert.match(view.recovery, /Reload if acceptance may already have been recorded/);
      assert.equal(app.review().accepted, null);
      assert.equal((await app.compare()).ok, false);
    }
  }
});

test("editing and successful acceptance clear rejection presentation without changing review or frozen-provenance rules", async () => {
  for (const followUp of [false, true]) {
    const app = await acceptanceReview(followUp, [
      () => respond(422, { error: { code: "EXPECTATION_RULE_MISMATCH", message: "Check the written rule." } }),
      () => respond(200, followUp ? followUpAcceptedBody() : acceptedBody()),
    ]);
    app.edit("0.00"); app.confirm();
    await app.accept();
    assert.ok(app.review().acceptanceFailure);
    app.edit(followUp ? "13.00" : "9.00");
    assert.equal(app.review().acceptanceFailure, null);
    assert.equal(app.review().reviewedConfirmed, false);
    assert.equal((await app.accept()).ok, false, "recovery still requires a fresh review confirmation");
    app.confirm();
    assert.deepEqual(await app.accept(), { ok: true });
    assert.equal(app.review().acceptanceFailure, null);
    assert.equal(app.review().accepted.acceptedCases[0].expectationOrigin, followUp ? "REVIEWER_CORRECTED" : "META_ACCEPTED");
    assert.deepEqual(app.edit("1.00"), { ok: false, reason: "frozen" });
    assert.equal(app.store.getState().session.callsUsed, followUp ? 2 : 1);
  }
});

test("accepted LIVE reviewer corrections keep provenance but hide the unverified draft badge in both paths", async () => {
  const initialProposal = proposalBody({ origin: "LIVE" });
  initialProposal.cases[0].expectedTotal = 800;
  const initialAcceptance = acceptedBody({ origin: "LIVE" });
  initialAcceptance.acceptedCases[0].expectationOrigin = "REVIEWER_CORRECTED";
  const initial = makeApp([
    () => respond(200, sessionBody({ mode: "LIVE" })), () => respond(200, baselineBody()),
    () => respond(200, initialProposal), () => respond(200, initialAcceptance),
  ]);
  await initial.store.loadSession(); await initial.store.runBaseline(); await initial.store.propose();
  initial.store.setExpectation("case-1", "9.00"); initial.store.confirmReview(true);
  assert.equal((await initial.store.accept()).ok, true);
  const root = initial.store.getState();
  assert.equal(root.expectations["case-1"].edited, true);
  assert.equal(root.accepted.acceptedCases[0].expectationOrigin, "REVIEWER_CORRECTED");
  assert.equal(!root.expectations["case-1"].edited || Boolean(root.accepted), true);

  const proposal = followUpProposalBody({ origin: "LIVE" });
  proposal.cases[0].expectedTotal = 1300;
  const accepted = followUpAcceptedBody({ origin: "LIVE" });
  accepted.acceptedCases[0].expectedTotal = 1350;
  const follow = await appAtControl([
    () => respond(200, feedbackBody({ origin: "LIVE", proposal })), () => respond(200, accepted),
  ], "LIVE");
  await follow.store.requestFeedback(); follow.store.setFollowUpExpectation("case-3", "13.50");
  follow.store.confirmFollowUpReview(true);
  assert.equal((await follow.store.acceptFollowUp()).ok, true);
  const followUp = follow.store.getState().followUp;
  assert.equal(followUp.expectations["case-3"].edited, true);
  assert.equal(followUp.accepted.acceptedCases[0].expectationOrigin, "REVIEWER_CORRECTED");
  assert.equal(!followUp.expectations["case-3"].edited || Boolean(followUp.accepted), true);
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.ok(source.includes('row.querySelector(\'[data-role="edited"]\').hidden = !entry.edited || Boolean(state.accepted)'));
  assert.ok(source.includes('row.querySelector(\'[data-role="edited"]\').hidden = !entry.edited || Boolean(followUp.accepted)'));
});

test("green acceptance cards use locked accepted records, not proposed or editable totals, in both review paths", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const list = source.slice(source.indexOf("function acceptedCasesList(accepted)"), source.indexOf("function renderAcceptanceSuccess("));
  assert.match(list, /for \(const entry of accepted\.acceptedCases\)/);
  assert.match(list, /class: "accepted-total-value" \}, formatPence\(entry\.expectedTotal\)/);
  assert.ok(list.includes('entry.expectationOrigin === "REVIEWER_CORRECTED"'));
  assert.doesNotMatch(list, /state\.proposal|state\.expectations/);
  assert.ok(source.includes("renderAcceptanceSuccess(nodes.acceptStatus, state.accepted)"));
  assert.ok(source.includes("renderAcceptanceSuccess(nodes.followupAcceptStatus, followUp.accepted, true)"));
  assert.ok(source.includes('followUp ? "Follow-up totals accepted" : "Expected totals accepted"'));
  assert.ok(source.includes('"Locked for comparison"'));
  assert.ok(source.includes("Acceptance alone does not show that the checkout code is correct."));
  assert.ok(source.includes("Scripted totals are locked for this walkthrough. No model or pricing code was run."));
  assert.equal(source.includes("nodes.acceptedPanel.append("), false, "no duplicate accepted list below the card");
  assert.equal(source.includes("nodes.followupAcceptedPanel.append("), false);
  for (const id of ["accept-status", "followup-accept-status"]) {
    assert.match(html, new RegExp(`<div id="${id}"[^>]*aria-atomic="true"`));
  }
  assert.match(css, /\.acceptance-success\s*\{[^}]*border-left: 5px solid var\(--green\);[^}]*background: var\(--green-wash\)/);
  assert.match(css, /\.acceptance-title\s*\{[^}]*font-weight: 800;[^}]*text-transform: uppercase/);
});

test("important monetary figures are large while proposed, accepted and executed meanings stay explicit", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  assert.ok(source.includes('el("span", { class: "case-expected-label" }, "Proposed expected total")'));
  assert.ok(source.includes('el("strong", { class: "case-expected-value" }, formatPence(entry.expectedTotal))'));
  for (const selector of [".case-expected-value", ".accepted-total-value", ".fault-amounts dd"]) {
    const declaration = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    assert.ok(declaration.includes("font-size: clamp(1.6rem, 3.5vw, 2rem)"));
    assert.ok(declaration.includes("font-weight: 800"));
  }
  assert.match(css, /\.exp-row \.money-field input\s*\{[^}]*font-size: 1\.2rem;[^}]*min-height: 3rem/);
  assert.match(css, /\.money-field\s*\{[^}]*max-width: 100%/);
});

test("acceptance rejection uses the pass-card visual weight, accessible alerts and unverified draft badges in both paths", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.ok(source.includes('renderAcceptanceFailure(nodes.acceptStatus, state.acceptanceFailure, state.errors.accept)'));
  assert.ok(source.includes('renderAcceptanceFailure(nodes.followupAcceptStatus, followUp.acceptanceFailure, state.errors.followUpAccept)'));
  assert.ok(source.includes('node.setAttribute("role", tone === "error" ? "alert" : "status")'));
  assert.ok(source.includes('node.setAttribute("aria-live", tone === "error" ? "assertive" : "polite")'));
  assert.equal([...source.matchAll(/"data-role": "edited" \}, "Edited, not verified"/g)].length, 2);
  assert.ok(source.includes('? "reviewer corrected"'), "accepted, backend-validated provenance remains unchanged");
  assert.match(css, /\.acceptance-rejection\s*\{[^}]*border-left: 5px solid var\(--red\);[^}]*background: var\(--red-wash\)/);
  assert.match(css, /\.rejection-title\s*\{[^}]*font-size: clamp\(1\.4rem, 3vw, 1\.8rem\);[^}]*font-weight: 800;[^}]*text-transform: uppercase/);
  for (const id of ["accept-status", "followup-accept-status"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-atomic="true"`));
  }
});

function faultComparison() {
  const comparison = comparisonBody({ status: "REPRODUCED" });
  comparison.rows[1].candidate = { value: 2800, error: null };
  return comparison;
}

test("fault summary derives the missed basket and before/after amounts from actual bound records", () => {
  const comparison = faultComparison();
  const accepted = acceptedBody().acceptedCases;
  const before = getFaultEvidence(comparison, accepted, baselineBody());
  assert.equal(before.expected, 2900);
  assert.equal(before.before, 2800);
  assert.equal(before.after, null, "a corrected amount is never invented before execution");
  assert.equal(before.baselineLinked, true);
  assert.equal(before.absentFromBaseline, true);
  assert.equal(before.impact, "Shop undercharges £1.00");
  assert.deepEqual(before.lines, accepted[1].lines);
  const after = getFaultEvidence(comparison, accepted, baselineBody(), controlBody());
  assert.equal(after.after, 2900);
  assert.equal(after.controlAttempted, true);
});

test("a suggestion, no counterexample, errors or a wrong original never manufacture a fault summary", () => {
  const accepted = acceptedBody().acceptedCases;
  assert.equal(getFaultEvidence(null, accepted), null);
  for (const status of ["NO_COUNTEREXAMPLE", "INCONCLUSIVE"]) {
    assert.equal(getFaultEvidence({ ...faultComparison(), status }, accepted), null);
  }
  const edits = [
    (row) => { row.candidate = { value: row.expectedTotal, error: null }; },
    (row) => { row.candidate = { value: null, error: "synthetic error" }; },
    (row) => { row.original.value = 2800; },
    (row) => { row.original = { value: null, error: "synthetic error" }; },
  ];
  for (const edit of edits) {
    const comparison = faultComparison();
    edit(comparison.rows[1]);
    assert.equal(getFaultEvidence(comparison, accepted), null);
  }
  const altered = structuredClone(accepted);
  altered[1].expectedTotal = 2800;
  assert.equal(getFaultEvidence(faultComparison(), altered), null);
});

test("old-tests-missed wording requires matching source identities and an absent basket", () => {
  const comparison = faultComparison();
  const accepted = acceptedBody().acceptedCases;
  for (const baseline of [null, baselineBody({ status: "FAIL" }),
    baselineBody({ sourceIdentities: { original: HEX_D, candidate: HEX_B } }),
    baselineBody({ sourceIdentities: { original: HEX_A, candidate: HEX_D } })]) {
    const evidence = getFaultEvidence(comparison, accepted, baseline);
    assert.equal(evidence.baselineLinked, false);
    assert.equal(evidence.absentFromBaseline, false);
  }
  const covered = baselineBody();
  covered.coverage.cases[2].lines = [...accepted[1].lines].reverse();
  const evidence = getFaultEvidence(comparison, accepted, covered);
  assert.equal(evidence.baselineLinked, true);
  assert.equal(evidence.absentFromBaseline, false, "reordering an old basket is not a missed example");
});

test("after amount requires the matching executed control and does not conceal a still-wrong correction", () => {
  const comparison = faultComparison();
  const accepted = acceptedBody().acceptedCases;
  const edits = [
    (control) => { control.runId = "other-run"; },
    (control) => { control.acceptedId = "other-acceptance"; },
    (control) => { control.sourceIdentities.original = HEX_D; },
    (control) => { control.status = "INCONCLUSIVE"; },
    (control) => { control.rows[1].expectedTotal = 2800; },
    (control) => { control.rows[1].candidate = { value: null, error: "synthetic error" }; },
  ];
  for (const edit of edits) {
    const control = controlBody();
    edit(control);
    assert.equal(getFaultEvidence(comparison, accepted, baselineBody(), control).after, null);
  }
  const wrong = controlBody({ status: "REPRODUCED" });
  wrong.rows[1].candidate.value = 2800;
  assert.equal(getFaultEvidence(comparison, accepted, baselineBody(), wrong).after, 2800);
});

test("the visible story leads with executed price differences and keeps retained and red-green scope explicit", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  assert.ok(html.includes("<h1>Catch checkout bugs your tests missed.</h1>"));
  assert.ok(html.includes("check its expected total, then run the code"));
  for (const label of ["Expected by the rule", "Before · proposed code", "After · pre-reviewed correction",
    "The old tests passed. This basket exposed a wrong charge.", "Not checked yet", "Not established"]) {
    assert.ok(source.includes(label));
  }
  assert.ok(source.includes('${retained ? "RETAINED " : ""}${origin} · ${origin === "FIXTURE" ? "SCRIPTED COMPARISON" : "EXECUTED COMPARISON"}'));
  assert.ok(source.includes("The before result is retained evidence, not a fresh execution or a new model discovery."));
  assert.ok(source.includes("Same test: fails before, passes after."));
  assert.ok(source.includes("state.regression.testSha256 === state.exportResult?.sha256"));
  assert.match(css, /\.fault-evidence\s*\{[^}]*border-left: 5px solid var\(--red\)/);
  assert.match(css, /\.fault-amounts\s*\{[^}]*grid-template-columns: repeat\(auto-fit/);
});

test("both expectation editors use a compact currency control and non-stretching correction badge", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  for (const [start, end] of [["function renderExpectations(state)", "function renderComparison(state)"],
    ["function renderFollowUp(state)", "function render(state)"]]) {
    const renderer = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(renderer, /class: "expectation-control"/);
    assert.match(renderer, /class: "money-field"/);
    assert.match(renderer, /class: "currency-prefix", "aria-hidden": "true"/);
    assert.match(renderer, /class: "badge edited", hidden: true, "data-role": "edited"/);
    assert.match(renderer, /row\.querySelector\("input"\)/);
  }
  assert.match(css, /\.expectation-control\s*\{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.money-field\s*\{[^}]*width: 10rem;[^}]*max-width: 100%/);
  assert.match(css, /\.money-field:focus-within\s*\{[^}]*outline: 2px solid var\(--green\)/);
  assert.match(css, /\.exp-row \.money-field input:focus-visible\s*\{ outline: none; \}/);
  assert.match(css, /\.expectation-control \.badge\.edited\s*\{[^}]*flex: 0 0 auto/);
});

test("proposal provenance is prominent without claiming the suggestions are verified", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("function renderProposal(state)"), source.indexOf("function renderExpectations(state)"));
  assert.ok(renderer.includes('el("strong", { class: "proposal-title" }, `${state.proposal.origin} proposal`)'));
  assert.ok(renderer.includes('el("span", { class: "proposal-model" }, `From ${state.proposal.model}`)'));
  assert.ok(renderer.includes("formatTokenUsage(state.proposal.usage.inputTokens)"));
  assert.ok(renderer.includes("formatTokenUsage(state.proposal.usage.outputTokens)"));
  assert.ok(renderer.includes("Suggested test cases. Review the expected totals before accepting."));
  assert.ok(renderer.includes("This session carries retained initial evidence"));
  assert.doesNotMatch(renderer, /557|2980|proposal PASS|verified proposal|defect found/i);
  assert.match(css, /#propose-status\.good,\s*#regression-status\.good\s*\{[^}]*border-left: 5px solid var\(--green\)/);
  assert.match(css, /\.proposal-title,\s*\.regression-verdict\s*\{[^}]*font-weight: 800/);
});

test("baseline PASS is a prominent bounded verdict using actual counts and exit status", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("function renderBaseline(state)"), source.indexOf("function retainedOf(state)"));
  const passing = renderer.slice(renderer.indexOf('if (state.baseline.status === "PASS")'), renderer.indexOf('state.baseline.status === "FAIL"'));
  assert.match(passing, /el\("strong", \{ class: "baseline-verdict" \}, state\.baseline\.origin === "FIXTURE" \? "Scripted baseline PASS" : "Baseline PASS"\)/);
  assert.ok(passing.includes("${counts.passed} of ${counts.tests} assertions passed"));
  assert.ok(renderer.includes('${state.baseline.execution.exitCode === null ? "unknown" : state.baseline.execution.exitCode}'));
  assert.ok(passing.includes("Existing baseline cases only."));
  assert.doesNotMatch(passing, /6 of 6|production.ready|merge.approv/i);
  assert.ok(renderer.includes("Baseline FAIL"));
  assert.ok(renderer.includes("Baseline INCONCLUSIVE"));
  assert.match(css, /#baseline-status\.good,\s*#propose-status\.good,\s*#regression-status\.good\s*\{[^}]*border-left: 5px solid var\(--green\)/);
  assert.match(css, /\.baseline-verdict,\s*\.proposal-title,\s*\.regression-verdict\s*\{[^}]*font-weight: 800/);
  assert.match(html, /id="baseline-status"[^>]*aria-atomic="true"/);
  assert.match(passing, /el\("span", \{ class: "baseline-evidence mono" \}, executionSummary\)/,
    "the actual execution summary belongs inside the PASS live-status card");
  assert.ok(renderer.includes("origin ${state.baseline.origin}"));
  assert.ok(renderer.includes("${describeCounts(state.baseline.execution.counts)}"));
  assert.match(renderer, /if \(state\.baseline\.status !== "PASS"\) \{\s*nodes\.baselinePanel\.append\(el\("p", \{ class: "mono" \}, executionSummary\)\);/,
    "only non-PASS states retain a separate metadata line; passing metadata is not duplicated");
  assert.ok(renderer.includes('"Baseline test details"'));
});

test("baseline test details use one disclosure with directly labelled output, identities and limits", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const renderer = source.slice(source.indexOf("function renderBaseline(state)"), source.indexOf("function retainedOf(state)"));
  assert.equal([...renderer.matchAll(/el\("details"/g)].length, 1, "no nested baseline disclosure");
  assert.match(renderer, /el\("summary", \{\}, "Baseline test details"\)/);
  for (const heading of ["Standard output", "Standard error", "Source identities", "Scope and limits"]) {
    assert.ok(renderer.includes(`el("h3", {}, "${heading}")`));
  }
  assert.ok(renderer.includes('state.baseline.execution.stdout || "(empty stdout)"'));
  assert.ok(renderer.includes('state.baseline.execution.stderr || "(empty stderr)"'));
  assert.ok(renderer.includes("state.baseline.sourceIdentities[key]"));
  assert.ok(renderer.includes("for (const limit of state.baseline.limits)"));
  assert.equal(renderer.includes('executionEvidence("Baseline"'), false);
  assert.ok(source.includes("function executionEvidence(label, record)"), "other execution-detail renderers remain unchanged");
});

test("baseline action hides only after PASS, offers retry on failure and returns for a new change", async () => {
  const initial = initialState();
  assert.deepEqual(getBaselineButtonPresentation(initial), { hidden: false, label: "Run baseline tests" });
  assert.deepEqual(getBaselineButtonPresentation({ ...initial, baseline: baselineBody() }),
    { hidden: true, label: "Run baseline tests" });
  for (const status of ["FAIL", "INCONCLUSIVE"]) {
    assert.deepEqual(getBaselineButtonPresentation({ ...initial, baseline: { status } }),
      { hidden: false, label: "Try again" });
  }
  const failed = { ...initial, errors: { ...initial.errors, baseline: "synthetic execution failure" } };
  assert.deepEqual(getBaselineButtonPresentation(failed), { hidden: false, label: "Try again" });
  const button = presentationButton();
  presentPendingButton(button, getPendingPresentation("baseline"), getBaselineButtonPresentation(failed).label);
  assert.equal(button.textContent, "Running baseline tests...");
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");

  const app = makeApp([() => respond(200, sessionBody()), () => respond(200, baselineBody())]);
  await app.store.loadSession();
  await app.store.runBaseline();
  assert.equal(getBaselineButtonPresentation(app.store.getState()).hidden, true);
  assert.deepEqual(app.store.selectChange("c"), { ok: true });
  assert.deepEqual(getBaselineButtonPresentation(app.store.getState()),
    { hidden: false, label: "Run baseline tests" });
  assert.equal(app.calls.length, 2, "visibility and selection do not rerun a baseline or call the model");

  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.ok(source.includes("nodes.baselineButton.hidden = getBaselineButtonPresentation(state).hidden"));
  assert.ok(source.includes("getBaselineButtonPresentation(state).label : idleLabel"));
});
