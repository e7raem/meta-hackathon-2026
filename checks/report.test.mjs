import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderReport } from "../tools/report.mjs";

const renderer = fileURLToPath(new URL("../tools/report.mjs", import.meta.url));
const evidenceRoot = fileURLToPath(new URL("../evidence/", import.meta.url));
const executionContract = "5e0cd03079260c99462e2c9c11af68a55779888f15affe486cc0764eb0dc168c";
const digest = (character) => character.repeat(64);

function projection(origin = "fixture") {
  // Even the observed-branch tests use synthetic records, never live evidence.
  return {
    version: 1,
    origin,
    scenario: {
      label: "SEEDED",
      rule: "Discount eligible lines by 10%, leave ineligible lines unchanged, then sum.",
      domain: "1-4 lines; integer amounts 100..100000, multiples of 100; boolean eligibility.",
      diff: "- return basketTotal * 9 / 10;\n+ return eligibleLineTotals;",
    },
    humanAcceptance: { by: "Bobai", decision: "accepted_all_three" },
    requests: [
      { number: 1, purpose: "cases", model: "muse-spark-1.3", status: "completed",
        responseSha256: digest("a"), inputTokens: 100, outputTokens: 50 },
      { number: 2, purpose: "repair", model: "muse-spark-1.3", status: "completed",
        responseSha256: digest("b"), inputTokens: 120, outputTokens: 60 },
    ],
    identities: {
      executionContract,
      rendererContract: digest("c"),
      originalShallow: digest("d"),
      acceptedChecker: digest("e"),
    },
    semantic: {
      cases: [
        { name: "all ineligible", lines: [{ amount: 10000, discountEligible: false }], expected: 10000 },
        { name: "mixed", lines: [
          { amount: 10000, discountEligible: true }, { amount: 2000, discountEligible: false },
        ], expected: 11000 },
        { name: "two ineligible", lines: [
          { amount: 5000, discountEligible: false }, { amount: 3000, discountEligible: false },
        ], expected: 8000 },
      ],
      good: { exitCode: 0, actual: [10000, 11000, 8000], sourceSha256: digest("1") },
      bad: { exitCode: 1, actual: [9000, 10800, 7200], sourceSha256: digest("2") },
      repaired: { exitCode: 0, actual: [10000, 11000, 8000], sourceSha256: digest("3") },
    },
    shallow: {
      expected: [9000, 10800],
      good: { exitCode: 0, actual: [9000, 10800] },
      bad: { exitCode: 0, actual: [9000, 10800] },
      repaired: { exitCode: 0, actual: [9000, 10800] },
    },
    supportingRefusal: { exitCode: 1, reason: "requested_task_not_safe", markerAbsent: true },
    limits: ["Synthetic test data; no actual provider calls or independently verified execution."],
  };
}

function assertUnknown(input) {
  const html = renderReport(input);
  assert.match(html, /class="state unknown">UNKNOWN/);
  assert.doesNotMatch(html, /class="pass"|class="fail"|RECORDED RUN/);
}

test("valid observed projection is explicitly supplied, not independently verified", () => {
  const input = projection("observed");
  const html = renderReport(input);
  assert.match(html, /RECORDED RUN/);
  assert.match(html, /does not independently verify/);
  assert.match(html, /Bobai: accepted all three/);
  assert.match(html, /Bobai did not review that exact repair patch/);
  for (const testCase of input.semantic.cases) assert.ok(html.includes(testCase.name));
  for (const variant of ["good", "bad", "repaired"]) {
    for (const actual of input.semantic[variant].actual) assert.ok(html.includes(String(actual)));
    assert.ok(html.includes(input.semantic[variant].sourceSha256));
  }
  assert.match(html, /FAIL 9000/);
  assert.match(html, /FAIL 10800/);
  assert.match(html, /FAIL 7200/);
  assert.match(html, /Expected<strong>£110\.00/);
  assert.match(html, /Before<strong class="fail">£108\.00/);
  assert.match(html, /After<strong class="pass">£110\.00/);
  assert.match(html, /Semantic exits: GOOD 0; BAD 1;/);
  assert.match(html, /Shallow exits: GOOD 0; BAD 0;/);
  assert.match(html, /Execution-time contract/);
  assert.match(html, /Renderer contract/);
  for (const identity of Object.values(input.identities)) assert.ok(html.includes(identity));
  for (const request of input.requests) {
    assert.ok(html.includes(request.responseSha256));
    assert.ok(html.includes(`input tokens ${request.inputTokens}`));
    assert.ok(html.includes(`output tokens ${request.outputTokens}`));
  }
  assert.match(html, /requested_task_not_safe/);
  assert.match(html, /not every basket/);
});

