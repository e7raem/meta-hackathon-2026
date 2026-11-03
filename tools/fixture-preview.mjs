// Reloadable, authored UI walkthrough. No provider, execution or live-state imports.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import fixtures from "../fixtures/preview.json" with { type: "json" };
import { validateSession, validateBaseline, validateProposal, validateAccepted,
  validateComparison, validateControl, validateFeedback, validateExport, validateRegression,
  formatPence } from "../web/app.js";

export const PREVIEW_PORT = 48761;
const LIMITS = [fixtures.notice];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const ORIGINAL = sha("FIXTURE original: not executed");
const CORRECTED = sha("FIXTURE correction: not executed");
const BASELINE = sha(JSON.stringify(fixtures.baseline));
const clone = (value) => structuredClone(value);
const problem = (status, code, message = code) => Object.assign(new Error(message), { status, code });
const refuse = (...args) => { throw problem(...args); };
const fields = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key));
const id = () => `fixture-${randomUUID()}`;
const result = (value, validator) => {
  if (value.mode ? value.mode !== "FIXTURE" : value.origin !== "FIXTURE") refuse(500, "FIXTURE_ORIGIN_REQUIRED");
  const checked = validator(value, { fixture: true });
  if (!checked.ok) refuse(500, "FIXTURE_DATA_INVALID", checked.error);
  return clone(value);
};
const execution = (tests, failed = 0) => ({ exitCode: failed ? 1 : 0,
  counts: { tests, passed: tests - failed, failed, skipped: 0, cancelled: 0 },
  stdout: "FIXTURE: scripted outcome. No tests or code were executed.", stderr: "" });
const publicCases = (cases) => cases.map(({ before, ...entry }) => clone(entry));

