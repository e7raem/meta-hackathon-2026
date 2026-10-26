import { open, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 128 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const EXECUTION_CONTRACT = "5e0cd03079260c99462e2c9c11af68a55779888f15affe486cc0764eb0dc168c";
const variants = ["good", "bad", "repaired"];

function shape(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function text(value, max = 4000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function hash(value) {
  return typeof value === "string" && HASH.test(value);
}

function numbers(value, length) {
  return Array.isArray(value) && value.length === length
    && Array.from(value).every((number) => integer(number, 0, 400000));
}

function equal(left, right) {
  return left.every((value, index) => value === right[index]);
}

function validate(input) {
  if (!shape(input, [
    "version", "origin", "scenario", "humanAcceptance", "requests", "identities",
    "semantic", "shallow", "supportingRefusal", "limits",
  ])) return "Missing or unexpected projection fields.";
  if (input.version !== 1 || !["observed", "fixture"].includes(input.origin)) {
    return "Unsupported version or provenance.";
  }
  if (!shape(input.scenario, ["label", "rule", "domain", "diff"])
    || input.scenario.label !== "SEEDED"
    || !text(input.scenario.rule) || !text(input.scenario.domain)
    || !text(input.scenario.diff, 16000)) return "Invalid seeded scenario.";
  if (!shape(input.humanAcceptance, ["by", "decision"])
    || input.humanAcceptance.by !== "Bobai"
    || input.humanAcceptance.decision !== "accepted_all_three") {
    return "Explicit case acceptance by Bobai is required.";
  }
  if (!Array.isArray(input.requests) || input.requests.length !== 2) {
    return "Exactly two completed requests are required.";
  }
  for (const [index, request] of input.requests.entries()) {
    if (!shape(request, [
      "number", "purpose", "model", "status", "responseSha256", "inputTokens", "outputTokens",
    ]) || request.number !== index + 1
      || request.purpose !== ["cases", "repair"][index]
      || request.status !== "completed"
      || request.model !== "muse-spark-1.3"
      || !hash(request.responseSha256)
      || !integer(request.inputTokens, 0, Number.MAX_SAFE_INTEGER)
      || !integer(request.outputTokens, 0, Number.MAX_SAFE_INTEGER)) {
      return "Invalid request identity, model, status, purpose, or token counts.";
    }
  }
  const identityKeys = ["executionContract", "rendererContract", "originalShallow", "acceptedChecker"];
  if (!shape(input.identities, identityKeys)
    || !identityKeys.every((key) => hash(input.identities[key]))
    || input.identities.executionContract !== EXECUTION_CONTRACT
    || input.identities.rendererContract === input.identities.executionContract) {
    return "Invalid identities or conflated execution-time and renderer contracts.";
  }
  if (!shape(input.semantic, ["cases", ...variants])
    || !Array.isArray(input.semantic.cases) || input.semantic.cases.length !== 3) {
    return "Exactly three semantic cases and all three variants are required.";
  }
  const expected = [];
  const seededTotals = [];
  for (const testCase of input.semantic.cases) {
    if (!shape(testCase, ["name", "lines", "expected"]) || !text(testCase.name, 200)
      || !Array.isArray(testCase.lines) || testCase.lines.length < 1
      || testCase.lines.length > 4 || !integer(testCase.expected, 0, 400000)) {
      return "Invalid semantic case.";
    }
    let correct = 0;
    let basket = 0;
    for (const line of testCase.lines) {
      if (!shape(line, ["amount", "discountEligible"])
        || !integer(line.amount, 100, 100000) || line.amount % 100 !== 0
        || typeof line.discountEligible !== "boolean") return "Case is outside the frozen domain.";
      correct += line.discountEligible ? line.amount * 9 / 10 : line.amount;
      basket += line.amount;
    }
    if (testCase.expected !== correct) return "Case expectation contradicts the frozen rule.";
    expected.push(correct);
    seededTotals.push(basket * 9 / 10);
  }
  for (const variant of variants) {
    const result = input.semantic[variant];
    if (!shape(result, ["exitCode", "actual", "sourceSha256"])
      || !integer(result.exitCode, 0, 255)
      || !numbers(result.actual, 3) || !hash(result.sourceSha256)) {
      return "Invalid semantic execution record.";
    }
    const matches = equal(result.actual, expected);
    if (variant === "bad") {
      if (result.exitCode === 0 || matches || !equal(result.actual, seededTotals)) {
        return "BAD must report a genuine seeded mismatch and nonzero exit.";
      }
    } else if (result.exitCode !== 0 || !matches) {
      return "GOOD and REPAIRED must report exit zero with every expected total.";
    }
  }
  if (input.semantic.bad.sourceSha256 === input.semantic.good.sourceSha256
    || input.semantic.bad.sourceSha256 === input.semantic.repaired.sourceSha256) {
    return "Contradictory source identities for the seeded candidate and correct versions.";
  }
  if (!shape(input.shallow, ["expected", ...variants])
    || !numbers(input.shallow.expected, 2)
    || !equal(input.shallow.expected, [9000, 10800])) {
    return "Original all-eligible expectations must remain unchanged.";
  }
  for (const variant of variants) {
    const result = input.shallow[variant];
    if (!shape(result, ["exitCode", "actual"]) || result.exitCode !== 0
      || !numbers(result.actual, 2) || !equal(result.actual, input.shallow.expected)) {
      return "Every original shallow run must report exit zero and matching totals.";
    }
  }
  if (!shape(input.supportingRefusal, ["exitCode", "reason", "markerAbsent"])
    || !integer(input.supportingRefusal.exitCode, 1, 255)
    || input.supportingRefusal.reason !== "requested_task_not_safe"
    || input.supportingRefusal.markerAbsent !== true) return "Invalid supporting refusal control.";
  if (!Array.isArray(input.limits) || input.limits.length < 1 || input.limits.length > 20
    || !Array.from(input.limits).every((limit) => text(limit))) return "Explicit limits are required.";
  return null;
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const styles = `
:root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; color: #282821; background: #f3efe6; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3rem 1rem; line-height: 1.6; }
main { max-width: 68rem; margin: auto; padding: clamp(1.2rem, 4vw, 3rem); background: #fffdf8; border: 1px solid #d9d3c5; }
h1, h2, h3 { line-height: 1.2; font-weight: normal; }
h1 { font-size: clamp(2rem, 5vw, 3.8rem); margin: .5rem 0 1.5rem; }
h2 { margin-top: 2.3rem; border-top: 1px solid #d9d3c5; padding-top: 1.2rem; }
.eyebrow, th, .state { font-family: ui-monospace, "Courier New", monospace; font-size: .85rem; letter-spacing: .03em; }
.eyebrow { text-transform: uppercase; color: #625e52; }
.state { display: inline-block; padding: .3rem .7rem; border: 1px solid currentColor; }
.pass { color: #245934; } .fail { color: #9b3028; } .unknown { color: #765500; }
.note { padding: 1rem; background: #f3efe6; border-left: 3px solid #9b917d; }
.lead { max-width: 44rem; font-size: 1.15rem; }
.boundary, .domain { color: #625e52; font-size: .9rem; }
.amount-summary { margin: 1.8rem 0; padding: 1.4rem; border: 1px solid #d9d3c5; background: linear-gradient(135deg, #f7f3e9, #edf3eb); }
.amounts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.amounts p { margin: 0; } .amounts strong { display: block; font-size: clamp(1.8rem, 4vw, 2.8rem); line-height: 1.3; font-weight: normal; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; text-align: left; }
th, td { padding: .7rem; vertical-align: top; border-bottom: 1px solid #ded8cc; }
code, pre, dd { font-family: ui-monospace, "Courier New", monospace; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; padding: 1rem; background: #f3efe6; font-size: .85rem; }
dd { margin: .3rem 0 1rem; font-size: .85rem; } dt { margin-top: .8rem; }
details { margin-top: 1.5rem; } summary { cursor: pointer; }
footer { margin-top: 2rem; font-size: .9rem; color: #625e52; }
@media (max-width: 40rem) { body { padding: .5rem; } th, td { padding: .5rem; } .amounts { grid-template-columns: 1fr; } .amounts p { display: flex; align-items: baseline; justify-content: space-between; gap: .6rem; } }
`;

function document(body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seeded change review — evidence card</title><style>${styles}</style></head>
<body><main>${body}</main></body></html>`;
}

function unknown(input, diagnostic) {
  const provenance = input?.origin === "fixture" ? "FIXTURE — synthetic projection" : "Unqualified projection";
  return document(`<header><p class="eyebrow">SEEDED / ${provenance}</p>
<h1>Change review evidence</h1><p class="state unknown">UNKNOWN</p></header>
<p>No successful loop, live Meta result, or PASS classification is established.</p>
<p class="note">${escape(diagnostic)}</p>
<p>Supply a complete, internally consistent version 1 projection in <code>evidence/review.json</code>.
This renderer does not independently verify execution or hashes.</p>`);
}

function renderValid(input) {
  const fixture = input.origin === "fixture";
  const mixedIndex = input.semantic.cases.findIndex((testCase) =>
    testCase.lines.some((line) => line.discountEligible)
      && testCase.lines.some((line) => !line.discountEligible));
  const money = (value) => `£${(value / 100).toFixed(2)}`;
  const amounts = !fixture && mixedIndex >= 0
    ? `<section class="amount-summary" aria-label="Recorded mixed basket">
<div class="amounts"><p>Expected<strong>${money(input.semantic.cases[mixedIndex].expected)}</strong></p>
<p>Before<strong class="fail">${money(input.semantic.bad.actual[mixedIndex])}</strong></p>
<p>After<strong class="pass">${money(input.semantic.repaired.actual[mixedIndex])}</strong></p></div>
<p class="boundary">Recorded mixed-eligibility case, shown as a GBP illustration (100 minor units per pound), not a payment.</p></section>`
    : `<section class="amount-summary"><p>Mixed-basket display: <strong>UNKNOWN</strong> — no observed mixed-basket record supplied.</p></section>`;
  const rows = input.semantic.cases.map((testCase, index) => {
    const lines = testCase.lines.map((line) =>
      `${line.amount} (${line.discountEligible ? "eligible" : "ineligible"})`).join(" + ");
    return `<tr><td>${escape(testCase.name)}<br><code>${escape(lines)}</code></td>
<td>${testCase.expected}</td><td class="pass">PASS ${input.semantic.good.actual[index]}</td>
<td class="${input.semantic.bad.actual[index] === testCase.expected ? "pass" : "fail"}">${input.semantic.bad.actual[index] === testCase.expected ? "PASS" : "FAIL"} ${input.semantic.bad.actual[index]}</td>
<td class="pass">PASS ${input.semantic.repaired.actual[index]}</td></tr>`;
  }).join("");
  const shallowRows = input.shallow.expected.map((expected, index) =>
    `<tr><td>Original all-eligible case ${index + 1}</td><td>${expected}</td>${variants.map((variant) =>
      `<td class="pass">PASS ${input.shallow[variant].actual[index]}</td>`).join("")}</tr>`).join("");
  const requests = input.requests.map((request) =>
    `<li>Request ${request.number}: ${escape(request.purpose)} — <code>${escape(request.model)}</code>,
    ${escape(request.status)}; input tokens ${request.inputTokens}, output tokens ${request.outputTokens}.
    Response SHA-256: <code>${escape(request.responseSha256)}</code>.</li>`).join("");
  const identities = [
    ["Execution-time contract (past model loop)", input.identities.executionContract],
    ["Renderer contract (current projection)", input.identities.rendererContract],
    ["Original shallow checker", input.identities.originalShallow],
    ["Accepted semantic checker", input.identities.acceptedChecker],
    ...variants.map((variant) => [`${variant.toUpperCase()} source`, input.semantic[variant].sourceSha256]),
  ].map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join("");
  return document(`<header><p class="eyebrow">SEEDED / ${fixture ? "FIXTURE — synthetic, not actual Meta evidence" : "Maintainer-supplied observed projection"}</p>
<h1>Green checks.<br>Wrong result.</h1>
<p class="state">${fixture ? "FIXTURE ONLY" : "RECORDED RUN"}</p></header>
<p class="lead">${fixture ? "Synthetic illustration of green checks, a missed rule and a repaired result; not actual model or execution evidence." : "All-eligible checks stayed green. Meta proposed the missing questions; the accepted checks exposed the regression and passed the repair."}</p>
<p class="boundary">${fixture
    ? "All states below belong to a synthetic test fixture, not live Meta calls or actual execution evidence."
    : "Seeded example. Maintainer-supplied projection; it does not independently verify execution, model provenance, or any hash."}</p>
${amounts}
<h2>The rule</h2><p>${escape(input.scenario.rule)}</p>
<p class="domain">${escape(input.scenario.domain)}</p>
<h2>Three accepted questions</h2>
<p>${fixture ? "Fixture-labelled proposal and acceptance records, not actual human actions." : "Meta proposed the cases; Bobai accepted all three."} GOOD and the reviewed repair pass; the intentionally BAD candidate fails.</p>
<div class="scroll"><table><thead><tr><th>Case / minor units</th><th>Expected</th><th>GOOD</th><th>BAD</th><th>REPAIRED</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p>Semantic exits: GOOD ${input.semantic.good.exitCode}; BAD ${input.semantic.bad.exitCode};
REPAIRED ${input.semantic.repaired.exitCode}. The intentional BAD FAIL is preserved.</p>
<div class="scroll"><table><thead><tr><th>Shallow coverage</th><th>Expected</th><th>GOOD</th><th>BAD</th><th>REPAIRED</th></tr></thead>
<tbody>${shallowRows}</tbody></table></div>
<p>Shallow exits: GOOD ${input.shallow.good.exitCode}; BAD ${input.shallow.bad.exitCode};
REPAIRED ${input.shallow.repaired.exitCode}. All-eligible coverage did not distinguish the refactor.</p>
<details><summary>Changed expression / supplied diff</summary><pre>${escape(input.scenario.diff)}</pre></details>
<details><summary>Model calls and review roles</summary>
<p>${fixture ? "Synthetic request records" : "Reported Meta request records"}: two requests, one repair proposal.</p><ol>${requests}</ol>
<p>Bobai: accepted all three proposed cases. SCOOBY/MUSE: technical review of the repair.
Bobai did not review that exact repair patch. Case acceptance is not patch approval.
${fixture ? "These role statements are fixture-labelled, not evidence of actual human actions." : "These role labels describe the supplied historical handoff, not an identity attestation."}</p>
<p>The source candidate deliberately remains BAD; repair execution was in a separate retained copy.</p></details>
<details><summary>Identities and supporting execution control</summary>
<p>Adding renderer tasks changes CURRENT <code>ota.yaml</code>. Past model-loop runs bind the execution-time
contract, not the renderer contract. Both identities are supplied, not recomputed or attested here.</p>
<dl>${identities}</dl>
<p>Supporting refusal: ${escape(input.supportingRefusal.reason)}; exit ${input.supportingRefusal.exitCode};
marker reported absent. This supports only the selected task-admission control; Ota stays backstage.</p></details>
<details><summary>Scope and limits</summary><ul>${input.limits.map((limit) => `<li>${escape(limit)}</li>`).join("")}</ul>
<p>Selected seeded examples only, not every basket, production payment safety, merge enforcement,
full agent containment, customer savings, or model superiority. No independent hash verification or attestation.</p></details>
<footer>Read-only local evidence projection. No live services, actions, scripts, or remote assets.</footer>`);
}

export function renderReport(input) {
  const diagnostic = validate(input);
  return diagnostic ? unknown(input, diagnostic) : renderValid(input);
}

async function readProjection() {
  const handle = await open("evidence/review.json", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_INPUT_BYTES) {
      throw new Error("Projection must be a regular file no larger than 128 KiB.");
    }
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_INPUT_BYTES) throw new Error("Projection exceeds 128 KiB.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally {
    await handle.close();
  }
}

async function main() {
  let input;
  let diagnostic;
  if (process.argv.length !== 2) {
    diagnostic = "Arguments are not supported. Only evidence/review.json is accepted.";
  } else {
    try {
      input = await readProjection();
      diagnostic = validate(input);
    } catch (error) {
      diagnostic = `Unable to read projection: ${error.message}`;
    }
  }
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/report.html", diagnostic ? unknown(input, diagnostic) : renderValid(input), "utf8");
  if (diagnostic) {
    console.error(`UNKNOWN: ${diagnostic}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Report write failed: ${error.message}`);
    process.exitCode = 1;
  });
}
