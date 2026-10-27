import { constants } from "node:fs";
import { open, readFile, rename, unlink, lstat, link } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCart } from "./pricing-runner.mjs";

export const ORIGIN = "http://127.0.0.1:48761";
export const STOP_AT = "2026-10-27T03:50:52.000Z";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9-]{8,80}$/;
const MODEL = "muse-spark-1.3";
export const RUNTIME_FILES = ["pricing/rule.json", "pricing/original.ts", "pricing/change-a.ts",
  "pricing/change-b.ts", "tools/live-demo.mjs", "tools/pricing-runner.mjs",
  "web/index.html", "web/app.js", "web/styles.css"];
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

async function readPrivate(path, max = 32768) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    requireThat(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === 0o600
      && s.nlink === 1 && s.size <= max, "PRIVATE_FILE_REQUIRED", 503);
    const data = await f.readFile();
    requireThat(data.length <= max, "PRIVATE_FILE_TOO_LARGE", 503);
    return data;
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

export async function persistRegression({ artifact, record, scopeId, source, beforeCommit }) {
  requireThat(typeof source === "string" && Buffer.byteLength(source) <= 16384,
    "EXPORT_LIMIT");
  await privateDirectory(dirname(artifact)); await privateDirectory(dirname(record));
  let previous;
  try { previous = JSON.parse((await readPrivate(record)).toString("utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  if (previous) {
    requireThat(exact(previous, ["scopeId", "sha256"]) && previous.scopeId === scopeId
      && HASH.test(previous.sha256) && sha(await readPrivate(artifact)) === previous.sha256,
    "EXPORT_PREIMAGE_CHANGED", 409);
  } else {
    try { await lstat(artifact); throw new Refusal("EXISTING_EXPORT_NOT_OWNED", 409); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  const digest = sha(source);
  const pending = artifact + ".pending-" + randomUUID();
  const pendingRecord = record + ".pending-" + randomUUID();
  await exclusiveBytes(pending, source);
  await exclusiveJSON(pendingRecord, { scopeId, sha256: digest });
  if (beforeCommit) await beforeCommit();
  if (previous) {
    requireThat(sha(await readPrivate(artifact)) === previous.sha256, "EXPORT_PREIMAGE_CHANGED", 409);
    await rename(pending, artifact);
  } else {
    await link(pending, artifact); await unlink(pending);
  }
  await syncDirectory(dirname(artifact));
  if (previous) await rename(pendingRecord, record);
  else { await link(pendingRecord, record); await unlink(pendingRecord); }
  await syncDirectory(dirname(record));
  requireThat(sha(await readPrivate(artifact)) === digest, "EXPORT_PERSISTENCE_FAILED", 503);
  return { sha256: digest, path: "evidence/regression.test.mjs" };
}

// Setup is deliberately separate: normal startup never creates or resets a budget.
export async function initializeBudget(path, scope) {
  await privateDirectory(dirname(path));
  requireThat(ID.test(scope.id) && scope.limit === 6 && Number.isFinite(Date.parse(scope.deadline))
    && Date.parse(scope.deadline) <= Date.parse(STOP_AT), "INVALID_SCOPE");
  await exclusiveJSON(path, { version: 1, scopeId: scope.id, deadline: scope.deadline,
    limit: 6, reservations: [] });
}

export class BudgetLedger {
  constructor(path, scope, options = {}) {
    this.path = path; this.scope = scope; this.now = options.now ?? Date.now;
    this.beforeRename = options.beforeRename; this.poisoned = false;
  }
  async read() {
    await privateDirectory(dirname(this.path));
    const data = JSON.parse((await readPrivate(this.path)).toString("utf8"));
    requireThat(exact(data, ["version", "scopeId", "deadline", "limit", "reservations"])
      && data.version === 1 && data.scopeId === this.scope.id && data.deadline === this.scope.deadline
      && data.limit === 6 && Array.isArray(data.reservations) && data.reservations.length <= 6
      && data.reservations.every((r) => exact(r, ["requestId", "reservedAt"])
        && ID.test(r.requestId) && Number.isFinite(Date.parse(r.reservedAt)))
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
  requireThat(method === "POST" && ["/api/propose", "/api/accept", "/api/compare", "/api/export"].includes(path), "NOT_FOUND", 404);
  requireThat(headers.origin === ORIGIN && headers["x-demo-token"] === nonce,
    "ORIGIN_OR_NONCE_REFUSED", 403);
  requireThat(headers["content-type"] === "application/json", "JSON_REQUIRED", 415);
}

export function exportRegression(changeId, cases) {
  requireThat(["a", "b"].includes(changeId) && cases.length > 0 && cases.length <= 3
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

function casesFromResponse(response) {
  requireThat(response?.status === "completed" && response.error == null && response.model === MODEL,
    "MODEL_INCOMPLETE", 502);
  const parts = response.output?.filter((x) => x.type === "message")
    .flatMap((x) => x.content ?? []).filter((x) => x.type === "output_text");
  requireThat(parts?.length === 1 && bounded(parts[0].text, 16000), "MODEL_OUTPUT_INVALID", 502);
  const value = JSON.parse(parts[0].text);
  requireThat(exact(value, ["cases"]) && Array.isArray(value.cases)
    && value.cases.length <= 3, "MODEL_CASES_INVALID", 502);
  requireThat(value.cases.length > 0, "NO_CASES_PROPOSED", 422);
  return value.cases.map((c, i) => {
    requireThat(exact(c, ["lines", "expectedTotal", "rationale"]) && isCart(c.lines)
      && integer(c.expectedTotal) && bounded(c.rationale), "MODEL_CASES_INVALID", 502);
    return { id: "case-" + (i + 1), lines: c.lines, expectedTotal: c.expectedTotal, rationale: c.rationale };
  });
}

export function createController({ changes, scope, ledger, provider, runner, verifySources,
  retain, persistExport, lifecycle = createLifecycle(), now = Date.now,
  nonce = randomBytes(32).toString("hex") }) {
  const proposals = new Map(), accepted = new Map(), runs = new Map(), seen = new Set();
  const acceptedProposals = new Set();
  let busy = false;
  return {
    nonce,
    async session() {
      lifecycle.check();
      requireThat(now() < Date.parse(scope.deadline), "WINDOW_ENDED", 403);
      const budget = await ledger.ready();
      lifecycle.check();
      return { mode: "LIVE", csrfToken: nonce, callsUsed: budget.reservations.length, limit: 6,
        deadline: scope.deadline, changes: changes.map(({ originalSource, candidateSource, ...publicChange }) => publicChange) };
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
        if (path === "/api/propose") {
          requireThat(exact(body, ["changeId", "requestId"]), "INVALID_FIELDS");
          const change = changes.find((c) => c.id === body.changeId);
          requireThat(change, "CHANGE_NOT_FOUND", 404);
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
          const result = { kind: "proposal", origin: "LIVE", proposalId, model: MODEL, cases,
            usage: { inputTokens: raw.usage?.input_tokens ?? null, outputTokens: raw.usage?.output_tokens ?? null }, callsUsed };
          proposals.set(proposalId, { ...result, change });
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
          const record = { kind: "accepted", origin: "LIVE", acceptedId, proposalId: proposal.proposalId, acceptedCases };
          await retain("accepted-" + acceptedId, { ...record,
            reviewEvidence: "operator declaration, not independently attested human identity" });
          lifecycle.check();
          acceptedProposals.add(proposal.proposalId);
          accepted.set(acceptedId, { record, change: proposal.change });
          return record;
        }
        if (path === "/api/compare") {
          requireThat(exact(body, ["acceptedId", "requestId"]), "INVALID_FIELDS");
          const selected = accepted.get(body.acceptedId);
          requireThat(selected, "ACCEPTED_CASES_REQUIRED", 409);
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
          requireThat(exact(actual, ["rows"]) && Array.isArray(actual.rows)
            && actual.rows.length === frozen.length, "RUNNER_OUTPUT_INVALID", 502);
          const rows = actual.rows.map((r, i) => {
            requireThat(exact(r, ["original", "candidate"])
              && [r.original, r.candidate].every((x) => exact(x, ["value", "error"])
                && ((integer(x.value) && x.error === null) || (x.value === null && bounded(x.error, 100)))),
            "RUNNER_OUTPUT_INVALID", 502);
            return { caseId: frozen[i].caseId, expectedTotal: frozen[i].expectedTotal, ...r };
          });
          const incomplete = rows.some((r) => r.original.error || r.candidate.error
            || r.original.value !== r.expectedTotal);
          const status = incomplete ? "INCONCLUSIVE"
            : rows.some((r) => r.candidate.value !== r.expectedTotal) ? "REPRODUCED" : "NO_COUNTEREXAMPLE";
          const runId = randomUUID();
          const result = { kind: "comparison", origin: "LIVE", runId, acceptedId: body.acceptedId, status, rows,
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
        if (path === "/api/export") {
          requireThat(exact(body, ["runId", "requestId"]), "INVALID_FIELDS");
          const run = runs.get(body.runId);
          requireThat(run && run.result.status !== "INCONCLUSIVE", "MEANINGFUL_RUN_REQUIRED", 409);
          const testSource = exportRegression(run.selected.change.id, run.selected.record.acceptedCases);
          const artifact = await persistExport(testSource);
          lifecycle.check();
          requireThat(artifact?.sha256 === sha(testSource), "EXPORT_PERSISTENCE_FAILED", 503);
          const result = { kind: "export", origin: "LIVE", filename: "regression.test.mjs", testSource,
            sha256: artifact.sha256, path: "evidence/regression.test.mjs", command: "ota run verify:export --agent" };
          await retain("export-" + body.runId, result);
          lifecycle.check();
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

export async function museProposal(keyFile, packet, deadline, {
  lifecycle = createLifecycle(), readCredential = readPrivate, request = httpsRequest,
  now = Date.now,
} = {}) {
  lifecycle.check();
  const keyBuffer = await readCredential(keyFile, 514);
  try {
  lifecycle.check();
  const key = keyBuffer.toString("utf8").trim();
  requireThat(/^[A-Za-z0-9._~-]{16,512}$/.test(key), "CREDENTIAL_INVALID", 503);
  const input = "Propose at most three concrete cases to check this pricing change against the independently written rule. "
    + "The original is not a specification. Give an integer expected total from the rule, and a brief rationale. "
    + "Do not return code, commands, a repair, or a general safety verdict. If no useful case can be identified return cases:[].\n"
    + JSON.stringify(packet);
  requireThat(Buffer.byteLength(input) <= 16384, "PACKET_TOO_LARGE");
  const body = JSON.stringify({ model: MODEL, input, store: false, stream: false, tools: [],
    max_output_tokens: 4096, text: { format: { type: "json_schema", name: "pricing_cases",
      strict: true, schema: modelSchema } } });
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

async function fixedRunner(node, changeId, cases, lifecycle) {
  lifecycle.check();
  const input = JSON.stringify({ changeId, cases });
  requireThat(Buffer.byteLength(input) <= 8192, "RUNNER_INPUT_LIMIT");
  return new Promise((accept, reject) => {
    const child = spawn(node, ["--max-old-space-size=128", join(ROOT, "tools/pricing-runner.mjs")], {
      cwd: ROOT, env: buildRunnerEnvironment(node), stdio: ["pipe", "pipe", "pipe"], detached: true,
    });
    CHILDREN.add(child);
    const output = []; let size = 0, refused = false, hardTimer;
    const stop = () => {
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
    child.stderr.on("data", (chunk) => { size += chunk.length; if (size > 65536) stop(); });
    child.stdin.on("error", () => {});
    child.on("error", () => { refused = true; });
    child.on("close", (code) => {
      clearTimeout(timer); clearTimeout(hardTimer); CHILDREN.delete(child);
      if (refused || code !== 0) { reject(new Refusal("RUNNER_FAILED", 502)); return; }
      try { accept(JSON.parse(Buffer.concat(output).toString("utf8"))); }
      catch { reject(new Refusal("RUNNER_OUTPUT_INVALID", 502)); }
    });
    child.stdin.end(input);
  });
}

async function approval() {
  const file = process.env.META_DEMO_APPROVAL_FILE;
  requireThat(isAbsolute(file ?? ""), "APPROVAL_FILE_REQUIRED", 503);
  const a = JSON.parse((await readPrivate(file)).toString("utf8"));
  requireThat(exact(a, ["version", "id", "deadline", "maxAdditionalRequests", "keyFile", "nodeExecutable", "nodeSha256", "sourceHashes"])
    && a.version === 1 && ID.test(a.id) && a.maxAdditionalRequests === 6
    && Number.isFinite(Date.parse(a.deadline)) && Date.parse(a.deadline) <= Date.parse(STOP_AT)
    && Date.now() < Date.parse(a.deadline) && isAbsolute(a.keyFile) && isAbsolute(a.nodeExecutable)
    && HASH.test(a.nodeSha256) && exact(a.sourceHashes, RUNTIME_FILES)
    && Object.values(a.sourceHashes).every((x) => HASH.test(x)), "APPROVAL_INVALID", 503);
  return a;
}

async function verifyFiles(a) {
  for (const file of RUNTIME_FILES) {
    const path = join(ROOT, file); const s = await lstat(path);
    requireThat(s.isFile() && !s.isSymbolicLink() && s.size <= 131072
      && sha(await readFile(path)) === a.sourceHashes[file], "SOURCE_IDENTITY_CHANGED", 503);
  }
  requireThat(sha(await readFile(a.nodeExecutable)) === a.nodeSha256, "NODE_IDENTITY_CHANGED", 503);
}

async function start() {
  const a = await approval(); await verifyFiles(a);
  const runDirectory = join(ROOT, "evidence/live", a.id);
  await privateDirectory(runDirectory);
  const scope = { id: a.id, deadline: a.deadline, limit: 6 };
  const ledgerFile = join(runDirectory, "budget.json");
  if (process.argv.length === 3 && process.argv[2] === "--initialize-budget") {
    await initializeBudget(ledgerFile, scope); console.log("BUDGET_INITIALIZED_NO_SERVICE_NO_PROVIDER"); return;
  }
  requireThat(process.argv.length === 2, "ARGUMENTS_REFUSED");
  const ledger = new BudgetLedger(ledgerFile, scope); await ledger.ready();
  const lifecycle = createLifecycle({ deadline: Date.parse(a.deadline) });
  const rule = JSON.parse(await readFile(join(ROOT, "pricing/rule.json"), "utf8"));
  requireThat(exact(rule, ["id", "title", "text", "domain"]) && rule.id === "pricing-v1", "RULE_INVALID", 503);
  const originalSource = await readFile(join(ROOT, "pricing/original.ts"), "utf8");
  const changes = [];
  for (const id of ["a", "b"]) {
    const candidateSource = await readFile(join(ROOT, "pricing/change-" + id + ".ts"), "utf8");
    changes.push({ id, title: "Prepared change " + id.toUpperCase(), rule, originalSource, candidateSource,
      originalSha256: sha(originalSource), candidateSha256: sha(candidateSource),
      diff: "ORIGINAL\n" + originalSource + "\nPROPOSED\n" + candidateSource });
  }
  const controller = createController({ changes, scope, ledger, lifecycle,
    verifySources: () => verifyFiles(a),
    provider: (packet) => museProposal(a.keyFile, packet, a.deadline, { lifecycle }),
    runner: (id, cases) => fixedRunner(a.nodeExecutable, id, cases, lifecycle),
    persistExport: (source) => persistRegression({ artifact: join(ROOT, "evidence/regression.test.mjs"),
      record: join(runDirectory, "current-export.json"), scopeId: a.id, source }),
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
  start().catch((error) => { console.error(error instanceof Refusal ? error.code : "STARTUP_REFUSED"); process.exitCode = 1; });
}