export function createFixtureSession({ now = Date.now() } = {}) {
  const token = randomUUID(), deadline = new Date(now + 60 * 60 * 1000).toISOString();
  let turns = 0;
  const seen = new Set(), baselines = new Set(), proposals = new Map(), accepted = new Map(), runs = new Map();
  const changes = Object.entries(fixtures.changes).map(([changeId, change]) => ({
    id: changeId, title: change.title, diff: change.diff, rule: clone(fixtures.rule),
    originalSha256: ORIGINAL, candidateSha256: sha(change.diff),
  }));
  const proposal = (changeId, cases, followUp = false) => {
    if (turns >= 6) refuse(409, "FIXTURE_TURNS_USED", "Reload to start a new scripted walkthrough. The live budget is unchanged.");
    const record = result({ kind: "proposal", origin: "FIXTURE", scenarioId: changeId,
      proposalId: id(), model: "Authored fixture (no model)", cases: publicCases(cases),
      callsUsed: ++turns, usage: { inputTokens: 0, outputTokens: 0 } }, validateProposal);
    proposals.set(record.proposalId, { record, cases, changeId, followUp, accepted: false });
    return record;
  };
  return {
    token,
    deadline,
    session() {
      return result({ mode: "FIXTURE", csrfToken: token, callsUsed: turns, limit: 6, deadline,
        changes, baselineCoverage: clone(fixtures.baseline) }, validateSession);
    },
    action(path, body) {
      const routes = {
        "/api/baseline": ["changeId"], "/api/propose": ["changeId"],
        "/api/accept": ["proposalId", "expectations", "reviewed"], "/api/compare": ["acceptedId"],
        "/api/control": ["runId"], "/api/feedback": ["runId", "controlId"],
        "/api/export": ["runId"], "/api/regression": ["runId", "exportId"],
      };
      if (!Object.hasOwn(routes, path)) refuse(404, "FIXTURE_ROUTE_REFUSED");
      if (!fields(body, [...routes[path], "requestId"]) || typeof body.requestId !== "string"
        || !/^[A-Za-z0-9-]{8,80}$/.test(body.requestId)) refuse(400, "FIXTURE_FIELDS_REFUSED");
      if (seen.has(body.requestId)) refuse(409, "FIXTURE_DUPLICATE_REQUEST");
      if (seen.size >= 100) refuse(429, "FIXTURE_SESSION_FULL", "Reload the preview to start a new walkthrough.");
      seen.add(body.requestId);
      const requireBaseline = (changeId) => { if (!baselines.has(changeId)) refuse(409, "FIXTURE_BASELINE_REQUIRED"); };
      if (path === "/api/baseline" || path === "/api/propose") {
        if (!Object.hasOwn(fixtures.changes, body.changeId)) refuse(400, "FIXTURE_CHANGE_REFUSED");
        const change = changes.find((entry) => entry.id === body.changeId);
        if (path === "/api/propose") {
          requireBaseline(body.changeId);
          return proposal(body.changeId, fixtures.changes[body.changeId].cases);
        }
        baselines.add(body.changeId);
        return result({ kind: "baseline", origin: "FIXTURE", changeId: body.changeId, status: "PASS",
          coverage: clone(fixtures.baseline), execution: execution(6),
          sourceIdentities: { original: ORIGINAL, candidate: change.candidateSha256, baseline: BASELINE },
          limits: LIMITS }, validateBaseline);
      }
      if (path === "/api/accept") {
        const selected = proposals.get(body.proposalId);
        if (!selected || selected.accepted) refuse(409, "FIXTURE_PROPOSAL_REQUIRED");
        if (body.reviewed !== true || !Array.isArray(body.expectations)
          || body.expectations.length !== selected.cases.length) refuse(400, "FIXTURE_REVIEW_REQUIRED");
        const values = new Map();
        for (const entry of body.expectations) {
          if (!fields(entry, ["caseId", "expectedTotal"]) || values.has(entry.caseId)) refuse(400, "FIXTURE_EXPECTATIONS_REFUSED");
          values.set(entry.caseId, entry.expectedTotal);
        }
        const cases = selected.cases.map((entry) => {
          if (values.get(entry.id) !== entry.expectedTotal) refuse(422, "FIXTURE_EXPECTATION_MISMATCH",
            `This scripted walkthrough expects ${formatPence(entry.expectedTotal)} for ${entry.id}. Canned outputs are not changed to match an edited answer.`);
          return { caseId: entry.id, lines: clone(entry.lines), expectedTotal: entry.expectedTotal,
            expectationOrigin: "META_ACCEPTED" };
        });
        const record = result({ kind: "accepted", origin: "FIXTURE", scenarioId: selected.changeId,
          acceptedId: id(), proposalId: body.proposalId, acceptedCases: cases }, validateAccepted);
        selected.accepted = true;
        accepted.set(record.acceptedId, { record, selected });
        return record;
      }
      if (path === "/api/compare") {
        const review = accepted.get(body.acceptedId);
        if (!review || review.compared) refuse(409, "FIXTURE_ACCEPTANCE_REQUIRED");
        requireBaseline(review.selected.changeId);
        const change = changes.find((entry) => entry.id === review.selected.changeId);
        const rows = review.selected.cases.map((entry) => ({ caseId: entry.id, expectedTotal: entry.expectedTotal,
          original: { value: entry.expectedTotal, error: null }, candidate: { value: entry.before, error: null } }));
        const record = result({ kind: "comparison", origin: "FIXTURE", scenarioId: change.id,
          runId: id(), acceptedId: body.acceptedId,
          status: rows.some((entry) => entry.candidate.value !== entry.expectedTotal) ? "REPRODUCED" : "NO_COUNTEREXAMPLE",
          rows, sourceIdentities: { original: ORIGINAL, candidate: change.candidateSha256,
            acceptedCases: sha(JSON.stringify(review.record.acceptedCases)) }, limits: LIMITS }, validateComparison);
        review.compared = true;
        runs.set(record.runId, { record, review });
        return record;
      }
      const run = runs.get(body.runId);
      if (!run) refuse(409, "FIXTURE_RUN_REQUIRED");
      const changeId = run.record.scenarioId;
      if (path === "/api/control") {
        if (run.control) refuse(409, "FIXTURE_CONTROL_ALREADY_SHOWN");
        const record = result({ kind: "control", origin: "FIXTURE", scenarioId: changeId, controlId: id(),
          runId: body.runId, acceptedId: run.record.acceptedId, status: "NO_COUNTEREXAMPLE",
          rows: run.record.rows.map((entry) => ({ ...clone(entry), candidate: { value: entry.expectedTotal, error: null } })),
          sourceIdentities: { original: ORIGINAL, candidate: CORRECTED,
            acceptedCases: run.record.sourceIdentities.acceptedCases }, limits: LIMITS }, validateControl);
        run.control = record;
        return record;
      }
      if (path === "/api/feedback") {
        if (run.review.selected.followUp || run.feedback || run.record.status !== "REPRODUCED"
          || run.control?.controlId !== body.controlId) refuse(409, "FIXTURE_FEEDBACK_ORDER_REFUSED");
        const followUp = proposal(changeId, fixtures.changes[changeId].followUp, true);
        run.feedback = true;
        return result({ kind: "feedback", origin: "FIXTURE", scenarioId: changeId, feedbackId: id(),
          runId: body.runId, controlId: body.controlId, bindingId: sha(JSON.stringify(run.record)),
          status: "FOLLOW_UP_PROPOSED", callsUsed: turns, proposal: followUp,
          explanation: "Authored fixture feedback, not a model interpretation: the scripted proposed charge differs from the reviewed total; the scripted correction matches it. The next basket is another prewritten example.",
          usage: { inputTokens: 0, outputTokens: 0 }, limits: LIMITS }, validateFeedback);
      }
      if (path === "/api/export") {
        if (run.exported || run.record.status !== "REPRODUCED") refuse(409, "FIXTURE_EXPORT_ORDER_REFUSED");
        const exportId = randomUUID();
        const testSource = "// FIXTURE PREVIEW ONLY - inert sample, not an executable regression test.\n"
          + run.review.selected.cases.map((entry) => `// ${entry.id}: scripted expected total ${formatPence(entry.expectedTotal)}.\n`).join("");
        run.exported = result({ kind: "export", origin: "FIXTURE", scenarioId: changeId, runId: body.runId,
          exportId, filename: "regression.test.mjs", testSource, sha256: sha(testSource),
          path: `preview-memory/${exportId}/regression.test.mjs`, command: "NOT_EXECUTED_FIXTURE" }, validateExport);
        return clone(run.exported);
      }
      if (path === "/api/regression") {
        if (!run.exported || run.exported.exportId !== body.exportId || run.regression) refuse(409, "FIXTURE_EXPORT_REQUIRED");
        const cases = run.review.selected.cases;
        run.regression = true;
        return result({ kind: "regression", origin: "FIXTURE", scenarioId: changeId,
          runId: body.runId, exportId: body.exportId, status: "RED_THEN_GREEN", sameTest: true,
          testSha256: run.exported.sha256,
          red: execution(cases.length, cases.filter((entry) => entry.before !== entry.expectedTotal).length),
          green: execution(cases.length), correction: { kind: "PRE_REVIEWED_FIXED", label: "Scripted correction; not executed",
            faultySha256: run.record.sourceIdentities.candidate, correctedSha256: CORRECTED },
          cleanup: { ownedCopiesRemoved: false }, limits: LIMITS }, validateRegression);
      }
      refuse(404, "FIXTURE_ROUTE_REFUSED");
    },
  };
}

