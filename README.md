# Break This PR

**Find checkout bugs your passing tests missed.**

Break This PR helps developers catch incorrect charges before merging a checkout
refactor, even when its existing tests pass. Meta's **Muse Spark 1.3** finds missing
shopping baskets from the pricing rule and code change. A developer checks the
expected totals, then a fixed runner reproduces the defect. The result is a
regression test that fails on the faulty code and passes on a reviewed correction,
not just another review comment.

## Quick Start

From the checkout root, choose one Ota task:

| What you want | Command |
| --- | --- |
| Explore the app without an API key or model calls | `ota run demo:preview --agent` |
| Record the live Muse demo | `ota run demo:record --agent` |

Open [the app](http://127.0.0.1:48761/) when Ota reports readiness. Both modes
use the same port, so stop one with Ctrl-C before starting the other. If you're
recording, start the app off camera and open the video on the checkout review.
See [one-time setup](#one-time-setup) and [what to change](#what-to-change) below.

## The Problem

A pricing change can pass its tests and still charge customers the wrong amount.
The tests may cover ordinary purchases but miss the interaction between a
discount and a voucher threshold.

In prepared change A, both the original code and the proposed refactor pass the
same three baseline cases: **six passing assertions**. In the verified live run
on 28 October, Muse proposed three new baskets that exposed what those checks missed:

| Basket | Correct charge | Proposed code | What goes wrong |
| --- | ---: | ---: | --- |
| GBP110 eligible | GBP99 | GBP94.50 | Shop undercharges GBP4.50 |
| GBP200 eligible | GBP175 | GBP175.50 | Customer overcharged GBP0.50 |
| GBP150 eligible + GBP50 full-price | GBP180 | GBP180.50 | Customer overcharged GBP0.50 |

The [shop rule](pricing/rule.json) is simple: take 10% off eligible items, apply
one GBP5 voucher only when their **discounted** subtotal reaches GBP100, then
add full-price items unchanged. The faulty refactor changes that order.

## How It Works

1. **Run the existing tests.** See the original and proposed code pass the same
   baseline, then inspect the rule and code change.
2. **Ask Muse for a missing case.** Muse reads the rule and both implementations
   and proposes structured basket data, not executable code. Check each expected
   total against the rule before running it.
3. **Reproduce the defect.** Compare the original and proposed prices. Run the
   same baskets against a correct refactor to check that the test distinguishes
   the faulty change from the reviewed correction.
4. **Give Muse the results (optional).** One feedback turn explains the observed failures
   and can stop or suggest up to two additional baskets for separate review.
5. **Test a fix and keep the regression.** In A, lock the test and prove it fails
   before asking Muse for a patch. The runner builds the patch from allowlisted
   pricing expressions and checks the identical regression test plus the six
   original assertions in disposable copies. Review the diff before applying
   anything. C and the no-model walkthrough use a pre-reviewed correction.

### Two Prepared Changes

Choose A or C in the local UI. Both use the same written rule and ordinary
baseline baskets, but each has its own selected code, baseline and evidence chain.
A is the discount/voucher-order example above. C is another prepared refactor
which incorrectly lets full-price items qualify a basket for the voucher.

C's authored offline witnesses include GBP80 eligible plus GBP30 full-price:
the rule gives GBP102, while C gives GBP97. A GBP120 all-ineligible basket must
stay GBP120, but C gives GBP115. Correct control B matches the rule; C also
matches B for an eligible GBP120 basket (GBP103). These are engineering fixtures,
not claimed Muse discoveries. Witnesses, corrected B and test expectations are
not included in the initial model packet, which contains only the rule and
selected original/proposed source.

Switching changes clears scenario-specific UI results, never the shared session's
request count or deadline. The selector is disabled while an operation is pending.
This is a fixed two-example demo, not arbitrary repository ingestion.

## Why Muse

Muse does the reasoning work between the business rule and the code: looking for
inputs that expose a difference the existing tests overlook. After execution,
it receives the actual results so its explanation can address a demonstrated
failure rather than speculate about one.

The model's answer is a hypothesis, not the verdict. Expected totals are checked
independently, and Node runs the comparison and regression tests. Muse cannot
issue shell commands or supply arbitrary code. The optional A repair changes only
three pricing statements via a closed expression list, and never edits the checkout.
Model calls use low reasoning effort within the fixed 4,096-output-token limit.

In A's verified live run on 28 October, Muse proposed the three baskets above.
The original and reviewed correction matched their expected totals; the faulty
refactor did not. Muse then received those execution results, explained the
discount/voucher error and chose to stop. The identical exported test failed all
three cases on the faulty code and passed all three on the correction.

C's separate live run on 27 October reproduced incorrect charges on three baskets. Its
feedback proposed two further baskets, which were checked and run without finding
another defect. That run predates the latest feedback-effort adjustment. These
are recorded prepared-example runs, not a measured success rate across real PRs.

## Run The App

### One-Time Setup

Use the reference setup: **macOS on Apple Silicon, Node.js 24.22.1 and
[Ota](https://github.com/ota-run/ota) 1.6.28**. No npm dependencies are needed.
Preview uses the Node executable on `PATH`; it has been checked on Node 24.22.1
and 26.5.0. For live recording, keep Node 24.22.1 and released Ota 1.6.28 on
`PATH`, or point the local `node` and `ota` executables or symlinks in
`$HOME/.config/meta-hackathon-2026/` to those binaries. The recording task
prefers those local entries; the outer `ota` command still needs to be on `PATH`.

For live mode only, confirm your Meta credits and put the API key in
`$HOME/.config/meta-hackathon-2026/model-api-key`, outside the checkout. The key
must be a regular file you own, not a symlink, with mode `600`. Do not put it
in a command, browser code, recording or committed file.

### Preview vs. Live

- **Preview** is a reloadable, authored walkthrough of both examples. Its
  **FIXTURE** labels mean no model request, pricing execution or real test run.
  Downloaded samples are inert. Run `ota run verify:preview --agent` to check
  the preview's isolation and flow.
- **Live** starts a fresh 20-minute session with two Muse requests. Startup
  makes none. In A, use the two requests to find a breaking basket and propose
  a patch; skip optional feedback. Running the baseline, comparing charges
  and running the pre-reviewed control use no model requests. The local
  request limit is not a provider billing cap.

### What To Change

| Setting | Where to change it |
| --- | --- |
| Meta key | Replace the private `model-api-key` file for the next session. For a different file path, use `META_DEMO_KEY_FILE` with the explicit tasks below. |
| Local Node or Ota binary | Update the local `node` or `ota` entry described above, or select the qualified version on `PATH`. |
| Session length or request count | Set `META_DEMO_SESSION_MINUTES` (1-60) and `META_DEMO_REQUEST_LIMIT` (1-6) for a **new** session using the explicit tasks below. To change the shortcut's defaults for everyone, edit `prepareRecording()` in [`tools/live-demo.mjs`](tools/live-demo.mjs) and keep the contract, docs and tests aligned. |
| Port | Currently fixed at `127.0.0.1:48761`. A code change must keep the surface and task bindings in [`ota.yaml`](ota.yaml), the listener and origin/Host checks in [`tools/live-demo.mjs`](tools/live-demo.mjs), and the preview listener in [`tools/fixture-preview.mjs`](tools/fixture-preview.mjs) aligned. |
| Pricing rule or example | Edit [`pricing/rule.json`](pricing/rule.json) or the corresponding [implementation and baseline](pricing/), then rerun verification. Preview's authored cases live in [`fixtures/preview.json`](fixtures/preview.json). |

For custom live settings, use the qualified binaries on `PATH`. Example: a
30-minute session with three requests, including optional feedback.

```sh
export META_DEMO_KEY_FILE="$HOME/.config/meta-hackathon-2026/model-api-key"
export META_DEMO_OTA_EXECUTABLE="$(command -v ota)"
export META_DEMO_SESSION_MINUTES=30
export META_DEMO_REQUEST_LIMIT=3
export META_DEMO_APPROVAL_FILE="$(pwd -P)/evidence/live/custom-$(date -u +%Y%m%dT%H%M%SZ)/approval.json"
ota run demo:live:budget --agent && ota run demo:live --agent
```

Ota's live tasks retain the private approval, budget and evidence under ignored
`evidence/live/`. Preparation pins the sources and the Node/Ota binaries.
Create a new session after a source or binary change, or when the session
expires; don't edit or reuse the old approval or reset its budget.

Exports are saved under the session's `exports/<export-id>/regression.test.mjs`.
The app runs identical test bytes in disposable copies through `verify:export`.
A downloaded test is not a standalone checkout; use the app's regression
action to see the paired red/green proof.

## Run The Tests

```sh
git clone https://github.com/e7raem/meta-hackathon-2026.git
cd meta-hackathon-2026

ota validate
ota run verify:baseline --agent
ota run verify:baseline:c --agent
ota run verify:pricing --agent
ota run verify:web --agent
```

These test tasks cover both selected baselines, pricing and UI checks without an API key or a Meta request:

| Task | What it checks |
| --- | --- |
| `verify:baseline` | Six ordinary assertions pass on both original and proposed code. |
| `verify:baseline:c` | The same six assertions against original and selected C. |
| `verify:pricing` | Pricing arithmetic and the prepared faulty/correct implementations. |
| `verify:web` | The browser workflow using mocked responses, including review and error states. |

For the full offline suite, select a trusted released Ota executable
and bind the integration tests to that exact file:

```sh
export OTA_DEMO_TEST_OTA="$(command -v ota)"
export OTA_DEMO_TEST_OTA_SHA256="$(shasum -a 256 "$OTA_DEMO_TEST_OTA" | awk '{print $1}')"
ota run verify:live-mvp --agent
```

This also tests the controller and runs real nested Ota tasks in temporary
copies to verify the unchanged-test failure/pass sequence. Model responses in
the offline suite are fixtures, not fresh Muse results.

## Project Structure

| Location | Purpose |
| --- | --- |
| [`pricing/`](pricing/) | Written rule, ordinary baseline, original code, faulty refactor and correct refactor. |
| [`web/`](web/) | Three-stage review interface. |
| [`tools/live-demo.mjs`](tools/live-demo.mjs) | Local API, Muse requests, reviewed case handling and test export. |
| [`tools/pricing-runner.mjs`](tools/pricing-runner.mjs) | Fixed execution of the prepared checkout implementations. |
| [`checks/`](checks/) | Pricing, UI, controller and execution tests. |
| [`ota.yaml`](ota.yaml) | Named setup requirements and verification tasks. |

## Scope

This prototype reviews **two prepared checkout refactors**, not arbitrary
repositories or production payment systems. Finding no failure in selected
cases is not approval of an entire PR. It runs reviewed sample code, not
untrusted uploaded code in a sandbox.

The new work for the Meta AI Developer Hackathon is the review UI, Muse
proposal/feedback integration, pricing runner and regression-test workflow.
Ota 1.6.28 is an existing tool used to run the declared checks.