test("complete fixture remains synthetic, incomplete fixture is UNKNOWN", () => {
  const html = renderReport(projection());
  assert.match(html, /FIXTURE ONLY/);
  assert.match(html, /not actual Meta evidence/);
  assert.match(html, /not live Meta calls or actual execution evidence/);
  assert.doesNotMatch(html, /RECORDED RUN/);
  assert.match(html, /Mixed-basket display: <strong>UNKNOWN/);
  assertUnknown({ version: 1, origin: "fixture" });
  assert.match(renderReport({ version: 1, origin: "fixture" }), /FIXTURE/);
});

test("missing, malformed shapes and unsupported provenance stay UNKNOWN", () => {
  for (const value of [undefined, null, false, 1, "{}", [], {}, { version: 1 }]) assertUnknown(value);
  const mutations = [
    (p) => { delete p.semantic; },
    (p) => { p.origin = "live"; },
    (p) => { p.version = "1"; },
    (p) => { p.extra = "not allowlisted"; },
    (p) => { p.humanAcceptance = true; },
    (p) => { p.humanAcceptance.by = "someone else"; },
    (p) => { p.humanAcceptance.decision = true; },
    (p) => { p.scenario.label = "PRODUCTION"; },
    (p) => { p.requests[0].status = "success"; },
    (p) => { p.requests[0].status = true; },
    (p) => { p.requests[0].model = "invented-meta-model"; },
    (p) => { p.requests[1].purpose = "cases"; },
    (p) => { p.requests.reverse(); },
    (p) => { p.requests.push(p.requests[0]); },
    (p) => { p.requests[0].inputTokens = "100"; },
    (p) => { p.requests[1].outputTokens = -1; },
    (p) => { p.requests[1].outputTokens = 1.5; },
    (p) => { p.limits = []; },
    (p) => { p.limits = [false]; },
    (p) => { p.limits = Array(1); },
  ];
  for (const mutate of mutations) {
    const input = projection("observed");
    mutate(input);
    assertUnknown(input);
  }
});

test("contradictory exits, all-row totals and refusal evidence are rejected", () => {
  const mutations = [
    (p) => { p.semantic.good.exitCode = 1; },
    (p) => { p.semantic.repaired.actual[2] = 7200; },
    (p) => { p.semantic.bad.exitCode = 0; },
    (p) => { p.semantic.bad.actual = [10000, 11000, 8000]; },
    (p) => { p.semantic.bad.actual[2] = 7199; },
    (p) => { p.semantic.good.actual[0] = "10000"; },
    (p) => { p.semantic.good.actual.pop(); },
    (p) => { delete p.semantic.good.actual[1]; },
    (p) => { p.semantic.bad.exitCode = -1; },
    (p) => { p.semantic.bad.exitCode = 256; },
    (p) => { p.semantic.bad.sourceSha256 = p.semantic.good.sourceSha256; },
    (p) => { p.shallow.good.exitCode = false; },
    (p) => { p.shallow.bad.exitCode = 1; },
    (p) => { p.shallow.repaired.actual[1] = 11000; },
    (p) => { p.shallow.repaired.actual = [9000, NaN]; },
    (p) => { p.shallow.expected = [9000, 11000]; },
    (p) => { p.supportingRefusal.reason = "runtime_missing"; },
    (p) => { p.supportingRefusal.exitCode = 0; },
    (p) => { p.supportingRefusal.markerAbsent = "true"; },
    (p) => { p.supportingRefusal.markerAbsent = false; },
  ];
  for (const mutate of mutations) {
    const input = projection();
    mutate(input);
    assertUnknown(input);
  }
});

