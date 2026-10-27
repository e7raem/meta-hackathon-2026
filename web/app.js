/*
 * Pricing change reviewer — browser module (web/app.js).
 *
 * Pure state, validation, and API-client functions are exported for Node
 * tests. DOM wiring happens only when a document is present, so importing
 * this module in Node has no side effects: no fetch, no rendering, no
 * global mutation.
 */

export const API_PATHS = Object.freeze({
  session: "/api/session",
  propose: "/api/propose",
  accept: "/api/accept",
  compare: "/api/compare",
  export: "/api/export",
});

export const EXPECTED_TOTAL_MIN = 0;
export const EXPECTED_TOTAL_MAX = 400000;

const MODES = ["LIVE", "FIXTURE"];
const ORIGINS = ["LIVE", "FIXTURE"];
const COMPARISON_STATUSES = ["REPRODUCED", "NO_COUNTEREXAMPLE", "INCONCLUSIVE"];
const EXPECTATION_ORIGINS = ["META_ACCEPTED", "REVIEWER_CORRECTED"];
const EXPORT_FILENAME = "regression.test.mjs";
const EXPORT_PATH = "evidence/regression.test.mjs";
const EXPORT_COMMAND = "ota run verify:export --agent";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DIGITS_PATTERN = /^\d{1,6}$/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerIn(value, min, max) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function textOk(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function fail(error) {
  return { ok: false, error };
}

const OK = Object.freeze({ ok: true, error: null });

export function isValidExpectedTotal(value) {
  return isIntegerIn(value, EXPECTED_TOTAL_MIN, EXPECTED_TOTAL_MAX);
}

export function parseExpectationInput(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!DIGITS_PATTERN.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return isValidExpectedTotal(value) ? value : null;
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 4) {
    return fail("each case needs 1 to 4 lines");
  }
  for (const line of lines) {
    if (!isPlainObject(line)) return fail("line entries must be objects");
    if (!isIntegerIn(line.amount, 100, 100000) || line.amount % 100 !== 0) {
      return fail("line amounts must be integers 100..100000 in multiples of 100");
    }
    if (typeof line.discountEligible !== "boolean") {
      return fail("discountEligible must be an explicit boolean");
    }
  }
  return OK;
}

function validateCase(entry) {
  if (!isPlainObject(entry)) return fail("cases must be objects");
  if (!textOk(entry.id, 100)) return fail("case id must be a non-empty string");
  const lines = validateLines(entry.lines);
  if (!lines.ok) return lines;
  if (!isValidExpectedTotal(entry.expectedTotal)) {
    return fail("case expectedTotal must be an integer within bounds");
  }
  if (!textOk(entry.rationale, 2000)) {
    return fail("case rationale must be a bounded non-empty string");
  }
  return OK;
}

export function validateSession(data) {
  if (!isPlainObject(data)) return fail("session payload must be an object");
  if (!MODES.includes(data.mode)) return fail("session mode must be literal LIVE or FIXTURE");
  if (!textOk(data.csrfToken, 500)) return fail("session csrfToken must be a non-empty string");
  if (!isIntegerIn(data.callsUsed, 0, 1000000)) return fail("session callsUsed must be a non-negative integer");
  if (!isIntegerIn(data.limit, 1, 1000000)) return fail("session limit must be a positive integer");
  if (!textOk(data.deadline, 100)) return fail("session deadline must be a non-empty string");
  if (!Array.isArray(data.changes) || data.changes.length < 1 || data.changes.length > 10) {
    return fail("session changes must list between 1 and 10 prepared changes");
  }
  const seen = new Set();
  for (const change of data.changes) {
    if (!isPlainObject(change)) return fail("changes must be objects");
    if (change.id !== "a" && change.id !== "b") return fail('change ids must be "a" or "b"');
    if (seen.has(change.id)) return fail("change ids must be unique");
    seen.add(change.id);
    if (!textOk(change.title, 300)) return fail("change title must be a bounded non-empty string");
    if (!isPlainObject(change.rule)) return fail("change rule must be an object");
    if (!textOk(change.rule.id, 100)) return fail("rule id must be a non-empty string");
    if (!textOk(change.rule.title, 300)) return fail("rule title must be a bounded non-empty string");
    if (!textOk(change.rule.text, 8000)) return fail("rule text must be a bounded non-empty string");
    if (!textOk(change.rule.domain, 2000)) return fail("rule domain must be a bounded non-empty string");
    if (!textOk(change.diff, 16000)) return fail("change diff must be a bounded non-empty string");
    if (typeof change.originalSha256 !== "string" || !SHA256_PATTERN.test(change.originalSha256)) {
      return fail("originalSha256 must be 64 lowercase hex characters");
    }
    if (typeof change.candidateSha256 !== "string" || !SHA256_PATTERN.test(change.candidateSha256)) {
      return fail("candidateSha256 must be 64 lowercase hex characters");
    }
  }
  return OK;
}

