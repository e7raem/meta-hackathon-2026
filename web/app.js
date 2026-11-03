/*
 * Break This PR — browser module (web/app.js).
 *
 * A developer selects one of two prepared sample checkout PRs, then reviews it in three stages:
 * the code change (with an actually executed baseline), the breaking
 * basket (Muse-proposed cases reviewed against the written rule before
 * any comparison), and the test to keep (persisted export proven
 * red -> green against a pre-reviewed fixed correction).
 *
 * Pure state, validation, and API-client functions are exported for Node
 * tests. DOM wiring happens only when a document is present, so importing
 * this module in Node has no side effects: no fetch, no rendering, no
 * global mutation.
 */

export const API_PATHS = Object.freeze({
  session: "/api/session",
  baseline: "/api/baseline",
  propose: "/api/propose",
  accept: "/api/accept",
  compare: "/api/compare",
  export: "/api/export",
  regression: "/api/regression",
  control: "/api/control",
  feedback: "/api/feedback",
});

export const EXPECTED_TOTAL_MIN = 0;
export const EXPECTED_TOTAL_MAX = 400000;

const MODES = ["LIVE", "FIXTURE"];
const ORIGINS = ["LIVE", "FIXTURE"];
const SCENARIO_IDS = ["a", "c"];
const LOCAL_EXECUTION = "LOCAL_EXECUTION";
const COMPARISON_STATUSES = ["REPRODUCED", "NO_COUNTEREXAMPLE", "INCONCLUSIVE"];
const BASELINE_STATUSES = ["PASS", "FAIL", "INCONCLUSIVE"];
const REGRESSION_STATUSES = ["RED_THEN_GREEN", "INCONCLUSIVE"];
const FEEDBACK_STATUSES = ["STOPPED", "FOLLOW_UP_PROPOSED", "INCONCLUSIVE"];
export const FEEDBACK_EXPLANATION_MAX = 600;
const EXPECTATION_ORIGINS = ["META_ACCEPTED", "REVIEWER_CORRECTED"];
const EXPORT_FILENAME = "regression.test.mjs";
const EXPORT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EXPORT_PATH_PATTERN = /^evidence\/live\/[A-Za-z0-9-]{8,80}\/exports\/([a-f0-9-]{36})\/regression\.test\.mjs$/;
const EXPORT_COMMAND = "ota run verify:export --agent";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const POUNDS_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;

export const NO_CASES_MESSAGE =
  "INCONCLUSIVE: Muse proposed no cases; no new case comparison was run. This is not approval.";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerIn(value, min, max) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function textOk(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

// Like textOk but accepts the empty string (captured stdout/stderr may be empty).
function textAny(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength;
}

function intOrNull(value, min, max) {
  return value === null || isIntegerIn(value, min, max);
}

function fail(error) {
  return { ok: false, error };
}

const OK = Object.freeze({ ok: true, error: null });

function validScenario(data, retainedA = false) {
  return retainedA
    ? data.scenarioId === undefined || data.scenarioId === "a"
    : SCENARIO_IDS.includes(data.scenarioId);
}

export function getSelectedChange(state) {
  return state.session?.changes.find((change) => change.id === state.selectedChangeId) ?? null;
}

export function isValidExpectedTotal(value) {
  return isIntegerIn(value, EXPECTED_TOTAL_MIN, EXPECTED_TOTAL_MAX);
}

/*
 * Money: the backend speaks integer pence (10000 = GBP 100). The UI
 * renders pounds with two decimals and parses reviewer input strictly:
 * digits with at most two decimals, optional leading £, no coercion.
 */
export function formatPence(pence) {
  if (!Number.isSafeInteger(pence) || pence < 0) return "unknown";
  const pounds = Math.trunc(pence / 100);
  const pennies = String(pence % 100).padStart(2, "0");
  return `£${pounds}.${pennies}`;
}

export function describeChargeDifference(candidate, expected) {
  if (!isValidExpectedTotal(candidate) || !isValidExpectedTotal(expected)) return "Charge comparison unavailable.";
  const difference = candidate - expected;
  if (difference > 0) return `Customer overcharged ${formatPence(difference)}`;
  if (difference < 0) return `Shop undercharges ${formatPence(-difference)}`;
  return "Matches the reviewed total.";
}

// Select observed evidence for presentation; never infer a fault from model prose.
export function getFaultEvidence(comparison, acceptedCases, baseline = null, control = null) {
  if (comparison?.status !== "REPRODUCED") return null;
  const row = comparison.rows.find((entry) => {
    const accepted = acceptedCases.find((item) => item.caseId === entry.caseId);
    return accepted?.expectedTotal === entry.expectedTotal
      && entry.original.error === null && entry.original.value === entry.expectedTotal
      && entry.candidate.error === null && isValidExpectedTotal(entry.candidate.value)
      && entry.candidate.value !== entry.expectedTotal;
  });
  if (!row) return null;
  const accepted = acceptedCases.find((entry) => entry.caseId === row.caseId);
  const baselineLinked = baseline?.status === "PASS"
    && SHA256_PATTERN.test(comparison.sourceIdentities.original ?? "")
    && SHA256_PATTERN.test(comparison.sourceIdentities.candidate ?? "")
    && baseline.sourceIdentities.original === comparison.sourceIdentities.original
    && baseline.sourceIdentities.candidate === comparison.sourceIdentities.candidate;
  const basketKey = (lines) => JSON.stringify(lines.map((line) =>
    [line.amount, line.discountEligible]).sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1])));
  const absentFromBaseline = baselineLinked && !baseline.coverage.cases.some((entry) =>
    basketKey(entry.lines) === basketKey(accepted.lines));
  const controlBound = control && control.runId === comparison.runId
    && control.acceptedId === comparison.acceptedId
    && control.sourceIdentities.original === comparison.sourceIdentities.original
    && (control.status === "NO_COUNTEREXAMPLE" || control.status === "REPRODUCED");
  const correctedRow = controlBound ? control.rows.find((entry) =>
    entry.caseId === row.caseId && entry.expectedTotal === row.expectedTotal
    && entry.original.error === null && entry.original.value === row.expectedTotal
    && entry.candidate.error === null && isValidExpectedTotal(entry.candidate.value)) : null;
  return {
    lines: accepted.lines,
    expected: row.expectedTotal,
    before: row.candidate.value,
    after: correctedRow?.candidate.value ?? null,
    controlAttempted: Boolean(control),
    baselineLinked,
    absentFromBaseline,
    impact: describeChargeDifference(row.candidate.value, row.expectedTotal),
  };
}

export function penceToPoundsString(pence) {
  if (!Number.isSafeInteger(pence) || pence < 0) return "";
  return `${Math.trunc(pence / 100)}.${String(pence % 100).padStart(2, "0")}`;
}

