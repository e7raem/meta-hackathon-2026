import { constants } from "node:fs";
import { open, readFile, rename, unlink, lstat, link, mkdir, mkdtemp, rm, realpath } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCart } from "./pricing-runner.mjs";

export const ORIGIN = "http://127.0.0.1:48761";
export const MAX_SESSION_MINUTES = 60;
export const MAX_SESSION_REQUESTS = 6;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9-]{8,80}$/;
const validId = (x) => typeof x === "string" && ID.test(x);
export const SCENARIO_IDS = Object.freeze(["a", "c"]);
const MODEL = "muse-spark-1.3";
export const RUNTIME_FILES = ["pricing/rule.json", "pricing/original.ts", "pricing/change-a.ts",
  "pricing/change-b.ts", "tools/live-demo.mjs", "tools/pricing-runner.mjs",
  "web/index.html", "web/app.js", "web/styles.css", "pricing/baseline.json",
  "checks/baseline.test.mjs", "ota.yaml", "package.json", "pricing/change-c.ts", "checks/baseline-c.test.mjs"];
const CHILDREN = new Set();
const PROVIDER_REQUESTS = new Set();
const sha = (value) => createHash("sha256").update(value).digest("hex");
const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length
  && keys.every((key) => Object.hasOwn(x, key));
const integer = (x, min = 0, max = 400000) => Number.isSafeInteger(x) && x >= min && x <= max;
const bounded = (x, max = 600) => typeof x === "string" && x.length > 0 && x.length <= max;

export class Refusal extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const requireThat = (ok, code, status) => { if (!ok) throw new Refusal(code, status); };

export function createLifecycle({ deadline = Infinity, now = Date.now } = {}) {
  let stopping = false;
  const active = new Set();
  const check = () => {
    requireThat(!stopping, "STOPPING", 503);
    requireThat(now() < deadline, "WINDOW_ENDED", 403);
  };
  return {
    check,
    beginStop() { stopping = true; },
    run(operation) {
      check();
      const pending = Promise.resolve().then(() => { check(); return operation(); });
      active.add(pending);
      return pending.finally(() => active.delete(pending));
    },
    async drain() { await Promise.allSettled([...active]); },
  };
}

export async function closeProviderRequests(requests = PROVIDER_REQUESTS) {
  const owned = [...requests];
  const closed = owned.map((req) => new Promise((done) => req.once("close", done)));
  for (const req of owned) req.destroy();
  await Promise.all(closed);
  requireThat(requests.size === 0, "PROVIDER_CLOSE_NOT_ESTABLISHED", 503);
}

async function privateDirectory(path) {
  const s = await lstat(path);
  requireThat(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid()
    && (s.mode & 0o777) === 0o700, "PRIVATE_DIRECTORY_REQUIRED", 503);
}

async function readPrivate(path, max = 32768, mode = 0o600) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    requireThat(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === mode
      && s.nlink === 1 && s.size <= max, "PRIVATE_FILE_REQUIRED", 503);
    const data = Buffer.alloc(max + 1); let length = 0;
    while (length < data.length) {
      const { bytesRead } = await f.read(data, length, data.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    requireThat(length <= max, "PRIVATE_FILE_TOO_LARGE", 503);
    return data.subarray(0, length);
  } finally { await f.close(); }
}

async function syncDirectory(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await f.sync(); } finally { await f.close(); }
}

async function exclusiveBytes(path, value) {
  const f = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(value); await f.sync(); }
  finally { await f.close(); }
  await syncDirectory(dirname(path));
}

async function exclusiveJSON(path, value) {
  await exclusiveBytes(path, JSON.stringify(value, null, 2) + "\n");
}

export function exportArtifactPath(scopeId, exportId) {
  requireThat(validId(scopeId) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(exportId),
    "EXPORT_ID_INVALID");
  return `evidence/live/${scopeId}/exports/${exportId}/regression.test.mjs`;
}