export function validateProposal(data) {
  if (!isPlainObject(data)) return fail("proposal payload must be an object");
  if (data.kind !== "proposal") return fail('proposal kind must be "proposal"');
  if (!ORIGINS.includes(data.origin)) return fail("proposal origin must be literal LIVE or FIXTURE");
  if (!textOk(data.proposalId, 200)) return fail("proposalId must be a non-empty string");
  if (!textOk(data.model, 200)) return fail("proposal model must be a non-empty string");
  if (!isIntegerIn(data.callsUsed, 0, 1000000)) return fail("proposal callsUsed must be a non-negative integer");
  if (!Array.isArray(data.cases) || data.cases.length < 1 || data.cases.length > 3) {
    return fail("proposal must contain between 1 and 3 cases");
  }
  const ids = new Set();
  for (const entry of data.cases) {
    const result = validateCase(entry);
    if (!result.ok) return result;
    if (ids.has(entry.id)) return fail("case ids must be unique");
    ids.add(entry.id);
  }
  if (!isPlainObject(data.usage)
    || !(data.usage.inputTokens === null || isIntegerIn(data.usage.inputTokens, 0, 100000000))
    || !(data.usage.outputTokens === null || isIntegerIn(data.usage.outputTokens, 0, 100000000))) {
    return fail("proposal usage must report integer token counts or null (unknown)");
  }
  return OK;
}

export function formatTokenUsage(value) {
  return value === null ? "UNKNOWN" : String(value);
}

export function validateAccepted(data) {
  if (!isPlainObject(data)) return fail("acceptance payload must be an object");
  if (data.kind !== "accepted") return fail('acceptance kind must be "accepted"');
  if (!ORIGINS.includes(data.origin)) return fail("acceptance origin must be literal LIVE or FIXTURE");
  if (!textOk(data.acceptedId, 200)) return fail("acceptedId must be a non-empty string");
  if (!textOk(data.proposalId, 200)) return fail("acceptance proposalId must be a non-empty string");
  if (!Array.isArray(data.acceptedCases) || data.acceptedCases.length < 1 || data.acceptedCases.length > 3) {
    return fail("acceptance must contain between 1 and 3 cases");
  }
  const allowedKeys = ["caseId", "lines", "expectedTotal", "expectationOrigin"];
  const ids = new Set();
  for (const entry of data.acceptedCases) {
    if (!isPlainObject(entry)) return fail("accepted cases must be objects");
    const keys = Object.keys(entry);
    if (keys.length !== allowedKeys.length || !allowedKeys.every((key) => key in entry)) {
      return fail("acceptance cases must not carry observed outcomes or extra fields");
    }
    if (!textOk(entry.caseId, 100)) return fail("accepted caseId must be a non-empty string");
    if (ids.has(entry.caseId)) return fail("accepted caseIds must be unique");
    ids.add(entry.caseId);
    const lines = validateLines(entry.lines);
    if (!lines.ok) return lines;
    if (!isValidExpectedTotal(entry.expectedTotal)) {
      return fail("accepted expectedTotal must be an integer within bounds");
    }
    if (!EXPECTATION_ORIGINS.includes(entry.expectationOrigin)) {
      return fail("expectationOrigin must be META_ACCEPTED or REVIEWER_CORRECTED");
    }
  }
  return OK;
}

function validateOutcome(outcome, label) {
  if (!isPlainObject(outcome)) return fail(`${label} outcome must be an object`);
  const valueIsNull = outcome.value === null;
  const errorIsNull = outcome.error === null;
  if (valueIsNull === errorIsNull) {
    return fail(`${label} outcome must have exactly one of value or error`);
  }
  if (!valueIsNull && !isIntegerIn(outcome.value, -1000000000, 1000000000)) {
    return fail(`${label} outcome value must be a bounded integer`);
  }
  if (!errorIsNull && !textOk(outcome.error, 2000)) {
    return fail(`${label} outcome error must be a bounded non-empty string`);
  }
  return OK;
}