export function parsePoundsInput(raw) {
  if (typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (trimmed.startsWith("£")) trimmed = trimmed.slice(1).trim();
  if (!POUNDS_PATTERN.test(trimmed)) return null;
  const [poundsPart, decimalPart = ""] = trimmed.split(".");
  const pence = Number.parseInt(poundsPart, 10) * 100
    + Number.parseInt(decimalPart.padEnd(2, "0") || "0", 10);
  return isValidExpectedTotal(pence) ? pence : null;
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

function validateCounts(counts) {
  if (!isPlainObject(counts)) return fail("execution counts must be an object");
  for (const key of ["tests", "passed", "failed", "skipped", "cancelled"]) {
    if (!isIntegerIn(counts[key], 0, 1000)) {
      return fail(`execution counts.${key} must be an integer 0..1000`);
    }
  }
  return OK;
}

function validateExecutionRecord(record, label) {
  if (!isPlainObject(record)) return fail(`${label} execution record must be an object`);
  if (!intOrNull(record.exitCode, -1000, 1000)) {
    return fail(`${label} exitCode must be an integer or null`);
  }
  if (record.counts !== null) {
    const counts = validateCounts(record.counts);
    if (!counts.ok) return fail(`${label}: ${counts.error}`);
  }
  if (!textAny(record.stdout, 16384) || !textAny(record.stderr, 16384)) {
    return fail(`${label} stdout/stderr must be bounded strings`);
  }
  return OK;
}

function validateCoverage(coverage) {
  if (!isPlainObject(coverage)) return fail("baseline coverage must be an object");
  if (!textOk(coverage.label, 300)) return fail("coverage label must be a bounded non-empty string");
  if (!Array.isArray(coverage.cases) || coverage.cases.length < 1 || coverage.cases.length > 10) {
    return fail("coverage must list between 1 and 10 cases");
  }
  const seen = new Set();
  for (const entry of coverage.cases) {
    if (!isPlainObject(entry)) return fail("coverage cases must be objects");
    if (!textOk(entry.id, 100)) return fail("coverage case id must be a non-empty string");
    if (seen.has(entry.id)) return fail("coverage case ids must be unique");
    seen.add(entry.id);
    if (!textOk(entry.title, 300)) return fail("coverage case title must be a bounded non-empty string");
    const lines = validateLines(entry.lines);
    if (!lines.ok) return lines;
    if (!isValidExpectedTotal(entry.expectedTotal)) {
      return fail("coverage expectedTotal must be an integer within bounds");
    }
  }
  return OK;
}

export function validateSession(data) {
  if (!isPlainObject(data)) return fail("session payload must be an object");
  if (!MODES.includes(data.mode)) return fail("session mode must be literal LIVE or FIXTURE");
  if (!textOk(data.csrfToken, 500)) return fail("session csrfToken must be a non-empty string");
  if (!isIntegerIn(data.callsUsed, 0, 1000000)) return fail("session callsUsed must be a non-negative integer");
  if (!isIntegerIn(data.limit, 1, 6)) return fail("session limit must be an integer from 1 to 6");
  if (data.callsUsed > data.limit) return fail("session consumption cannot exceed its request limit");
  if (!textOk(data.deadline, 100)) return fail("session deadline must be a non-empty string");
  if (!Array.isArray(data.changes) || data.changes.length !== 2) {
    return fail("session must contain exactly the two prepared changes a and c");
  }
  const changeIds = new Set();
  for (const change of data.changes) {
    if (!isPlainObject(change)) return fail("the prepared change must be an object");
    if (!SCENARIO_IDS.includes(change.id) || changeIds.has(change.id)) {
      return fail("prepared changes must have unique ids a and c");
    }
    changeIds.add(change.id);
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
  const coverage = validateCoverage(data.baselineCoverage);
  if (!coverage.ok) return coverage;
  if (data.feedbackAttempted !== undefined && typeof data.feedbackAttempted !== "boolean") {
    return fail("feedbackAttempted must be a boolean when present");
  }
  if (data.retainedInitial === undefined || data.retainedInitial === null) return OK;
  if (data.mode === "LIVE" && ["proposal", "accepted", "comparison"].some(
    (key) => data.retainedInitial[key]?.origin !== "LIVE")) return fail("live retained records must have LIVE origin");
  return validateRetainedInitial(data.retainedInitial);
}

export function validateProposal(data, { retainedA = false } = {}) {
  if (!isPlainObject(data)) return fail("proposal payload must be an object");
  if (!validScenario(data, retainedA)) return fail("proposal scenarioId must identify its prepared scenario");
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

export function validateAccepted(data, { retainedA = false } = {}) {
  if (!isPlainObject(data)) return fail("acceptance payload must be an object");
  if (!validScenario(data, retainedA)) return fail("acceptance scenarioId must identify its prepared scenario");
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

function validateComparisonRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) {
    return fail("comparison must contain between 1 and 3 rows");
  }
  const ids = new Set();
  for (const row of rows) {
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
  return OK;
}

export function validateComparison(data, { retainedA = false } = {}) {
  if (!isPlainObject(data)) return fail("comparison payload must be an object");
  if (!validScenario(data, retainedA)) return fail("comparison scenarioId must identify its prepared scenario");
  if (data.kind !== "comparison") return fail('comparison kind must be "comparison"');
  if (!ORIGINS.includes(data.origin)) return fail("comparison origin must be literal LIVE or FIXTURE");
  if (!textOk(data.runId, 200)) return fail("comparison runId must be a non-empty string");
  if (!textOk(data.acceptedId, 200)) return fail("comparison acceptedId must be a non-empty string");
  if (!COMPARISON_STATUSES.includes(data.status)) {
    return fail("comparison status must be REPRODUCED, NO_COUNTEREXAMPLE or INCONCLUSIVE");
  }
  const rows = validateComparisonRows(data.rows);
  if (!rows.ok) return rows;
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

export function validateExport(data, { fixture = false } = {}) {
  if (!isPlainObject(data)) return fail("export payload must be an object");
  if (data.kind !== "export") return fail('export kind must be "export"');
  if (!ORIGINS.includes(data.origin)) return fail("export origin must be literal LIVE or FIXTURE");
  if (data.filename !== EXPORT_FILENAME) {
    return fail(`export filename must be exactly ${EXPORT_FILENAME}`);
  }
  if (!EXPORT_ID_PATTERN.test(data.exportId) || !textOk(data.runId, 200) || !SCENARIO_IDS.includes(data.scenarioId)) {
    return fail("export must identify its export, run and prepared scenario");
  }
  const fixtureExport = fixture && data.origin === "FIXTURE" && typeof data.path === "string" && data.path.startsWith("preview-memory/");
  const expectedPath = fixtureExport ? `preview-memory/${data.exportId}/${EXPORT_FILENAME}` : null;
  if (typeof data.path !== "string" || (fixtureExport
    ? data.path !== expectedPath : data.path.match(EXPORT_PATH_PATTERN)?.[1] !== data.exportId)) {
    return fail("export path must identify the exact session-local export");
  }
  if (!textOk(data.testSource, 16384)) {
    return fail("export testSource must be a non-empty string of at most 16 KiB");
  }
  if (typeof data.sha256 !== "string" || !SHA256_PATTERN.test(data.sha256)) {
    return fail("export sha256 must be 64 lowercase hex characters");
  }
  if (data.command !== (fixtureExport ? "NOT_EXECUTED_FIXTURE" : EXPORT_COMMAND)) {
    return fail(`export command must be exactly "${EXPORT_COMMAND}"`);
  }
  return OK;
}

export function validateBaseline(data, { fixture = false } = {}) {
  if (!isPlainObject(data)) return fail("baseline payload must be an object");
  if (data.kind !== "baseline") return fail('baseline kind must be "baseline"');
  if (data.origin !== LOCAL_EXECUTION && !(fixture && data.origin === "FIXTURE")) return fail("baseline origin must be LOCAL_EXECUTION, or FIXTURE in a fixture session");
  if (!SCENARIO_IDS.includes(data.changeId)) return fail("baseline changeId must be a or c");
  if (!BASELINE_STATUSES.includes(data.status)) {
    return fail("baseline status must be PASS, FAIL or INCONCLUSIVE");
  }
  const coverage = validateCoverage(data.coverage);
  if (!coverage.ok) return coverage;
  const execution = validateExecutionRecord(data.execution, "baseline");
  if (!execution.ok) return execution;
  if (!isPlainObject(data.sourceIdentities)) return fail("baseline sourceIdentities must be an object");
  for (const key of ["original", "candidate", "baseline"]) {
    if (!textOk(data.sourceIdentities[key], 300)) {
      return fail(`baseline sourceIdentities.${key} must be a bounded non-empty string`);
    }
  }
  if (!Array.isArray(data.limits) || data.limits.length > 20) {
    return fail("baseline limits must be a bounded array");
  }
  for (const limit of data.limits) {
    if (!textOk(limit, 500)) return fail("baseline limits must be bounded non-empty strings");
  }
  if (data.status === "PASS") {
    const counts = data.execution.counts;
    const consistent = data.execution.exitCode === 0
      && counts !== null
      && counts.tests === 6 && counts.passed === 6 && counts.failed === 0
      && counts.skipped === 0 && counts.cancelled === 0;
    if (!consistent) {
      return fail("baseline PASS is inconsistent with its execution record (needs exit 0 and 6 of 6 passed)");
    }
  }
  return OK;
}

export function validateRegression(data, { fixture = false } = {}) {
  if (!isPlainObject(data)) return fail("regression payload must be an object");
  if (data.kind !== "regression") return fail('regression kind must be "regression"');
  if (data.origin !== LOCAL_EXECUTION && !(fixture && data.origin === "FIXTURE")) return fail("regression origin must be LOCAL_EXECUTION, or FIXTURE in a fixture session");
  if (!textOk(data.runId, 200)) return fail("regression runId must be a non-empty string");
  if (!EXPORT_ID_PATTERN.test(data.exportId) || !SCENARIO_IDS.includes(data.scenarioId)) {
    return fail("regression must identify its export and prepared scenario");
  }
  if (!REGRESSION_STATUSES.includes(data.status)) {
    return fail("regression status must be RED_THEN_GREEN or INCONCLUSIVE");
  }
  if (typeof data.testSha256 !== "string" || !SHA256_PATTERN.test(data.testSha256)) {
    return fail("regression testSha256 must be 64 lowercase hex characters");
  }
  if (typeof data.sameTest !== "boolean") return fail("regression sameTest must be an explicit boolean");
  const red = validateExecutionRecord(data.red, "red run");
  if (!red.ok) return red;
  if (data.green !== null) {
    const green = validateExecutionRecord(data.green, "green run");
    if (!green.ok) return green;
  }
  if (!isPlainObject(data.correction)) return fail("regression correction must be an object");
  if (data.correction.kind !== "PRE_REVIEWED_FIXED") {
    return fail("regression correction kind must be PRE_REVIEWED_FIXED");
  }
  if (!textOk(data.correction.label, 300)) {
    return fail("regression correction label must be a bounded non-empty string");
  }
  for (const key of ["faultySha256", "correctedSha256"]) {
    const value = data.correction[key];
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      return fail(`regression correction.${key} must be 64 lowercase hex characters`);
    }
  }
  if (!isPlainObject(data.cleanup) || typeof data.cleanup.ownedCopiesRemoved !== "boolean") {
    return fail("regression cleanup.ownedCopiesRemoved must be an explicit boolean");
  }
  if (!Array.isArray(data.limits) || data.limits.length > 20) {
    return fail("regression limits must be a bounded array");
  }
  for (const limit of data.limits) {
    if (!textOk(limit, 500)) return fail("regression limits must be bounded non-empty strings");
  }
  if (data.status === "RED_THEN_GREEN" && (data.sameTest !== true || data.green === null)) {
    return fail("RED_THEN_GREEN requires sameTest true and a green run record");
  }
  return OK;
}

/*
 * Control: the same accepted baskets executed against the fixed
 * pre-reviewed correct implementation B. A control is a bounded check on
 * those baskets, never whole-PR approval or a model-generated repair.
 */
export function validateControl(data, { fixture = false } = {}) {
  if (!isPlainObject(data)) return fail("control payload must be an object");
  if (!validScenario(data)) return fail("control scenarioId must identify its prepared scenario");
  if (data.kind !== "control") return fail('control kind must be "control"');
  if (data.origin !== LOCAL_EXECUTION && !(fixture && data.origin === "FIXTURE")) return fail("control origin must be LOCAL_EXECUTION, or FIXTURE in a fixture session");
  if (!textOk(data.controlId, 200)) return fail("control controlId must be a non-empty string");
  if (!textOk(data.runId, 200)) return fail("control runId must be a non-empty string");
  if (!textOk(data.acceptedId, 200)) return fail("control acceptedId must be a non-empty string");
  if (!COMPARISON_STATUSES.includes(data.status)) {
    return fail("control status must be REPRODUCED, NO_COUNTEREXAMPLE or INCONCLUSIVE");
  }
  const rows = validateComparisonRows(data.rows);
  if (!rows.ok) return rows;
  const expectedStatus = data.rows.some((r) => r.original.error || r.candidate.error
    || r.original.value !== r.expectedTotal) ? "INCONCLUSIVE"
    : data.rows.some((r) => r.candidate.value !== r.expectedTotal) ? "REPRODUCED" : "NO_COUNTEREXAMPLE";
  if (data.status !== expectedStatus) return fail("control status and actual rows do not match");
  if (!isPlainObject(data.sourceIdentities)) return fail("control sourceIdentities must be an object");
  for (const key of ["original", "candidate", "acceptedCases"]) {
    if (typeof data.sourceIdentities[key] !== "string" || !SHA256_PATTERN.test(data.sourceIdentities[key])) {
      return fail(`control sourceIdentities.${key} must be lowercase SHA-256`);
    }
  }
  if (!Array.isArray(data.limits) || data.limits.length > 20) {
    return fail("control limits must be a bounded array");
  }
  for (const limit of data.limits) {
    if (!textOk(limit, 500)) return fail("control limits must be bounded non-empty strings");
  }
  return OK;
}

/*
 * Feedback: one bounded model interpretation of verified outputs. The
 * explanation is labelled model text, not authority or proof. A follow-up
 * is optional; STOPPED and INCONCLUSIVE must carry no proposal.
 */
export function validateFeedback(data) {
  if (!isPlainObject(data)) return fail("feedback payload must be an object");
  if (!validScenario(data)) return fail("feedback scenarioId must identify its prepared scenario");
  if (data.kind !== "feedback") return fail('feedback kind must be "feedback"');
  if (!ORIGINS.includes(data.origin)) return fail("feedback origin must be literal LIVE or FIXTURE");
  if (!textOk(data.feedbackId, 200)) return fail("feedback feedbackId must be a non-empty string");
  if (!textOk(data.runId, 200)) return fail("feedback runId must be a non-empty string");
  if (!textOk(data.controlId, 200)) return fail("feedback controlId must be a non-empty string");
  if (typeof data.bindingId !== "string" || !SHA256_PATTERN.test(data.bindingId)) {
    return fail("feedback bindingId must be 64 lowercase hex characters");
  }
  if (!FEEDBACK_STATUSES.includes(data.status)) {
    return fail("feedback status must be STOPPED, FOLLOW_UP_PROPOSED or INCONCLUSIVE");
  }
  if (!textOk(data.explanation, FEEDBACK_EXPLANATION_MAX)) {
    return fail(`feedback explanation must be a non-empty string of at most ${FEEDBACK_EXPLANATION_MAX} characters`);
  }
  if (data.status === "FOLLOW_UP_PROPOSED") {
    const proposal = validateProposal(data.proposal);
    if (!proposal.ok) return fail(`feedback follow-up proposal: ${proposal.error}`);
    if (data.proposal.cases.length > 2) {
      return fail("feedback follow-up must propose 1 or 2 cases");
    }
    if (data.proposal.origin !== data.origin || data.proposal.callsUsed !== data.callsUsed
      || data.proposal.scenarioId !== data.scenarioId) {
      return fail("feedback proposal provenance or usage count does not match feedback");
    }
  } else if (data.proposal !== null) {
    return fail("feedback without a follow-up must carry a null proposal");
  }
  if (!isPlainObject(data.usage)
    || !(data.usage.inputTokens === null || isIntegerIn(data.usage.inputTokens, 0, 100000000))
    || !(data.usage.outputTokens === null || isIntegerIn(data.usage.outputTokens, 0, 100000000))) {
    return fail("feedback usage must report integer token counts or null (unknown)");
  }
  if (!isIntegerIn(data.callsUsed, 0, 1000000)) {
    return fail("feedback callsUsed must be a non-negative integer");
  }
  if (!Array.isArray(data.limits) || data.limits.length > 20) {
    return fail("feedback limits must be a bounded array");
  }
  for (const limit of data.limits) {
    if (!textOk(limit, 500)) return fail("feedback limits must be bounded non-empty strings");
  }
  return OK;
}

/*
 * Retained initial evidence: stored proposal/acceptance/comparison records
 * from an earlier live run, delivered with the session. Linkage between
 * the three records is verified before any of them is displayed or used.
 */
export function validateRetainedInitial(data) {
  if (!isPlainObject(data)) return fail("retainedInitial must be an object");
  const proposal = validateProposal(data.proposal, { retainedA: true });
  if (!proposal.ok) return fail(`retained proposal: ${proposal.error}`);
  const accepted = validateAccepted(data.accepted, { retainedA: true });
  if (!accepted.ok) return fail(`retained acceptance: ${accepted.error}`);
  const comparison = validateComparison(data.comparison, { retainedA: true });
  if (!comparison.ok) return fail(`retained comparison: ${comparison.error}`);
  if (data.accepted.proposalId !== data.proposal.proposalId) {
    return fail("retained acceptance does not reference the retained proposal");
  }
  if (data.comparison.acceptedId !== data.accepted.acceptedId) {
    return fail("retained comparison does not reference the retained acceptance");
  }
  if (data.accepted.acceptedCases.length !== data.proposal.cases.length
    || !data.accepted.acceptedCases.every(
      (entry) => data.proposal.cases.some((proposed) => proposed.id === entry.caseId))) {
    return fail("retained accepted cases do not match the retained proposal cases");
  }
  if (data.comparison.rows.length !== data.accepted.acceptedCases.length) {
    return fail("retained comparison rows do not match the retained accepted cases");
  }
  for (const row of data.comparison.rows) {
    const acceptedCase = data.accepted.acceptedCases.find((entry) => entry.caseId === row.caseId);
    if (!acceptedCase || acceptedCase.expectedTotal !== row.expectedTotal) {
      return fail("retained comparison rows do not match the retained accepted cases");
    }
  }
  if (!textOk(data.recordedAt, 100)) return fail("retained recordedAt must be a bounded non-empty string");
  if (!isPlainObject(data.recordHashes)) return fail("retained recordHashes must be an object");
  for (const key of ["proposal", "accepted", "comparison"]) {
    const value = data.recordHashes[key];
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      return fail(`retained recordHashes.${key} must be 64 lowercase hex characters`);
    }
  }
  return OK;
}

function apiError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function describeError(error) {
  if (error?.code === "NO_CASES_PROPOSED") {
    return NO_CASES_MESSAGE;
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function captureAcceptanceFailure(error, submitted) {
  return { code: typeof error?.code === "string" ? error.code : null,
    submitted: submitted.map((entry) => ({ ...entry })) };
}

export function getAcceptanceFailurePresentation(failure) {
  const rejected = ["EXPECTATION_RULE_MISMATCH", "FIXTURE_EXPECTATION_MISMATCH"].includes(failure?.code);
  return {
    rejected,
    title: rejected ? "Expected total rejected" : "Acceptance not confirmed",
    boundary: "Comparison blocked",
    explanation: rejected
      ? "The backend rejected one or more submitted expected totals. This is a review-input rejection, not a new checkout-code failure."
      : "The app could not confirm acceptance. This does not establish that your totals are wrong.",
    recovery: rejected
      ? "Check the written pricing rule, edit the totals, tick the review box again, then accept."
      : "Check the connection, session and details before retrying. Reload if acceptance may already have been recorded.",
    submitted: (failure?.submitted ?? []).filter((entry) => isValidExpectedTotal(entry.expectedTotal))
      .map((entry) => `${entry.caseId}: ${formatPence(entry.expectedTotal)}`).join("; "),
  };
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

  let sessionMode = null;
  let fixtureToken = null;
  async function requestJson(path, { method, body, csrfToken }) {
    let response;
    try {
      if (method === "GET") {
        response = await fetchImpl(path, csrfToken ? { headers: { "X-Demo-Token": csrfToken } } : undefined);
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
    if (sessionMode === "LIVE" && data.origin === "FIXTURE") {
      throw apiError("invalid_shape", "fixture evidence cannot enter a live session");
    }
    return data;
  }

  return {
    async getSession() {
      const data = await requestJson(API_PATHS.session, { method: "GET", csrfToken: fixtureToken });
      ensure(validateSession(data), data);
      sessionMode = data.mode;
      fixtureToken = sessionMode === "FIXTURE" ? data.csrfToken : null;
      return data;
    },
    async baseline({ csrfToken, changeId }) {
      const data = await requestJson(API_PATHS.baseline, {
        method: "POST",
        csrfToken,
        body: { changeId },
      });
      ensure(validateBaseline(data, { fixture: sessionMode === "FIXTURE" }), data);
      if (data.changeId !== changeId) throw apiError("invalid_shape", "baseline echoed a different changeId");
      return data;
    },
    async propose({ csrfToken, changeId }) {
      const data = await requestJson(API_PATHS.propose, {
        method: "POST",
        csrfToken,
        body: { changeId },
      });
      ensure(validateProposal(data), data);
      if (data.scenarioId !== changeId) throw apiError("invalid_shape", "proposal echoed a different scenarioId");
      return data;
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
      ensure(validateExport(data, { fixture: sessionMode === "FIXTURE" }), data);
      if (data.runId !== runId) throw apiError("invalid_shape", "export echoed a different runId");
      return data;
    },
    async regression({ csrfToken, runId, exportId, scenarioId }) {
      const data = await requestJson(API_PATHS.regression, {
        method: "POST",
        csrfToken,
        body: { runId, exportId },
      });
      ensure(validateRegression(data, { fixture: sessionMode === "FIXTURE" }), data);
      if (data.runId !== runId || data.exportId !== exportId || data.scenarioId !== scenarioId) {
        throw apiError("invalid_shape", "regression echoed a different runId, exportId or scenarioId");
      }
      return data;
    },
    async control({ csrfToken, runId }) {
      const data = await requestJson(API_PATHS.control, {
        method: "POST",
        csrfToken,
        body: { runId },
      });
      ensure(validateControl(data, { fixture: sessionMode === "FIXTURE" }), data);
      if (data.runId !== runId) {
        throw apiError("invalid_shape", "control echoed a different runId");
      }
      return data;
    },
    async feedback({ csrfToken, runId, controlId }) {
      const data = await requestJson(API_PATHS.feedback, {
        method: "POST",
        csrfToken,
        body: { runId, controlId },
      });
      ensure(validateFeedback(data), data);
      if (data.runId !== runId || data.controlId !== controlId) {
        throw apiError("invalid_shape", "feedback echoed different run or control identities");
      }
      return data;
    },
  };
}

function blankErrors() {
  return {
    session: null, baseline: null, propose: null, accept: null,
    compare: null, export: null, regression: null,
    control: null, feedback: null,
    followUpAccept: null, followUpCompare: null, followUpControl: null,
  };
}

export function initialState() {
  return {
    session: null,
    selectedChangeId: "a",
    retainedSuppressed: false,
    budgetKnown: false,
    proposalPending: false,
    baseline: null,
    proposal: null,
    expectations: {},
    reviewedConfirmed: false,
    accepted: null,
    acceptanceFailure: null,
    comparison: null,
    exportResult: null,
    regression: null,
    control: null,
    feedback: null,
    feedbackAttempted: false,
    followUp: null,
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

  function resetDownstreamOfExpectations() {
    state.reviewedConfirmed = false;
    state.accepted = null;
    state.comparison = null;
    state.exportResult = null;
    state.errors.accept = null;
    state.acceptanceFailure = null;
    state.errors.compare = null;
    state.errors.export = null;
  }

  function guardBusy() {
    return state.inFlight || state.proposalPending ? { ok: false, reason: "busy" } : null;
  }

  function retainedInitial() {
    return state.selectedChangeId === "a" && !state.retainedSuppressed
      ? state.session?.retainedInitial ?? null : null;
  }

  function assertFreshRecord(record, parentKey, parentId) {
    if (record.origin === "FIXTURE" && state.session?.mode !== "FIXTURE") {
      throw apiError("invalid_shape", "fixture evidence cannot enter a live session");
    }
    if (record.scenarioId !== state.selectedChangeId) {
      throw apiError("invalid_shape", "response scenarioId differs from the selected change");
    }
    if (parentKey && record[parentKey] !== parentId) {
      throw apiError("invalid_shape", `response ${parentKey} differs from its reviewed parent`);
    }
  }

  // Root records: retained initial evidence when the session carries it,
  // otherwise the fresh records produced in this session.
  function rootAccepted() {
    const retained = retainedInitial();
    return retained ? retained.accepted : state.accepted;
  }

  function rootComparison() {
    const retained = retainedInitial();
    return retained ? retained.comparison : state.comparison;
  }

  function checkAcceptanceEcho(accepted, expectations) {
    const localIds = Object.keys(expectations);
    if (accepted.acceptedCases.length !== localIds.length) {
      return "acceptance echo mismatch: case count differs from reviewed expectations";
    }
    for (const entry of accepted.acceptedCases) {
      const local = expectations[entry.caseId];
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

  function checkComparisonEcho(comparison, acceptedCases) {
    const cases = acceptedCases;
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

  /*
   * Client-side cross-check of a claimed RED_THEN_GREEN result against the
   * context this session already holds: the exported test identity and the
   * accepted case count. The backend's claim is rejected, not repaired,
   * when the evidence does not support it.
   */
  function checkRegressionEvidence(regression) {
    if (regression.sameTest !== true) return "sameTest is not true";
    if (regression.testSha256 !== state.exportResult.sha256) {
      return "the executed test hash differs from the exported test";
    }
    const expectedTests = rootAccepted().acceptedCases.length;
    const red = regression.red;
    if (red.exitCode !== 1 || red.counts === null) return "red run did not fail with exit code 1";
    if (red.counts.tests !== expectedTests) return "red run test count differs from the accepted cases";
    if (red.counts.failed < 1) return "red run reported no failing assertion";
    if (red.counts.passed + red.counts.failed !== red.counts.tests) {
      return "red run counts do not add up";
    }
    if (red.counts.skipped !== 0 || red.counts.cancelled !== 0) {
      return "red run skipped or cancelled tests";
    }
    const green = regression.green;
    if (green === null) return "no green run record";
    if (green.exitCode !== 0 || green.counts === null) return "green run did not exit 0";
    if (green.counts.tests !== expectedTests) return "green run test count differs from the accepted cases";
    if (green.counts.failed !== 0 || green.counts.passed !== green.counts.tests) {
      return "green run did not pass every test";
    }
    if (green.counts.skipped !== 0 || green.counts.cancelled !== 0) {
      return "green run skipped or cancelled tests";
    }
    if (regression.origin !== "FIXTURE" && regression.cleanup.ownedCopiesRemoved !== true) {
      return "backend did not confirm cleanup of its owned copies";
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

    selectChange(changeId) {
      if (!state.session) return { ok: false, reason: "no_session" };
      const busy = guardBusy();
      if (busy) return busy;
      if (!state.session.changes.some((change) => change.id === changeId)) {
        return { ok: false, reason: "unknown_change" };
      }
      if (changeId === state.selectedChangeId) return { ok: true };
      const { session, budgetKnown, feedbackAttempted, epoch } = state;
      state = {
        ...initialState(), session, budgetKnown, feedbackAttempted,
        selectedChangeId: changeId, retainedSuppressed: true, epoch: epoch + 1,
      };
      notify();
      return { ok: true };
    },

    async loadSession() {
      const busy = guardBusy();
      if (busy) return busy;
      const epoch = state.epoch + 1;
      const priorFeedbackAttempted = state.feedbackAttempted;
      const priorSelectedChangeId = state.selectedChangeId;
      const priorRetainedSuppressed = state.retainedSuppressed;
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
        state.selectedChangeId = priorSelectedChangeId;
        state.retainedSuppressed = priorRetainedSuppressed;
        state.budgetKnown = true;
        state.feedbackAttempted = priorFeedbackAttempted || session.feedbackAttempted === true;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state = initialState();
        state.epoch = epoch;
        state.feedbackAttempted = priorFeedbackAttempted;
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
          || session.callsUsed < state.session.callsUsed
          || JSON.stringify(session.retainedInitial ?? null) !== JSON.stringify(state.session.retainedInitial ?? null)) {
          throw apiError("session_changed", "usage refresh changed session identity or regressed its durable count; reload required");
        }
        state.session.callsUsed = session.callsUsed;
        state.feedbackAttempted ||= session.feedbackAttempted === true;
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

    async runBaseline() {
      if (!state.session) return { ok: false, reason: "no_session" };
      if (state.proposal) return { ok: false, reason: "already_proposed" };
      const busy = guardBusy();
      if (busy) return busy;
      const epoch = state.epoch;
      state.inFlight = "baseline";
      state.errors.baseline = null;
      notify();
      try {
        const baseline = await client.baseline({
          csrfToken: state.session.csrfToken, changeId: state.selectedChangeId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        if (baseline.changeId !== state.selectedChangeId) {
          throw apiError("invalid_shape", "baseline changeId differs from the selected change");
        }
        if (baseline.origin === "FIXTURE" && state.session.mode !== "FIXTURE") {
          throw apiError("invalid_shape", "fixture baseline cannot enter a live session");
        }
        state.inFlight = null;
        state.baseline = baseline;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.baseline = null;
        state.errors.baseline = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    async propose() {
      if (!state.session) return { ok: false, reason: "not_ready" };
      if (retainedInitial()) return { ok: false, reason: "retained_initial" };
      if (!state.baseline || state.baseline.status !== "PASS"
        || state.baseline.changeId !== state.selectedChangeId) {
        return { ok: false, reason: "baseline_required" };
      }
      if (state.proposal) return { ok: false, reason: "already_proposed" };
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
        assertFreshRecord(proposal);
        if (proposal.callsUsed <= state.session.callsUsed || proposal.callsUsed > state.session.limit) {
          throw apiError("invalid_shape", "proposal did not confirm a new durable budget reservation");
        }
        state.inFlight = null;
        state.proposal = proposal;
        // A newly reserved server-issued proposal is a new root, not a retry of the prior root's feedback.
        state.feedbackAttempted = false;
        state.session.callsUsed = proposal.callsUsed;
        state.budgetKnown = true;
        state.expectations = {};
        for (const entry of proposal.cases) {
          state.expectations[entry.id] = {
            proposed: entry.expectedTotal,
            raw: penceToPoundsString(entry.expectedTotal),
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
      if (state.accepted) return { ok: false, reason: "frozen" };
      const busy = guardBusy();
      if (busy) return busy;
      const entry = state.expectations[caseId];
      if (!entry) return { ok: false, reason: "unknown_case" };
      if (typeof raw !== "string" || raw.length > 12) return { ok: false, reason: "invalid_input" };
      entry.raw = raw;
      entry.value = parsePoundsInput(raw);
      entry.edited = entry.value !== null && entry.value !== entry.proposed;
      resetDownstreamOfExpectations();
      notify();
      return { ok: true };
    },

    confirmReview(confirmed) {
      if (!state.proposal) return { ok: false, reason: "no_proposal" };
      if (state.accepted) return { ok: false, reason: "frozen" };
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
      state.acceptanceFailure = null;
      const submitted = entries.map(([caseId, entry]) => ({ caseId, expectedTotal: entry.value }));
      notify();
      try {
        const accepted = await client.accept({
          csrfToken: state.session.csrfToken,
          proposalId: state.proposal.proposalId,
          expectations: submitted,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(accepted, "proposalId", state.proposal.proposalId);
        state.inFlight = null;
        const mismatch = checkAcceptanceEcho(accepted, state.expectations);
        if (mismatch) {
          state.accepted = null;
          state.errors.accept = mismatch;
          state.acceptanceFailure = captureAcceptanceFailure({ code: "invalid_shape" }, submitted);
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
        state.acceptanceFailure = captureAcceptanceFailure(error, submitted);
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
        assertFreshRecord(comparison, "acceptedId", state.accepted.acceptedId);
        state.inFlight = null;
        const mismatch = checkComparisonEcho(comparison, state.accepted.acceptedCases);
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
      const comparison = rootComparison();
      if (!comparison) return { ok: false, reason: "no_comparison" };
      if (comparison.status !== "REPRODUCED") return { ok: false, reason: "not_reproduced" };
      if (!state.baseline || state.baseline.status !== "PASS") return { ok: false, reason: "baseline_required" };
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
          runId: comparison.runId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(exported, "runId", comparison.runId);
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

    async runRegression() {
      if (!state.exportResult) return { ok: false, reason: "not_exported" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.regression) return { ok: false, reason: "already_run" };
      const epoch = state.epoch;
      state.inFlight = "regression";
      state.errors.regression = null;
      notify();
      try {
        const regression = await client.regression({
          csrfToken: state.session.csrfToken,
          runId: rootComparison().runId,
          exportId: state.exportResult.exportId,
          scenarioId: state.exportResult.scenarioId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(regression, "runId", rootComparison().runId);
        if (regression.exportId !== state.exportResult.exportId) {
          throw apiError("invalid_shape", "regression exportId differs from the retained export");
        }
        state.inFlight = null;
        if (regression.status === "RED_THEN_GREEN") {
          const problem = checkRegressionEvidence(regression);
          if (problem) {
            state.regression = null;
            state.errors.regression =
              `The backend claimed RED_THEN_GREEN but its evidence does not prove it: ${problem}. ` +
              "Treat this run as not proven.";
            notify();
            return { ok: false, reason: "request_failed" };
          }
        }
        state.regression = regression;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.regression = null;
        state.errors.regression = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    /*
     * Control: run the root accepted baskets against the fixed pre-reviewed
     * correct implementation B. Requires a fresh baseline PASS (retained
     * sessions re-prove the baseline before any new local execution) and an
     * existing root comparison. The echoed identities and rows must match
     * the reviewed acceptance exactly, or the result is discarded.
     */
    async runControl() {
      if (!state.session) return { ok: false, reason: "no_session" };
      if (!state.baseline || state.baseline.status !== "PASS") {
        return { ok: false, reason: "baseline_required" };
      }
      const comparison = rootComparison();
      if (!comparison) return { ok: false, reason: "no_comparison" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.control) return { ok: false, reason: "already_run" };
      const epoch = state.epoch;
      state.inFlight = "control";
      state.errors.control = null;
      notify();
      try {
        const control = await client.control({
          csrfToken: state.session.csrfToken,
          runId: comparison.runId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(control, "runId", comparison.runId);
        state.inFlight = null;
        const acceptedRecord = rootAccepted();
        const mismatch = control.acceptedId !== acceptedRecord.acceptedId
          ? "control echoed a different acceptedId than the reviewed acceptance"
          : checkComparisonEcho(control, acceptedRecord.acceptedCases);
        if (mismatch) {
          state.control = null;
          state.errors.control = mismatch;
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.control = control;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.control = null;
        state.errors.control = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    /*
     * Feedback: exactly one model request per local session, consumed on
     * dispatch even when the outcome fails or stays unknown. An explicit
     * usage refresh never re-enables a consumed attempt. A follow-up
     * proposal starts its own independently reviewed expectation flow.
     */
    async requestFeedback() {
      if (!state.session) return { ok: false, reason: "no_session" };
      if (!state.control) return { ok: false, reason: "no_control" };
      if (state.feedbackAttempted) return { ok: false, reason: "already_attempted" };
      if (state.baseline?.status !== "PASS") return { ok: false, reason: "baseline_required" };
      if (state.control.status !== "NO_COUNTEREXAMPLE" || rootComparison()?.status !== "REPRODUCED") {
        return { ok: false, reason: "matching_control_required" };
      }
      const busy = guardBusy();
      if (busy) return busy;
      if (!state.budgetKnown) return { ok: false, reason: "usage_unknown" };
      if (state.session.callsUsed >= state.session.limit) return { ok: false, reason: "budget" };
      const epoch = state.epoch;
      state.feedbackAttempted = true;
      state.inFlight = "feedback";
      state.budgetKnown = false;
      state.errors.feedback = null;
      notify();
      try {
        const feedback = await client.feedback({
          csrfToken: state.session.csrfToken,
          runId: state.control.runId,
          controlId: state.control.controlId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(feedback, "runId", state.control.runId);
        if (feedback.controlId !== state.control.controlId
          || (feedback.proposal && feedback.proposal.scenarioId !== state.selectedChangeId)) {
          throw apiError("invalid_shape", "feedback differs from its selected control ancestry");
        }
        if (feedback.origin !== state.session.mode) throw apiError("invalid_shape", "feedback origin differs from session mode");
        if (feedback.callsUsed <= state.session.callsUsed || feedback.callsUsed > state.session.limit) {
          throw apiError("invalid_shape", "feedback did not confirm a new durable budget reservation");
        }
        state.inFlight = null;
        state.feedback = feedback;
        state.session.callsUsed = feedback.callsUsed;
        state.budgetKnown = true;
        if (feedback.status === "FOLLOW_UP_PROPOSED") {
          const expectations = {};
          for (const entry of feedback.proposal.cases) {
            expectations[entry.id] = {
              proposed: entry.expectedTotal,
              raw: penceToPoundsString(entry.expectedTotal),
              value: entry.expectedTotal,
              edited: false,
            };
          }
          state.followUp = {
            proposal: feedback.proposal,
            expectations,
            reviewedConfirmed: false,
            accepted: null,
            acceptanceFailure: null,
            comparison: null,
            control: null,
          };
        }
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        state.feedback = null;
        state.errors.feedback = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    setFollowUpExpectation(caseId, raw) {
      if (!state.followUp) return { ok: false, reason: "no_follow_up" };
      if (state.followUp.accepted) return { ok: false, reason: "frozen" };
      const busy = guardBusy();
      if (busy) return busy;
      const entry = state.followUp.expectations[caseId];
      if (!entry) return { ok: false, reason: "unknown_case" };
      if (typeof raw !== "string" || raw.length > 12) return { ok: false, reason: "invalid_input" };
      entry.raw = raw;
      entry.value = parsePoundsInput(raw);
      entry.edited = entry.value !== null && entry.value !== entry.proposed;
      state.followUp.reviewedConfirmed = false;
      state.errors.followUpAccept = null;
      state.followUp.acceptanceFailure = null;
      notify();
      return { ok: true };
    },

    confirmFollowUpReview(confirmed) {
      if (!state.followUp) return { ok: false, reason: "no_follow_up" };
      if (state.followUp.accepted) return { ok: false, reason: "frozen" };
      const busy = guardBusy();
      if (busy) return busy;
      state.followUp.reviewedConfirmed = confirmed === true;
      notify();
      return { ok: true };
    },

    async acceptFollowUp() {
      if (!state.followUp) return { ok: false, reason: "no_follow_up" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.followUp.accepted) return { ok: false, reason: "already_accepted" };
      if (!state.followUp.reviewedConfirmed) return { ok: false, reason: "not_reviewed" };
      const entries = Object.entries(state.followUp.expectations);
      if (entries.some(([, entry]) => !isValidExpectedTotal(entry.value))) {
        return { ok: false, reason: "invalid_expectation" };
      }
      const epoch = state.epoch;
      state.inFlight = "followup_accept";
      state.errors.followUpAccept = null;
      state.followUp.acceptanceFailure = null;
      const submitted = entries.map(([caseId, entry]) => ({ caseId, expectedTotal: entry.value }));
      notify();
      try {
        const accepted = await client.accept({
          csrfToken: state.session.csrfToken,
          proposalId: state.followUp.proposal.proposalId,
          expectations: submitted,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(accepted, "proposalId", state.followUp.proposal.proposalId);
        state.inFlight = null;
        const mismatch = checkAcceptanceEcho(accepted, state.followUp.expectations);
        if (mismatch) {
          state.followUp.accepted = null;
          state.errors.followUpAccept = mismatch;
          state.followUp.acceptanceFailure = captureAcceptanceFailure({ code: "invalid_shape" }, submitted);
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.followUp.accepted = accepted;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        if (state.followUp) {
          state.followUp.accepted = null;
          state.followUp.acceptanceFailure = captureAcceptanceFailure(error, submitted);
        }
        state.errors.followUpAccept = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    async compareFollowUp() {
      if (!state.followUp || !state.followUp.accepted) return { ok: false, reason: "not_accepted" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.followUp.comparison) return { ok: false, reason: "already_compared" };
      const epoch = state.epoch;
      state.inFlight = "followup_compare";
      state.errors.followUpCompare = null;
      notify();
      try {
        const comparison = await client.compare({
          csrfToken: state.session.csrfToken,
          acceptedId: state.followUp.accepted.acceptedId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(comparison, "acceptedId", state.followUp.accepted.acceptedId);
        state.inFlight = null;
        const mismatch = checkComparisonEcho(comparison, state.followUp.accepted.acceptedCases);
        if (mismatch) {
          state.followUp.comparison = null;
          state.errors.followUpCompare = mismatch;
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.followUp.comparison = comparison;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        if (state.followUp) state.followUp.comparison = null;
        state.errors.followUpCompare = describeError(error);
        notify();
        return { ok: false, reason: "request_failed" };
      }
    },

    // Follow-up control: the follow-up baskets against correct B. The
    // feedback attempt itself is never repeatable from here: no recursion.
    async runFollowUpControl() {
      if (!state.followUp || !state.followUp.comparison) return { ok: false, reason: "no_comparison" };
      const busy = guardBusy();
      if (busy) return busy;
      if (state.followUp.control) return { ok: false, reason: "already_run" };
      const epoch = state.epoch;
      state.inFlight = "followup_control";
      state.errors.followUpControl = null;
      notify();
      try {
        const control = await client.control({
          csrfToken: state.session.csrfToken,
          runId: state.followUp.comparison.runId,
        });
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        assertFreshRecord(control, "runId", state.followUp.comparison.runId);
        state.inFlight = null;
        const mismatch = control.acceptedId !== state.followUp.accepted.acceptedId
          ? "control echoed a different acceptedId than the reviewed acceptance"
          : checkComparisonEcho(control, state.followUp.accepted.acceptedCases);
        if (mismatch) {
          state.followUp.control = null;
          state.errors.followUpControl = mismatch;
          notify();
          return { ok: false, reason: "request_failed" };
        }
        state.followUp.control = control;
        notify();
        return { ok: true };
      } catch (error) {
        if (state.epoch !== epoch) return { ok: false, reason: "stale" };
        state.inFlight = null;
        if (state.followUp) state.followUp.control = null;
        state.errors.followUpControl = describeError(error);
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

function setAcceptanceStatus(node, text, tone) {
  node.setAttribute("role", tone === "error" ? "alert" : "status");
  node.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  node.setAttribute("aria-atomic", "true");
  setStatus(node, text, tone);
}

function renderAcceptanceFailure(node, failure, detail) {
  const view = getAcceptanceFailurePresentation(failure);
  setAcceptanceStatus(node, "", "error");
  node.classList.add("acceptance-rejection");
  node.append(
    el("strong", { class: "rejection-title" }, view.title),
    el("strong", { class: "rejection-blocked" }, view.boundary),
    el("span", {}, view.explanation),
    ...(view.submitted ? [el("span", { class: "rejection-submitted" }, `Submitted expected totals: ${view.submitted}`)] : []),
    el("span", { class: "rejection-recovery" }, view.recovery),
    el("span", { class: "rejection-detail mono" }, `Details: ${detail}`),
  );
}

function acceptedCasesList(accepted) {
  const list = el("ul", { class: "accepted-list" });
  for (const entry of accepted.acceptedCases) {
    const corrected = entry.expectationOrigin === "REVIEWER_CORRECTED";
    list.append(el("li", { class: "accepted-case" },
      el("span", { class: "accepted-basket mono" }, describeLines(entry.lines)),
      el("span", { class: "accepted-total-label" }, "Accepted expected total"),
      el("strong", { class: "accepted-total-value" }, formatPence(entry.expectedTotal)),
      el("span", { class: corrected ? "badge edited" : "badge meta" }, corrected ? "reviewer corrected"
        : accepted.origin === "FIXTURE" ? "Scripted value, reviewer accepted" : "Muse value, reviewer accepted"),
    ));
  }
  return list;
}

function renderAcceptanceSuccess(node, accepted, followUp = false) {
  setAcceptanceStatus(node, "", "good");
  node.classList.add("acceptance-success");
  node.append(
    el("strong", { class: "acceptance-title" }, followUp ? "Follow-up totals accepted" : "Expected totals accepted"),
    el("strong", { class: "acceptance-locked" }, "Locked for comparison"),
    el("span", { class: "acceptance-scope" }, accepted.origin === "FIXTURE"
      ? "Scripted totals are locked for this walkthrough. No model or pricing code was run."
      : "Reviewed expected totals are locked. Acceptance alone does not show that the checkout code is correct."),
    acceptedCasesList(accepted),
  );
}

const PENDING_ACTIONS = {
  session: ["Opening the review...", "Reading the local session. No model request is made yet.", "change"],
  baseline: ["Running baseline tests...", "Checking the existing baskets against both versions.", "change"],
  propose: ["Asking Muse...", "Looking for missing baskets. You will review the expected totals before anything runs.", "basket"],
  usage: ["Refreshing usage...", "Reading the durable request budget. This does not make a model call.", "basket"],
  accept: ["Saving your review...", "Recording the expectations you checked against the written rule.", "basket"],
  compare: ["Running comparison...", "Running the accepted baskets against the original and proposed code.", "basket"],
  control: ["Checking the correction...", "Running those same baskets against the pre-reviewed corrected version.", "basket"],
  feedback: ["Waiting for Muse's feedback...", "Muse is reviewing the verified outputs. This uses the single feedback request.", "basket"],
  followup_accept: ["Saving follow-up review...", "Recording your independently reviewed follow-up expectations.", "basket"],
  followup_compare: ["Comparing follow-up baskets...", "Running only the accepted follow-up baskets.", "basket"],
  followup_control: ["Checking the follow-up control...", "Running the accepted follow-up baskets against the fixed correction.", "basket"],
  export: ["Keeping the regression test...", "Persisting the test on the local backend. Nothing is executed in this browser.", "test"],
  regression: ["Proving red, then green...", "Running identical exported test bytes against the faulty code and the pre-reviewed correction.", "test"],
};

const FIXTURE_ACTION_LABELS = {
  "baseline-button": "Show scripted baseline", "propose-button": "Load scripted baskets",
  "compare-button": "Show scripted charges", "control-button": "Show scripted correction",
  "feedback-button": "Load scripted feedback", "export-button": "Prepare inert sample",
  "regression-button": "Show scripted red → green",
  "followup-compare-button": "Show scripted follow-up charges", "followup-control-button": "Show scripted follow-up correction",
};

export function getPendingPresentation(operation, slow = false, fixture = false) {
  const action = Object.hasOwn(PENDING_ACTIONS, operation) ? PENDING_ACTIONS[operation] : null;
  if (!action) return null;
  const [label, detail, step] = action;
  if (fixture) return { label: "Loading fixture...", detail: "Scripted preview only. No model calls or code execution.", step };
  const model = operation === "propose" || operation === "feedback";
  return {
    label,
    detail: slow
      ? `${model ? "Still waiting for Muse" : "Still waiting for the local backend"}. No automatic retry is being made. Keep this page open. ${detail}`
      : detail,
    step,
  };
}

export function presentPendingButton(button, presentation, idleLabel) {
  button.textContent = presentation?.label ?? idleLabel;
  button.setAttribute("aria-busy", presentation ? "true" : "false");
  // Only the existing render guards may re-enable an action.
  if (presentation) button.disabled = true;
}

export function getSessionUsageText(state) {
  if (state.session?.mode === "FIXTURE") {
    return `Fixture preview · ${state.session.callsUsed} of ${state.session.limit} scripted turns · no model calls; live budget unchanged`;
  }
  if (state.inFlight === "propose" || state.inFlight === "feedback") {
    return "Muse is working; request usage updates when it finishes.";
  }
  if (state.inFlight === "usage") return "Refreshing request usage; no model call is made.";
  const { callsUsed, limit } = state.session;
  return state.budgetKnown
    ? `${callsUsed} of ${limit} model requests used (last confirmed)`
    : "Model usage unknown or pending; refresh before another request";
}

export function getBaselineButtonPresentation(state) {
  return {
    hidden: state.baseline?.status === "PASS",
    label: state.errors.baseline || ["FAIL", "INCONCLUSIVE"].includes(state.baseline?.status)
      ? "Try again" : "Run baseline tests",
  };
}

function describeLines(lines) {
  return lines
    .map((line) => `${formatPence(line.amount)} ${line.discountEligible ? "eligible" : "not eligible"}`)
    .join(" + ");
}

function chargeTone(candidateValue, expectedTotal) {
  if (!isValidExpectedTotal(candidateValue)) return "warn";
  if (candidateValue > expectedTotal) return "bad";
  if (candidateValue < expectedTotal) return "warn";
  return "good";
}

/*
 * Shared execution-result table for comparison, retained comparison and
 * correct-B control records. The observed customer overcharge or shop
 * undercharge is the lead of each row; everything is plain text.
 */
function comparisonTable(record, acceptedCases, candidateHeading) {
  const table = el("table", { class: "compare-table" },
    el("thead", {},
      el("tr", {},
        el("th", {}, "Basket"),
        el("th", {}, "Expected (rule)"),
        el("th", {}, "Original"),
        el("th", {}, candidateHeading),
      ),
    ),
  );
  const tbody = el("tbody", {});
  for (const row of record.rows) {
    const acceptedCase = acceptedCases.find((entry) => entry.caseId === row.caseId);
    const cell = (outcome) => {
      if (outcome.error !== null) {
        return el("td", { class: "bad" }, `error: ${outcome.error}`);
      }
      const matches = outcome.value === row.expectedTotal;
      return el("td", { class: matches ? "good" : "bad" },
        `${formatPence(outcome.value)}${matches ? " ✓" : " ✗"}`);
    };
    const chargeText = row.candidate.error !== null
      ? "Charge comparison unavailable."
      : describeChargeDifference(row.candidate.value, row.expectedTotal);
    const tone = row.candidate.error !== null
      ? "warn"
      : chargeTone(row.candidate.value, row.expectedTotal);
    tbody.append(
      el("tr", {},
        el("td", {},
          el("span", { class: "mono" }, acceptedCase ? describeLines(acceptedCase.lines) : row.caseId),
          el("p", { class: "charge-line" }, el("strong", { class: tone }, chargeText)),
        ),
        el("td", {}, formatPence(row.expectedTotal)),
        cell(row.original),
        cell(row.candidate),
      ),
    );
  }
  table.append(tbody);
  return table;
}

function faultEvidenceCard(evidence, origin, retained = false) {
  const title = evidence.absentFromBaseline
    ? "The old tests passed. This basket exposed a wrong charge."
    : "Execution caught an incorrect charge.";
  const coverage = evidence.absentFromBaseline
    ? "This basket was not among the three baseline examples. All six baseline checks passed on these same source versions."
    : evidence.baselineLinked
      ? "This basket also appears in the baseline examples. Review the conflicting evidence before claiming the baseline missed it."
      : "The baseline has not been linked to these source versions. This result alone does not show what the old tests missed.";
  const after = evidence.after === null
    ? evidence.controlAttempted ? "Not established" : "Not checked yet"
    : formatPence(evidence.after);
  return el("section", { class: "fault-evidence", "aria-label": "Where the fault was caught" },
    el("p", { class: "section-label" }, `${retained ? "RETAINED " : ""}${origin} · ${origin === "FIXTURE" ? "SCRIPTED COMPARISON" : "EXECUTED COMPARISON"}`),
    el("h3", { class: "fault-title" }, title),
    el("p", { class: "mono" }, describeLines(evidence.lines)),
    el("dl", { class: "fault-amounts" },
      el("div", {}, el("dt", {}, "Expected by the rule"), el("dd", {}, formatPence(evidence.expected))),
      el("div", {}, el("dt", {}, "Before · proposed code"), el("dd", { class: "bad" }, formatPence(evidence.before))),
      el("div", {}, el("dt", {}, "After · pre-reviewed correction"),
        el("dd", { class: evidence.after === null ? "" : evidence.after === evidence.expected ? "good" : "bad" }, after)),
    ),
    el("p", { class: "fault-impact" }, evidence.impact),
    el("p", {}, coverage),
    el("p", { class: "fineprint" },
      "The original code matched the reviewed expectation. The proposed code did not. "
      + (evidence.after === null
        ? "Run the corrected-version control to establish the after result."
        : evidence.after === evidence.expected
          ? "The pre-reviewed correction matched it on this basket; this is not a Muse-generated repair."
          : "The pre-reviewed correction still differs on this basket; the correction is not established.")),
    retained ? el("p", { class: "fineprint" },
      "The before result is retained evidence, not a fresh execution or a new model discovery.") : "",
  );
}

function startBrowserApp() {
  const client = createApiClient({
    fetchImpl: (...args) => window.fetch(...args),
    randomId: () => crypto.randomUUID(),
  });
  const store = createStore({ client });

  const byId = (id) => document.getElementById(id);
  const nodes = {
    fixtureBanner: byId("fixture-banner"),
    modeBadge: byId("mode-badge"),
    sessionMeta: byId("session-meta"),
    sessionError: byId("session-error"),
    changeSelector: byId("change-selector"),
    prTitle: byId("pr-title"),
    changeContext: byId("change-context"),
    changePanel: byId("change-panel"),
    baselineButton: byId("baseline-button"),
    baselineStatus: byId("baseline-status"),
    baselinePanel: byId("baseline-panel"),
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
    regressionButton: byId("regression-button"),
    regressionStatus: byId("regression-status"),
    regressionPanel: byId("regression-panel"),
    retainedBanner: byId("retained-banner"),
    retainedPanel: byId("retained-panel"),
    controlButton: byId("control-button"),
    controlStatus: byId("control-status"),
    controlPanel: byId("control-panel"),
    feedbackButton: byId("feedback-button"),
    feedbackStatus: byId("feedback-status"),
    feedbackPanel: byId("feedback-panel"),
    followupSection: byId("followup-section"),
    followupRows: byId("followup-rows"),
    followupReviewedCheckbox: byId("followup-reviewed-checkbox"),
    followupAcceptButton: byId("followup-accept-button"),
    followupAcceptStatus: byId("followup-accept-status"),
    followupAcceptedPanel: byId("followup-accepted-panel"),
    followupCompareButton: byId("followup-compare-button"),
    followupCompareStatus: byId("followup-compare-status"),
    followupComparePanel: byId("followup-compare-panel"),
    followupControlButton: byId("followup-control-button"),
    followupControlStatus: byId("followup-control-status"),
    followupControlPanel: byId("followup-control-panel"),
    expectationsSection: byId("expectations-section"),
    verificationSection: byId("verification-section"),
    activity: byId("activity"),
    activityLabel: byId("activity-label"),
    activityDetail: byId("activity-detail"),
  };

  const actionButtons = [
    [nodes.baselineButton, ["baseline"]],
    [nodes.proposeButton, ["propose", "usage"]],
    [nodes.acceptButton, ["accept"]],
    [nodes.compareButton, ["compare"]],
    [nodes.controlButton, ["control"]],
    [nodes.feedbackButton, ["feedback", "usage"]],
    [nodes.followupAcceptButton, ["followup_accept"]],
    [nodes.followupCompareButton, ["followup_compare"]],
    [nodes.followupControlButton, ["followup_control"]],
    [nodes.exportButton, ["export"]],
    [nodes.regressionButton, ["regression"]],
  ].map(([button, operations]) => ({ button, operations, idleLabel: button.textContent }));
  let activityKey = null;
  let patienceTimer = null;
  let slowOperation = false;

  let renderedSessionToken = null;
  let renderedProposalId = null;
  let renderedRetainedToken = null;
  let renderedFollowUpId = null;

  function renderSession(state) {
    nodes.fixtureBanner.hidden = state.session?.mode !== "FIXTURE";
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
    const { mode, deadline } = state.session;
    nodes.modeBadge.textContent = mode;
    nodes.modeBadge.className = mode === "LIVE" ? "badge live" : "badge fixture";
    nodes.sessionMeta.textContent = getSessionUsageText(state);
    nodes.sessionMeta.title = `Session deadline ${deadline}`;
    nodes.sessionError.hidden = true;
  }

  function describeCounts(counts) {
    if (counts === null) return "no test counts reported";
    return `${counts.tests} tests · ${counts.passed} passed · ${counts.failed} failed`
      + ` · ${counts.skipped} skipped · ${counts.cancelled} cancelled`;
  }

  function executionEvidence(label, record) {
    return el("details", {},
      el("summary", {}, `${label}: raw execution log`),
      el("p", { class: "mono fineprint" },
        `exit ${record.exitCode === null ? "unknown" : record.exitCode} · ${describeCounts(record.counts)}`),
      el("pre", { class: "log" }, record.stdout || "(empty stdout)"),
      el("pre", { class: "log" }, record.stderr || "(empty stderr)"),
    );
  }

  function renderChange(state) {
    nodes.changeSelector.disabled = !state.session || Boolean(state.inFlight) || state.proposalPending;
    const token = state.session ? `${state.session.csrfToken}:${state.selectedChangeId}` : null;
    if (token === renderedSessionToken) return;
    renderedSessionToken = token;
    clear(nodes.changeSelector);
    clear(nodes.changePanel);
    const change = getSelectedChange(state);
    nodes.prTitle.textContent = change?.title ?? "";
    nodes.changeContext.textContent = change?.id === "a"
      ? "Changes how eligible-item subtotals, the 10% discount and the £5 voucher are combined into the final charge."
      : change?.id === "c"
        ? "Replaces separate passes over eligible and full-price items with a single loop that accumulates both totals."
        : "";
    if (!state.session) return;
    for (const entry of state.session.changes) {
      nodes.changeSelector.append(el("option", { value: entry.id }, entry.title));
    }
    nodes.changeSelector.value = state.selectedChangeId;
    if (!change) return;
    const coverage = state.session.baselineCoverage;
    const coverageList = el("ul", { class: "coverage-list" });
    for (const entry of coverage.cases) {
      coverageList.append(
        el("li", {},
          el("span", {}, `${entry.title}: `),
          el("span", { class: "mono" }, describeLines(entry.lines)),
          el("span", {}, ` → expected ${formatPence(entry.expectedTotal)}`),
        ),
      );
    }
    nodes.changePanel.append(
      el("details", {},
        el("summary", {}, "View proposed code changes (read-only)"),
        el("pre", { class: "diff" }, change.diff),
      ),
      el("details", {},
        el("summary", {}, "Full rule and input units"),
        el("p", { class: "rule-text" }, change.rule.text),
        el("p", {}, "Raw code and tests use pence: 10000 = £100."),
        el("p", { class: "rule-domain" }, `Input domain: ${change.rule.domain}`),
      ),
      el("details", {},
        el("summary", {}, "Baseline coverage: three baskets × two versions"),
        coverageList,
        el("p", { class: "fineprint" },
          "Three ordinary baskets × two versions: six checks. No voucher-boundary coverage; these are not failing witnesses."),
      ),
      el("details", {},
        el("summary", {}, "Evidence: source identities"),
        el("dl", { class: "identities" },
          el("dt", {}, "original sha256"),
          el("dd", { class: "mono" }, change.originalSha256),
          el("dt", {}, "candidate sha256"),
          el("dd", { class: "mono" }, change.candidateSha256),
          el("dt", {}, "session deadline"),
          el("dd", { class: "mono" }, state.session.deadline),
        ),
      ),
    );
  }

  function renderBaseline(state) {
    nodes.baselineButton.hidden = getBaselineButtonPresentation(state).hidden;
    nodes.baselineButton.disabled =
      !state.session || Boolean(state.inFlight) || Boolean(state.proposal)
      || (state.baseline !== null && state.baseline.status === "PASS");
    const executionSummary = state.baseline
      ? `origin ${state.baseline.origin} · exit ${state.baseline.execution.exitCode === null ? "unknown" : state.baseline.execution.exitCode}`
        + ` · ${describeCounts(state.baseline.execution.counts)}`
      : "";
    if (state.inFlight === "baseline") {
      setStatus(nodes.baselineStatus, state.session?.mode === "FIXTURE"
        ? "Loading scripted baseline counts. No tests are run." : "Running the six baseline assertions against both versions…", "pending");
    } else if (state.errors.baseline) {
      setStatus(nodes.baselineStatus, `Baseline run failed: ${state.errors.baseline}`, "error");
    } else if (state.baseline) {
      const counts = state.baseline.execution.counts;
      if (state.baseline.status === "PASS") {
        setStatus(nodes.baselineStatus, "", "good");
        nodes.baselineStatus.append(
          el("strong", { class: "baseline-verdict" }, state.baseline.origin === "FIXTURE" ? "Scripted baseline PASS" : "Baseline PASS"),
          el("span", { class: "baseline-score" }, `${counts.passed} of ${counts.tests} assertions passed`),
          el("span", { class: "baseline-scope" },
            state.baseline.origin === "FIXTURE"
              ? "Scripted counts for visual review only. No tests or pricing code were executed."
              : "Original and candidate. Existing baseline cases only. A green baseline does not prove every charge is correct."),
          el("span", { class: "baseline-evidence mono" }, executionSummary),
        );
      } else if (state.baseline.status === "FAIL") {
        setStatus(nodes.baselineStatus,
          "Baseline FAIL — the existing assertions already disagree. Fix that before asking Muse.", "bad");
      } else {
        setStatus(nodes.baselineStatus,
          "Baseline INCONCLUSIVE — the run did not produce a usable verdict. This is not a pass.", "warn");
      }
    } else {
      setStatus(nodes.baselineStatus, "Not run yet. Nothing here is assumed green.", null);
    }
    clear(nodes.baselinePanel);
    if (!state.baseline) return;
    const identities = el("dl", { class: "identities" });
    for (const key of ["original", "candidate", "baseline"]) {
      identities.append(el("dt", {}, `${key} identity`),
        el("dd", { class: "mono" }, state.baseline.sourceIdentities[key]));
    }
    const limits = el("ul", { class: "limits" });
    for (const limit of state.baseline.limits) limits.append(el("li", {}, limit));
    if (state.baseline.status !== "PASS") {
      nodes.baselinePanel.append(el("p", { class: "mono" }, executionSummary));
    }
    nodes.baselinePanel.append(
      el("details", {},
        el("summary", {}, "Baseline test details"),
        el("h3", {}, "Standard output"),
        el("pre", { class: "log" }, state.baseline.execution.stdout || "(empty stdout)"),
        el("h3", {}, "Standard error"),
        el("pre", { class: "log" }, state.baseline.execution.stderr || "(empty stderr)"),
        el("h3", {}, "Source identities"),
        identities,
        el("h3", {}, "Scope and limits"),
        limits,
      ),
    );
  }

  function retainedOf(state) {
    return state.selectedChangeId === "a" && !state.retainedSuppressed
      ? state.session?.retainedInitial ?? null : null;
  }

  function renderProposal(state) {
    const baselinePassed = state.baseline !== null && state.baseline.status === "PASS";
    const retained = retainedOf(state);
    nodes.proposeButton.disabled =
      !state.session || !baselinePassed || Boolean(state.inFlight)
      || state.proposalPending
      || Boolean(state.proposal)
      || Boolean(retained)
      || (state.budgetKnown && state.session && state.session.callsUsed >= state.session.limit);
    nodes.proposeButton.textContent = state.budgetKnown ? "Ask Muse for breaking baskets" : "Refresh usage (no model call)";
    if (retained) {
      setStatus(nodes.proposeStatus,
        "This session carries retained initial evidence; the initial proposal is not requested again.", null);
      clear(nodes.proposalPanel);
      return;
    }
    if (state.inFlight === "propose") {
      setStatus(nodes.proposeStatus, state.session?.mode === "FIXTURE"
        ? "Loading authored baskets. No model request is made." : "Asking Muse for baskets that could break this change…", "pending");
    } else if (state.inFlight === "usage") {
      setStatus(nodes.proposeStatus, state.session?.mode === "FIXTURE"
        ? "Reading the fixture walkthrough state; the live budget is untouched." : "Reading the durable budget; no model call…", "pending");
    } else if (state.errors.propose) {
      if (state.errors.propose === NO_CASES_MESSAGE) {
        setStatus(nodes.proposeStatus, state.errors.propose, "warn");
      } else {
        setStatus(nodes.proposeStatus, `Proposal failed and was not retried: ${state.errors.propose}`, "error");
      }
    } else if (state.proposal) {
      setStatus(nodes.proposeStatus, "", "good");
      nodes.proposeStatus.append(
        el("strong", { class: "proposal-title" }, `${state.proposal.origin} proposal`),
        el("span", { class: "proposal-model" }, `From ${state.proposal.model}`),
        el("span", { class: "proposal-usage mono" },
          `${formatTokenUsage(state.proposal.usage.inputTokens)} in / ${formatTokenUsage(state.proposal.usage.outputTokens)} out tokens`),
        el("span", { class: "proposal-scope" }, state.proposal.origin === "FIXTURE"
          ? "Authored fixture cases, not model discoveries. Review the scripted expected totals to continue."
          : "Suggested test cases. Review the expected totals before accepting."),
      );
    } else if (state.session && !state.budgetKnown) {
      setStatus(nodes.proposeStatus, "A prior call may have consumed budget. Refresh usage before another model request.", "warn");
    } else if (state.session && state.session.callsUsed >= state.session.limit) {
      setStatus(nodes.proposeStatus, "The model call budget for this session is used up.", "warn");
    } else if (state.session && !baselinePassed) {
      setStatus(nodes.proposeStatus, "Muse is only asked after the baseline actually passes.", null);
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
          el("p", { class: "case-expected" },
            el("span", { class: "case-expected-label" }, "Proposed expected total"),
            el("strong", { class: "case-expected-value" }, formatPence(entry.expectedTotal))),
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
            inputmode: "decimal",
            autocomplete: "off",
            maxlength: "8",
            value: state.expectations[entry.id].raw,
          });
          input.addEventListener("input", () => {
            store.setExpectation(entry.id, input.value);
          });
          nodes.expectationRows.append(
            el("div", { class: "exp-row" },
              el("label", { for: `exp-${entry.id}` },
                `Expected total in pounds for ${describeLines(entry.lines)}`),
              el("div", { class: "expectation-control" },
                el("div", { class: "money-field" },
                  el("span", { class: "currency-prefix", "aria-hidden": "true" }, "£"), input),
                el("span", { class: "badge edited", hidden: true, "data-role": "edited" }, "Edited, not verified"),
              ),
              el("span", { class: "hint", hidden: true, "data-role": "hint" },
                "Enter pounds with at most two decimals, between £0.00 and £4000.00."),
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
      row.querySelector('[data-role="edited"]').hidden = !entry.edited || Boolean(state.accepted);
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
      setAcceptanceStatus(nodes.acceptStatus, "Recording the reviewed expectations…", "pending");
    } else if (state.errors.accept) {
      renderAcceptanceFailure(nodes.acceptStatus, state.acceptanceFailure, state.errors.accept);
    } else if (state.accepted) {
      renderAcceptanceSuccess(nodes.acceptStatus, state.accepted);
    } else {
      setAcceptanceStatus(nodes.acceptStatus, "", null);
    }
    clear(nodes.acceptedPanel);
    if (!state.accepted) return;
    nodes.acceptStatus.append(
      el("p", { class: "fineprint" },
        "Acceptance records the reviewer's declaration in this session. " +
        "A reviewer declaration is an operator decision, not an attestation of any human's identity."),
    );
  }

  function renderComparison(state) {
    const evidence = state.comparison && state.accepted
      ? getFaultEvidence(state.comparison, state.accepted.acceptedCases, state.baseline, state.control) : null;
    nodes.compareButton.disabled =
      !state.accepted || Boolean(state.inFlight) || Boolean(state.comparison);
    if (state.inFlight === "compare") {
      setStatus(nodes.compareStatus, state.session?.mode === "FIXTURE"
        ? "Loading scripted before/after charges. No pricing code is run." : "Comparing original and candidate on the backend…", "pending");
    } else if (state.errors.compare) {
      setStatus(nodes.compareStatus,
        `Comparison failed — treat the result as inconclusive: ${state.errors.compare}`, "error");
    } else if (state.comparison) {
      const status = state.comparison.status;
      if (status === "REPRODUCED" && evidence) {
        setStatus(nodes.compareStatus,
          state.comparison.origin === "FIXTURE"
            ? "REPRODUCED — scripted fixture shows an incorrect charge. No pricing code was executed."
            : "REPRODUCED — execution exposed an incorrect charge on a reviewed basket.", "bad");
      } else if (status === "NO_COUNTEREXAMPLE") {
        setStatus(nodes.compareStatus,
          "NO_COUNTEREXAMPLE — these baskets did not expose an incorrect charge. That is not proof the change is correct.", "warn");
      } else {
        setStatus(nodes.compareStatus,
          "INCONCLUSIVE — the available results do not establish a reliable pricing fault.", "warn");
      }
    } else {
      setStatus(nodes.compareStatus, "", null);
    }
    clear(nodes.comparisonPanel);
    if (!state.comparison) return;
    const table = comparisonTable(state.comparison, state.accepted.acceptedCases, "Candidate");
    const identities = el("dl", { class: "identities" });
    for (const [key, value] of Object.entries(state.comparison.sourceIdentities)) {
      identities.append(el("dt", {}, key), el("dd", { class: "mono" }, value));
    }
    const limits = el("ul", { class: "limits" });
    for (const limit of state.comparison.limits) {
      limits.append(el("li", {}, limit));
    }
    nodes.comparisonPanel.append(
      el("p", { class: "fineprint" },
        `origin ${state.comparison.origin} · run ${state.comparison.runId} · ` +
        "expectations came from the rule, not from the original implementation"),
      ...(evidence ? [faultEvidenceCard(evidence, state.comparison.origin)] : []),
      table,
      el("details", {},
        el("summary", {}, "Evidence: source identities and limits"),
        identities,
        limits,
      ),
    );
  }

  function renderExport(state) {
    const comparison = retainedOf(state)?.comparison ?? state.comparison;
    const reproduced = comparison !== null && comparison.status === "REPRODUCED";
    nodes.exportButton.disabled =
      !reproduced || state.baseline?.status !== "PASS" || Boolean(state.inFlight) || Boolean(state.exportResult);
    if (state.inFlight === "export") {
      setStatus(nodes.exportStatus, state.session?.mode === "FIXTURE"
        ? "Preparing an inert sample in preview memory only." : "Asking the backend to persist the regression test…", "pending");
    } else if (state.errors.export) {
      setStatus(nodes.exportStatus, `Export failed: ${state.errors.export}`, "error");
    } else if (state.exportResult) {
      setStatus(nodes.exportStatus, state.exportResult.origin === "FIXTURE"
        ? "Inert fixture sample ready. Nothing was persisted or executed."
        : "Regression test persisted by the server. Shown as text; never executed here.", "good");
    } else if (comparison && !reproduced) {
      setStatus(nodes.exportStatus,
        "Only a REPRODUCED counterexample is worth keeping as a regression test.", null);
    } else {
      setStatus(nodes.exportStatus, "", null);
    }
    clear(nodes.exportPanel);
    if (!state.exportResult) return;
    const exported = state.exportResult;
    const download = el("button", { type: "button", class: "download" },
      exported.origin === "FIXTURE" ? "Download inert fixture sample" : `Download ${exported.filename}`);
    download.addEventListener("click", () => {
      const blob = new Blob([exported.testSource], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = el("a", { href: url, download: exported.filename });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    if (exported.origin === "FIXTURE") {
      nodes.exportPanel.append(
        el("p", {}, "This is an inert sample held in preview memory, not a persisted or executable regression test. Downloading it does not run anything."),
        el("p", { class: "fineprint mono" }, `sha256 ${exported.sha256} · FIXTURE`),
        download,
        el("details", {}, el("summary", {}, "Inert sample contents"), el("pre", { class: "test-source" }, exported.testSource)),
      );
      return;
    }
    nodes.exportPanel.append(
      el("p", {},
        `The server persisted this test at ${exported.path}. ` +
        `The app stages these identical bytes in its owned verification copies and runs "${exported.command}" there. ` +
        `The download below is an optional local copy only.`),
      el("p", { class: "fineprint mono" }, `sha256 ${exported.sha256} · origin ${exported.origin}`),
      download,
      el("details", {},
        el("summary", {}, "Test source (text only)"),
        el("pre", { class: "test-source" }, exported.testSource),
      ),
    );
  }

  function renderRegression(state) {
    nodes.regressionButton.disabled =
      !state.exportResult || Boolean(state.inFlight) || Boolean(state.regression);
    if (state.inFlight === "regression") {
      setStatus(nodes.regressionStatus,
        state.session?.mode === "FIXTURE" ? "Loading scripted red/green counts. No regression test is executed."
          : "Running the same exported test against the faulty source, then the pre-reviewed correction…", "pending");
    } else if (state.errors.regression) {
      setStatus(nodes.regressionStatus, `Regression proof failed: ${state.errors.regression}`, "error");
    } else if (state.regression) {
      if (state.regression.status === "RED_THEN_GREEN"
        && state.regression.sameTest === true && state.regression.testSha256 === state.exportResult?.sha256) {
        setStatus(nodes.regressionStatus, "", "good");
        nodes.regressionStatus.append(
          el("strong", { class: "regression-verdict" }, state.regression.origin === "FIXTURE"
            ? "Scripted example: red before, green after." : "Same test: fails before, passes after."),
          el("span", { class: "baseline-scope" },
            state.regression.origin === "FIXTURE" ? "Fixture outcomes only. No regression test or correction was executed."
              : "RED then GREEN — the same test failed on the faulty source and passed on the pre-reviewed correction. "
                + "This is the regression test to keep, not whole-project approval."),
        );
      } else {
        setStatus(nodes.regressionStatus,
          "INCONCLUSIVE — this run did not prove the regression red-to-green. It is not green proof.", "warn");
      }
    } else if (state.exportResult) {
      setStatus(nodes.regressionStatus, "Not run yet.", null);
    } else {
      setStatus(nodes.regressionStatus, "", null);
    }
    clear(nodes.regressionPanel);
    if (!state.regression) return;
    const regression = state.regression;
    const sameHash = state.exportResult !== null && regression.testSha256 === state.exportResult.sha256;
    const limits = el("ul", { class: "limits" });
    for (const limit of regression.limits) limits.append(el("li", {}, limit));
    const rows = [
      el("p", { class: "mono" },
        `red: exit ${regression.red.exitCode === null ? "unknown" : regression.red.exitCode}`
        + ` · ${describeCounts(regression.red.counts)}`),
    ];
    if (regression.green !== null) {
      rows.push(el("p", { class: "mono" },
        `green: exit ${regression.green.exitCode === null ? "unknown" : regression.green.exitCode}`
        + ` · ${describeCounts(regression.green.counts)}`));
    }
    const evidence = el("details", {},
      el("summary", {}, "Evidence: raw logs and limits"),
      executionEvidence("Red run (faulty source)", regression.red),
    );
    if (regression.green !== null) {
      evidence.append(executionEvidence("Green run (pre-reviewed correction)", regression.green));
    }
    evidence.append(
      el("dl", { class: "identities" },
        el("dt", {}, "test sha256"),
        el("dd", { class: "mono" }, regression.testSha256),
        el("dt", {}, "faulty source sha256"),
        el("dd", { class: "mono" }, regression.correction.faultySha256),
        el("dt", {}, "corrected source sha256"),
        el("dd", { class: "mono" }, regression.correction.correctedSha256),
      ),
      limits,
    );
    nodes.regressionPanel.append(
      ...rows,
      el("p", {},
        sameHash
          ? "The test identity was unchanged between the red and green runs."
          : "Warning: the test identity could not be matched to the exported test."),
      el("p", { class: "fineprint" },
        regression.origin === "FIXTURE" ? "Scripted correction only. No source copies were created or cleaned up."
          : `Correction used: ${regression.correction.label} — a pre-reviewed prepared correction, not a Muse-generated fix. ` +
            `Owned copies cleaned up: ${regression.cleanup.ownedCopiesRemoved ? "yes" : "no"}.`),
      evidence,
    );
  }

  function renderRetained(state) {
    const retained = retainedOf(state);
    const token = retained && state.session
      ? `${state.session.csrfToken}:${state.baseline?.status}:${state.control?.controlId}` : null;
    nodes.retainedBanner.hidden = !retained;
    if (!retained) {
      nodes.retainedBanner.textContent = "";
      renderedRetainedToken = null;
      clear(nodes.retainedPanel);
      return;
    }
    nodes.retainedBanner.textContent =
      `RETAINED LIVE INITIAL EVIDENCE · recorded ${retained.recordedAt} — shown from stored records; `
      + "no new provider request was made for them. The proposal projection is derived from retained model/acceptance records.";
    if (token === renderedRetainedToken) return;
    renderedRetainedToken = token;
    clear(nodes.retainedPanel);
    const hashes = el("dl", { class: "identities" });
    for (const key of ["proposal", "accepted", "comparison"]) {
      hashes.append(el("dt", {}, `${key} projection sha256`),
        el("dd", { class: "mono" }, retained.recordHashes[key]));
    }
    const evidence = getFaultEvidence(retained.comparison, retained.accepted.acceptedCases, state.baseline, state.control);
    nodes.retainedPanel.append(
      el("p", {},
        `Retained initial result: ${retained.comparison.status} on `
        + `${retained.accepted.acceptedCases.length} reviewed basket(s), recorded ${retained.recordedAt}.`),
      ...(evidence ? [faultEvidenceCard(evidence, retained.comparison.origin, true)] : []),
      comparisonTable(retained.comparison, retained.accepted.acceptedCases, "Candidate"),
      el("p", { class: "fineprint" },
        "These are stored records from the earlier live run. Run a fresh baseline, then the "
        + "corrected-version control, before sending feedback. Nothing here is a new provider "
        + "request or a new reviewer approval."),
      el("details", {},
        el("summary", {}, "Evidence: retained record hashes"),
        hashes,
      ),
    );
  }

  function renderControl(state) {
    const retained = retainedOf(state);
    const rootComparisonRecord = retained ? retained.comparison : state.comparison;
    const rootAcceptedRecord = retained ? retained.accepted : state.accepted;
    const baselinePassed = state.baseline !== null && state.baseline.status === "PASS";
    nodes.controlButton.disabled =
      !state.session || !baselinePassed || !rootComparisonRecord
      || Boolean(state.inFlight) || Boolean(state.control);
    if (state.inFlight === "control") {
      setStatus(nodes.controlStatus,
        state.session?.mode === "FIXTURE" ? "Loading scripted correction amounts. No pricing code is run."
          : "Running the same accepted baskets against the fixed pre-reviewed correct version…", "pending");
    } else if (state.errors.control) {
      setStatus(nodes.controlStatus, `Control run failed: ${state.errors.control}`, "error");
    } else if (state.control) {
      if (state.control.status === "NO_COUNTEREXAMPLE") {
        setStatus(nodes.controlStatus,
          "Control NO_COUNTEREXAMPLE — the corrected version matched every reviewed expectation. "
          + "A control check on these baskets, not whole-PR approval.", "good");
      } else if (state.control.status === "REPRODUCED") {
        setStatus(nodes.controlStatus,
          "Control REPRODUCED — the pre-reviewed correction still misses a reviewed expectation.", "bad");
      } else {
        setStatus(nodes.controlStatus,
          "Control INCONCLUSIVE — this run established no control outcome.", "warn");
      }
    } else if (rootComparisonRecord && !baselinePassed) {
      setStatus(nodes.controlStatus,
        "Run a fresh baseline PASS before the corrected-version control.", null);
    } else {
      setStatus(nodes.controlStatus, "", null);
    }
    clear(nodes.controlPanel);
    if (!state.control || !rootAcceptedRecord) return;
    const identities = el("dl", { class: "identities" });
    for (const key of ["original", "candidate", "acceptedCases"]) {
      identities.append(el("dt", {}, `${key} identity`),
        el("dd", { class: "mono" }, state.control.sourceIdentities[key]));
    }
    const limits = el("ul", { class: "limits" });
    for (const limit of state.control.limits) limits.append(el("li", {}, limit));
    nodes.controlPanel.append(
      el("p", { class: "fineprint" },
        `origin ${state.control.origin} · control ${state.control.controlId} · `
        + "the corrected column is a fixed pre-reviewed correction, not a model-generated repair"),
      comparisonTable(state.control, rootAcceptedRecord.acceptedCases, "Corrected (pre-reviewed)"),
      el("details", {},
        el("summary", {}, "Evidence: source identities and limits"),
        identities,
        limits,
      ),
    );
  }

  function renderFeedback(state) {
    nodes.feedbackButton.textContent = state.budgetKnown
      ? "Send verified results back to Muse (one request)"
      : "Refresh usage (no model call)";
    nodes.feedbackButton.disabled =
      !state.session || !state.control || Boolean(state.inFlight) || state.proposalPending
      || state.baseline?.status !== "PASS"
      || state.control.status !== "NO_COUNTEREXAMPLE"
      || (state.budgetKnown
        && (state.feedbackAttempted || state.session.callsUsed >= state.session.limit));
    if (state.inFlight === "feedback") {
      setStatus(nodes.feedbackStatus,
        state.session?.mode === "FIXTURE" ? "Loading authored feedback. No model request is made."
          : "Sending the verified comparison and control outputs back to Muse…", "pending");
    } else if (state.inFlight === "usage") {
      setStatus(nodes.feedbackStatus, "Reading the durable budget; no model call…", "pending");
    } else if (state.errors.feedback) {
      setStatus(nodes.feedbackStatus,
        `Feedback failed and will not be retried — the single attempt is consumed: ${state.errors.feedback}`,
        "error");
    } else if (state.feedback) {
      if (state.feedback.status === "FOLLOW_UP_PROPOSED") {
        setStatus(nodes.feedbackStatus,
          state.feedback.origin === "FIXTURE"
            ? "Authored fixture follow-up baskets are ready. Review their scripted totals below; no model or code runs."
            : "Muse proposed follow-up baskets. Review their totals independently below before anything runs.", "good");
      } else if (state.feedback.status === "STOPPED") {
        setStatus(nodes.feedbackStatus,
          state.feedback.origin === "FIXTURE" ? "The authored fixture stops here. No model was called."
            : "Muse stopped here with no follow-up case. A stop is a valid outcome, not approval.", null);
      } else {
        setStatus(nodes.feedbackStatus,
          "Feedback INCONCLUSIVE — no finding was manufactured from it.", "warn");
      }
    } else if (state.feedbackAttempted) {
      setStatus(nodes.feedbackStatus,
        "The single feedback attempt was already consumed in this session.", "warn");
    } else if (state.control && !state.budgetKnown) {
      setStatus(nodes.feedbackStatus,
        "Model usage is unknown; refresh the durable budget before the one feedback request.", "warn");
    } else {
      setStatus(nodes.feedbackStatus, "", null);
    }
    clear(nodes.feedbackPanel);
    if (!state.feedback) return;
    const feedback = state.feedback;
    const limits = el("ul", { class: "limits" });
    for (const limit of feedback.limits) limits.append(el("li", {}, limit));
    nodes.feedbackPanel.append(
      el("p", { class: "fineprint" },
        `origin ${feedback.origin} · ${formatTokenUsage(feedback.usage.inputTokens)} in / `
        + `${formatTokenUsage(feedback.usage.outputTokens)} out tokens · `
        + (feedback.origin === "FIXTURE" ? "authored fixture wording, not a model interpretation or execution proof"
          : "the explanation is a model interpretation of verified outputs — not authority or proof")),
      el("blockquote", { class: "explanation" }, feedback.explanation),
      el("details", {},
        el("summary", {}, "Evidence: feedback identities and limits"),
        el("dl", { class: "identities" },
          el("dt", {}, "feedback id"),
          el("dd", { class: "mono" }, feedback.feedbackId),
          el("dt", {}, "binding id"),
          el("dd", { class: "mono" }, feedback.bindingId),
          el("dt", {}, "run / control"),
          el("dd", { class: "mono" }, `${feedback.runId} / ${feedback.controlId}`),
        ),
        limits,
      ),
    );
  }

  function renderFollowUp(state) {
    const followUp = state.followUp;
    nodes.followupSection.hidden = !followUp;
    const followUpId = followUp && state.feedback ? state.feedback.feedbackId : null;
    if (!followUp) {
      renderedFollowUpId = null;
      clear(nodes.followupRows);
      clear(nodes.followupAcceptedPanel);
      clear(nodes.followupComparePanel);
      clear(nodes.followupControlPanel);
      return;
    }
    if (followUpId !== renderedFollowUpId) {
      renderedFollowUpId = followUpId;
      clear(nodes.followupRows);
      for (const entry of followUp.proposal.cases) {
        const input = el("input", {
          type: "text",
          id: `fexp-${entry.id}`,
          inputmode: "decimal",
          autocomplete: "off",
          maxlength: "8",
          value: followUp.expectations[entry.id].raw,
        });
        input.addEventListener("input", () => {
          store.setFollowUpExpectation(entry.id, input.value);
        });
        nodes.followupRows.append(
          el("div", { class: "exp-row" },
            el("p", { class: "case-lines mono" }, describeLines(entry.lines)),
            el("p", { class: "case-rationale" }, entry.rationale),
            el("label", { for: `fexp-${entry.id}` },
              `Expected total in pounds for ${describeLines(entry.lines)}`),
            el("div", { class: "expectation-control" },
              el("div", { class: "money-field" },
                el("span", { class: "currency-prefix", "aria-hidden": "true" }, "£"), input),
              el("span", { class: "badge edited", hidden: true, "data-role": "edited" }, "Edited, not verified"),
            ),
            el("span", { class: "hint", hidden: true, "data-role": "hint" },
              "Enter pounds with at most two decimals, between £0.00 and £4000.00."),
          ),
        );
      }
    }
    for (const row of nodes.followupRows.querySelectorAll(".exp-row")) {
      const input = row.querySelector("input");
      const caseId = input.id.replace(/^fexp-/, "");
      const entry = followUp.expectations[caseId];
      if (!entry) continue;
      input.disabled = Boolean(state.inFlight) || Boolean(followUp.accepted);
      row.querySelector('[data-role="edited"]').hidden = !entry.edited || Boolean(followUp.accepted);
      row.querySelector('[data-role="hint"]').hidden = entry.value !== null;
    }
    nodes.followupReviewedCheckbox.disabled = Boolean(state.inFlight) || Boolean(followUp.accepted);
    nodes.followupReviewedCheckbox.checked = followUp.reviewedConfirmed;
    const expectationEntries = Object.values(followUp.expectations);
    nodes.followupAcceptButton.disabled =
      Boolean(state.inFlight) || Boolean(followUp.accepted)
      || !followUp.reviewedConfirmed
      || expectationEntries.some((entry) => entry.value === null);
    if (state.inFlight === "followup_accept") {
      setAcceptanceStatus(nodes.followupAcceptStatus, "Recording the reviewed follow-up expectations…", "pending");
    } else if (state.errors.followUpAccept) {
      renderAcceptanceFailure(nodes.followupAcceptStatus, followUp.acceptanceFailure, state.errors.followUpAccept);
    } else if (followUp.accepted) {
      renderAcceptanceSuccess(nodes.followupAcceptStatus, followUp.accepted, true);
    } else {
      setAcceptanceStatus(nodes.followupAcceptStatus,
        "Review these expectations against the written rule, independently of any earlier result.", null);
    }
    clear(nodes.followupAcceptedPanel);
    nodes.followupCompareButton.disabled =
      !followUp.accepted || Boolean(state.inFlight) || Boolean(followUp.comparison);
    if (state.inFlight === "followup_compare") {
      setStatus(nodes.followupCompareStatus, state.session?.mode === "FIXTURE"
        ? "Loading scripted follow-up charges. No pricing code is run." : "Comparing original and candidate on the follow-up basket…", "pending");
    } else if (state.errors.followUpCompare) {
      setStatus(nodes.followupCompareStatus,
        `Follow-up comparison failed — treat it as inconclusive: ${state.errors.followUpCompare}`, "error");
    } else if (followUp.comparison) {
      if (followUp.comparison.status === "REPRODUCED") {
        setStatus(nodes.followupCompareStatus,
          "REPRODUCED — the follow-up basket distinguishes the candidate from the reviewed expectation.", "bad");
      } else if (followUp.comparison.status === "NO_COUNTEREXAMPLE") {
        setStatus(nodes.followupCompareStatus,
          "NO_COUNTEREXAMPLE — this basket found no difference. Not proof of correctness.", "warn");
      } else {
        setStatus(nodes.followupCompareStatus,
          "INCONCLUSIVE — the backend could not establish a follow-up outcome.", "warn");
      }
    } else {
      setStatus(nodes.followupCompareStatus, "", null);
    }
    clear(nodes.followupComparePanel);
    if (followUp.comparison && followUp.accepted) {
      nodes.followupComparePanel.append(
        el("p", { class: "fineprint" },
          `origin ${followUp.comparison.origin} · run ${followUp.comparison.runId} · `
          + "the root regression run above stays unchanged"),
        comparisonTable(followUp.comparison, followUp.accepted.acceptedCases, "Candidate"),
      );
    }
    nodes.followupControlButton.disabled =
      !followUp.comparison || Boolean(state.inFlight) || Boolean(followUp.control);
    if (state.inFlight === "followup_control") {
      setStatus(nodes.followupControlStatus,
        state.session?.mode === "FIXTURE" ? "Loading scripted follow-up correction. No pricing code is run."
          : "Running the follow-up basket against the fixed pre-reviewed correct version…", "pending");
    } else if (state.errors.followUpControl) {
      setStatus(nodes.followupControlStatus,
        `Follow-up control failed: ${state.errors.followUpControl}`, "error");
    } else if (followUp.control) {
      if (followUp.control.status === "NO_COUNTEREXAMPLE") {
        setStatus(nodes.followupControlStatus,
          "Control NO_COUNTEREXAMPLE on the follow-up basket — a control check, not whole-PR approval.", "good");
      } else if (followUp.control.status === "REPRODUCED") {
        setStatus(nodes.followupControlStatus,
          "Control REPRODUCED — the pre-reviewed correction misses this expectation too.", "bad");
      } else {
        setStatus(nodes.followupControlStatus,
          "Control INCONCLUSIVE on the follow-up basket.", "warn");
      }
    } else {
      setStatus(nodes.followupControlStatus, "", null);
    }
    clear(nodes.followupControlPanel);
    if (followUp.control && followUp.accepted) {
      nodes.followupControlPanel.append(
        el("p", { class: "fineprint" },
          `origin ${followUp.control.origin} · control ${followUp.control.controlId} · `
          + "fixed pre-reviewed correction — feedback is never requested again from here"),
        comparisonTable(followUp.control, followUp.accepted.acceptedCases, "Corrected (pre-reviewed)"),
      );
    }
  }

  function render(state) {
    renderSession(state);
    renderChange(state);
    renderRetained(state);
    renderBaseline(state);
    renderProposal(state);
    renderExpectations(state);
    renderComparison(state);
    renderExport(state);
    renderRegression(state);
    renderControl(state);
    renderFeedback(state);
    renderFollowUp(state);
    renderActivity(state);
  }

  function renderActivity(state) {
    nodes.expectationsSection.hidden = !state.proposal?.cases.length;
    nodes.verificationSection.hidden = !state.accepted && !retainedOf(state);
    const key = state.inFlight ? `${state.epoch}:${state.inFlight}` : null;
    if (key !== activityKey) {
      clearTimeout(patienceTimer);
      activityKey = key;
      slowOperation = false;
      if (key) {
        patienceTimer = setTimeout(() => {
          const current = store.getState();
          if (`${current.epoch}:${current.inFlight}` !== key) return;
          slowOperation = true;
          renderActivity(current);
        }, 8000);
      }
    }
    const fixture = state.session?.mode === "FIXTURE";
    const pending = getPendingPresentation(state.inFlight, slowOperation, fixture);
    for (const { button, operations, idleLabel } of actionButtons) {
      const usageButton = button === nodes.proposeButton || button === nodes.feedbackButton;
      const label = fixture ? FIXTURE_ACTION_LABELS[button.id] ?? idleLabel
        : button === nodes.baselineButton ? getBaselineButtonPresentation(state).label : idleLabel;
      presentPendingButton(button, operations.includes(state.inFlight) ? pending : null,
        usageButton && !state.budgetKnown ? fixture ? "Refresh fixture state" : "Refresh usage (no model call)" : label);
      button.dataset.nextAction = "false";
    }
    const needsReview = (state.proposal?.cases.length && !state.accepted)
      || (state.followUp?.proposal.cases.length && !state.followUp.accepted);
    const next = actionButtons.find(({ button }) => !button.disabled && !button.closest("[hidden]"))?.button;
    const error = Object.values(state.errors).find(Boolean);
    let step = pending?.step ?? (needsReview ? "basket" : "change");
    nodes.activity.dataset.pending = pending ? "true" : "false";
    nodes.activity.dataset.error = !pending && error ? "true" : "false";
    if (pending) {
      nodes.activityLabel.textContent = pending.label;
      nodes.activityDetail.textContent = pending.detail;
    } else if (error) {
      nodes.activityLabel.textContent = "This step needs attention";
      nodes.activityDetail.textContent = error;
    } else if (needsReview && next !== nodes.acceptButton && next !== nodes.followupAcceptButton) {
      nodes.activityLabel.textContent = "Next: review the expected totals";
      nodes.activityDetail.textContent = "Check each basket against the rule, then confirm your review before accepting.";
    } else if (next) {
      next.dataset.nextAction = "true";
      nodes.activityLabel.textContent = `Next: ${next.textContent}`;
      nodes.activityDetail.textContent = next === nodes.baselineButton
        ? fixture ? "Start the scripted baseline to unlock the authored fixture baskets. No tests or model calls are made."
          : "Start with the existing tests. Muse becomes available after a passing baseline."
        : "The highlighted action is ready. Evidence and earlier results remain available below.";
      step = next.closest(".step").id.replace("stage-", "");
    } else {
      nodes.activityLabel.textContent = state.session ? "Review the evidence" : "Review backend unavailable";
      nodes.activityDetail.textContent = state.session
        ? "Inspect the results below, or select another prepared change. These checks do not approve a merge."
        : "Start the local backend and reload. No results are simulated here.";
    }
    for (const name of ["change", "basket", "test"]) {
      const path = byId(`path-${name}`);
      if (name === step) path.setAttribute("aria-current", "step");
      else path.removeAttribute("aria-current");
    }
  }

  nodes.changeSelector.addEventListener("change", () => {
    store.selectChange(nodes.changeSelector.value);
    nodes.changeSelector.value = store.getState().selectedChangeId;
  });
  nodes.baselineButton.addEventListener("click", () => {
    store.runBaseline();
  });
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
  nodes.regressionButton.addEventListener("click", () => {
    store.runRegression();
  });
  nodes.controlButton.addEventListener("click", () => {
    store.runControl();
  });
  nodes.feedbackButton.addEventListener("click", () => {
    if (store.getState().budgetKnown) store.requestFeedback();
    else store.refreshUsage();
  });
  nodes.followupReviewedCheckbox.addEventListener("change", () => {
    store.confirmFollowUpReview(nodes.followupReviewedCheckbox.checked);
  });
  nodes.followupAcceptButton.addEventListener("click", () => {
    store.acceptFollowUp();
  });
  nodes.followupCompareButton.addEventListener("click", () => {
    store.compareFollowUp();
  });
  nodes.followupControlButton.addEventListener("click", () => {
    store.runFollowUpControl();
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