export async function persistRegression({ root = ROOT, runDirectory, scopeId, runId, scenarioId, exportId, source, beforeCommit }) {
  requireThat(typeof source === "string" && Buffer.byteLength(source) <= 16384,
    "EXPORT_LIMIT");
  const path = exportArtifactPath(scopeId, exportId);
  requireThat(runDirectory === join(root, "evidence/live", scopeId) && validId(runId) && SCENARIO_IDS.includes(scenarioId),
    "EXPORT_BINDING_INVALID");
  await privateDirectory(runDirectory);
  const exports = join(runDirectory, "exports");
  try { await mkdir(exports, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
  await privateDirectory(exports);
  const directory = join(exports, exportId);
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(exports);
  const digest = sha(source);
  const artifact = join(directory, "regression.test.mjs");
  await exclusiveBytes(artifact, source);
  if (beforeCommit) await beforeCommit();
  await exclusiveJSON(join(directory, "record.json"), { version: 2, scopeId, runId, scenarioId, exportId, sha256: digest });
  requireThat(sha(await readPrivate(artifact)) === digest, "EXPORT_PERSISTENCE_FAILED", 503);
  return { sha256: digest, path, exportId };
}

async function readStoredExport({ runDirectory, scopeId, runId, scenarioId, exportId, testSha256 }) {
  exportArtifactPath(scopeId, exportId);
  const directory = join(runDirectory, "exports", exportId);
  await noLinkedParents(join(directory, "record.json")); await privateDirectory(directory);
  const record = JSON.parse((await readPrivate(join(directory, "record.json"))).toString("utf8"));
  requireThat(exact(record, ["version", "scopeId", "runId", "scenarioId", "exportId", "sha256"])
    && record.version === 2 && record.scopeId === scopeId && record.runId === runId
    && record.scenarioId === scenarioId && record.exportId === exportId && record.sha256 === testSha256,
  "EXPORT_BINDING_CHANGED", 503);
  const bytes = await readPrivate(join(directory, "regression.test.mjs"));
  requireThat(sha(bytes) === testSha256, "PERSISTED_TEST_CHANGED", 503);
  return bytes;
}

// Setup is deliberately separate: normal startup never creates or resets a budget.
export function validateSessionWindow(scope, now = Date.now()) {
  const issued = Date.parse(scope.issuedAt), deadline = Date.parse(scope.deadline);
  requireThat(validId(scope.id) && integer(scope.limit, 1, MAX_SESSION_REQUESTS)
    && Number.isFinite(issued) && Number.isFinite(deadline)
    && new Date(issued).toISOString() === scope.issuedAt && new Date(deadline).toISOString() === scope.deadline
    && deadline - issued >= 60000 && deadline - issued <= MAX_SESSION_MINUTES * 60000,
  "SESSION_WINDOW_INVALID", 503);
  requireThat(Number.isFinite(now) && issued <= now && now < deadline, "SESSION_WINDOW_EXPIRED_OR_FUTURE", 403);
}

export async function initializeBudget(path, scope) {
  validateSessionWindow(scope, Date.parse(scope.issuedAt));
  await privateDirectory(dirname(path));
  await exclusiveJSON(path, { version: 2, scopeId: scope.id, issuedAt: scope.issuedAt, deadline: scope.deadline,
    limit: scope.limit, reservations: [] });
}

export class BudgetLedger {
  constructor(path, scope, options = {}) {
    this.path = path; this.scope = scope; this.now = options.now ?? Date.now;
    this.beforeRename = options.beforeRename; this.poisoned = false;
  }
  async read() {
    await privateDirectory(dirname(this.path));
    const data = JSON.parse((await readPrivate(this.path)).toString("utf8"));
    requireThat(data?.version !== 1, "LEGACY_SESSION_READ_ONLY", 503);
    validateSessionWindow(this.scope, Date.parse(this.scope.issuedAt));
    requireThat(exact(data, ["version", "scopeId", "issuedAt", "deadline", "limit", "reservations"])
      && data.version === 2 && data.scopeId === this.scope.id && data.deadline === this.scope.deadline
      && data.issuedAt === this.scope.issuedAt && data.limit === this.scope.limit
      && Array.isArray(data.reservations) && data.reservations.length <= data.limit
      && data.reservations.every((r) => exact(r, ["requestId", "reservedAt"])
        && validId(r.requestId) && Number.isFinite(Date.parse(r.reservedAt))
        && Date.parse(r.reservedAt) >= Date.parse(data.issuedAt) && Date.parse(r.reservedAt) < Date.parse(data.deadline))
      && new Set(data.reservations.map((r) => r.requestId)).size === data.reservations.length,
    "BUDGET_STATE_INVALID", 503);
    return data;
  }
  async ready() {
    requireThat(!this.poisoned, "BUDGET_UNCERTAIN", 503);
    try { await lstat(this.path + ".lock"); throw new Refusal("BUDGET_LOCKED", 503); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    return this.read();
  }
  async reserve(requestId) {
    requireThat(!this.poisoned && typeof requestId === "string" && ID.test(requestId), "BUDGET_UNCERTAIN", 503);
    // Reject legacy/corrupt state before even creating a lock alongside it.
    await this.read();
    requireThat(this.now() >= Date.parse(this.scope.issuedAt), "SESSION_WINDOW_EXPIRED_OR_FUTURE", 403);
    const lockPath = this.path + ".lock";
    // A crash/uncertain commit leaves this durable lock for independent disposition.
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const identity = await lock.stat();
    let certain = false;
    try {
      await lock.writeFile("reserved\n"); await lock.sync(); await syncDirectory(dirname(this.path));
      const data = await this.read();
      requireThat(this.now() < Date.parse(data.deadline), "WINDOW_ENDED", 403);
      requireThat(!data.reservations.some((r) => r.requestId === requestId), "DUPLICATE_REQUEST", 409);
      requireThat(data.reservations.length < data.limit, "REQUEST_BUDGET_EXHAUSTED", 403);
      data.reservations.push({ requestId, reservedAt: new Date(this.now()).toISOString() });
      const pending = this.path + ".pending-" + randomUUID();
      await exclusiveJSON(pending, data);
      if (this.beforeRename) await this.beforeRename();
      await rename(pending, this.path); await syncDirectory(dirname(this.path));
      certain = true;
      return data.reservations.length;
    } catch (error) {
      if (error instanceof Refusal && ["DUPLICATE_REQUEST", "REQUEST_BUDGET_EXHAUSTED", "WINDOW_ENDED"].includes(error.code)) certain = true;
      else this.poisoned = true;
      throw error;
    } finally {
      await lock.close();
      if (certain) {
        const current = await lstat(lockPath);
        requireThat(current.dev === identity.dev && current.ino === identity.ino, "BUDGET_LOCK_CHANGED", 503);
        await unlink(lockPath); await syncDirectory(dirname(this.path));
      }
    }
  }
}

export function ruleTotal(lines) {
  requireThat(isCart(lines), "INVALID_CART");
  let eligible = 0, other = 0;
  for (const line of lines) {
    if (line.discountEligible) eligible += line.amount * 9 / 10;
    else other += line.amount;
  }
  return eligible + other - (eligible >= 10000 ? 500 : 0);
}

export function buildRunnerEnvironment(node) {
  return { PATH: dirname(node) + ":/usr/bin:/bin", NODE_OPTIONS: "",
    NODE_DISABLE_COMPILE_CACHE: "1", LANG: "C", NO_COLOR: "1" };
}

export function checkRequest(method, path, headers, nonce) {
  // Temporary compatibility with released Ota 1.6.28's portless readiness Host.
  const readinessProbe = method === "GET" && path === "/health";
  requireThat(headers.host === "127.0.0.1:48761"
    || (readinessProbe && headers.host === "127.0.0.1"), "HOST_REFUSED", 403);
  if (method === "GET") {
    requireThat(["/", "/app.js", "/styles.css", "/health", "/api/session"].includes(path), "NOT_FOUND", 404);
    return;
  }
  requireThat(method === "POST" && ["/api/baseline", "/api/propose", "/api/accept", "/api/compare", "/api/control", "/api/feedback", "/api/export", "/api/regression"].includes(path), "NOT_FOUND", 404);
  requireThat(headers.origin === ORIGIN && headers["x-demo-token"] === nonce,
    "ORIGIN_OR_NONCE_REFUSED", 403);
  requireThat(headers["content-type"] === "application/json", "JSON_REQUIRED", 415);
}

export function exportRegression(changeId, cases) {
  requireThat(SCENARIO_IDS.includes(changeId) && cases.length > 0 && cases.length <= 3
    && cases.every((c) => isCart(c.lines) && integer(c.expectedTotal)), "INVALID_EXPORT");
  const data = cases.map((c) => ({ lines: c.lines, expected: c.expectedTotal }));
  return 'import assert from "node:assert/strict";\nimport { test } from "node:test";\n'
    + `import { priceCart } from "../pricing/change-${changeId}.ts";\n`
    + '// Operator-validated expectations; selected cases, not universal correctness.\n'
    + `const cases = ${JSON.stringify(data, null, 2)};\n`
    + 'for (const [index, item] of cases.entries()) {\n'
    + '  test(`accepted pricing case ${index + 1}`, () => {\n'
    + '    assert.equal(priceCart(item.lines), item.expected);\n  });\n}\n';
}

function finalModelValue(response) {
  requireThat(response?.status === "completed" && response.error == null && response.model === MODEL,
    "MODEL_INCOMPLETE", 502);
  const parts = response.output?.filter((x) => x.type === "message")
    .flatMap((x) => x.content ?? []).filter((x) => x.type === "output_text");
  requireThat(parts?.length === 1 && bounded(parts[0].text, 16000), "MODEL_OUTPUT_INVALID", 502);
  try { return JSON.parse(parts[0].text); }
  catch { throw new Refusal("MODEL_OUTPUT_INVALID", 502); }
}

function casesFromResponse(response) {
  const value = finalModelValue(response);
  requireThat(exact(value, ["cases"]) && Array.isArray(value.cases)
    && value.cases.length <= 3, "MODEL_CASES_INVALID", 502);
  requireThat(value.cases.length > 0, "NO_CASES_PROPOSED", 422);
  return value.cases.map((c, i) => {
    requireThat(exact(c, ["lines", "expectedTotal", "rationale"]) && isCart(c.lines)
      && integer(c.expectedTotal) && bounded(c.rationale), "MODEL_CASES_INVALID", 502);
    return { id: "case-" + (i + 1), lines: c.lines, expectedTotal: c.expectedTotal, rationale: c.rationale };
  });
}

function modelUsage(raw) {
  const token = (x) => integer(x, 0, 100000000) ? x : null;
  return { inputTokens: token(raw.usage?.input_tokens), outputTokens: token(raw.usage?.output_tokens) };
}

function comparisonRows(actual, frozen) {
  requireThat(exact(actual, ["rows"]) && Array.isArray(actual.rows)
    && actual.rows.length === frozen.length, "RUNNER_OUTPUT_INVALID", 502);
  return actual.rows.map((r, i) => {
    requireThat(exact(r, ["original", "candidate"])
      && [r.original, r.candidate].every((x) => exact(x, ["value", "error"])
        && ((integer(x.value) && x.error === null) || (x.value === null && bounded(x.error, 100)))),
    "RUNNER_OUTPUT_INVALID", 502);
    return { caseId: frozen[i].caseId, expectedTotal: frozen[i].expectedTotal, ...r };
  });
}

function comparisonStatus(rows) {
  return rows.some((r) => r.original.error || r.candidate.error || r.original.value !== r.expectedTotal)
    ? "INCONCLUSIVE" : rows.some((r) => r.candidate.value !== r.expectedTotal)
      ? "REPRODUCED" : "NO_COUNTEREXAMPLE";
}

const basketIdentity = (lines) => sha(JSON.stringify(lines.map((x) => [x.amount, x.discountEligible])
  .sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1]))));

export function feedbackContext({ run, control, selected, ruleSha256, controlSha256, provenance }) {
  requireThat(SCENARIO_IDS.includes(selected.change.id), "CHANGE_NOT_FOUND", 404);
  const binding = { domain: "break-this-pr/feedback-context/v2", scenarioId: selected.change.id, runId: run.runId,
    acceptedId: run.acceptedId, proposalId: selected.record.proposalId,
    acceptedCases: sha(JSON.stringify(selected.record.acceptedCases)), rule: ruleSha256,
    original: selected.change.originalSha256, candidate: selected.change.candidateSha256,
    control: controlSha256, controlId: control.controlId,
    initialRows: sha(JSON.stringify(run.rows)), controlRows: sha(JSON.stringify(control.rows)),
    provenance: sha(JSON.stringify(provenance ?? null)) };
  requireThat([binding.rule, binding.original, binding.candidate, binding.control].every((x) => HASH.test(x)),
    "FEEDBACK_SOURCES_REQUIRED", 503);
  const bindingId = sha("break-this-pr/feedback-binding/v2\n" + JSON.stringify(binding));
  return { bindingId, runId: run.runId, binding, rule: selected.change.rule,
    originalSource: selected.change.originalSource, proposedSource: selected.change.candidateSource,
    acceptedCases: selected.record.acceptedCases, initialRows: run.rows, controlRows: control.rows,
    initialProvenance: provenance ?? null };
}

export function feedbackFromResponse(raw, packet) {
  const v = finalModelValue(raw);
  requireThat(exact(v, ["bindingId", "runId", "explanation", "observedFaultCaseIds", "decision", "cases"])
    && v.bindingId === packet.bindingId && v.runId === packet.runId
    && bounded(v.explanation) && ["STOP", "PROPOSE_CASES"].includes(v.decision)
    && Array.isArray(v.observedFaultCaseIds) && v.observedFaultCaseIds.length <= 3
    && new Set(v.observedFaultCaseIds).size === v.observedFaultCaseIds.length
    && Array.isArray(v.cases) && v.cases.length <= 2, "FEEDBACK_OUTPUT_INVALID", 502);
  const failing = new Set(packet.initialRows.filter((r) => !r.original.error && !r.candidate.error
    && r.original.value === r.expectedTotal && r.candidate.value !== r.expectedTotal).map((r) => r.caseId));
  requireThat(v.observedFaultCaseIds.length === failing.size
    && v.observedFaultCaseIds.every((id) => failing.has(id)), "FEEDBACK_FAULT_ID_INVALID", 502);
  requireThat(v.decision === "STOP" ? v.cases.length === 0
    : v.cases.length > 0 && v.observedFaultCaseIds.length > 0, "FEEDBACK_DECISION_INVALID", 502);
  const cases = v.cases.map((c, i) => {
    requireThat(exact(c, ["lines", "expectedTotal", "rationale"]) && isCart(c.lines)
      && integer(c.expectedTotal) && bounded(c.rationale), "FEEDBACK_CASES_INVALID", 502);
    return { id: "feedback-case-" + (i + 1), ...c };
  });
  const previous = new Set(packet.acceptedCases.map((c) => basketIdentity(c.lines)));
  const duplicates = cases.some((c) => {
    const identity = basketIdentity(c.lines); const seen = previous.has(identity); previous.add(identity); return seen;
  });
  return { status: duplicates ? "INCONCLUSIVE" : v.decision === "STOP" ? "STOPPED" : "FOLLOW_UP_PROPOSED",
    explanation: v.explanation, cases: duplicates ? [] : cases };
}

