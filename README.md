# Pricing-regression reproducer and historical checkout card

## Current local LIVE candidate

The new candidate selects one of two prepared pricing refactors. Muse proposes
structured cases against an independent written rule. A reviewer must validate
or correct expected totals before either implementation's outcomes are exposed.
Only then does a fixed audited runner compare the original and selected change.
The baseline is not the specification. Comparison reports `REPRODUCED`,
`NO_COUNTEREXAMPLE`, or `INCONCLUSIVE`, never universal correctness.
Valid empty model output is `NO_CASES_PROPOSED` / inconclusive: no implementations
run, no accepted case set or approval is created, and its request remains consumed.

The rule discounts eligible lines first, applies one voucher only when their
post-discount subtotal qualifies, then includes unchanged ineligible lines.
`pricing/rule.json` is authoritative. Prepared domain: 1-4 lines, integer amounts
100..100000 in multiples of 100, explicit boolean eligibility; no tax, currency
conversion, payment integration or arbitrary repository/code execution.

This source is **NOT YET LIVE-QUALIFIED**. Source authoring and offline fixtures
do not establish real provider, browser or exported-test outcomes. The historical
checkout results below do not qualify this different pricing scenario. Authored
pricing controls include deliberate regression witnesses: their green fixture
suite is not evidence that an existing customer suite missed those defects.

Existing released Ota v1.6.28 and exactly Node v24.22.1 are required; the contract
diagnoses instead of installing anything. After source/admission review:

```text
ota validate
ota run verify:live-mvp --agent --dry-run
ota run verify:live-mvp --agent
```

That finite aggregate runs offline pricing controls, mocked-fetch UI tests and
synthetic controller/budget/export tests. It starts no server and makes no Meta
request. Controller tests create only owned temporary paths under
`evidence/live-tests/`. There are no dependencies to install or hidden setup tasks.

The service path requires separate frozen-source and operational clearance.
`META_DEMO_APPROVAL_FILE` names an owner-private approval binding source/Node
identities, the saved key path, deadline and six additional calls. It contains
no key. Private directories must exist first; the operator initializes the budget
once via `ota run demo:live:budget --agent`, then starts
`ota run demo:live --agent`. Neither command is authorized merely by reading
this README or by inclusion in `agent.safe_tasks`. First qualification is macOS
only. No automatic retry, reset, provider fallback, paid top-up or repair occurs.

The listener binds only `127.0.0.1:48761`; a busy port refuses. The provider key
stays in the trusted HTTPS server, never the browser or pricing child. That child
receives a fixed credential-free environment and bounded time/output; it is not
an OS sandbox. Exact origin/nonce checks mitigate browser cross-origin requests,
not a malicious local same-user process. Reviewer acceptance/correction is an
operator declaration, not verified human identity. Ota effects are declarations,
not a claim of universal network/process containment.

Temporary readiness compatibility: released Ota v1.6.28 sends a portless HTTP
`Host` in its socket readiness probe. Only **GET `/health`** therefore accepts
the literal `127.0.0.1` as well as `127.0.0.1:48761`. Static/session/POST routes
retain the exact-port Host requirement; readiness is not skipped or changed to
TCP. Named Ota gap: HTTP readiness authority omits a non-default port. Core owns
the permanent authority-serialization fix and IPv6/non-default-port regressions;
return to it in the next Core work slice, outside this demo's implementation.
This temporary compatibility does not establish a repaired Ota release.

Successful export persists `evidence/regression.test.mjs`, returns its hash and
`ota run verify:export --agent`. Check that hash before executing; the optional
download is only a copy. The test uses a fixed audited template and numeric/
boolean data, not model-authored code. A reproduced candidate regression should
fail its candidate assertion; do not turn that failure green by changing the rule.
Missing export or execution errors are not a successful regression proof.

`LIVE` denotes actual provider-origin data, not correctness; `FIXTURE` and
historical `RECORDED` remain distinct. No new Meta request, live service or browser
qualification is established by this source-only candidate. No CI, deployment,
production payment safety, general agent containment or automatic merge follows.

## Historical static evidence card

A **SEEDED synthetic checkout refactor**, not a discovered customer defect or
hosted product. The checked-in `src/checkout.ts` deliberately remains BAD:
it discounts the whole basket regardless of eligibility. GOOD and the real
Meta repair discount eligible lines individually. The repair was executed only
in a retained separate copy; this renderer does not apply it.

## Frozen rule and domain

Apply a 10% discount to eligible lines only, leave ineligible lines unchanged,
then sum. Public interface:

```ts
checkoutTotal(
  lines: ReadonlyArray<{ amount: number; discountEligible: boolean }>,
): number
```

Supported inputs: 1–4 lines; integer amounts 100..100000 minor units inclusive,
in multiples of 100; explicit boolean eligibility. No mutation, rounding policy,
tax, thresholds, caps, currency conversion, real payments, or domain expansion.

## Historical loop versus new renderer

