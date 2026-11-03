import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createFixturePreviewServer, createFixtureSession } from "../tools/fixture-preview.mjs";
import { createApiClient, createStore, validateBaseline, validateControl,
  validateRegression, validateExport, getSessionUsageText } from "../web/app.js";

// Every response and red/green count here is authored fixture data, not execution proof.
async function withServer(run) {
  const server = await createFixturePreviewServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  const send = (path, options = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: { Origin: origin, ...options.headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject); req.end(options.body);
  });
  const apiClient = () => createApiClient({ randomId: randomUUID, fetchImpl: async (path, options = {}) => {
    const response = await send(path, options);
    return { ok: response.status >= 200 && response.status < 300, status: response.status,
      json: async () => JSON.parse(response.text) };
  } });
  try { await run({ send, apiClient }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

async function advanceToControl(store) {
  assert.deepEqual(await store.runBaseline(), { ok: true });
  assert.equal(store.getState().baseline.origin, "FIXTURE");
  assert.deepEqual(await store.propose(), { ok: true });
  store.confirmReview(true);
  assert.deepEqual(await store.accept(), { ok: true });
  assert.deepEqual(await store.compare(), { ok: true });
  assert.equal(store.getState().comparison.status, "REPRODUCED");
  assert.deepEqual(await store.runControl(), { ok: true });
  assert.equal(store.getState().control.origin, "FIXTURE");
}

test("plain URL loads fixed assets and a labelled fixture session; reload starts only a new synthetic walkthrough", async () => {
  await withServer(async ({ send, apiClient }) => {
    const page = await send("/");
    assert.equal(page.status, 200);
    assert.match(page.text, /FIXTURE PREVIEW — no model calls or code execution/);
    assert.equal((await send("/app.js")).status, 200);
    assert.equal((await send("/styles.css")).status, 200);
    assert.deepEqual(JSON.parse((await send("/health")).text),
      { status: "FIXTURE_PREVIEW", modelCalls: false, codeExecution: false, liveBudgetAccess: false });
    const first = apiClient();
    const session = await first.getSession();
    assert.deepEqual(session.changes.map((entry) => entry.title), ["Rework discounts and vouchers", "Calculate totals in one pass"]);
    await first.baseline({ csrfToken: session.csrfToken, changeId: "a" });
    await first.propose({ csrfToken: session.csrfToken, changeId: "a" });
    const refresh = await first.getSession();
    assert.equal(refresh.csrfToken, session.csrfToken);
    assert.equal(refresh.callsUsed, 1, "state refresh preserves scripted turns");
    const reload = await apiClient().getSession();
    assert.notEqual(reload.csrfToken, session.csrfToken);
    assert.equal(reload.callsUsed, 0, "only an in-memory fixture counter starts over");
    assert.match(getSessionUsageText({ session: reload }), /scripted turns.*live budget unchanged/);
  });
});

test("both scenarios complete the real UI store's scripted review, control, feedback/follow-up and inert export flow", async () => {
  await withServer(async ({ apiClient }) => {
    const store = createStore({ client: apiClient() });
    assert.deepEqual(await store.loadSession(), { ok: true });
    for (const scenario of ["a", "c"]) {
      if (scenario === "c") assert.deepEqual(store.selectChange("c"), { ok: true });
      await advanceToControl(store);
      assert.deepEqual(await store.exportTest(), { ok: true });
      const sample = store.getState().exportResult;
      assert.equal(sample.origin, "FIXTURE");
      assert.match(sample.path, /^preview-memory\//);
      assert.equal(sample.command, "NOT_EXECUTED_FIXTURE");
      assert.ok(sample.testSource.trim().split("\n").every((line) => line.startsWith("//")));
      assert.deepEqual(await store.runRegression(), { ok: true });
      assert.equal(store.getState().regression.origin, "FIXTURE");
      assert.equal(store.getState().regression.cleanup.ownedCopiesRemoved, false);
      assert.deepEqual(await store.requestFeedback(), { ok: true });
      assert.equal(store.getState().feedback.origin, "FIXTURE");
      assert.equal(store.getState().feedback.status, "FOLLOW_UP_PROPOSED");
      store.confirmFollowUpReview(true);
      assert.deepEqual(await store.acceptFollowUp(), { ok: true });
      assert.deepEqual(await store.compareFollowUp(), { ok: true });
      assert.deepEqual(await store.runFollowUpControl(), { ok: true });
      assert.equal(store.getState().followUp.control.origin, "FIXTURE");
    }
    assert.equal(store.getState().session.callsUsed, 4);
  });
});

test("edited expectations are refused clearly instead of changing canned results", async () => {
  await withServer(async ({ apiClient }) => {
    const store = createStore({ client: apiClient() });
    await store.loadSession(); await store.runBaseline(); await store.propose();
    store.setExpectation("case-1", "0.00"); store.confirmReview(true);
    assert.equal((await store.accept()).ok, false);
    assert.match(store.getState().errors.accept, /expects £99\.00.*not changed/);
    assert.equal(store.getState().accepted, null);
    store.setExpectation("case-1", "99.00"); store.confirmReview(true);
    assert.equal((await store.accept()).ok, true);
    assert.equal(store.getState().accepted.acceptedCases[0].expectedTotal, 9900);
  });
});

test("execution-shaped fixture records require explicit fixture context and cannot enter a LIVE session", async () => {
  const fixture = createFixtureSession();
  const action = (path, body) => fixture.action(path, { ...body, requestId: randomUUID() });
  const baseline = action("/api/baseline", { changeId: "a" });
  assert.equal(validateBaseline(baseline).ok, false);
  assert.equal(validateBaseline(baseline, { fixture: true }).ok, true);
  const fixtureRecords = [];
  await withServer(async ({ apiClient }) => {
    const store = createStore({ client: apiClient() });
    await store.loadSession(); await advanceToControl(store);
    const control = store.getState().control;
    assert.equal(validateControl(control).ok, false);
    assert.equal(validateControl(control, { fixture: true }).ok, true);
    assert.equal(validateControl({ ...control, origin: "LOCAL_EXECUTION" }).ok, true);
    await store.exportTest(); await store.runRegression();
    assert.equal(validateExport(store.getState().exportResult).ok, false);
    assert.equal(validateRegression(store.getState().regression).ok, false);
    fixtureRecords.push(["control", control, { runId: control.runId }],
      ["exportTest", store.getState().exportResult, { runId: control.runId }],
      ["regression", store.getState().regression, { runId: control.runId,
        exportId: store.getState().exportResult.exportId, scenarioId: "a" }]);
  });
  const fakeLive = { ...fixture.session(), mode: "LIVE" };
  const client = createApiClient({ randomId: randomUUID, fetchImpl: async (path) => ({ ok: true,
    status: 200, json: async () => path === "/api/session" ? fakeLive : baseline }) });
  const live = createStore({ client }); await live.loadSession();
  assert.equal((await live.runBaseline()).ok, false);
  assert.equal(live.getState().baseline, null);
  for (const [method, record, args] of fixtureRecords) {
    const client = createApiClient({ randomId: randomUUID, fetchImpl: async (path) => ({ ok: true,
      status: 200, json: async () => path === "/api/session" ? fakeLive : record }) });
    await client.getSession();
    await assert.rejects(() => client[method]({ ...args, csrfToken: fakeLive.csrfToken }));
  }
  const proposal = action("/api/propose", { changeId: "a" });
  const liveProposal = createApiClient({ randomId: randomUUID, fetchImpl: async (path) => ({ ok: true,
    status: 200, json: async () => path === "/api/session" ? fakeLive : proposal }) });
  await liveProposal.getSession();
  await assert.rejects(() => liveProposal.propose({ csrfToken: fakeLive.csrfToken, changeId: "a" }), /fixture evidence cannot enter a live session/);
});

test("unsupported/order/identity/duplicate/extra-field requests are refused and memory is bounded", () => {
  const session = createFixtureSession();
  const action = (path, body) => session.action(path, { ...body, requestId: randomUUID() });
  assert.throws(() => action("/api/propose", { changeId: "a" }), /FIXTURE_BASELINE_REQUIRED/);
  assert.throws(() => action("/api/compare", { acceptedId: "unknown" }), /FIXTURE_ACCEPTANCE_REQUIRED/);
  assert.throws(() => action("/api/control", { runId: "unknown" }), /FIXTURE_RUN_REQUIRED/);
  assert.throws(() => action("/api/baseline", { changeId: "b" }), /FIXTURE_CHANGE_REFUSED/);
  assert.throws(() => action("/api/baseline", { changeId: "a", file: "/etc/passwd" }), /FIXTURE_FIELDS_REFUSED/);
  assert.throws(() => action("/api/execute", {}), /FIXTURE_ROUTE_REFUSED/);
  const once = { changeId: "a", requestId: randomUUID() };
  session.action("/api/baseline", once);
  assert.throws(() => session.action("/api/baseline", once), /FIXTURE_DUPLICATE_REQUEST/);
  for (let i = 0; i < 110; i++) {
    try { action("/api/baseline", { changeId: "a" }); }
    catch (error) { assert.equal(error.code, "FIXTURE_SESSION_FULL"); }
  }
  assert.throws(() => action("/api/baseline", { changeId: "a" }), { code: "FIXTURE_SESSION_FULL" });
});

test("HTTP binds a closed asset/API surface with host, origin, token and body bounds", async () => {
  await withServer(async ({ send }) => {
    for (const path of ["/ota.yaml", "/fixtures/preview.json", "/tools/live-demo.mjs", "/../ota.yaml",
      "/evidence/live/approval.json", "/app.js?file=../budget.json"]) {
      assert.equal((await send(path)).status, 404, path);
    }
    assert.equal((await send("/", { headers: { Host: "attacker.example" } })).status, 403);
    const session = JSON.parse((await send("/api/session")).text);
    const headers = { "Content-Type": "application/json", "X-Demo-Token": session.csrfToken };
    const body = JSON.stringify({ requestId: randomUUID(), changeId: "a" });
    assert.equal((await send("/api/baseline", { method: "POST", headers: { ...headers, Origin: "https://attacker.example" }, body })).status, 403);
    assert.equal((await send("/api/baseline", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 403);
    assert.equal((await send("/api/baseline", { method: "POST", headers, body: "{broken" })).status, 400);
    assert.equal((await send("/api/baseline", { method: "POST", headers, body: "x".repeat(8193) })).status, 413);
  });
});

test("preview entrypoint has no live-state, credential, provider or process-execution dependency", async () => {
  const source = await readFile(new URL("../tools/fixture-preview.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:live-demo|pricing-runner|https|child_process|node:net)[^"']*["']/);
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|writeFile|appendFile|mkdir|\bspawn\s*\(|\bexec\s*\(/);
  assert.match(source, /listen\(PREVIEW_PORT, "127\.0\.0\.1"/);
  const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("Scripted baseline PASS"));
  assert.ok(app.includes("Fixture outcomes only. No regression test or correction was executed."));
  assert.ok(app.includes("Download inert fixture sample"));
  assert.match(app, /state\.comparison\.origin === "FIXTURE"\s*\? "REPRODUCED — scripted fixture shows an incorrect charge\. No pricing code was executed\."/);
  assert.ok(app.includes("Authored fixture follow-up baskets are ready. Review their scripted totals below; no model or code runs."));
  assert.ok(app.includes('feedback.origin === "FIXTURE" ? "authored fixture wording, not a model interpretation or execution proof"'));
  const followUp = app.slice(app.indexOf("function renderFollowUp(state)"), app.indexOf("function render(state)"));
  assert.ok(followUp.includes("renderAcceptanceSuccess(nodes.followupAcceptStatus, followUp.accepted, true)"));
  const acceptedList = app.slice(app.indexOf("function acceptedCasesList(accepted)"), app.indexOf("function renderAcceptanceSuccess("));
  assert.ok(acceptedList.includes('accepted.origin === "FIXTURE" ? "Scripted value, reviewer accepted" : "Muse value, reviewer accepted"'));
});