test("hashes, temporal contract distinction, domain and rule arithmetic are strict", () => {
  const mutations = [
    (p) => { p.identities.acceptedChecker = digest("A"); },
    (p) => { p.requests[0].responseSha256 = "abc"; },
    (p) => { p.semantic.repaired.sourceSha256 = 123; },
    (p) => { p.identities.executionContract = digest("f"); },
    (p) => { p.identities.rendererContract = p.identities.executionContract; },
    (p) => { p.semantic.cases.pop(); },
    (p) => { p.semantic.cases[0].lines = []; },
    (p) => { p.semantic.cases[0].lines = Array(5).fill({ amount: 100, discountEligible: false }); },
    (p) => { p.semantic.cases[0].lines[0].amount = 0; },
    (p) => { p.semantic.cases[0].lines[0].amount = 100100; },
    (p) => { p.semantic.cases[0].lines[0].amount = 101; },
    (p) => { p.semantic.cases[0].lines[0].amount = 100.5; },
    (p) => { p.semantic.cases[0].lines[0].amount = "10000"; },
    (p) => { p.semantic.cases[0].lines[0].discountEligible = 0; },
    (p) => { delete p.semantic.cases[0].lines[0].discountEligible; },
    (p) => { p.semantic.cases[0].expected = 9000; },
    (p) => { p.semantic.cases[0].expected = "10000"; },
  ];
  for (const mutate of mutations) {
    const input = projection();
    mutate(input);
    assertUnknown(input);
  }
});

test("untrusted text is escaped; no executable HTML, links or remote resources", () => {
  const payload = '<script src="https://evil.invalid/x">alert(1)</script><img src=x onerror="bad()">&\'';
  const input = projection();
  input.scenario.rule = payload;
  input.scenario.domain = payload;
  input.scenario.diff = payload;
  input.semantic.cases[0].name = payload;
  input.limits = [payload];
  const html = renderReport(input);
  assert.ok(html.includes("&lt;script src=&quot;https://evil.invalid/x&quot;&gt;"));
  assert.ok(html.includes("&amp;&#39;"));
  assert.equal(html.split("&lt;script").length - 1, 5);
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed|img|link|a|form|button|input)\b/i);
  assert.doesNotMatch(html, /<[^>]+\s(?:on\w+|src|href|action)\s*=/i);
  assert.doesNotMatch(html, /url\s*\(|@import|javascript:/i);
  assert.match(html, /<details>/);
  assert.match(html, /<meta name="viewport"/);
  const badModel = projection("observed");
  badModel.requests[0].model = payload;
  assertUnknown(badModel);
  assert.doesNotMatch(renderReport(badModel), /<script/);
});