export function validateComparison(data) {
  if (!isPlainObject(data)) return fail("comparison payload must be an object");
  if (data.kind !== "comparison") return fail('comparison kind must be "comparison"');
  if (!ORIGINS.includes(data.origin)) return fail("comparison origin must be literal LIVE or FIXTURE");
  if (!textOk(data.runId, 200)) return fail("comparison runId must be a non-empty string");
  if (!textOk(data.acceptedId, 200)) return fail("comparison acceptedId must be a non-empty string");
  if (!COMPARISON_STATUSES.includes(data.status)) {
    return fail("comparison status must be REPRODUCED, NO_COUNTEREXAMPLE or INCONCLUSIVE");
  }
  if (!Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 3) {
    return fail("comparison must contain between 1 and 3 rows");
  }
  const ids = new Set();
  for (const row of data.rows) {
    if (!isPlainObject(row)) return fail("comparison rows must be objects");
    if (!textOk(row.caseId, 100)) return fail("comparison row caseId must be a non-empty string");
    if (ids.has(row.caseId)) return fail("comparison row caseIds must be unique");
    ids.add(row.caseId);
    if (!isValidExpectedTotal(row.expectedTotal)) {
      return fail("comparison row expectedTotal must be an integer within bounds");
    }
    const original = validateOutcome(row.original, "original");
    if (!original.ok) return original;
    const candidate = validateOutcome(row.candidate, "candidate");
    if (!candidate.ok) return candidate;
  }
  if (!isPlainObject(data.sourceIdentities)) return fail("sourceIdentities must be an object");
  const identityEntries = Object.entries(data.sourceIdentities);
  if (identityEntries.length > 20) return fail("sourceIdentities must stay bounded");
  for (const [key, value] of identityEntries) {
    if (!textOk(key, 100) || !textOk(value, 300)) {
      return fail("sourceIdentities entries must be bounded non-empty strings");
    }
  }
  if (!Array.isArray(data.limits) || data.limits.length > 20) {
    return fail("comparison limits must be a bounded array");
  }
  for (const limit of data.limits) {
    if (!textOk(limit, 500)) return fail("comparison limits must be bounded non-empty strings");
  }
  return OK;
}

export function validateExport(data) {
  if (!isPlainObject(data)) return fail("export payload must be an object");
  if (data.kind !== "export") return fail('export kind must be "export"');
  if (!ORIGINS.includes(data.origin)) return fail("export origin must be literal LIVE or FIXTURE");
  if (data.filename !== EXPORT_FILENAME) {
    return fail(`export filename must be exactly ${EXPORT_FILENAME}`);
  }
  if (data.path !== EXPORT_PATH) {
    return fail(`export path must be exactly ${EXPORT_PATH}`);
  }
  if (!textOk(data.testSource, 16384)) {
    return fail("export testSource must be a non-empty string of at most 16 KiB");
  }
  if (typeof data.sha256 !== "string" || !SHA256_PATTERN.test(data.sha256)) {
    return fail("export sha256 must be 64 lowercase hex characters");
  }
  if (data.command !== EXPORT_COMMAND) {
    return fail(`export command must be exactly "${EXPORT_COMMAND}"`);
  }
  return OK;
}

function apiError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function describeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/*
 * API client. fetchImpl and randomId are injected so tests use a mocked
 * fetch and a deterministic requestId generator; the browser passes the
 * real fetch and crypto.randomUUID. Fixed same-origin paths only; no
 * caller-supplied URLs and no automatic retry.
 */
export function createApiClient({ fetchImpl, randomId }) {
  if (typeof fetchImpl !== "function" || typeof randomId !== "function") {
    throw new TypeError("createApiClient requires fetchImpl and randomId functions");
  }

  async function requestJson(path, { method, body, csrfToken }) {
    let response;
    try {
      if (method === "GET") {
        response = await fetchImpl(path);
      } else {
        response = await fetchImpl(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Demo-Token": csrfToken,
          },
          body: JSON.stringify({ ...body, requestId: randomId() }),
        });
      }
    } catch (error) {
      throw apiError("network_unreachable", describeError(error));
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw apiError("invalid_shape", "response body was not valid JSON");
    }
    if (!response.ok) {
      if (isPlainObject(data) && isPlainObject(data.error)
        && textOk(data.error.code, 100) && textOk(data.error.message, 1000)) {
        throw apiError(data.error.code, data.error.message);
      }
      throw apiError(`http_${response.status}`, "request failed");
    }
    return data;
  }

  function ensure(validation, data) {
    if (!validation.ok) throw apiError("invalid_shape", validation.error);
    return data;
  }

  return {
    async getSession() {
      const data = await requestJson(API_PATHS.session, { method: "GET" });
      return ensure(validateSession(data), data);
    },
    async propose({ csrfToken, changeId }) {
      const data = await requestJson(API_PATHS.propose, {
        method: "POST",
        csrfToken,
        body: { changeId },
      });
      return ensure(validateProposal(data), data);
    },
    async accept({ csrfToken, proposalId, expectations }) {
      const data = await requestJson(API_PATHS.accept, {
        method: "POST",
        csrfToken,
        body: { proposalId, expectations, reviewed: true },
      });
      ensure(validateAccepted(data), data);
      if (data.proposalId !== proposalId) {
        throw apiError("invalid_shape", "acceptance echoed a different proposalId");
      }
      return data;
    },
    async compare({ csrfToken, acceptedId }) {
      const data = await requestJson(API_PATHS.compare, {
        method: "POST",
        csrfToken,
        body: { acceptedId },
      });
      ensure(validateComparison(data), data);
      if (data.acceptedId !== acceptedId) {
        throw apiError("invalid_shape", "comparison echoed a different acceptedId");
      }
      return data;
    },
    async exportTest({ csrfToken, runId }) {
      const data = await requestJson(API_PATHS.export, {
        method: "POST",
        csrfToken,
        body: { runId },
      });
      return ensure(validateExport(data), data);
    },
  };
}

