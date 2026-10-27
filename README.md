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
   Run those same baskets against the fixed pre-reviewed correct refactor B.
   Then optionally give Muse the bound actual results for **one feedback turn**:
   a short explanation and zero to two additional data-only baskets. Follow-ups
   are outcome-informed, not uncoached discovery. Review their expected totals
   independently before running them on original/A/B. There is no recursive loop.
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

### Bounded Feedback And Retained Continuity

`/api/control` executes exactly the selected accepted baskets against B; a passing
control means **no counterexample in those cases**, not approval of the entire PR.
`/api/feedback` accepts only a matching initial reproduced run and fresh successful
control. Its server-built packet binds source/rule, case, run, control and provenance
identities. The response must echo the binding/run and the complete set of actual
fault case IDs. Muse cannot supply executable code, a repair, an arbitrary path,
URL or command. Its explanation is interpretation, never a replacement for results.

STOP with no new cases is valid. Duplicate baskets are unhelpful/inconclusive;
wrong bindings, invented/omitted observed faults and malformed replies refuse.
Every feedback attempt writes an exclusive durable root-proposal marker and
reserves from the same six-total ledger before dispatch. New run, control or
request IDs cannot reopen that allowance. Errors and uncertain outcomes are not
retried. Initial and feedback usage/evidence are separate; unknown usage stays null.

Owner approval may add exactly one optional `retainedCheckpoint: {path, sha256}`.
This is an absolute owner-only private startup file, never a public import API.
The bounded file must be regular, singular, owner-0400 and reached without links.
Its exact version-1 projection contains `scopeId`, `recordedAt`, source identities
`{rule,original,candidate,control}`, `model: {responseId,recordSha256,createdAt}`, the
derived `proposal`, original `accepted`, `comparison`, their `recordHashes`,
original accepted/comparison file hashes in `sourceRecordHashes`, fixed
`proposalProvenance: "DERIVED_FROM_RETAINED_MODEL_AND_ACCEPTANCE"`, and the original
`reviewEvidence` declaration. Record hashes are SHA-256 of each projection's
`JSON.stringify` bytes; the model record hash identifies the separately retained
owner evidence, not an independently fetched or authenticated provider attestation.
The prior runtime did not save a standalone proposal file. Its projection is
derived from the retained model's final cases and the accepted proposal reference;
its newly computed projection hash is not called a historical proposal-file hash.
The whole-file hash is independently pinned in owner approval. Exact sources,
record hashes, case/rule arithmetic, record linkage and result status are rechecked.

The UI prominently labels this **retained live initial evidence**, preserving its
original IDs, operator-review origin and time. It imports no baseline/control
success, new provider permission or named-human identity. Fresh baseline and
fresh B control on the new source remain required before feedback. The ordinary
initial-proposal endpoint is refused in retained mode before any reservation or
provider dispatch, even after a fresh baseline passes. The ordinary
fresh initial-to-feedback flow is supported, but qualifying it with mocks is not
a fresh two-request live demonstration. Prior runtime evidence never automatically
qualifies the new feedback implementation. Existing root regression selection
remains separate from follow-up exploration.

## Observed Feedback Walkthrough

On 27 October 2026, MUSE operated frozen R5 runtime source
`8b6b52682a2ac60a23d3dc6e8cc295cfd5a74d6c`. This deliberately continued the
**retained initial live cases**, rather than claiming a fresh initial discovery.
The selected new results are supported by retained execution/model records:

- A fresh baseline passed all six assertions. A fresh original/B control returned
  `NO_COUNTEREXAMPLE`: the two retained baskets matched GBP90 and GBP175 on both
  original and the pre-reviewed correct refactor. This is selected-case evidence,
  not whole-PR approval or a measured false-positive rate.
- One real Muse feedback request used 1706 input / 1941 output tokens. It explained
  the observed pre-discount voucher threshold and discount-after-voucher fault,
  then chose **STOP** with no new cases. No follow-up-case live execution occurred.
- A fresh export retained the same test SHA-256
  `61f707ad9ca28df195d18203cf4cbc454a39ec97ff0d262f18b67e5ee0803082`.
  Fresh declared native verification returned red: exit1/two assertion failures;
  green: exit0/two passes, no skips/cancellations, same test bytes. The correction
  remained pre-reviewed, not Muse-generated. MUSE's reconciliation and VLAD's
  independent evidence review confirmed the owned verification directories absent.

The timestamped browser capture spans **135.915 seconds / 19 frames**. MUSE
observed document width equal to scrollWidth at actual 530px, 375px and 1265px
viewports, with narrow code scrolling internally. These are MUSE's browser
observations, not a second independent DOM review. MUSE reconciled all thirteen
runtime pins and the preserved five-reservation prefix plus request six. VLAD's
independent live-evidence review reported no material findings and accepted the
bounded STOP/control/same-test result, not general correctness or live follow-ups.
All six requests are consumed; no further provider call is available or authorized.