// A pinned owner projection is continuity evidence, not fresh execution or an authenticated human decision.
export function validateRetainedCheckpoint(value, { scopeId, change, sources, now = Date.now() }) {
  requireThat(exact(value, ["version", "scopeId", "recordedAt", "sourceIdentities", "model",
    "proposal", "accepted", "comparison", "recordHashes", "reviewEvidence", "sourceRecordHashes", "proposalProvenance"])
    && value.version === 1 && value.scopeId === scopeId
    && bounded(value.recordedAt, 40) && Number.isFinite(Date.parse(value.recordedAt))
    && Date.parse(value.recordedAt) <= now
    && exact(value.sourceIdentities, ["rule", "original", "candidate", "control"])
    && Object.keys(sources).every((key) => HASH.test(value.sourceIdentities[key])
      && value.sourceIdentities[key] === sources[key])
    && exact(value.model, ["responseId", "recordSha256", "createdAt"]) && bounded(value.model.responseId, 100)
    && HASH.test(value.model.recordSha256) && integer(value.model.createdAt, 0, Math.floor(now / 1000))
    && value.model.createdAt * 1000 <= Date.parse(value.recordedAt)
    && exact(value.sourceRecordHashes, ["accepted", "comparison"])
    && Object.values(value.sourceRecordHashes).every((x) => HASH.test(x))
    && value.proposalProvenance === "DERIVED_FROM_RETAINED_MODEL_AND_ACCEPTANCE"
    && value.reviewEvidence === "operator declaration, not independently attested human identity",
  "CHECKPOINT_INVALID", 503);
  const { proposal: p, accepted: a, comparison: r } = value;
  requireThat(exact(value.recordHashes, ["proposal", "accepted", "comparison"])
    && ["proposal", "accepted", "comparison"].every((key) => HASH.test(value.recordHashes[key])
      && value.recordHashes[key] === sha(JSON.stringify(value[key]))), "CHECKPOINT_RECORD_HASH_MISMATCH", 503);
  requireThat(exact(p, ["kind", "origin", "proposalId", "model", "cases", "usage", "callsUsed"])
    && p.kind === "proposal" && p.origin === "LIVE" && validId(p.proposalId) && p.model === MODEL
    && integer(p.callsUsed, 1, 6) && exact(p.usage, ["inputTokens", "outputTokens"])
    && Object.values(p.usage).every((x) => x === null || integer(x, 0, 100000000))
    && Array.isArray(p.cases) && p.cases.length >= 1 && p.cases.length <= 3
    && p.cases.every((c, i) => exact(c, ["id", "lines", "expectedTotal", "rationale"])
      && c.id === "case-" + (i + 1) && isCart(c.lines) && integer(c.expectedTotal) && bounded(c.rationale)),
  "CHECKPOINT_PROPOSAL_INVALID", 503);
  requireThat(exact(a, ["kind", "origin", "acceptedId", "proposalId", "acceptedCases"])
    && a.kind === "accepted" && a.origin === "LIVE" && validId(a.acceptedId) && a.proposalId === p.proposalId
    && Array.isArray(a.acceptedCases) && a.acceptedCases.length === p.cases.length
    && a.acceptedCases.every((c, i) => exact(c, ["caseId", "lines", "expectedTotal", "expectationOrigin"])
      && c.caseId === p.cases[i].id && JSON.stringify(c.lines) === JSON.stringify(p.cases[i].lines)
      && c.expectedTotal === ruleTotal(c.lines)
      && c.expectationOrigin === (c.expectedTotal === p.cases[i].expectedTotal ? "META_ACCEPTED" : "REVIEWER_CORRECTED")),
  "CHECKPOINT_ACCEPTANCE_INVALID", 503);
  requireThat(exact(r, ["kind", "origin", "runId", "acceptedId", "status", "rows", "sourceIdentities", "limits"])
    && r.kind === "comparison" && r.origin === "LIVE" && validId(r.runId) && r.acceptedId === a.acceptedId
    && Array.isArray(r.rows) && r.rows.every((row) => exact(row, ["caseId", "expectedTotal", "original", "candidate"]))
    && exact(r.sourceIdentities, ["original", "candidate", "acceptedCases"])
    && r.sourceIdentities.original === change.originalSha256
    && r.sourceIdentities.candidate === change.candidateSha256
    && r.sourceIdentities.acceptedCases === sha(JSON.stringify(a.acceptedCases))
    && Array.isArray(r.limits) && r.limits.length <= 10 && r.limits.every((x) => bounded(x, 600)),
  "CHECKPOINT_COMPARISON_INVALID", 503);
  const rows = comparisonRows({ rows: r.rows.map(({ original, candidate }) => ({ original, candidate })) }, a.acceptedCases);
  requireThat(JSON.stringify(rows) === JSON.stringify(r.rows) && r.status === comparisonStatus(rows),
    "CHECKPOINT_COMPARISON_INVALID", 503);
  return structuredClone(value);
}

export async function loadRetainedCheckpoint(pin, context) {
  requireThat(exact(pin, ["path", "sha256"]) && isAbsolute(pin.path) && resolve(pin.path) === pin.path
    && HASH.test(pin.sha256), "CHECKPOINT_PIN_INVALID", 503);
  for (let parent = dirname(pin.path); ; parent = dirname(parent)) {
    const s = await lstat(parent);
    requireThat(s.isDirectory() && !s.isSymbolicLink(), "CHECKPOINT_PATH_LINKED", 503);
    if (parent === dirname(parent)) break;
  }
  const bytes = await readPrivate(pin.path, 32768, 0o400);
  requireThat(sha(bytes) === pin.sha256, "CHECKPOINT_PIN_MISMATCH", 503);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Refusal("CHECKPOINT_INVALID", 503); }
  return validateRetainedCheckpoint(value, context);
}

export function createFeedbackAttempts(directory) {
  const path = (root) => { requireThat(validId(root), "FEEDBACK_ROOT_INVALID"); return join(directory, "feedback-attempt-" + root + ".json"); };
  return {
    async has(root) {
      await privateDirectory(directory);
      try {
        const record = JSON.parse((await readPrivate(path(root), 2048)).toString("utf8"));
        requireThat(exact(record, ["rootProposalId", "runId", "requestId", "bindingId"])
          && record.rootProposalId === root && validId(record.runId) && validId(record.requestId)
          && HASH.test(record.bindingId), "FEEDBACK_ATTEMPT_UNCERTAIN", 503);
        return true;
      } catch (e) { if (e.code === "ENOENT") return false; throw e; }
    },
    async claim(root, record) {
      await privateDirectory(directory);
      try { await exclusiveJSON(path(root), { rootProposalId: root, ...record }); }
      catch (e) { if (e.code === "EEXIST") throw new Refusal("FEEDBACK_ALREADY_ATTEMPTED", 409); throw e; }
    },
  };
}

