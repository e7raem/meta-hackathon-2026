# Break This PR

**Catch checkout regressions that green baseline tests miss, then keep a test
that fails on the faulty code and passes on the reviewed correction.**

**Video:** [Watch the 2:48 demo](VIDEO_URL_PENDING)

This is one prepared checkout-refactor example, not a real customer's PR or a
hosted application. The video is the judge entry point; the selected offline
checks below are reproducible without a model account.

## Three Steps

1. **Start green.** Run the same three ordinary baskets against original and
   proposed code: six passing baseline assertions, without voucher-boundary coverage.
2. **Find the missing basket.** Meta's `muse-spark-1.3` proposes data-only cases.
   An operator checks expected totals against the independent shop rule before
   the fixed runner executes them. Compare the same cases against the reviewed
   correction, then give Muse the actual results for one bounded feedback turn.
3. **Keep the regression.** Export a fixed-template test and run its identical
   bytes red on faulty A, then green with only the pre-reviewed B correction
   applied in a disposable copy. Muse does not write or execute the repair.

The rule: take 10% off eligible items, apply one GBP5 voucher only when their
**post-discount** subtotal reaches GBP100, then add unchanged ineligible items.

## What It Caught

| Eligible basket | Rule / original | Proposed A | Impact |
| --- | ---: | ---: | --- |
| GBP100 | GBP90 | GBP85.50 | Shop undercharges GBP4.50 |
| GBP200 | GBP175 | GBP175.50 | Customer overcharged GBP0.50 |

These cases came from an earlier real Muse response. The final live walkthrough
**retained that initial evidence**, then ran a fresh six-pass baseline, a fresh
original/B control matching GBP90/GBP175, one real feedback request, and a fresh
same-test red2/green2 proof. Muse explained the threshold/order fault and chose
**STOP with zero new cases**. Live follow-up-case generation/execution was not
demonstrated; that branch has offline fixture coverage only.

MUSE's reconciliation and VLAD's independent review found no material issues in
this bounded result: thirteen runtime pins matched, the prior five reservations
were preserved, request six was recorded, and owned verification directories were
absent. B's selected-case agreement is not general correctness or a measured
false-positive rate. The exact test identity and prior runs are in the
[development history](docs/development-history.md).

## Built October 26-27

New for this project: the checkout-review UI, prepared pricing refactor, fixed
runner, rule-based expectation review, bounded Muse proposal/feedback loop,
retained-evidence continuity, regression export and same-test red/green workflow.
The edited demo shows those pieces working together.

**Ota v1.6.28 already existed.** It is the backstage execution rail for declared
tasks and verification, not a newly built hackathon product. Muse supplies cases
and interprets observed results; trusted native code runs the checks; the fixed
correction was reviewed in advance. No model-generated executable code is run.

## Inspect And Reproduce

Start with [the written rule](pricing/rule.json), [original](pricing/original.ts),
[proposed A](pricing/change-a.ts) and [reviewed B](pricing/change-b.ts). The
[controller](tools/live-demo.mjs), [fixed runner](tools/pricing-runner.mjs),
[UI](web/), [checks](checks/) and [execution contract](ota.yaml) expose the flow.

Selected reference environment: **macOS / Apple Silicon, Node v24.22.1 and an
already-qualified released Ota v1.6.28** on PATH. No package install, dependency
hydration, API key or server is required for these existing offline tasks:

```sh
ota validate
ota run verify:baseline --agent
ota run verify:pricing --agent
ota run verify:web --agent
```

Those paths cover 73 selected checks. For the full offline aggregate, also set
`OTA_DEMO_TEST_OTA` to the absolute path of the qualified Ota executable and
`OTA_DEMO_TEST_OTA_SHA256` to its independently verified SHA-256, then run:

```sh
ota run verify:live-mvp --agent --dry-run
ota run verify:live-mvp --agent
```

The full public aggregate covers **114 checks**, including real nested declared
Ota execution in owned disposable copies. The recorded 115th check parsed a
private owner-pinned checkpoint; it is not required for public reproduction.
Fixtures are not new model evidence. `verify:export` requires an actual persisted
export and intentionally fails on faulty code; a fresh clone does not contain one.

## Demo Limits

The 2:48 video uses twelve actual browser-state shots with edited cuts/holds and
shortened waiting, English subtitles and synthetic Daniel English UK narration
**not Bobai's voice**. It is not continuous full-motion capture; the raw browser
capture lasted 135.915 seconds. No whole-PR approval, production payment assurance,
CI proof, universal correctness, identity attestation or independent OS sandbox
is claimed. The native runner executes only this reviewed prepared sample.

The recorded live service is stopped and all six requests are consumed. There
is no public one-click live setup or hosted app; this README does not authorize
a restart, budget reset or provider request. Historical prototypes and detailed
audit records live in one [archived development history](docs/development-history.md).
