# Break This PR

**Find checkout bugs your passing tests missed.**

Break This PR helps developers review a checkout refactor beyond its existing
tests. Meta's **Muse Spark 1.3** suggests missing shopping baskets; a fixed runner
checks the results against the pricing rule. The developer gets a reproducible
failure and a regression test to keep, not just another review comment.

## The Problem

A pricing change can pass its tests and still charge customers the wrong amount.
The tests may cover ordinary purchases but miss the interaction between a
discount and a voucher threshold.

In this prepared example, both the original code and the proposed refactor pass
the same three baseline cases: **six passing assertions**. Muse suggested two
additional baskets that exposed what those checks missed:

| Eligible items | Correct charge | Proposed code | What goes wrong |
| --- | ---: | ---: | --- |
| GBP100 | GBP90 | GBP85.50 | Shop undercharges GBP4.50 |
| GBP200 | GBP175 | GBP175.50 | Customer overcharged GBP0.50 |

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
4. **Give Muse the results.** One feedback turn explains the observed failures
   and can stop or suggest up to two additional baskets for separate review.
5. **Keep the test.** Export a regression test and run its identical contents
   against the faulty and corrected code: failing before the fix, passing after.

The correction is supplied and reviewed in advance; Muse does not write the fix.

## Why Muse

Muse does the reasoning work between the business rule and the code: looking for
inputs that expose a difference the existing tests overlook. After execution,
it receives the actual results so its explanation can address a demonstrated
failure rather than speculate about one.

The model's answer is a hypothesis, not the verdict. Expected totals are checked
independently, and Node runs the comparison and regression tests. Muse cannot
issue shell commands or execute generated code through this workflow.

The baskets above came from a real Muse response. A later walkthrough reused
those cases, reran the baseline and correct-version comparison, and sent fresh
results to Muse. It explained the discount/voucher error and chose to stop.
That feedback produced no additional cases; the optional follow-up path is
covered by offline tests, not a demonstrated live result.

## Run The Tests

The reference environment is **macOS on Apple Silicon, Node.js 24.22.1 and
[Ota](https://github.com/ota-run/ota) 1.6.28**. The contract requires that Node
version and uses existing tools; there are no npm dependencies to install.

```sh
git clone https://github.com/ota-run/meta-hackathon-2026.git
cd meta-hackathon-2026

ota validate
ota run verify:baseline --agent
ota run verify:pricing --agent
ota run verify:web --agent
```

These three test tasks cover **73 checks** without an API key or a Meta request:

| Task | What it checks |
| --- | --- |
| `verify:baseline` | Six ordinary assertions pass on both original and proposed code. |
| `verify:pricing` | Pricing arithmetic and the prepared faulty/correct implementations. |
| `verify:web` | The browser workflow using mocked responses, including review and error states. |

For the full **114-check offline suite**, select a trusted released Ota executable
and bind the integration tests to that exact file:

```sh
export OTA_DEMO_TEST_OTA="$(command -v ota)"
export OTA_DEMO_TEST_OTA_SHA256="$(shasum -a 256 "$OTA_DEMO_TEST_OTA" | awk '{print $1}')"
ota run verify:live-mvp --agent
```

This also tests the controller and runs real nested Ota tasks in temporary
copies to verify the unchanged-test failure/pass sequence. Model responses in
the offline suite are fixtures, not fresh Muse results.

### Interactive Demo

The browser UI is in [`web/`](web/), served by
[`tools/live-demo.mjs`](tools/live-demo.mjs) on `http://127.0.0.1:48761`.
The recorded live window ended on October 27, 2026 at 14:00 UTC. This version
blocks startup after that fixed source deadline; configuration alone cannot
reopen it. A new live demo requires a reviewed source and configuration update.
Use the offline commands above to reproduce the test coverage without provider
credentials. Opening the HTML file alone does not start the backend.

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

This prototype reviews **one prepared checkout refactor**, not arbitrary
repositories or production payment systems. Finding no failure in selected
cases is not approval of an entire PR. It runs reviewed sample code, not
untrusted uploaded code in a sandbox.

Built for the Meta AI Developer Hackathon on October 26-27, 2026: the UI,
Muse proposal/feedback integration, pricing runner and regression-test workflow
are new work. Ota 1.6.28 is an existing tool used to run the declared checks.