export function createController({ changes, scope, ledger, provider, runner, verifySources,
  retain, persistExport, baselineCoverage, baselineIdentity, verification, feedbackProvider,
  feedbackAttempts, ruleIdentity, controlIdentity, retainedCheckpoint,
  lifecycle = createLifecycle(), now = Date.now,
  nonce = randomBytes(32).toString("hex") }) {
  const proposals = new Map(), accepted = new Map(), runs = new Map(), seen = new Set();
  const acceptedProposals = new Set();
  const baselines = new Map();
  const feedbackAttempted = new Set();
  let retainedInitial;
  if (retainedCheckpoint) {
    const change = changes.find((c) => c.id === "a");
    const checkpoint = validateRetainedCheckpoint(retainedCheckpoint, { scopeId: scope.id, change,
      sources: { rule: ruleIdentity, original: change.originalSha256,
        candidate: change.candidateSha256, control: controlIdentity }, now: now() });
    const { proposal, accepted: record, comparison: result, recordedAt, recordHashes } = checkpoint;
    retainedInitial = { proposal, accepted: record, comparison: result, recordedAt, recordHashes,
      proposalProvenance: checkpoint.proposalProvenance, model: checkpoint.model,
      sourceRecordHashes: checkpoint.sourceRecordHashes };
    proposals.set(proposal.proposalId, { ...proposal, change, rootProposalId: proposal.proposalId,
      provenance: { origin: "RETAINED_LIVE", recordedAt, recordHashes, model: checkpoint.model,
        sourceRecordHashes: checkpoint.sourceRecordHashes, proposalProvenance: checkpoint.proposalProvenance,
        reviewEvidence: checkpoint.reviewEvidence } });
    const selected = { record, change, rootProposalId: proposal.proposalId, feedback: false };
    accepted.set(record.acceptedId, selected); acceptedProposals.add(proposal.proposalId);
    runs.set(result.runId, { result, selected });
  }
  let busy = false;
  return {
    nonce,
    async session() {
      lifecycle.check();
      requireThat(now() < Date.parse(scope.deadline), "WINDOW_ENDED", 403);
      await verifySources(); lifecycle.check();
      const budget = await ledger.ready();
      lifecycle.check();
      if (retainedInitial) requireThat(budget.reservations.length >= retainedInitial.proposal.callsUsed,
        "CHECKPOINT_BUDGET_PRECEDES_HISTORY", 503);
      return { mode: "LIVE", csrfToken: nonce, callsUsed: budget.reservations.length, limit: scope.limit,
        deadline: scope.deadline, baselineCoverage,
        ...(retainedInitial ? { retainedInitial, feedbackAttempted: feedbackAttempted.has(retainedInitial.proposal.proposalId)
          || await feedbackAttempts.has(retainedInitial.proposal.proposalId) } : {}),
        changes: changes.map(({ originalSource, candidateSource, ...publicChange }) => publicChange) };
    },
    async action(path, body) { return lifecycle.run(async () => {
      requireThat(now() < Date.parse(scope.deadline), "WINDOW_ENDED", 403);
      requireThat(plain(body) && typeof body.requestId === "string" && ID.test(body.requestId), "REQUEST_ID_REQUIRED");
      requireThat(!seen.has(body.requestId), "DUPLICATE_REQUEST", 409);
      requireThat(!busy, "BUSY", 409);
      busy = true; seen.add(body.requestId);
      try {
        await verifySources();
        lifecycle.check();
        if (path === "/api/baseline") {
          requireThat(exact(body, ["changeId", "requestId"]) && SCENARIO_IDS.includes(body.changeId), "INVALID_FIELDS");
          const change = changes.find((c) => c.id === body.changeId && SCENARIO_IDS.includes(c.id));
          requireThat(change && verification && baselineCoverage, "BASELINE_UNAVAILABLE", 503);
          const actual = await verification.baseline(body.changeId); lifecycle.check();
          const result = { kind: "baseline", origin: "LOCAL_EXECUTION", changeId: body.changeId,
            status: actual.status, coverage: baselineCoverage, execution: actual.execution,
            sourceIdentities: { original: change.originalSha256, candidate: change.candidateSha256,
              baseline: baselineIdentity },
            limits: ["Six assertions: three ordinary baskets against each version.",
              "This baseline does not exercise voucher-boundary cases or prove the whole PR."] };
          requireThat(actual.cleanup?.ownedCopiesRemoved === true, "COPY_CLEANUP_INCOMPLETE", 503);
          await retain("baseline-" + body.requestId, result); lifecycle.check();
          if (actual.status === "PASS" && passing(actual.execution, 6)) baselines.set(body.changeId, result);
          else baselines.delete(body.changeId);
          return result;
        }
        if (path === "/api/propose") {
          requireThat(exact(body, ["changeId", "requestId"]), "INVALID_FIELDS");
          requireThat(!retainedInitial, "RETAINED_INITIAL_MODE", 409);
          const change = changes.find((c) => c.id === body.changeId && SCENARIO_IDS.includes(c.id));
          requireThat(change, "CHANGE_NOT_FOUND", 404);
          requireThat(baselines.has(body.changeId), "PASSING_BASELINE_REQUIRED", 409);
          const callsUsed = await ledger.reserve(body.requestId);
          lifecycle.check();
          const packet = { rule: change.rule, originalSource: change.originalSource,
            proposedSource: change.candidateSource };
          let raw;
          try { raw = await provider(packet); }
          catch {
            lifecycle.check();
            await retain("model-" + callsUsed + "-failure", { requestId: body.requestId,
              outcome: "FAILED_OR_UNKNOWN_CONSUMED", callsUsed });
            throw new Refusal("PROVIDER_FAILED_CONSUMED", 502);
          }
          lifecycle.check();
          await retain("model-" + callsUsed, raw);
          lifecycle.check();
          const cases = casesFromResponse(raw);
          const proposalId = randomUUID();
          const result = { kind: "proposal", origin: "LIVE", scenarioId: change.id, proposalId, model: MODEL, cases,
            usage: modelUsage(raw), callsUsed };
          await retain("proposal-" + proposalId, result); lifecycle.check();
          proposals.set(proposalId, { ...result, change, rootProposalId: proposalId,
            provenance: { origin: "LIVE_INITIAL", recordedAt: new Date(now()).toISOString() } });
          return result;
        }
        if (path === "/api/accept") {
          requireThat(exact(body, ["proposalId", "expectations", "reviewed", "requestId"])
            && body.reviewed === true, "EXPECTATION_REVIEW_REQUIRED");
          const proposal = proposals.get(body.proposalId);
          requireThat(proposal, "PROPOSAL_NOT_FOUND", 404);
          requireThat(!acceptedProposals.has(proposal.proposalId), "PROPOSAL_ALREADY_ACCEPTED", 409);
          requireThat(Array.isArray(body.expectations) && body.expectations.length === proposal.cases.length,
            "EXPECTATIONS_INVALID");
          const values = new Map();
          for (const item of body.expectations) {
            requireThat(exact(item, ["caseId", "expectedTotal"]) && integer(item.expectedTotal)
              && !values.has(item.caseId), "EXPECTATIONS_INVALID");
            values.set(item.caseId, item.expectedTotal);
          }
          const acceptedCases = proposal.cases.map((c) => {
            const expectedTotal = values.get(c.id);
            requireThat(expectedTotal === ruleTotal(c.lines), "EXPECTATION_RULE_MISMATCH", 422);
            return { caseId: c.id, lines: c.lines, expectedTotal,
              expectationOrigin: expectedTotal === c.expectedTotal ? "META_ACCEPTED" : "REVIEWER_CORRECTED" };
          });
          const acceptedId = randomUUID();
          const record = { kind: "accepted", origin: "LIVE", scenarioId: proposal.change.id,
            acceptedId, proposalId: proposal.proposalId, acceptedCases };
          await retain("accepted-" + acceptedId, { ...record,
            reviewEvidence: "operator declaration, not independently attested human identity" });
          lifecycle.check();
          acceptedProposals.add(proposal.proposalId);
          accepted.set(acceptedId, { record, change: proposal.change,
            rootProposalId: proposal.rootProposalId, feedback: proposal.feedback === true });
          return record;
        }
        if (path === "/api/compare") {
          requireThat(exact(body, ["acceptedId", "requestId"]), "INVALID_FIELDS");
          const selected = accepted.get(body.acceptedId);
          requireThat(selected, "ACCEPTED_CASES_REQUIRED", 409);
          requireThat(baselines.has(selected.change.id), "PASSING_BASELINE_REQUIRED", 409);
          const frozen = selected.record.acceptedCases;
          let actual;
          try { actual = await runner(selected.change.id, frozen.map((c) => c.lines)); }
          catch {
            lifecycle.check();
            actual = { rows: frozen.map(() => ({
              original: { value: null, error: "RUNNER_NOT_ESTABLISHED" },
              candidate: { value: null, error: "RUNNER_NOT_ESTABLISHED" },
            })) };
          }
          lifecycle.check();
          await verifySources(); lifecycle.check();
          const rows = comparisonRows(actual, frozen);
          const status = comparisonStatus(rows);
          const runId = randomUUID();
          const result = { kind: "comparison", origin: "LIVE", scenarioId: selected.change.id,
            runId, acceptedId: body.acceptedId, status, rows,
            sourceIdentities: { original: selected.change.originalSha256, candidate: selected.change.candidateSha256,
              acceptedCases: sha(JSON.stringify(frozen)) },
            limits: ["Selected prepared code/cases only; original behaviour is not the specification.",
              "No counterexample is not universal correctness or a model false-positive rate.",
              "Operator expectation declaration is not independent human-identity proof.",
              "Fixed audited native code; no independent OS isolation or production readiness established."] };
          await retain("run-" + runId, result);
          lifecycle.check();
          runs.set(runId, { result, selected });
          return result;
        }
        if (path === "/api/control") {
          requireThat(exact(body, ["runId", "requestId"]), "INVALID_FIELDS");
          const run = runs.get(body.runId);
          requireThat(run, "MEANINGFUL_RUN_REQUIRED", 409);
          requireThat(baselines.has(run.selected.change.id), "PASSING_BASELINE_REQUIRED", 409);
          requireThat(HASH.test(controlIdentity), "CONTROL_SOURCE_REQUIRED", 503);
          requireThat(!run.controlAttempted, "CONTROL_ALREADY_RUN", 409); run.controlAttempted = true;
          const frozen = run.selected.record.acceptedCases;
          let actual;
          try { actual = await runner("b", frozen.map((c) => c.lines)); }
          catch { actual = { rows: frozen.map(() => ({ original: { value: null, error: "RUNNER_NOT_ESTABLISHED" },
            candidate: { value: null, error: "RUNNER_NOT_ESTABLISHED" } })) }; }
          lifecycle.check(); await verifySources(); lifecycle.check();
          const rows = comparisonRows(actual, frozen);
          const result = { kind: "control", origin: "LOCAL_EXECUTION", scenarioId: run.selected.change.id, controlId: randomUUID(),
            runId: body.runId, acceptedId: run.result.acceptedId, status: comparisonStatus(rows), rows,
            sourceIdentities: { original: run.selected.change.originalSha256, candidate: controlIdentity,
              acceptedCases: sha(JSON.stringify(frozen)) },
            limits: ["The same selected cases against fixed pre-reviewed B, not a Muse-generated repair.",
              "No counterexample is not whole-PR approval, all-input correctness or a false-positive rate."] };
          await retain("control-" + result.controlId, result); lifecycle.check(); run.control = result;
          return result;
        }
        if (path === "/api/feedback") {
          requireThat(exact(body, ["runId", "controlId", "requestId"]), "INVALID_FIELDS");
          const run = runs.get(body.runId);
          requireThat(run?.result.status === "REPRODUCED" && !run.selected.feedback,
            "INITIAL_REPRODUCED_RUN_REQUIRED", 409);
          requireThat(baselines.has(run.selected.change.id), "PASSING_BASELINE_REQUIRED", 409);
          requireThat(run.control?.controlId === body.controlId && run.control.status === "NO_COUNTEREXAMPLE",
            "MATCHING_CONTROL_REQUIRED", 409);
          requireThat(feedbackProvider && feedbackAttempts, "FEEDBACK_UNAVAILABLE", 503);
          const root = run.selected.rootProposalId;
          requireThat(!feedbackAttempted.has(root), "FEEDBACK_ALREADY_ATTEMPTED", 409);
          feedbackAttempted.add(root);
          requireThat(!await feedbackAttempts.has(root), "FEEDBACK_ALREADY_ATTEMPTED", 409);
          lifecycle.check();
          const packet = feedbackContext({ run: run.result, control: run.control, selected: run.selected,
            ruleSha256: ruleIdentity, controlSha256: controlIdentity, provenance: proposals.get(root).provenance });
          // No retry even if persistence/reservation/dispatch has an uncertain outcome.
          await feedbackAttempts.claim(root, { runId: body.runId, requestId: body.requestId, bindingId: packet.bindingId });
          lifecycle.check();
          const callsUsed = await ledger.reserve(body.requestId); lifecycle.check();
          await retain("feedback-context-" + root, packet); lifecycle.check();
          await verifySources(); lifecycle.check();
          let raw;
          try { raw = await feedbackProvider(packet); }
          catch {
            lifecycle.check();
            await retain("feedback-model-" + callsUsed + "-failure", { requestId: body.requestId,
              outcome: "FAILED_OR_UNKNOWN_CONSUMED", callsUsed, bindingId: packet.bindingId });
            throw new Refusal("PROVIDER_FAILED_CONSUMED", 502);
          }
          lifecycle.check(); await verifySources(); lifecycle.check();
          await retain("feedback-model-" + callsUsed, raw); lifecycle.check();
          const parsed = feedbackFromResponse(raw, packet);
          const proposal = parsed.status === "FOLLOW_UP_PROPOSED" ? { kind: "proposal", origin: "LIVE", scenarioId: run.selected.change.id,
            proposalId: randomUUID(), model: MODEL, cases: parsed.cases, usage: modelUsage(raw), callsUsed } : null;
          const result = { kind: "feedback", origin: "LIVE", scenarioId: run.selected.change.id, feedbackId: randomUUID(), runId: body.runId,
            controlId: body.controlId, bindingId: packet.bindingId, status: parsed.status,
            explanation: parsed.explanation, proposal, usage: modelUsage(raw), callsUsed,
            limits: ["Model interpretation of bound observed outputs, not independent execution proof or approval.",
              "Follow-up cases are outcome-informed, not uncoached discovery; review expectations before execution.",
              "One feedback attempt per initial proposal; no automatic retry or recursive feedback."] };
          await retain("feedback-" + root, result); lifecycle.check();
          if (proposal) proposals.set(proposal.proposalId, { ...proposal, change: run.selected.change,
            rootProposalId: root, feedback: true });
          return result;
        }
        if (path === "/api/export") {
          requireThat(exact(body, ["runId", "requestId"]), "INVALID_FIELDS");
          const run = runs.get(body.runId);
          requireThat(run && run.result.status !== "INCONCLUSIVE", "MEANINGFUL_RUN_REQUIRED", 409);
          requireThat(baselines.has(run.selected.change.id), "PASSING_BASELINE_REQUIRED", 409);
          requireThat(!run.exported, "RUN_ALREADY_EXPORTED", 409);
          const testSource = exportRegression(run.selected.change.id, run.selected.record.acceptedCases);
          const exportId = randomUUID(), scenarioId = run.selected.change.id;
          const artifact = await persistExport(testSource, { runId: body.runId, scenarioId, exportId });
          lifecycle.check();
          const path = exportArtifactPath(scope.id, exportId);
          requireThat(artifact?.sha256 === sha(testSource) && artifact.path === path && artifact.exportId === exportId,
            "EXPORT_PERSISTENCE_FAILED", 503);
          const result = { kind: "export", origin: "LIVE", filename: "regression.test.mjs", testSource,
            exportId, runId: body.runId, scenarioId, sha256: artifact.sha256, path, command: "ota run verify:export --agent" };
          await retain("export-" + body.runId + "-" + body.requestId, result);
          lifecycle.check();
          run.exported = result;
          return result;
        }
        if (path === "/api/regression") {
          requireThat(exact(body, ["runId", "exportId", "requestId"]), "INVALID_FIELDS");
          const run = runs.get(body.runId);
          requireThat(run?.result.status === "REPRODUCED" && run.exported?.exportId === body.exportId && verification,
            "REPRODUCED_EXPORT_REQUIRED", 409);
          requireThat(baselines.has(run.selected.change.id), "PASSING_BASELINE_REQUIRED", 409);
          requireThat(!run.regressionAttempted, "REGRESSION_ALREADY_RUN", 409);
          run.regressionAttempted = true;
          const proof = await verification.regression({ testSource: run.exported.testSource,
            testSha256: run.exported.sha256, expectedTests: run.result.rows.length,
            exportId: body.exportId, runId: body.runId, scenarioId: run.selected.change.id,
            expectedFailures: run.result.rows.filter((r) => r.candidate.value !== r.expectedTotal).length });
          lifecycle.check();
          const result = { kind: "regression", origin: "LOCAL_EXECUTION", runId: body.runId,
            exportId: body.exportId, scenarioId: run.selected.change.id, ...proof,
            limits: ["Same fixed-template test and accepted expectations; only the prepared implementation correction changes.",
              "The correction was reviewed in advance, not generated by Muse.",
              "Prepared local sample only: not all-input correctness, CI, a real customer PR or production assurance."] };
          await retain("regression-" + body.runId + "-" + body.requestId, result); lifecycle.check();
          return result;
        }
        throw new Refusal("NOT_FOUND", 404);
      } finally { busy = false; }
    }); },
  };
}