function blankErrors() {
  return { session: null, propose: null, accept: null, compare: null, export: null };
}

export function initialState() {
  return {
    session: null,
    budgetKnown: false,
    proposalPending: false,
    selectedChangeId: null,
    proposal: null,
    expectations: {},
    reviewedConfirmed: false,
    accepted: null,
    comparison: null,
    exportResult: null,
    inFlight: null,
    epoch: 0,
    errors: blankErrors(),
  };
}

/*
 * Store. Methods return { ok, reason? } so the UI and tests can assert
 * guard behavior. Stale async responses (epoch mismatch after a selection
 * change or session reload) never populate downstream results. An uncertain
 * model dispatch leaves usage unknown until an explicit read-only refresh.
 */
export function createStore({ client }) {
  let state = initialState();
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) listener(state);
  }

  function resetDownstreamOfSelection() {
    state.proposal = null;
    state.expectations = {};
    state.reviewedConfirmed = false;
    state.accepted = null;
    state.comparison = null;
    state.exportResult = null;
    state.errors = blankErrors();
  }

  function resetDownstreamOfExpectations() {
    state.reviewedConfirmed = false;
    state.accepted = null;
    state.comparison = null;
    state.exportResult = null;
    state.errors.accept = null;
    state.errors.compare = null;
    state.errors.export = null;
  }

  function guardBusy() {
    return state.inFlight || state.proposalPending ? { ok: false, reason: "busy" } : null;
  }

  function checkAcceptanceEcho(accepted) {
    const localIds = Object.keys(state.expectations);
    if (accepted.acceptedCases.length !== localIds.length) {
      return "acceptance echo mismatch: case count differs from reviewed expectations";
    }
    for (const entry of accepted.acceptedCases) {
      const local = state.expectations[entry.caseId];
      if (!local) {
        return "acceptance echo mismatch: unknown caseId returned";
      }
      if (entry.expectedTotal !== local.value) {
        return "acceptance echo mismatch: expected totals differ from reviewed values";
      }
      const wantedOrigin = local.edited ? "REVIEWER_CORRECTED" : "META_ACCEPTED";
      if (entry.expectationOrigin !== wantedOrigin) {
        return `acceptance expectation origin mismatch: ${entry.caseId} must be ${wantedOrigin}`;
      }
    }
    return null;
  }

  function checkComparisonEcho(comparison) {
    const cases = state.accepted.acceptedCases;
    if (comparison.rows.length !== cases.length) {
      return "comparison rows do not match the accepted expectations";
    }
    for (const row of comparison.rows) {
      const acceptedCase = cases.find((entry) => entry.caseId === row.caseId);
      if (!acceptedCase || acceptedCase.expectedTotal !== row.expectedTotal) {
        return "comparison rows do not match the accepted expectations";
      }
    }
    return null;
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async loadSession() {
      const busy = guardBusy();
      if (busy) return busy;
      const epoch = state.epoch + 1;
      state.epoch = epoch;
      state.inFlight = "session";
      state.errors.session = null;
      notify();
      try {
        const session = await client.getSession();
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state = initialState();
        state.epoch = epoch;
        state.session = session;
        state.budgetKnown = true;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state = initialState();
        state.epoch = epoch;
        state.errors.session = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    async refreshUsage() {
      if (!state.session) return { ok: false, reason: "no_session" };
      const busy = guardBusy();
      if (busy) return busy;
      const epoch = state.epoch;
      state.inFlight = "usage";
      state.budgetKnown = false;
      notify();
      try {
        const session = await client.getSession();
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        if (session.csrfToken !== state.session.csrfToken || session.mode !== state.session.mode
          || session.deadline !== state.session.deadline || session.limit !== state.session.limit
          || session.callsUsed < state.session.callsUsed) {
          throw apiError("session_changed", "usage refresh changed session identity or regressed its durable count; reload required");
        }
        state.session.callsUsed = session.callsUsed;
        state.budgetKnown = true;
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.errors.propose = `Usage refresh failed: ${describeError(error)}`;
        return { ok: false, reason: "request_failed" };
      } finally {
        if (state.epoch === epoch) state.inFlight = null;
        notify();
      }
    },

    selectChange(changeId) {
      if (!state.session) return { ok: false, reason: "no_session" };
      const known = state.session.changes.some((change) => change.id === changeId);
      if (!known) return { ok: false, reason: "unknown_change" };
      if (state.selectedChangeId === changeId) return { ok: true };
      state.selectedChangeId = changeId;
      state.epoch += 1;
      state.inFlight = null;
      resetDownstreamOfSelection();
      notify();
      return { ok: true };
    },

    async propose() {
      if (!state.session || !state.selectedChangeId) return { ok: false, reason: "not_ready" };
      const busy = guardBusy();
      if (busy) return busy;
      if (!state.budgetKnown) return { ok: false, reason: "usage_unknown" };
      if (state.session.callsUsed >= state.session.limit) return { ok: false, reason: "budget" };
      const epoch = state.epoch;
      state.inFlight = "propose";
      state.proposalPending = true;
      state.budgetKnown = false;
      state.errors.propose = null;
      notify();
      try {
        const proposal = await client.propose({
          csrfToken: state.session.csrfToken,
          changeId: state.selectedChangeId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        if (proposal.callsUsed <= state.session.callsUsed || proposal.callsUsed > state.session.limit) {
          throw apiError("invalid_shape", "proposal did not confirm a new durable budget reservation");
        }
        state.inFlight = null;
        state.proposal = proposal;
        state.session.callsUsed = proposal.callsUsed;
        state.budgetKnown = true;
        state.expectations = {};
        for (const entry of proposal.cases) {
          state.expectations[entry.id] = {
            proposed: entry.expectedTotal,
            raw: String(entry.expectedTotal),
            value: entry.expectedTotal,
            edited: false,
          };
        }
        resetDownstreamOfExpectations();
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.proposal = null;
        state.expectations = {};
        state.errors.propose = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      } finally {
        state.proposalPending = false;
        notify();
      }
    },

    setExpectation(caseId, raw) {
      if (!state.proposal) return { ok: false, reason: "no_proposal" };
      if (state.accepted) return { ok: false, reason: "expectations_locked" };
      const busy = guardBusy();
      if (busy) return busy;
      const entry = state.expectations[caseId];
      if (!entry) return { ok: false, reason: "unknown_case" };
      if (typeof raw !== "string" || raw.length > 40) return { ok: false, reason: "invalid_input" };
      entry.raw = raw;
      entry.value = parseExpectationInput(raw);
      entry.edited = entry.value !== null && entry.value !== entry.proposed;
      resetDownstreamOfExpectations();
      notify();
      return { ok: true };
    },

    confirmReview(confirmed) {
      if (!state.proposal) return { ok: false, reason: "no_proposal" };
      if (state.accepted) return { ok: false, reason: "expectations_locked" };
      const busy = guardBusy();
      if (busy) return busy;
      state.reviewedConfirmed = confirmed === true;
      notify();
      return { ok: true };
    },

    async accept() {
      if (!state.proposal) return { ok: false, reason: "no_proposal" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.accepted) return { ok: false, reason: "already_accepted" };
      if (!state.reviewedConfirmed) return { ok: false, reason: "not_reviewed" };
      const entries = Object.entries(state.expectations);
      if (entries.some(([, entry]) => !isValidExpectedTotal(entry.value))) {
        return { ok: false, reason: "invalid_expectation" };
      }
      const epoch = state.epoch;
      state.inFlight = "accept";
      state.errors.accept = null;
      notify();
      try {
        const accepted = await client.accept({
          csrfToken: state.session.csrfToken,
          proposalId: state.proposal.proposalId,
          expectations: entries.map(([caseId, entry]) => ({
            caseId,
            expectedTotal: entry.value,
          })),
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        const mismatch = checkAcceptanceEcho(accepted);
        if (mismatch) {
          state.accepted = null;
          state.errors.accept = mismatch;
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.accepted = accepted;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.accepted = null;
        state.errors.accept = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    async compare() {
      if (!state.accepted) return { ok: false, reason: "not_accepted" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.comparison) return { ok: false, reason: "already_compared" };
      const epoch = state.epoch;
      state.inFlight = "compare";
      state.errors.compare = null;
      notify();
      try {
        const comparison = await client.compare({
          csrfToken: state.session.csrfToken,
          acceptedId: state.accepted.acceptedId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        const mismatch = checkComparisonEcho(comparison);
        if (mismatch) {
          state.comparison = null;
          state.errors.compare = mismatch;
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.comparison = comparison;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.comparison = null;
        state.errors.compare = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    async exportTest() {
      if (!state.comparison) return { ok: false, reason: "no_comparison" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.exportResult) return { ok: false, reason: "already_exported" };
      const epoch = state.epoch;
      state.inFlight = "export";
      state.errors.export = null;
      notify();
      try {
        const exported = await client.exportTest({
          csrfToken: state.session.csrfToken,
          runId: state.comparison.runId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.exportResult = exported;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.exportResult = null;
        state.errors.export = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Browser-only DOM layer. Never executed under Node test imports.     */
/* ------------------------------------------------------------------ */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === false || raw === null || raw === undefined) continue;
    if (key === "class") {
      node.className = raw;
    } else if (raw === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(raw));
    }
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setStatus(node, text, tone) {
  node.textContent = text;
  node.className = tone ? `status ${tone}` : "status";
}

function formatMinorUnits(value) {
  return `${value} minor units`;
}

function describeLines(lines) {
  return lines
    .map((line) => `${line.amount} ${line.discountEligible ? "eligible" : "not eligible"}`)
    .join(" + ");
}

function startBrowserApp() {
  const client = createApiClient({
    fetchImpl: (...args) => window.fetch(...args),
    randomId: () => crypto.randomUUID(),
  });
  const store = createStore({ client });

  const byId = (id) => document.getElementById(id);
  const nodes = {
    modeBadge: byId("mode-badge"),
    sessionMeta: byId("session-meta"),
    sessionError: byId("session-error"),
    changeOptions: byId("change-options"),
    changeDetail: byId("change-detail"),
    proposeButton: byId("propose-button"),
    proposeStatus: byId("propose-status"),
    proposalPanel: byId("proposal-panel"),
    expectationRows: byId("expectation-rows"),
    reviewedCheckbox: byId("reviewed-checkbox"),
    acceptButton: byId("accept-button"),
    acceptStatus: byId("accept-status"),
    acceptedPanel: byId("accepted-panel"),
    compareButton: byId("compare-button"),
    compareStatus: byId("compare-status"),
    comparisonPanel: byId("comparison-panel"),
    exportButton: byId("export-button"),
    exportStatus: byId("export-status"),
    exportPanel: byId("export-panel"),
  };

  let renderedChangesKey = null;
  let renderedProposalId = null;

  function renderSession(state) {
    if (state.inFlight === "session") {
      nodes.modeBadge.textContent = "LOADING";
      nodes.modeBadge.className = "badge offline";
      nodes.sessionMeta.textContent = "Contacting the local backend…";
      nodes.sessionError.hidden = true;
      return;
    }
    if (!state.session) {
      nodes.modeBadge.textContent = "NO SESSION";
      nodes.modeBadge.className = "badge offline";
      nodes.sessionMeta.textContent =
        "The review backend is unavailable. Start it locally and reload; nothing is simulated here.";
      nodes.sessionError.hidden = !state.errors.session;
      nodes.sessionError.textContent = state.errors.session ?? "";
      return;
    }
    const { mode, callsUsed, limit, deadline } = state.session;
    nodes.modeBadge.textContent = mode;
    nodes.modeBadge.className = mode === "LIVE" ? "badge live" : "badge fixture";
    nodes.sessionMeta.textContent =
      state.budgetKnown
        ? `${callsUsed} of ${limit} model calls used (last confirmed) · session deadline ${deadline}`
        : `Model usage unknown or pending; refresh before another call · session deadline ${deadline}`;
    nodes.sessionError.hidden = true;
  }

  function renderChanges(state) {
    const session = state.session;
    const key = session
      ? session.changes.map((change) => change.id).join(",")
      : null;
    if (key !== renderedChangesKey) {
      renderedChangesKey = key;
      clear(nodes.changeOptions);
      if (session) {
        for (const change of session.changes) {
          const input = el("input", {
            type: "radio",
            name: "change",
            id: `change-${change.id}`,
            value: change.id,
          });
          input.addEventListener("change", () => {
            store.selectChange(change.id);
          });
          nodes.changeOptions.append(
            el("div", { class: "change-option" },
              input,
              el("label", { for: `change-${change.id}` }, `Change ${change.id.toUpperCase()}: ${change.title}`),
            ),
          );
        }
      }
    }
    for (const radio of nodes.changeOptions.querySelectorAll("input[type=radio]")) {
      radio.checked = radio.value === state.selectedChangeId;
      radio.disabled = Boolean(state.inFlight);
    }
    clear(nodes.changeDetail);
    if (!session || !state.selectedChangeId) return;
    const change = session.changes.find((entry) => entry.id === state.selectedChangeId);
    if (!change) return;
    nodes.changeDetail.append(
      el("h3", {}, change.title),
      el("details", { open: true },
        el("summary", {}, `Rule: ${change.rule.title}`),
        el("p", { class: "rule-text" }, change.rule.text),
        el("p", { class: "rule-domain" }, `Input domain: ${change.rule.domain}`),
      ),
      el("details", {},
        el("summary", {}, "Proposed source change (diff)"),
        el("pre", { class: "diff" }, change.diff),
      ),
      el("details", {},
        el("summary", {}, "Source identities"),
        el("dl", { class: "identities" },
          el("dt", {}, "original sha256"),
          el("dd", {}, change.originalSha256),
          el("dt", {}, "candidate sha256"),
          el("dd", {}, change.candidateSha256),
        ),
      ),
    );
  }

  function renderProposal(state) {
    nodes.proposeButton.disabled =
      !state.session || !state.selectedChangeId || Boolean(state.inFlight)
      || state.proposalPending
      || Boolean(state.proposal)
      || (state.budgetKnown && state.session && state.session.callsUsed >= state.session.limit);
    nodes.proposeButton.textContent = state.budgetKnown ? "Propose cases" : "Refresh usage (no model call)";
    if (state.inFlight === "propose") {
      setStatus(nodes.proposeStatus, "Asking Muse for verification cases…", "pending");
    } else if (state.inFlight === "usage") {
      setStatus(nodes.proposeStatus, "Reading the durable budget; no model call…", "pending");
    } else if (state.errors.propose) {
      setStatus(nodes.proposeStatus, `Proposal failed and was not retried: ${state.errors.propose}`, "error");
    } else if (state.proposal) {
      setStatus(
        nodes.proposeStatus,
        `${state.proposal.origin} proposal from ${state.proposal.model} · ` +
        `${formatTokenUsage(state.proposal.usage.inputTokens)} in / ${formatTokenUsage(state.proposal.usage.outputTokens)} out tokens`,
        "good",
      );
    } else if (state.session && !state.budgetKnown) {
      setStatus(nodes.proposeStatus, "A prior call may have consumed budget. Refresh usage before another model request.", "warn");
    } else if (state.session && state.session.callsUsed >= state.session.limit) {
      setStatus(nodes.proposeStatus, "The model call budget for this session is used up.", "warn");
    } else {
      setStatus(nodes.proposeStatus, "", null);
    }
    clear(nodes.proposalPanel);
    if (!state.proposal) return;
    const list = el("ol", { class: "case-list" });
    for (const entry of state.proposal.cases) {
      list.append(
        el("li", {},
          el("p", { class: "case-lines mono" }, describeLines(entry.lines)),
          el("p", { class: "case-expected" }, `Proposed expected total: ${formatMinorUnits(entry.expectedTotal)}`),
          el("p", { class: "case-rationale" }, entry.rationale),
        ),
      );
    }
    nodes.proposalPanel.append(list);
  }

  function renderExpectations(state) {
    const proposalId = state.proposal ? state.proposal.proposalId : null;
    if (proposalId !== renderedProposalId) {
      renderedProposalId = proposalId;
      clear(nodes.expectationRows);
      if (state.proposal) {
        for (const entry of state.proposal.cases) {
          const input = el("input", {
            type: "text",
            id: `exp-${entry.id}`,
            inputmode: "numeric",
            autocomplete: "off",
            maxlength: "6",
            value: state.expectations[entry.id].raw,
          });
          input.addEventListener("input", () => {
            store.setExpectation(entry.id, input.value);
          });
          nodes.expectationRows.append(
            el("div", { class: "exp-row" },
              el("label", { for: `exp-${entry.id}` },
                `Expected total for ${describeLines(entry.lines)} (minor units)`),
              input,
              el("span", { class: "badge edited", hidden: true, "data-role": "edited" }, "reviewer corrected"),
              el("span", { class: "hint", hidden: true, "data-role": "hint" },
                "Enter a whole number between 0 and 400000."),
            ),
          );
        }
      }
    }
    for (const row of nodes.expectationRows.querySelectorAll(".exp-row")) {
      const input = row.querySelector("input");
      const caseId = input.id.replace(/^exp-/, "");
      const entry = state.expectations[caseId];
      if (!entry) continue;
      input.disabled = Boolean(state.inFlight) || Boolean(state.accepted);
      row.querySelector('[data-role="edited"]').hidden = !entry.edited;
      row.querySelector('[data-role="hint"]').hidden = entry.value !== null;
    }
    nodes.reviewedCheckbox.disabled = !state.proposal || Boolean(state.inFlight) || Boolean(state.accepted);
    nodes.reviewedCheckbox.checked = state.reviewedConfirmed;
    const expectationEntries = Object.values(state.expectations);
    nodes.acceptButton.disabled =
      !state.proposal || Boolean(state.inFlight) || Boolean(state.accepted)
      || !state.reviewedConfirmed
      || expectationEntries.some((entry) => entry.value === null);
    if (state.inFlight === "accept") {
      setStatus(nodes.acceptStatus, "Recording the reviewed expectations…", "pending");
    } else if (state.errors.accept) {
      setStatus(nodes.acceptStatus, `Acceptance failed: ${state.errors.accept}`, "error");
    } else if (state.accepted) {
      setStatus(nodes.acceptStatus, "Expectations locked before any execution outcome was observed.", "good");
    } else {
      setStatus(nodes.acceptStatus, "", null);
    }
    clear(nodes.acceptedPanel);
    if (!state.accepted) return;
    const list = el("ul", { class: "accepted-list" });
    for (const entry of state.accepted.acceptedCases) {
      list.append(
        el("li", {},
          el("span", { class: "mono" }, describeLines(entry.lines)),
          el("span", {}, ` → expected ${formatMinorUnits(entry.expectedTotal)} `),
          el("span", {
            class: entry.expectationOrigin === "REVIEWER_CORRECTED" ? "badge edited" : "badge meta",
          }, entry.expectationOrigin === "REVIEWER_CORRECTED" ? "reviewer corrected" : "Muse value, reviewer accepted"),
        ),
      );
    }
    nodes.acceptedPanel.append(
      list,
      el("p", { class: "fineprint" },
        "Acceptance records the reviewer's declaration in this session. " +
        "A reviewer declaration is an operator decision, not an attestation of any human's identity."),
    );
  }

  function renderComparison(state) {
    nodes.compareButton.disabled =
      !state.accepted || Boolean(state.inFlight) || Boolean(state.comparison);
    if (state.inFlight === "compare") {
      setStatus(nodes.compareStatus, "Comparing original and candidate on the backend…", "pending");
    } else if (state.errors.compare) {
      setStatus(nodes.compareStatus,
        `Comparison failed — treat the result as inconclusive: ${state.errors.compare}`, "error");
    } else if (state.comparison) {
      const status = state.comparison.status;
      if (status === "REPRODUCED") {
        setStatus(nodes.compareStatus,
          "REPRODUCED — at least one accepted case distinguishes candidate from expectation.", "bad");
      } else if (status === "NO_COUNTEREXAMPLE") {
        setStatus(nodes.compareStatus,
          "NO_COUNTEREXAMPLE — these cases found no difference. That is not proof of correctness.", "warn");
      } else {
        setStatus(nodes.compareStatus,
          "INCONCLUSIVE — the backend could not establish an outcome for these cases.", "warn");
      }
    } else {
      setStatus(nodes.compareStatus, "", null);
    }
    clear(nodes.comparisonPanel);
    if (!state.comparison) return;
    const table = el("table", { class: "compare-table" },
      el("thead", {},
        el("tr", {},
          el("th", {}, "Case"),
          el("th", {}, "Expected"),
          el("th", {}, "Original"),
          el("th", {}, "Candidate"),
        ),
      ),
    );
    const tbody = el("tbody", {});
    for (const row of state.comparison.rows) {
      const cell = (outcome) => {
        if (outcome.error !== null) {
          return el("td", { class: "bad" }, `error: ${outcome.error}`);
        }
        const matches = outcome.value === row.expectedTotal;
        return el("td", { class: matches ? "good" : "bad" },
          `${outcome.value}${matches ? " ✓" : " ✗"}`);
      };
      tbody.append(
        el("tr", {},
          el("td", { class: "mono" }, row.caseId),
          el("td", {}, String(row.expectedTotal)),
          cell(row.original),
          cell(row.candidate),
        ),
      );
    }
    table.append(tbody);
    const identities = el("dl", { class: "identities" });
    for (const [key, value] of Object.entries(state.comparison.sourceIdentities)) {
      identities.append(el("dt", {}, key), el("dd", {}, value));
    }
    const limits = el("ul", { class: "limits" });
    for (const limit of state.comparison.limits) {
      limits.append(el("li", {}, limit));
    }
    nodes.comparisonPanel.append(
      el("p", { class: "fineprint" }, `origin ${state.comparison.origin} · run ${state.comparison.runId}`),
      table,
      el("details", {},
        el("summary", {}, "Source identities and limits"),
        identities,
        limits,
      ),
    );
  }

  function renderExport(state) {
    nodes.exportButton.disabled =
      !state.comparison || Boolean(state.inFlight) || Boolean(state.exportResult);
    if (state.inFlight === "export") {
      setStatus(nodes.exportStatus, "Building the regression test…", "pending");
    } else if (state.errors.export) {
      setStatus(nodes.exportStatus, `Export failed: ${state.errors.export}`, "error");
    } else if (state.exportResult) {
      setStatus(nodes.exportStatus, "Regression test ready below. It is shown as text and never executed here.", "good");
    } else {
      setStatus(nodes.exportStatus, "", null);
    }
    clear(nodes.exportPanel);
    if (!state.exportResult) return;
    const exported = state.exportResult;
    const download = el("button", { type: "button", class: "download" }, `Download ${exported.filename}`);
    download.addEventListener("click", () => {
      const blob = new Blob([exported.testSource], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = el("a", { href: url, download: exported.filename });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    nodes.exportPanel.append(
      el("p", {},
        `The server persisted this test at ${exported.path}. ` +
        `Run it with the fixed command "${exported.command}". ` +
        `The download below is an optional local copy only.`),
      el("p", { class: "fineprint mono" }, `sha256 ${exported.sha256} · origin ${exported.origin}`),
      download,
      el("details", { open: true },
        el("summary", {}, "Test source (text only)"),
        el("pre", { class: "test-source" }, exported.testSource),
      ),
    );
  }

  function render(state) {
    renderSession(state);
    renderChanges(state);
    renderProposal(state);
    renderExpectations(state);
    renderComparison(state);
    renderExport(state);
  }

  nodes.proposeButton.addEventListener("click", () => {
    if (store.getState().budgetKnown) store.propose();
    else store.refreshUsage();
  });
  nodes.reviewedCheckbox.addEventListener("change", () => {
    store.confirmReview(nodes.reviewedCheckbox.checked);
  });
  nodes.acceptButton.addEventListener("click", () => {
    store.accept();
  });
  nodes.compareButton.addEventListener("click", () => {
    store.compare();
  });
  nodes.exportButton.addEventListener("click", () => {
    store.exportTest();
  });

  store.subscribe(render);
  render(store.getState());
  store.loadSession();
}

if (typeof document !== "undefined" && typeof document.getElementById === "function") {
  const boot = () => {
    if (document.getElementById("app")) startBrowserApp();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
