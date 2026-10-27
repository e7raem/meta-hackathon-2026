# Break This PR

**Find checkout bugs before release.** Review one prepared sample checkout PR,
find a missing basket with Muse, and keep a regression test that proves red then
green with a reviewed correction. This is a local demonstration, not an incoming
customer PR, a real shop integration or production payment assurance.

## The Three-Stage Flow

1. **The code change.** Read the sample PR diff and independent shop rule. Run
   the actual baseline: three ordinary baskets against both original and proposed
   code, six assertions in total. Its genuine green result has limited coverage;
   it does not exercise voucher-boundary cases. `pricing/baseline.json` is the
   frozen public baseline. The older deliberate witness suite is not this baseline.
2. **The breaking basket.** Ask Muse for data-only cases, then validate/correct
   each expected total against the rule before running the new case comparison.
   Freeze acceptance, run the comparison and show expected versus actual
   pounds. A proposal that finds nothing is not a discovered bug or approval.
3. **The test to keep.** Persist the generated regression test. Run those exact
   same bytes through declared Ota tasks in private faulty/corrected checkouts.
   Only the reviewed implementation correction changes; the original worktree,
   test and expected values do not. The prepared correction reuses reviewed
   `pricing/change-b.ts`; it is explicitly **not a Muse-generated fix**.

The independent rule takes 10% off eligible items, then one GBP5 voucher only if
their post-discount subtotal reaches GBP100, then adds unchanged ineligible items.
`pricing/rule.json` is authoritative. Values are pence: 10000 means GBP100. The
prepared domain is 1-4 lines, integer 100..100000 pence in multiples of 100, and
explicit boolean eligibility. No tax, currency conversion or real payments.

`REPRODUCED` requires a meaningful accepted case agreeing with the rule/original
and violating the proposed implementation. Empty output is
`NO_CASES_PROPOSED` / inconclusive, not approval. `NO_COUNTEREXAMPLE` is limited to
completed selected checks, never universal correctness. Red-green requires actual
assertion failures followed by all unskipped assertions passing, unchanged test
hashes and successful copy cleanup. Import/setup/timeout errors are inconclusive.

## Offline Validation

Use already-qualified released Ota v1.6.28 and exactly Node v24.22.1. No install,
package hydration, framework or dependency is needed. For `verify:delivery`, the
operator supplies `OTA_DEMO_TEST_OTA` (the absolute qualified executable path) and
`OTA_DEMO_TEST_OTA_SHA256` (its verified SHA-256); these are not credentials.

```text
ota validate
ota run verify:live-mvp --agent --dry-run
ota run verify:live-mvp --agent
```

The aggregate covers the baseline, separate witness controls, mocked UI/controller
tests and real nested declared Ota executions in owned disposable copies.
`verify:delivery` uses authored integration fixtures, not new Muse output. Tests
write only declared ignored evidence paths and make no provider call or listener.
The live service's baseline uses `verify:baseline`; its red and green copies both
use `verify:export`. Raw logs, counts and source/test identities are retained
behind Evidence rather than substituted with green animations.

## Live Rehearsal Boundary

This new flow needs its own combined-source, offline-copy, independent-review and
actual browser/provider qualification. Earlier prototype results are historical;
see [the draft PR evidence](https://github.com/ota-run/meta-hackathon-2026/pull/1)
and [the historical checkout card](#historical-static-evidence-card). No old run
is relabelled as this source's passing-baseline/red-green proof.

`META_DEMO_APPROVAL_FILE` names a private owner approval binding source, Node and
released Ota identities, saved key path, deadline and six-total request ledger.
It contains no key. Four retained reservations already exist; only the two
unspent requests may be used in the renewed rehearsal. MUSE alone owns explicit
deadline renewal/migration with immutable old history and unchanged counters.
The app has no renewal/reset endpoint and normal startup never initializes state.
No command or agent-safe declaration here grants service/provider authority.

After independent clearance the operator uses `ota run demo:live --agent` on
macOS. The listener binds only `127.0.0.1:48761`; a busy port refuses. The saved
key stays in the trusted HTTPS process, not the browser or verification children.
Children receive a fixed credential-free environment, bounded time/output and
private source copies containing no key, approval, ledger, `.git` or user config.
This is bounded audited prepared-code execution, **not an independent OS sandbox**.
No retry, provider/model fallback, top-up, arbitrary upload or code execution.
Unknown request usage requires a read-only budget refresh, never a guessed count.
Reviewer declarations are not verified Bobai/human identity or a merge decision.

Temporary released-Ota compatibility: only GET `/health` accepts literal portless
Host `127.0.0.1` in addition to `127.0.0.1:48761`. All static/session/POST routes
retain strict Host/Origin/nonce admission. The named Core HTTP-readiness authority
gap and permanent non-default-port/IPv6 fix remain outside this demo's scope.
Ota effects are declarations, not comprehensive network/process containment.

No whole-change, CI, hosted deployment, production, customer adoption, paid value,
false-positive-rate or universal safety claim follows from this prepared example.

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