const modelSchema = { type: "object", properties: { cases: { type: "array", items: {
  type: "object", properties: {
    lines: { type: "array", items: { type: "object", properties: {
      amount: { type: "integer" }, discountEligible: { type: "boolean" },
    }, required: ["amount", "discountEligible"], additionalProperties: false } },
    expectedTotal: { type: "integer" }, rationale: { type: "string" },
  }, required: ["lines", "expectedTotal", "rationale"], additionalProperties: false,
} } }, required: ["cases"], additionalProperties: false };

const feedbackSchema = { type: "object", properties: {
  bindingId: { type: "string" }, runId: { type: "string" }, explanation: { type: "string" },
  observedFaultCaseIds: { type: "array", items: { type: "string" } },
  decision: { type: "string", enum: ["STOP", "PROPOSE_CASES"] }, cases: modelSchema.properties.cases,
}, required: ["bindingId", "runId", "explanation", "observedFaultCaseIds", "decision", "cases"], additionalProperties: false };

const initialPrompt = "Propose at most three concrete cases to check this pricing change against the independently written rule. "
  + "The original is not a specification. Give an integer expected total from the rule, and a brief rationale. "
  + "Do not return code, commands, a repair, or a general safety verdict. If no useful case can be identified return cases:[].\n";
const feedbackPrompt = "This is ONE outcome-informed feedback turn, not fresh uncoached discovery. "
  + "The input contains reviewed cases and actual outputs from original, selected proposed change, and reviewed correction. "
  + "Explain the specific observed fault in at most 600 characters; do not invent observations. "
  + "Echo bindingId and runId exactly. observedFaultCaseIds must equal the set of initialRows caseIds whose "
  + "original equals expectedTotal and candidate differs, with neither error. "
  + "Return STOP with cases:[] if no useful further case is needed, or PROPOSE_CASES with 1-2 NEW data-only baskets, "
  + "integer rule-derived expectedTotal and rationale at most 600 characters each. Do not repeat any existing basket "
  + "or reorder it as a new case. No code, commands, repair, universal-correctness verdict or merge approval. "
  + "Respect retained initial provenance; do not describe retained results as fresh execution.\n";

export function museProposal(keyFile, packet, deadline, options) {
  return museStructuredRequest(keyFile, packet, deadline, initialPrompt, "pricing_cases", modelSchema, options);
}

export function museFeedback(keyFile, packet, deadline, options) {
  return museStructuredRequest(keyFile, packet, deadline, feedbackPrompt, "pricing_feedback", feedbackSchema, options);
}