export async function createFixturePreviewServer() {
  const assets = new Map();
  for (const [path, file, type] of [["/", "index.html", "text/html"], ["/app.js", "app.js", "text/javascript"],
    ["/styles.css", "styles.css", "text/css"]]) {
    assets.set(path, { body: await readFile(new URL(`../web/${file}`, import.meta.url)), type });
  }
  const sessions = new Map();
  const server = createServer(async (req, res) => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    const json = (status, value) => { res.writeHead(status, { ...headers, "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== origin.slice(7) && !(req.method === "GET" && req.url === "/health"
        && req.headers.host === "127.0.0.1")) refuse(403, "FIXTURE_HOST_REFUSED");
      if (req.method === "GET" && req.url === "/health") return json(200, { status: "FIXTURE_PREVIEW", modelCalls: false, codeExecution: false, liveBudgetAccess: false });
      if (req.method === "GET" && assets.has(req.url)) {
        const asset = assets.get(req.url); res.writeHead(200, { ...headers, "Content-Type": `${asset.type}; charset=utf-8` }); res.end(asset.body); return;
      }
      if (req.method === "GET" && req.url === "/api/session") {
        const token = req.headers["x-demo-token"];
        if (token) {
          const existing = sessions.get(token);
          if (!existing || Date.now() >= Date.parse(existing.deadline)) refuse(403, "FIXTURE_SESSION_EXPIRED", "Reload to start a new fixture walkthrough.");
          return json(200, existing.session());
        }
        for (const [key, session] of sessions) if (Date.now() >= Date.parse(session.deadline)) sessions.delete(key);
        if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
        const session = createFixtureSession(); sessions.set(session.token, session);
        return json(200, session.session());
      }
      if (req.method !== "POST") refuse(404, "FIXTURE_ROUTE_REFUSED");
      if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") refuse(403, "FIXTURE_ORIGIN_REFUSED");
      const session = sessions.get(req.headers["x-demo-token"]);
      if (!session || Date.now() >= Date.parse(session.deadline)) refuse(403, "FIXTURE_SESSION_REQUIRED");
      const chunks = await new Promise((resolve, reject) => {
        let size = 0, failed = false; const parts = [];
        req.on("data", (chunk) => {
          if (failed) return;
          size += chunk.length;
          if (size > 8192) { failed = true; reject(problem(413, "FIXTURE_BODY_TOO_LARGE")); }
          else parts.push(chunk);
        });
        req.on("end", () => resolve(parts));
        req.on("error", reject);
        req.on("aborted", () => reject(problem(400, "FIXTURE_BODY_ABORTED")));
      });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { refuse(400, "FIXTURE_JSON_REQUIRED"); }
      return json(200, session.action(req.url, body));
    } catch (error) {
      res.setHeader("Connection", "close");
      if (!res.headersSent && !res.destroyed) json(error.status ?? 500, { error: {
        code: error.code ?? "FIXTURE_PREVIEW_ERROR", message: error.status ? error.message : "Fixture preview failed." } });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error("Fixture preview accepts no arguments.");
  const server = await createFixturePreviewServer();
  server.listen(PREVIEW_PORT, "127.0.0.1", () => {
    console.log(`FIXTURE_PREVIEW_READY http://127.0.0.1:${PREVIEW_PORT}/ - no model calls, code execution or live budget access`);
  });
  process.once("SIGINT", () => { server.close(); server.closeIdleConnections(); });
  process.once("SIGTERM", () => { server.close(); server.closeIdleConnections(); });
}