The maintainer reports two actual Standard Meta `muse-spark-1.3` requests:
request 1 proposed cases before seeing failures; Bobai literally accepted all
three, and the maintainer froze the checker. Request 2 proposed one repair
touching only `src/checkout.ts`. SCOOBY/MUSE technically reviewed that patch;
Bobai did not review that exact patch. Case acceptance is not patch approval.
No further model call is needed.

Reported same-checker results (minor units):

| Accepted case | Expected | GOOD | BAD | REPAIRED |
| --- | ---: | ---: | ---: | ---: |
| Ineligible 10000 | 10000 | 10000 | 9000 | 10000 |
| Eligible 10000 + ineligible 2000 | 11000 | 11000 | 10800 | 11000 |
| Ineligible 5000 + ineligible 3000 | 8000 | 8000 | 7200 | 8000 |

GOOD and REPAIRED semantic runs exited zero; BAD exited nonzero. Original
all-eligible checks passed all three versions with 9000 / 10800. These are
maintainer-supplied historical results, not executions performed by this
source-authoring turn. The author-provided `fixtures/checkout-fix.fixture.patch`
is a separate labelled FIXTURE reference, not that real Meta repair.

Maintainer validation on macOS with released Ota v1.6.28 and Node v24.22.1 passed
all **10 renderer tests**, contract validation and both renderer-task dry-run previews.
The declared render task also returned zero and generated a local static card from
the allowlisted observed-result projection. Tests cover invalid/missing/oversized
input, linked/nonregular input, contradictory results, HTML injection and derived
observed-only money display. The presentation follow-up reran the affected renderer
tests and actual render successfully; the earlier validation remains separate. These
are local selected-path results, not hosted CI or independent evidence attestation.
Generated outputs and raw provider responses are deliberately not committed.

## Maintainer projection and operator replay

Use released Ota v1.6.28 or later and existing Node 24 native TypeScript support.
The maintainer must qualify binaries and validate CURRENT `ota.yaml` before
replay. No dependencies, installs, secrets, provider access, or direct Node
bypass are required or authorized by this README.

Supply the allowlisted version 1 projection in local `evidence/review.json`:
`origin` (`observed` or `fixture`), seeded scenario rule/domain/diff, explicit
Bobai case acceptance, two completed request records (model, hashes, token
counts), execution-time and renderer contract/checker identities, all three
semantic cases and GOOD/BAD/REPAIRED totals/exits/source identities, original
shallow expectations and all three runs, supporting admission refusal, and
honest limits. `tools/report.mjs` validates the fixed interface; it does not
read raw model responses, secrets, or external case files.

The minimal `{ "version": 1, "origin": "fixture" }` is intentionally incomplete:
it produces FIXTURE-labelled UNKNOWN, never a manufactured passing sample.
Complete synthetic inputs remain visibly FIXTURE, never actual Meta evidence.
Malformed, missing, oversized (over 128 KiB), or contradictory inputs produce
UNKNOWN HTML and a nonzero exit. Valid projections render with exit zero.

After qualification, the operator runs:

```text
ota run verify:report --agent
ota run report:render --agent
```

The renderer reads only `evidence/review.json` and writes only
`evidence/report.html`. It accepts no path arguments. Importing
`renderReport(input)` does not run the CLI or write files. Renderer tests own
isolated directories under ignored `evidence/` and remove only their artifacts.
Those two tasks were executed in the maintainer's disposable validation copy;
replaying them elsewhere requires the separately supplied projection. The tests'
synthetic observed-branch inputs are labelled test fixtures, not real model calls.

For checkout replay use separate GOOD, BAD, and REPAIRED copies, retaining exact
source, checker, contract, and diff identities. Keep the accepted checker and
original checks identical across copies. In each copy run
`ota run verify:shallow --agent`, preview
`ota run verify:semantic --agent --dry-run --json`, then run
`ota run verify:semantic --agent`. Preserve all rows, stdout/stderr and exits;
do not weaken the positive control or turn intentional BAD FAIL green.
For the supporting refusal, observe marker absence before and after
`ota run demo:excluded --agent`; require `requested_task_not_safe`, not a missing
task, parser, or runtime failure. Never bypass agent admission.

## Contract time and proof limits

Past model-loop executions bind execution-time contract:

```text
5e0cd03079260c99462e2c9c11af68a55779888f15affe486cc0764eb0dc168c
```

Adding renderer tasks changes CURRENT `ota.yaml`. Supply its distinct identity
as `rendererContract`, alongside `executionContract`; do not relabel past runs
with the new contract. The card displays both supplied identities without
recomputing hashes or independently verifying execution or attestation.
The locally validated renderer contract is
`0745cf6b889afb2700820f69c6540182db9eeacc35539d8b4ae348422e34c27d`.

SCOOBY owns technical review/corrections; MUSE owns acceptance. Bobai accepted
the proposed cases. The static card is a maintainer-supplied projection, not an
approval engine. Ota is the backstage execution rail, not the main product story.
Selected seeded examples prove neither all baskets nor production payment
safety, merge enforcement, full agent containment, customer savings, or model
superiority. No universal or customer claim follows.

Keep `evidence/` and `.demo-scratch/` local and ignored. No keys, private case
records, personal/employer/customer material, or invented public evidence belong
in the source or card.