async function museStructuredRequest(keyFile, packet, deadline, prompt, schemaName, schema, {
  lifecycle = createLifecycle(), readCredential = readPrivate, request = httpsRequest,
  now = Date.now,
} = {}) {
  lifecycle.check();
  const keyBuffer = await readCredential(keyFile, 514);
  try {
  lifecycle.check();
  const key = keyBuffer.toString("utf8").trim();
  requireThat(/^[A-Za-z0-9._~-]{16,512}$/.test(key), "CREDENTIAL_INVALID", 503);
  const input = prompt + JSON.stringify(packet);
  requireThat(Buffer.byteLength(input) <= 16384, "PACKET_TOO_LARGE");
  const body = JSON.stringify({ model: MODEL, input, store: false, stream: false, tools: [],
    ...(schemaName === "pricing_feedback" ? { reasoning: { effort: "low" } } : {}),
    max_output_tokens: 4096, text: { format: { type: "json_schema", name: schemaName,
      strict: true, schema } } });
    return await new Promise((accept, reject) => {
      let connectTimer, req;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        req?.destroy();
        reject(new Refusal("PROVIDER_FAILED_CONSUMED", 502));
      };
      const chunks = []; let size = 0;
      lifecycle.check();
      requireThat(now() < Date.parse(deadline), "WINDOW_ENDED", 403);
      req = request("https://api.meta.ai/v1/responses", { method: "POST", agent: false,
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body) } }, (res) => {
        res.on("error", fail);
        res.on("aborted", fail);
        res.on("close", () => { if (!res.complete) fail(); });
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 65536) req.destroy(new Refusal("PROVIDER_OUTPUT_LIMIT", 502));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          try {
            lifecycle.check();
            requireThat(res.complete, "PROVIDER_RESPONSE_INCOMPLETE", 502);
            requireThat(res.statusCode === 200, "PROVIDER_HTTP_ERROR", 502);
            const safe = Buffer.concat(chunks).toString("utf8").split(key).join("[REDACTED]");
            const parsed = JSON.parse(safe);
            settled = true; accept(parsed);
          } catch { fail(); }
        });
      });
      PROVIDER_REQUESTS.add(req);
      const totalTimer = setTimeout(() => req.destroy(new Refusal("PROVIDER_TIMEOUT", 504)),
        Math.max(1, Math.min(60000, Date.parse(deadline) - now())));
      req.on("socket", (socket) => {
        connectTimer = setTimeout(() => req.destroy(new Refusal("PROVIDER_CONNECT_TIMEOUT", 504)), 10000);
        socket.once("secureConnect", () => clearTimeout(connectTimer));
      });
      req.on("close", () => { clearTimeout(totalTimer); clearTimeout(connectTimer); PROVIDER_REQUESTS.delete(req); });
      req.on("error", fail);
      req.end(body);
    });
  } finally { keyBuffer.fill(0); }
}

async function captureChild({ executable, args, cwd, input = "", environment, lifecycle }) {
  lifecycle.check();
  return new Promise((accept) => {
    const child = spawn(executable, args, {
      cwd, env: environment, stdio: ["pipe", "pipe", "pipe"], detached: true,
    });
    CHILDREN.add(child);
    const output = [], errors = []; let size = 0, refused = false, hardTimer;
    const stop = () => {
      if (refused) return;
      refused = true;
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
        hardTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
          }
        }, 1000);
      }
    };
    const timer = setTimeout(stop, 5000);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 65536) stop(); else output.push(chunk); });
    child.stderr.on("data", (chunk) => { size += chunk.length; if (size > 65536) stop(); else errors.push(chunk); });
    child.stdin.on("error", () => {});
    child.on("error", () => { refused = true; });
    child.on("close", (code) => {
      clearTimeout(timer); clearTimeout(hardTimer); CHILDREN.delete(child);
      accept({ exitCode: refused ? null : code, stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8") });
    });
    child.stdin.end(input);
  });
}

export async function fixedRunner(node, changeId, cases, lifecycle) {
  const input = JSON.stringify({ changeId, cases });
  requireThat(Buffer.byteLength(input) <= 8192, "RUNNER_INPUT_LIMIT");
  const result = await captureChild({ executable: node,
    args: ["--max-old-space-size=128", join(ROOT, "tools/pricing-runner.mjs")],
    cwd: ROOT, input, environment: buildRunnerEnvironment(node), lifecycle });
  requireThat(result.exitCode === 0, "RUNNER_FAILED", 502);
  try { return JSON.parse(result.stdout); }
  catch { throw new Refusal("RUNNER_OUTPUT_INVALID", 502); }
}

export function parseTaskExecution(result) {
  const names = { tests: "tests", passed: "pass", failed: "fail", skipped: "skipped", cancelled: "cancelled" };
  const counts = {};
  for (const [key, label] of Object.entries(names)) {
    const matches = [...result.stdout.matchAll(new RegExp("^# " + label + " (\\d+)$", "gm"))];
    if (matches.length !== 1) return { ...result, counts: null };
    counts[key] = Number(matches[0][1]);
  }
  const plans = [...result.stdout.matchAll(/^1\.\.(\d+)$/gm)];
  const passed = [...result.stdout.matchAll(/^ok \d+ - /gm)].length;
  const failed = [...result.stdout.matchAll(/^not ok \d+ - /gm)].length;
  if (plans.length !== 1 || Number(plans[0][1]) !== counts.tests
    || passed !== counts.passed || failed !== counts.failed
    || counts.passed + counts.failed + counts.skipped + counts.cancelled !== counts.tests) {
    return { ...result, counts: null };
  }
  return { ...result, counts };
}

function completeCounts(execution, tests) {
  const c = execution.counts;
  return c && c.tests === tests && c.skipped === 0 && c.cancelled === 0
    && c.passed + c.failed === tests;
}

function passing(execution, tests) {
  return execution.exitCode === 0 && completeCounts(execution, tests)
    && execution.counts.passed === tests && execution.counts.failed === 0;
}

