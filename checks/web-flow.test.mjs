/*
 * Node tests for the pricing-review web UI module (web/app.js).
 *
 * Every fixture in this file is SYNTHETIC test data invented for these
 * tests. Nothing here is an actual Muse/Meta request, model response, or
 * recorded execution result, and no network access happens: the fetch
 * implementation is injected and fully mocked.
 *
 * NOT_RUN: these tests are authored but have not been executed yet.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  API_PATHS,
  createApiClient,
  createStore,
  initialState,
  formatTokenUsage,
  isValidExpectedTotal,
  parseExpectationInput,
  validateAccepted,
  validateComparison,
  validateExport,
  validateProposal,
  validateSession,
} from "../web/app.js";

const HEX_A = "a1".repeat(32);
const HEX_B = "b2".repeat(32);
const HEX_C = "c3".repeat(32);

function changeEntry(id, title) {
  return {
    id,
    title,
    rule: {
      id: `rule-${id}`,
      title: "Synthetic pricing rule",
      text: "Synthetic rule text used only by these tests.",
      domain: "1-4 lines; integer amounts 100..100000 in multiples of 100; explicit boolean eligibility.",
    },
    diff: "--- a/original.ts\n+++ b/candidate.ts\n@@ synthetic test diff @@",
    originalSha256: HEX_A,
    candidateSha256: HEX_B,
  };
}

function sessionBody(overrides = {}) {
  return {
    mode: "FIXTURE",
    csrfToken: "demo-token-1",
    callsUsed: 0,
    limit: 6,
    deadline: "2026-10-27T03:50:52Z",
    changes: [
      changeEntry("a", "Synthetic prepared change A"),
      changeEntry("b", "Synthetic prepared change B"),
    ],
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

test("compare is blocked before acceptance and export before comparison, with no fetch", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody()),
  ]);
  await store.loadSession();
  store.selectChange("a");

  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.deepEqual(await store.accept(), { ok: false, reason: "no_proposal" });
  assert.equal(calls.length, 1, "guards must refuse without touching the network");

  assert.deepEqual(await store.propose(), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.equal(calls.length, 2);
});

test("acceptance requires an explicit review confirmation and valid integer expectations", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
  ]);
  await store.loadSession();
  store.selectChange("a");
  await store.propose();

  assert.deepEqual(await store.accept(), { ok: false, reason: "not_reviewed" });

  store.setExpectation("case-1", "not a number");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: false, reason: "invalid_expectation" });

  store.setExpectation("case-1", "12.5");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: false, reason: "invalid_expectation" });
  assert.equal(calls.length, 2, "blocked acceptance must not reach the backend");

  store.setExpectation("case-1", "900");
  assert.equal(store.getState().reviewedConfirmed, false, "editing resets the review confirmation");
  assert.deepEqual(await store.accept(), { ok: false, reason: "not_reviewed" });

  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(store.getState().accepted.acceptedId, "acc-1");
});

test("changing the selection resets downstream state and stale responses are ignored", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    async () => { await gate; return respond(200, proposalBody()); },
    () => respond(200, sessionBody({ callsUsed: 1 })),
    () => respond(200, proposalBody({ proposalId: "prop-b", callsUsed: 2 })),
  ]);
  await store.loadSession();
  store.selectChange("a");

  const pending = store.propose();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(store.getState().inFlight, "propose");

  assert.deepEqual(store.selectChange("b"), { ok: true });
  assert.equal(store.getState().inFlight, null, "selection change clears the in-flight marker");
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "busy" });
  assert.deepEqual(await store.refreshUsage(), { ok: false, reason: "busy" });

  release();
  assert.deepEqual(await pending, { ok: false, reason: "stale" });
  assert.equal(store.getState().proposal, null, "a stale proposal must not be applied");
  assert.equal(store.getState().budgetKnown, false, "a stale success must not restore a current budget claim");
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.deepEqual(await store.refreshUsage(), { ok: true });
  assert.equal(calls[2].url, API_PATHS.session);
  assert.equal(calls[2].options, null, "budget refresh is a read-only GET, not a model retry");

  assert.deepEqual(await store.propose(), { ok: true });
  assert.equal(calls.length, 4);
  assert.equal(JSON.parse(calls[3].options.body).changeId, "b");
  assert.equal(store.getState().proposal.proposalId, "prop-b");
  assert.equal(store.getState().session.callsUsed, 2);

  assert.deepEqual(store.selectChange("a"), { ok: true });
  const state = store.getState();
  assert.equal(state.proposal, null);
  assert.deepEqual(state.expectations, {});
  assert.equal(state.reviewedConfirmed, false);
  assert.equal(state.accepted, null);
  assert.equal(state.comparison, null);
  assert.equal(state.exportResult, null);
});

test("duplicate in-flight actions are suppressed and the call budget is enforced locally", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    async () => { await gate; return respond(200, proposalBody()); },
  ]);
  await store.loadSession();
  store.selectChange("a");

  const first = store.propose();
  await tick();
  assert.deepEqual(await store.propose(), { ok: false, reason: "busy" });
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.equal(calls.length, 2, "the duplicate action must not issue a second request");
  release();
  assert.deepEqual(await first, { ok: true });

  const exhausted = makeApp([() => respond(200, sessionBody({ callsUsed: 6 }))]);
  await exhausted.store.loadSession();
  exhausted.store.selectChange("a");
  assert.deepEqual(await exhausted.store.propose(), { ok: false, reason: "budget" });
  assert.equal(exhausted.calls.length, 1, "an exhausted budget must not reach the backend");
});

test("full journey sends the exact contract bodies, headers and fresh requestIds", async () => {
  const editedAccepted = acceptedBody();
  editedAccepted.acceptedCases[0].expectedTotal = 1000;
  editedAccepted.acceptedCases[0].expectationOrigin = "REVIEWER_CORRECTED";
  const editedComparison = comparisonBody();
  editedComparison.rows[0].expectedTotal = 1000;

  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody()),
    () => respond(200, editedAccepted),
    () => respond(200, editedComparison),
    () => respond(200, exportBody()),
  ]);
  await store.loadSession();
  store.selectChange("a");
  assert.deepEqual(await store.propose(), { ok: true });
  store.setExpectation("case-1", "1000");
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.deepEqual(await store.compare(), { ok: true });
  assert.deepEqual(await store.exportTest(), { ok: true });

  const posts = calls.slice(1);
  assert.deepEqual(posts.map((call) => call.url), [
    API_PATHS.propose,
    API_PATHS.accept,
    API_PATHS.compare,
    API_PATHS.export,
  ]);
  const requestIds = [];
  for (const call of posts) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.equal(call.options.headers["X-Demo-Token"], "demo-token-1");
    requestIds.push(JSON.parse(call.options.body).requestId);
  }
  assert.deepEqual(requestIds, ["req-1", "req-2", "req-3", "req-4"]);
  assert.equal(new Set(requestIds).size, 4, "every request carries a fresh unique requestId");

  assert.deepEqual(JSON.parse(posts[0].options.body), { changeId: "a", requestId: "req-1" });
  assert.deepEqual(JSON.parse(posts[1].options.body), {
    proposalId: "prop-1",
    expectations: [
      { caseId: "case-1", expectedTotal: 1000 },
      { caseId: "case-2", expectedTotal: 2900 },
    ],
    reviewed: true,
    requestId: "req-2",
  });
  assert.deepEqual(JSON.parse(posts[2].options.body), { acceptedId: "acc-1", requestId: "req-3" });
  assert.deepEqual(JSON.parse(posts[3].options.body), { runId: "run-1", requestId: "req-4" });

  const state = store.getState();
  assert.equal(state.expectations["case-1"].edited, true);
  assert.equal(state.accepted.acceptedCases[0].expectationOrigin, "REVIEWER_CORRECTED");
  assert.equal(state.accepted.acceptedCases[1].expectationOrigin, "META_ACCEPTED");
  assert.equal(state.session.callsUsed, 1, "the reported call count is preserved");
  assert.equal(state.comparison.status, "INCONCLUSIVE");
  assert.equal(state.comparison.rows.length, 2, "every comparison row is preserved");
  assert.equal(state.comparison.rows[1].candidate.error, "synthetic evaluation error");
  assert.deepEqual(state.comparison.limits, ["Synthetic fixture: covers only the listed cases."]);
  assert.equal(state.exportResult.testSource.includes("INERT_TEST_SOURCE"), true);
});

test("an edited expectation echoed back as META_ACCEPTED is rejected, not relabelled", async () => {
  const mislabelled = acceptedBody();
  mislabelled.acceptedCases[0].expectedTotal = 1000;
  // expectationOrigin deliberately stays META_ACCEPTED for the edited case.

  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody()),
    () => respond(200, mislabelled),
  ]);
  await store.loadSession();
  store.selectChange("a");
  await store.propose();
  store.setExpectation("case-1", "1000");
  store.confirmReview(true);

  const result = await store.accept();
  assert.equal(result.ok, false);
  assert.equal(store.getState().accepted, null, "a mislabelled acceptance must not be stored");
  assert.match(store.getState().errors.accept, /origin/);
});

async function appAtAccepted(extraPlan) {
  const app = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody()),
    () => respond(200, acceptedBody()),
    ...extraPlan,
  ]);
  await app.store.loadSession();
  app.store.selectChange("a");
  await app.store.propose();
  app.store.confirmReview(true);
  await app.store.accept();
  return app;
}

test("HTTP, network and invalid-shape failures stay visible with no retry and no synthesized success", async () => {
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(500, { error: { code: "provider_busy", message: "try later" } }),
  ]);
  await store.loadSession();
  store.selectChange("a");
  const failed = await store.propose();
  assert.equal(failed.ok, false);
  assert.equal(store.getState().proposal, null, "an error must never become a successful proposal");
  assert.match(store.getState().errors.propose, /provider_busy/);
  assert.equal(calls.length, 2, "failed requests are not retried automatically");
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
    () => respond(502, { error: { code: "PROVIDER_FAILED_CONSUMED", message: "reservation consumed" } }),
    () => respond(503, { error: { code: "BUDGET_LOCKED", message: "uncertain persistence" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
    () => respond(200, proposalBody({ callsUsed: 2 })),
  ]);
  await store.loadSession(); store.selectChange("a");
  assert.equal((await store.propose()).ok, false);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal((await store.refreshUsage()).ok, false);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal((await store.refreshUsage()).ok, true);
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(store.getState().selectedChangeId, "a");
  assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 1);
  assert.equal((await store.propose()).ok, true);
  assert.equal(store.getState().session.callsUsed, 2);
  assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 2);
});

test("late failed proposal after selection stays stale and cannot refresh or retry itself", async () => {
  let reject;
  const pending = new Promise((_done, fail) => { reject = fail; });
  const { store, calls } = makeApp([
    () => respond(200, sessionBody()),
    () => pending,
    () => respond(200, sessionBody({ callsUsed: 1 })),
  ]);
  await store.loadSession(); store.selectChange("a");
  const proposing = store.propose(); await tick(); store.selectChange("b");
  reject(new Error("late uncertain connection loss"));
  assert.deepEqual(await proposing, { ok: false, reason: "stale" });
  assert.equal(store.getState().selectedChangeId, "b");
  assert.equal(store.getState().proposal, null);
  assert.equal(store.getState().budgetKnown, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  await store.refreshUsage();
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(store.getState().selectedChangeId, "b");
});

test("budget refresh refuses a different nonce or regressed count rather than adopting or resetting it", async () => {
  for (const next of [{ csrfToken: "changed-nonce" }, { callsUsed: 0 }]) {
    const { store, calls } = makeApp([
      () => respond(200, sessionBody({ callsUsed: 1 })),
      () => respond(200, sessionBody({ callsUsed: 1, ...next })),
    ]);
    await store.loadSession(); store.selectChange("a");
    assert.equal((await store.refreshUsage()).ok, false);
    assert.equal(store.getState().budgetKnown, false);
    assert.equal(store.getState().session.callsUsed, 1);
    assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
    assert.equal(calls.filter((call) => call.url === API_PATHS.propose).length, 0);
  }
});

test("accepted expectations stay frozen after comparison; editing or unchecking cannot erase observation", async () => {
  const app = await appAtAccepted([() => respond(200, comparisonBody())]);
  await app.store.compare();
  const before = JSON.stringify(app.store.getState());
  assert.deepEqual(app.store.setExpectation("case-1", "1000"), { ok: false, reason: "expectations_locked" });
  assert.deepEqual(app.store.confirmReview(false), { ok: false, reason: "expectations_locked" });
  assert.deepEqual(await app.store.accept(), { ok: false, reason: "already_accepted" });
  assert.equal(JSON.stringify(app.store.getState()), before);
  assert.equal(app.calls.length, 4, "no new acceptance/runner request follows a blocked edit");
});

test("nullable token usage accepts a charged proposal and displays UNKNOWN rather than zero", async () => {
  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody({ usage: { inputTokens: null, outputTokens: null } })),
  ]);
  await store.loadSession(); store.selectChange("a");
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
    () => respond(422, { error: { code: "NO_CASES_PROPOSED", message: "No cases" } }),
    () => respond(200, sessionBody({ callsUsed: 1 })),
  ]);
  await store.loadSession(); store.selectChange("b");
  assert.equal((await store.propose()).ok, false);
  assert.match(store.getState().errors.propose, /INCONCLUSIVE/);
  assert.match(store.getState().errors.propose, /Muse proposed no cases; no implementations were run/);
  assert.match(store.getState().errors.propose, /not approval/);
  assert.equal(store.getState().proposal, null);
  assert.equal(store.getState().comparison, null);
  assert.equal(store.getState().budgetKnown, false);
  assert.deepEqual(await store.compare(), { ok: false, reason: "not_accepted" });
  assert.deepEqual(await store.exportTest(), { ok: false, reason: "no_comparison" });
  assert.deepEqual(await store.propose(), { ok: false, reason: "usage_unknown" });
  assert.equal(calls.length, 2);
  await store.refreshUsage();
  assert.equal(store.getState().session.callsUsed, 1);
  assert.equal(calls[2].url, API_PATHS.session);
});

test("proposal and comparison origins must stay literal; RECORDED data is never promoted", async () => {
  const { store } = makeApp([
    () => respond(200, sessionBody()),
    () => respond(200, proposalBody({ origin: "RECORDED" })),
  ]);
  await store.loadSession();
  store.selectChange("a");
  const result = await store.propose();
  assert.equal(result.ok, false);
  assert.equal(store.getState().proposal, null);
  assert.match(store.getState().errors.propose, /LIVE or FIXTURE/);

  const recordedComparison = await appAtAccepted([
    () => respond(200, comparisonBody({ origin: "RECORDED" })),
  ]);
  const compared = await recordedComparison.store.compare();
  assert.equal(compared.ok, false);
  assert.equal(recordedComparison.store.getState().comparison, null);
  assert.match(recordedComparison.store.getState().errors.compare, /LIVE or FIXTURE/);
});

test("the exported test is held as inert data and its fixed shape is enforced", async () => {
  const app = await appAtAccepted([
    () => respond(200, comparisonBody()),
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
  assert.equal(app.calls.length, 4, "no additional comparison request is sent");
});

test("validators reject out-of-domain and coerced data instead of accepting truthiness", () => {
  assert.equal(validateSession(sessionBody()).ok, true);
  assert.equal(validateSession(sessionBody({ mode: "live" })).ok, false);
  assert.equal(validateSession(sessionBody({ csrfToken: "" })).ok, false);
  assert.equal(validateSession(sessionBody({ limit: "6" })).ok, false);
  assert.equal(validateSession(sessionBody({ changes: [] })).ok, false);
  const badHash = sessionBody();
  badHash.changes[0].originalSha256 = "ABC123";
  assert.equal(validateSession(badHash).ok, false);

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

test("expectation input parsing is strict", () => {
  assert.equal(parseExpectationInput("900"), 900);
  assert.equal(parseExpectationInput(" 900 "), 900);
  assert.equal(parseExpectationInput("0"), 0);
  assert.equal(parseExpectationInput("400000"), 400000);
  assert.equal(parseExpectationInput(""), null);
  assert.equal(parseExpectationInput("12.5"), null);
  assert.equal(parseExpectationInput("-100"), null);
  assert.equal(parseExpectationInput("1e3"), null);
  assert.equal(parseExpectationInput("400001"), null);
  assert.equal(parseExpectationInput("1000000"), null);
  assert.equal(parseExpectationInput(900), null, "non-string input is rejected, not coerced");

  assert.equal(isValidExpectedTotal(900), true);
  assert.equal(isValidExpectedTotal(900.5), false);
  assert.equal(isValidExpectedTotal("900"), false);
  assert.equal(isValidExpectedTotal(-1), false);
});