### Review Video

The local review copy is complete: `evidence/break-this-pr-feedback-demo.mp4`,
**168 seconds (2:48)**, H.264 1280x720 at 24fps, AAC narration and English soft
subtitles. The voice is **synthetic macOS Daniel, English UK, not Bobai**. It uses
twelve actual captured browser-state shots with edited cuts/holds and shortened
waiting; it is **not a continuous full-motion recording**. The raw capture's
135.915-second timing remains separate from the edited video's duration.

SHA-256: `c473cae4e14a902a20a2ffdeda60ce5701276ef8e9cdfb9b3d31ef5db743a19d`.
MUSE checked full decode and encoded frames at 100s/150s; the copied file's digest
matches. The video is an ignored local review artifact, not committed, hosted,
uploaded or submitted. It demonstrates the accepted STOP branch only; there was
no live follow-up-case generation/execution. Review-copy readiness is not a merge,
identity-attestation or submission decision. Process shutdown is a separate
operator-owned action, not established by the video or evidence review.

## Prior Full-Flow Rehearsal (Before Feedback)

On 27 October 2026, the selected local flow on frozen runtime source
`df39d0eac5104250fed4910332f86e0e72cc4201` completed in **158.41 seconds**,
including the actual provider wait. At 1280 x 720 the opening baseline button
was visible, with its bottom at 476px. This was a prepared sample, not a real
customer PR or production checkout.

The baseline actually passed all six assertions. A real Muse response then
proposed two untouched baskets; technical reviewer MUSE checked their expected
totals against the independent rule before accepting and running them. That is
not a claim of Bobai/human-identity approval.

| Eligible basket | Reviewed total | Original | Proposed | Observed impact |
| --- | ---: | ---: | ---: | --- |
| GBP100 | GBP90 | GBP90 | GBP85.50 | Shop undercharges GBP4.50 |
| GBP200 | GBP175 | GBP175 | GBP175.50 | Customer overcharged GBP0.50 |

The actual generated regression test SHA-256 was
`61f707ad9ca28df195d18203cf4cbc454a39ec97ff0d262f18b67e5ee0803082`.
Declared Ota verification ran the SAME test bytes red (exit 1, two actual
`ERR_ASSERTION` failures), then green (exit 0, two passes, no skips/cancellation)
after only the pre-reviewed implementation correction in a disposable copy.
The correction was not generated by Muse. Owned copies were actually removed;
the real worktree and all thirteen pinned runtime files remained unchanged.

This proves the selected local baseline/case-review/reproduction/retained-test/
red-green path and timed walkthrough, not all baskets, CI, customer adoption,
paid value, arbitrary-code containment or production assurance.

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
The previous runtime's selected local checks passed 94/94: baseline 6, controller 25, delivery 5,
UI 21 and separate pricing/witness controls 37. The authored offline integration
fixtures and the real live rehearsal above remain separate evidence.

The feedback candidate's selected offline qualification passed **115/115**:
baseline 6, controller/checkpoint 36, delivery 6, UI 30, separate pricing controls
37; zero failed/skipped/cancelled checks. This includes parsing the owner's actual
pinned retained checkpoint against the current rule/original/A/B identities and
real native A/B controls on authored cases. Supply both optional
`OTA_DEMO_TEST_CHECKPOINT` and `OTA_DEMO_TEST_CHECKPOINT_SHA256` only for that
owner-checkpoint check; without them, the controller suite has 35 synthetic checks.
No actual checkpoint is copied into the repository or published. These results
are not a fresh provider feedback call, browser/viewport check, timed demo or
production qualification. New runtime adoption remains owner-controlled.
Fresh retained-root exports/proofs append request-specific evidence records;
they never overwrite the earlier run's historical export/proof records.

## Live Rehearsal Boundary

The observed result above binds the reviewed frozen runtime, not future commits
or every execution path. Earlier prototype results remain historical;
see [the draft PR evidence](https://github.com/ota-run/meta-hackathon-2026/pull/1)
and [the historical checkout card](#historical-static-evidence-card). No old run
is relabelled as this source's passing-baseline/red-green proof.

`META_DEMO_APPROVAL_FILE` names a private owner approval binding source, Node and
released Ota identities, saved key path, deadline and six-total request ledger.
It contains no key. The original rehearsal retained four historical reservations
and consumed the fifth; the R5 feedback used the sixth. **All six are consumed,
with no request remaining.** Migration/cleanup remain operator-owned; preserve
immutable history and the established counter rather than resetting either.
The app has no renewal/reset endpoint and normal startup never initializes state.
No command or agent-safe declaration here grants service/provider authority.
The feedback addition does not renew that window or expand the remaining allowance.

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