function assertionFailure(execution, tests, failures) {
  return execution.exitCode === 1 && completeCounts(execution, tests)
    && execution.counts.failed === failures
    && [...execution.stdout.matchAll(/code: ['"]ERR_ASSERTION['"]/g)].length === failures;
}

export async function runDeclaredVerification({ task, cwd, nodeExecutable, otaExecutable, lifecycle }) {
  requireThat(["verify:baseline", "verify:baseline:c", "verify:export"].includes(task), "VERIFICATION_TASK_REFUSED");
  const dirs = { HOME: ".verification-home", TMPDIR: ".verification-tmp",
    XDG_CONFIG_HOME: ".verification-config", XDG_CACHE_HOME: ".verification-cache" };
  const environment = { ...buildRunnerEnvironment(nodeExecutable), CI: "true" };
  for (const [key, name] of Object.entries(dirs)) {
    lifecycle.check();
    environment[key] = join(cwd, name);
    await mkdir(environment[key], { mode: 0o700 });
  }
  lifecycle.check();
  return parseTaskExecution(await captureChild({ executable: otaExecutable,
    args: ["run", task, "--agent", "--stream"], cwd, environment, lifecycle }));
}

export function createPricingVerification({ root, runDirectory, scopeId, sourceHashes, execute, lifecycle, verifySources }) {
  async function checkCopy(copy, correctedScenario = null) {
    for (const file of RUNTIME_FILES) {
      const expected = correctedScenario && file === `pricing/change-${correctedScenario}.ts`
        ? sourceHashes["pricing/change-b.ts"] : sourceHashes[file];
      requireThat(sha(await readPrivate(join(copy, file), 131072)) === expected, "COPY_SOURCE_CHANGED", 503);
    }
  }
  async function makeCopy(parent, name, correctedScenario = null) {
    const copy = join(parent, name); await mkdir(copy, { mode: 0o700 });
    for (const file of RUNTIME_FILES) {
      lifecycle.check();
      const bytes = await readFile(join(root, file));
      requireThat(sha(bytes) === sourceHashes[file], "SOURCE_IDENTITY_CHANGED", 503);
      await mkdir(dirname(join(copy, file)), { recursive: true, mode: 0o700 });
      await exclusiveBytes(join(copy, file), bytes);
    }
    if (correctedScenario) {
      requireThat(SCENARIO_IDS.includes(correctedScenario), "CHANGE_NOT_FOUND", 404);
      const target = join(copy, `pricing/change-${correctedScenario}.ts`);
      requireThat(sha(await readPrivate(target)) === sourceHashes[`pricing/change-${correctedScenario}.ts`], "COPY_SOURCE_CHANGED", 503);
      const correction = await readFile(join(root, "pricing/change-b.ts"));
      requireThat(sha(correction) === sourceHashes["pricing/change-b.ts"], "SOURCE_IDENTITY_CHANGED", 503);
      await unlink(target); await exclusiveBytes(target, correction);
    }
    await checkCopy(copy, correctedScenario); return copy;
  }
  async function owned(operation) {
    lifecycle.check(); await verifySources(); lifecycle.check();
    await privateDirectory(runDirectory);
    const parent = await mkdtemp(join(runDirectory, "verification-"));
    const identity = await lstat(parent);
    let result;
    try { result = await operation(parent); }
    finally {
      const current = await lstat(parent);
      requireThat(current.isDirectory() && !current.isSymbolicLink()
        && current.dev === identity.dev && current.ino === identity.ino, "OWNED_COPY_CHANGED", 503);
      await rm(parent, { recursive: true });
      try { await lstat(parent); throw new Refusal("COPY_CLEANUP_INCOMPLETE", 503); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    return { ...result, cleanup: { ownedCopiesRemoved: true } };
  }
  return {
    async baseline(scenarioId = "a") {
      requireThat(SCENARIO_IDS.includes(scenarioId), "CHANGE_NOT_FOUND", 404);
      return owned(async (parent) => {
        const copy = await makeCopy(parent, "baseline"); lifecycle.check();
        const execution = await execute(scenarioId === "a" ? "verify:baseline" : "verify:baseline:c", copy); lifecycle.check();
        await checkCopy(copy);
        const status = passing(execution, 6) ? "PASS"
          : execution.counts && execution.counts.failed > 0
            && assertionFailure(execution, 6, execution.counts.failed) ? "FAIL" : "INCONCLUSIVE";
        return { execution, status };
      });
    },
    async regression({ testSource, testSha256, expectedTests, expectedFailures, exportId, runId, scenarioId }) {
      requireThat(integer(expectedTests, 1, 3) && integer(expectedFailures, 1, expectedTests)
        && sha(testSource) === testSha256, "REGRESSION_INPUT_REFUSED");
      requireThat(SCENARIO_IDS.includes(scenarioId), "EXPORT_BINDING_CHANGED", 503);
      const binding = { runDirectory, scopeId, runId, scenarioId, exportId, testSha256 };
      requireThat((await readStoredExport(binding)).toString("utf8") === testSource, "PERSISTED_TEST_CHANGED", 503);
      return owned(async (parent) => {
        const faulty = await makeCopy(parent, "faulty");
        const corrected = await makeCopy(parent, "corrected", scenarioId);
        for (const copy of [faulty, corrected]) {
          await mkdir(join(copy, "evidence"), { mode: 0o700 });
          await exclusiveBytes(join(copy, "evidence/regression.test.mjs"), testSource);
        }
        lifecycle.check(); const red = await execute("verify:export", faulty); lifecycle.check();
        await checkCopy(faulty);
        let green = null;
        const beforeGreen = (await Promise.all([faulty, corrected].map(async (copy) =>
          sha(await readPrivate(join(copy, "evidence/regression.test.mjs"))) === testSha256))).every(Boolean);
        if (beforeGreen && assertionFailure(red, expectedTests, expectedFailures)) {
          lifecycle.check(); green = await execute("verify:export", corrected); lifecycle.check();
        }
        await checkCopy(corrected, scenarioId);
        const sameTest = beforeGreen && (await Promise.all([faulty, corrected].map(async (copy) =>
          sha(await readPrivate(join(copy, "evidence/regression.test.mjs"))) === testSha256))).every(Boolean);
        await readStoredExport(binding);
        return { red, green, sameTest, testSha256,
          status: sameTest && green && passing(green, expectedTests) ? "RED_THEN_GREEN" : "INCONCLUSIVE",
          correction: { kind: "PRE_REVIEWED_FIXED", label: "Prepared correction reviewed in advance; not Muse-generated.",
            faultySha256: sourceHashes[`pricing/change-${scenarioId}.ts`], correctedSha256: sourceHashes["pricing/change-b.ts"] } };
      });
    },
  };
}

async function digestFile(path, executable = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    requireThat(before.isFile() && before.size <= (executable ? 268435456 : 131072)
      && (!executable || (before.mode & 0o111) !== 0 && (before.mode & 0o022) === 0),
    "PINNED_FILE_INVALID", 503);
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536);
    let total = 0;
    while (total <= before.size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - total + 1), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      requireThat(total <= before.size, "PINNED_FILE_CHANGED", 503);
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    requireThat(total === before.size && before.dev === after.dev && before.ino === after.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    "PINNED_FILE_CHANGED", 503);
    return hash.digest("hex");
  } finally { await file.close(); }
}

async function noLinkedParents(path, excludedDirectory) {
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const s = await lstat(parent);
    requireThat(s.isDirectory() && !s.isSymbolicLink(), "LINKED_SESSION_PATH", 503);
    requireThat(!excludedDirectory || s.dev !== excludedDirectory.dev || s.ino !== excludedDirectory.ino,
      "KEY_MUST_BE_OUTSIDE_REPOSITORY", 503);
    if (parent === dirname(parent)) return;
  }
}

function sessionLocation(root, file) {
  requireThat(typeof file === "string" && isAbsolute(file), "APPROVAL_FILE_REQUIRED", 503);
  const id = basename(dirname(file));
  requireThat(validId(id) && file === join(root, "evidence/live", id, "approval.json"), "SESSION_PATH_INVALID", 503);
  return { id, runDirectory: dirname(file) };
}

async function checkKeyMetadata(root, path) {
  requireThat(typeof path === "string" && isAbsolute(path) && resolve(path) === path
    && path !== root && !path.startsWith(root + "/"), "KEY_MUST_BE_OUTSIDE_REPOSITORY", 503);
  try {
    await noLinkedParents(path, await lstat(root));
    const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const s = await f.stat();
      requireThat(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === 0o600
        && s.nlink === 1 && s.size >= 16 && s.size <= 514, "PRIVATE_KEY_FILE_REQUIRED", 503);
      // Preparation/startup validate metadata only. Only an explicit provider action reads the key bytes.
    } finally { await f.close(); }
  } catch (e) { if (e.code === "ENOENT") throw new Refusal("KEY_FILE_NOT_FOUND", 503); throw e; }
}

export async function verifyFiles(a, root = ROOT) {
  for (const file of RUNTIME_FILES) {
    requireThat(await digestFile(join(root, file)) === a.sourceHashes[file], "SOURCE_IDENTITY_CHANGED", 503);
  }
  requireThat(await digestFile(a.nodeExecutable, true) === a.nodeSha256, "NODE_IDENTITY_CHANGED", 503);
  requireThat(await digestFile(a.otaExecutable, true) === a.otaSha256, "OTA_IDENTITY_CHANGED", 503);
}

export async function prepareSession({ root = ROOT, environment = process.env, now = Date.now,
  nodeExecutable = process.execPath } = {}) {
  root = await realpath(root);
  const file = environment.META_DEMO_APPROVAL_FILE;
  const { id, runDirectory } = sessionLocation(root, file);
  const number = (name, max, code) => {
    const raw = environment[name];
    requireThat(typeof raw === "string" && /^[1-9][0-9]*$/.test(raw)
      && integer(Number(raw), 1, max), code, 400);
    return Number(raw);
  };
  const minutes = number("META_DEMO_SESSION_MINUTES", MAX_SESSION_MINUTES, "SESSION_MINUTES_INVALID");
  const requestLimit = number("META_DEMO_REQUEST_LIMIT", MAX_SESSION_REQUESTS, "REQUEST_LIMIT_INVALID");
  const keyFile = environment.META_DEMO_KEY_FILE;
  await checkKeyMetadata(root, keyFile);
  requireThat(typeof environment.META_DEMO_OTA_EXECUTABLE === "string"
    && isAbsolute(environment.META_DEMO_OTA_EXECUTABLE), "OTA_EXECUTABLE_REQUIRED", 503);
  nodeExecutable = await realpath(nodeExecutable);
  const otaExecutable = await realpath(environment.META_DEMO_OTA_EXECUTABLE);
  const sourceHashes = {};
  for (const path of RUNTIME_FILES) sourceHashes[path] = await digestFile(join(root, path));
  const nodeSha256 = await digestFile(nodeExecutable, true), otaSha256 = await digestFile(otaExecutable, true);
  const issuedAt = new Date(now()).toISOString(), deadline = new Date(Date.parse(issuedAt) + minutes * 60000).toISOString();
  const scope = { id, issuedAt, deadline, limit: requestLimit };
  validateSessionWindow(scope, now());
  const a = { version: 2, id, issuedAt, deadline, requestLimit, keyFile,
    nodeExecutable, nodeSha256, otaExecutable, otaSha256, sourceHashes };
  for (const parent of [join(root, "evidence"), join(root, "evidence/live")]) {
    try { await mkdir(parent, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    await privateDirectory(parent);
  }
  await noLinkedParents(runDirectory);
  try { await mkdir(runDirectory, { mode: 0o700 }); }
  catch (e) { if (e.code === "EEXIST") throw new Refusal("SESSION_ALREADY_EXISTS", 409); throw e; }
  await syncDirectory(dirname(runDirectory));
  // The approval is published last. An interrupted preparation remains an unadoptable partial scope.
  await initializeBudget(join(runDirectory, "budget.json"), scope);
  await exclusiveJSON(file, a);
  return { approvalFile: file, id, issuedAt, deadline, requestLimit };
}

export async function loadOwnerSession({ root = ROOT, approvalFile = process.env.META_DEMO_APPROVAL_FILE,
  now = Date.now } = {}) {
  root = await realpath(root);
  const location = sessionLocation(root, approvalFile);
  let a;
  try {
    await noLinkedParents(approvalFile); await privateDirectory(location.runDirectory);
    a = JSON.parse((await readPrivate(approvalFile)).toString("utf8"));
  }
  catch (e) {
    if (e.code === "ENOENT") throw new Refusal("SESSION_NOT_PREPARED", 503);
    if (e instanceof SyntaxError) throw new Refusal("APPROVAL_INVALID", 503);
    throw e;
  }
  requireThat(a?.version !== 1, "LEGACY_SESSION_READ_ONLY", 503);
  requireThat(exact(a, ["version", "id", "issuedAt", "deadline", "requestLimit", "keyFile", "nodeExecutable",
    "nodeSha256", "otaExecutable", "otaSha256", "sourceHashes"])
    && a.version === 2 && a.id === location.id && isAbsolute(a.nodeExecutable ?? "")
    && isAbsolute(a.otaExecutable ?? "") && HASH.test(a.nodeSha256) && HASH.test(a.otaSha256)
    && exact(a.sourceHashes, RUNTIME_FILES) && Object.values(a.sourceHashes).every((x) => HASH.test(x)),
  "APPROVAL_INVALID", 503);
  const scope = { id: a.id, issuedAt: a.issuedAt, deadline: a.deadline, limit: a.requestLimit };
  validateSessionWindow(scope, now());
  await verifyFiles(a, root); await checkKeyMetadata(root, a.keyFile);
  const ledger = new BudgetLedger(join(location.runDirectory, "budget.json"), scope, { now });
  let budget;
  try { budget = await ledger.ready(); }
  catch (e) { if (e.code === "ENOENT") throw new Refusal("SESSION_INCOMPLETE", 503); throw e; }
  requireThat(budget.reservations.length < budget.limit, "REQUEST_BUDGET_EXHAUSTED", 403);
  validateSessionWindow(scope, now());
  return { approval: a, scope, ledger, runDirectory: location.runDirectory };
}

export function startupHint(code) {
  const hints = {
    APPROVAL_FILE_REQUIRED: "Set META_DEMO_APPROVAL_FILE to the new recording approval.json path shown in README.md.",
    SESSION_PATH_INVALID: "Use <checkout>/evidence/live/<new-session-name>/approval.json.",
    SESSION_MINUTES_INVALID: "Set META_DEMO_SESSION_MINUTES to an integer from 1 to 60.",
    REQUEST_LIMIT_INVALID: "Set META_DEMO_REQUEST_LIMIT to an integer from 1 to 6 for this session.",
    KEY_FILE_NOT_FOUND: "Create your private key file outside this checkout; set META_DEMO_KEY_FILE during preparation.",
    PRIVATE_KEY_FILE_REQUIRED: "The key file must be a single owner-owned regular file with mode 0600, outside the checkout.",
    KEY_MUST_BE_OUTSIDE_REPOSITORY: "Set META_DEMO_KEY_FILE to an absolute private key path outside the checkout.",
    OTA_EXECUTABLE_REQUIRED: "Set META_DEMO_OTA_EXECUTABLE to your qualified released Ota executable's absolute path.",
    SESSION_ALREADY_EXISTS: "This scope already exists. Never reset it; explicitly prepare a different new session path.",
    SESSION_NOT_PREPARED: "Run ota run demo:live:budget --agent with the setup inputs in README.md before starting.",
    SESSION_INCOMPLETE: "Preparation is incomplete; no automatic repair or budget reset. Review the retained partial scope.",
    LEGACY_SESSION_READ_ONLY: "Historical V1 approvals/budgets cannot be renewed or imported. Prepare an explicit new V2 session.",
    SESSION_WINDOW_EXPIRED_OR_FUTURE: "This session is outside its recorded window. It cannot be extended in place.",
    REQUEST_BUDGET_EXHAUSTED: "This session has no requests left. It cannot be topped up or silently replaced.",
  };
  return hints[code] ?? "Review the configuration and retained state; no automatic retry or reset. See README.md.";
}

async function start() {
  if (process.argv.length === 3 && process.argv[2] === "--initialize-budget") {
    const session = await prepareSession();
    console.log(JSON.stringify({ status: "SESSION_PREPARED_NO_SERVICE_NO_PROVIDER", ...session })); return;
  }
  requireThat(process.argv.length === 2, "ARGUMENTS_REFUSED");
  const { approval: a, scope, ledger, runDirectory } = await loadOwnerSession();
  const lifecycle = createLifecycle({ deadline: Date.parse(a.deadline) });
  const rule = JSON.parse(await readFile(join(ROOT, "pricing/rule.json"), "utf8"));
  requireThat(exact(rule, ["id", "title", "text", "domain"]) && rule.id === "pricing-v1", "RULE_INVALID", 503);
  const originalSource = await readFile(join(ROOT, "pricing/original.ts"), "utf8");
  const baselineCoverage = JSON.parse(await readFile(join(ROOT, "pricing/baseline.json"), "utf8"));
  requireThat(exact(baselineCoverage, ["label", "cases"]) && bounded(baselineCoverage.label)
    && Array.isArray(baselineCoverage.cases) && baselineCoverage.cases.length === 3
    && baselineCoverage.cases.every((c) => exact(c, ["id", "title", "lines", "expectedTotal"])
      && bounded(c.id, 40) && bounded(c.title, 120) && isCart(c.lines)
      && c.expectedTotal === ruleTotal(c.lines)), "BASELINE_INVALID", 503);
  const changes = [];
  for (const id of SCENARIO_IDS) {
    const candidateSource = await readFile(join(ROOT, "pricing/change-" + id + ".ts"), "utf8");
    changes.push({ id, title: id === "a" ? "Simplify checkout pricing (A)" : "Consolidate checkout totals (C)",
      rule, originalSource, candidateSource,
      originalSha256: sha(originalSource), candidateSha256: sha(candidateSource),
      diff: "ORIGINAL\n" + originalSource + "\nPROPOSED\n" + candidateSource });
  }
  const verification = createPricingVerification({ root: ROOT, runDirectory, scopeId: a.id, sourceHashes: a.sourceHashes,
    lifecycle, verifySources: () => verifyFiles(a),
    execute: (task, cwd) => runDeclaredVerification({ task, cwd, nodeExecutable: a.nodeExecutable,
      otaExecutable: a.otaExecutable, lifecycle }) });
  const sources = { rule: a.sourceHashes["pricing/rule.json"], control: a.sourceHashes["pricing/change-b.ts"] };
  const controller = createController({ changes, scope, ledger, lifecycle, baselineCoverage,
    ruleIdentity: sources.rule, controlIdentity: sources.control, feedbackAttempts: createFeedbackAttempts(runDirectory),
    baselineIdentity: a.sourceHashes["pricing/baseline.json"], verification,
    verifySources: () => verifyFiles(a),
    provider: (packet) => museProposal(a.keyFile, packet, a.deadline, { lifecycle }),
    feedbackProvider: (packet) => museFeedback(a.keyFile, packet, a.deadline, { lifecycle }),
    runner: (id, cases) => fixedRunner(a.nodeExecutable, id, cases, lifecycle),
    persistExport: (source, binding) => persistRegression({ root: ROOT, runDirectory, scopeId: a.id, source, ...binding }),
    retain: (name, data) => exclusiveJSON(join(runDirectory, name + ".json"), data) });
  const security = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { ...security, "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    try {
      checkRequest(req.method, req.url, req.headers, controller.nonce);
      requireThat(Date.now() < Date.parse(a.deadline), "WINDOW_ENDED", 403);
      if (req.method === "GET") {
        if (req.url === "/health") { json(200, { status: "ready" }); return; }
        if (req.url === "/api/session") { json(200, await controller.session()); return; }
        const routes = { "/": ["web/index.html", "text/html; charset=utf-8"],
          "/app.js": ["web/app.js", "text/javascript; charset=utf-8"], "/styles.css": ["web/styles.css", "text/css; charset=utf-8"] };
        const [path, type] = routes[req.url];
        res.writeHead(200, { ...security, "Content-Type": type }); res.end(await readFile(join(ROOT, path))); return;
      }
      const chunks = []; let size = 0;
      for await (const part of req) { size += part.length; requireThat(size <= 16384, "BODY_TOO_LARGE", 413); chunks.push(part); }
      const result = await controller.action(req.url, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      json(200, result);
    } catch (error) {
      if (!res.headersSent) json(error instanceof Refusal ? error.status : 503,
        { error: { code: error instanceof Refusal ? error.code : "INCONCLUSIVE", message: "Operation refused or incomplete; no automatic retry." } });
      else res.destroy();
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000; server.maxConnections = 8;
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    lifecycle.beginStop();
    const providerClosed = closeProviderRequests();
    const children = [...CHILDREN];
    const waits = children.map((child) => new Promise((done) => child.once("close", done)));
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
      }
    }
    const force = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
        }
      }
    }, 1000);
    const closed = new Promise((done) => server.close(done));
    server.closeAllConnections();
    await Promise.all([closed, lifecycle.drain(), providerClosed, ...waits]); clearTimeout(force);
    console.log(JSON.stringify({ cleanup: "OWNED_RUNTIME_STOPPED", listenerClosed: true,
      ownedChildrenRemaining: CHILDREN.size, ownedProviderRequestsRemaining: PROVIDER_REQUESTS.size }));
    process.exitCode = CHILDREN.size === 0 ? 0 : 1;
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const stopTimer = setTimeout(stop, Math.max(1, Date.parse(a.deadline) - Date.now()));
  server.once("close", () => clearTimeout(stopTimer));
  server.once("error", () => { clearTimeout(stopTimer); console.error("LISTENER_REFUSED"); process.exitCode = 1; });
  server.listen(48761, "127.0.0.1", () => console.log("LIVE_PRICING_READY " + ORIGIN));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch((error) => {
    const code = error instanceof Refusal ? error.code : "STARTUP_REFUSED";
    console.error(code + ": " + startupHint(code)); process.exitCode = 1;
  });
}