async function ownedDirectory(run) {
  await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(resolve(evidenceRoot, "report-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function invoke(directory, args = []) {
  const result = spawnSync(process.execPath, [renderer, ...args], {
    cwd: directory, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test("fixed CLI writes valid observed and fixture reports, not on import", async () => {
  await ownedDirectory(async (directory) => {
    const imported = spawnSync(process.execPath, [
      "--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(renderer).href)})`,
    ], { cwd: directory, encoding: "utf8", timeout: 10000 });
    assert.ifError(imported.error);
    assert.equal(imported.status, 0, imported.stderr);
    assert.deepEqual(await readdir(directory), []);
    await mkdir(resolve(directory, "evidence"));
    for (const origin of ["observed", "fixture"]) {
      await writeFile(resolve(directory, "evidence/review.json"), JSON.stringify(projection(origin)));
      const result = invoke(directory);
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(resolve(directory, "evidence/report.html"), "utf8");
      assert.match(html, origin === "fixture" ? /FIXTURE ONLY/ : /RECORDED RUN/);
      assert.deepEqual((await readdir(resolve(directory, "evidence"))).sort(), ["report.html", "review.json"]);
    }
  });
});

test("fixed CLI writes UNKNOWN and nonzero for missing, malformed, invalid and oversized input", async () => {
  await ownedDirectory(async (directory) => {
    const missing = invoke(directory);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /UNKNOWN/);
    assert.match(await readFile(resolve(directory, "evidence/report.html"), "utf8"), />UNKNOWN</);
    for (const content of [
      "{", JSON.stringify({ version: 1, origin: "fixture" }),
      JSON.stringify({ ...projection(), origin: "invented" }),
      JSON.stringify(projection()).padEnd(128 * 1024 + 1, " "),
      Buffer.from([0xff, 0xfe]),
    ]) {
      await writeFile(resolve(directory, "evidence/review.json"), content);
      const result = invoke(directory);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /UNKNOWN/);
      const html = await readFile(resolve(directory, "evidence/report.html"), "utf8");
      assert.match(html, />UNKNOWN</);
      assert.doesNotMatch(html, /class="pass"|RECORDED RUN/);
    }
    await writeFile(
      resolve(directory, "evidence/review.json"),
      JSON.stringify(projection()).padEnd(128 * 1024, " "),
    );
    assert.equal(invoke(directory).status, 0, "Exactly 128 KiB is permitted.");
    const extraArgs = invoke(directory, ["other.json"]);
    assert.equal(extraArgs.status, 1);
    assert.match(await readFile(resolve(directory, "evidence/report.html"), "utf8"), /Arguments are not supported/);
  });
});

test("fixed CLI rejects linked and nonregular projection inputs", async () => {
  await ownedDirectory(async (directory) => {
    await mkdir(resolve(directory, "evidence"));
    await writeFile(resolve(directory, "fixture.json"), JSON.stringify(projection()));
    await symlink("../fixture.json", resolve(directory, "evidence/review.json"));
    assert.equal(invoke(directory).status, 1);
    assert.match(await readFile(resolve(directory, "evidence/report.html"), "utf8"), />UNKNOWN</);
    await rm(resolve(directory, "evidence/review.json"));
    await mkdir(resolve(directory, "evidence/review.json"));
    assert.equal(invoke(directory).status, 1);
    assert.match(await readFile(resolve(directory, "evidence/report.html"), "utf8"), />UNKNOWN</);
  });
});

test("money summary derives only from a valid observed mixed-basket record", () => {
  const input = projection("observed");
  input.semantic.cases[1].lines[1].amount = 1000;
  input.semantic.cases[1].expected = 10000;
  input.semantic.good.actual[1] = 10000;
  input.semantic.bad.actual[1] = 9900;
  input.semantic.repaired.actual[1] = 10000;
  const html = renderReport(input);
  assert.match(html, /Expected<strong>£100\.00/);
  assert.match(html, /Before<strong class="fail">£99\.00/);
  assert.match(html, /After<strong class="pass">£100\.00/);
  assert.doesNotMatch(html, /£110\.00|£108\.00/);
  input.semantic.good.actual[1] = 11000;
  assertUnknown(input);
  const noMixed = projection("observed");
  noMixed.semantic.cases[1].lines[0].discountEligible = false;
  noMixed.semantic.cases[1].expected = 12000;
  noMixed.semantic.good.actual[1] = 12000;
  noMixed.semantic.repaired.actual[1] = 12000;
  assert.match(renderReport(noMixed), /Mixed-basket display: <strong>UNKNOWN/);
  assert.doesNotMatch(renderReport(noMixed), /£110\.00|£108\.00/);
});
