# Break This PR

**Find checkout bugs your passing tests missed.**

Break This PR helps developers catch incorrect charges before merging a checkout
refactor, even when its existing tests pass. Meta's **Muse Spark 1.3** finds missing
shopping baskets from the pricing rule and code change. A developer checks the
expected totals, then a fixed runner reproduces the defect. The result is a
regression test that fails on the faulty code and passes on a reviewed correction,
not just another review comment.

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
4. **Give Muse the results.** One feedback turn explains the observed failures
   and can stop or suggest up to two additional baskets for separate review.
5. **Keep the test.** Export a regression test and run its identical contents
   against the faulty and corrected code: failing before the fix, passing after.

The correction is supplied and reviewed in advance; Muse does not write the fix.

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
issue shell commands or execute generated code through this workflow. Both model
turns use low reasoning effort within the fixed 4,096-output-token limit.

In A's verified live run on 28 October, Muse proposed the three baskets above.
The original and reviewed correction matched their expected totals; the faulty
refactor did not. Muse then received those execution results, explained the
discount/voucher error and chose to stop. The identical exported test failed all
three cases on the faulty code and passed all three on the correction.

C's separate live run on 27 October reproduced incorrect charges on three baskets. Its
feedback proposed two further baskets, which were checked and run without finding
another defect. That run predates the latest feedback-effort adjustment. These
are recorded prepared-example runs, not a measured success rate across real PRs.

## Run The Tests

### Reloadable No-Model Preview

```sh
ota run demo:preview --agent
```

Open <http://127.0.0.1:48761/>. The same UI now supports a complete, reloadable
walkthrough of both prepared scenarios, including review, before/after results,
scripted feedback and follow-up, an inert download, and scripted red/green counts.
Every result is labelled **FIXTURE**: no model, pricing code or test is executed.
The server never reads a credential, live approval or live budget and never writes
evidence. Its temporary scripted-turn counter is not model consumption. Reloading
starts a fresh fixture walkthrough; ordinary state refresh preserves that
walkthrough. Wrong expected totals are refused rather than changing canned
results to match. Downloads contain comments only, not executable tests.

The server serves only fixed web assets and bounded loopback API routes. Stop it
with Ctrl-C before starting the live demo on the same port. This mode is for
interface review, not evidence of a model discovery, execution or regression proof.
Run `ota run verify:preview --agent` for its isolation and full-flow checks.

### Offline Checks

The reference environment is **macOS on Apple Silicon, Node.js 24.22.1 and
[Ota](https://github.com/ota-run/ota) 1.6.28**. The contract requires that Node
version and uses existing tools; there are no npm dependencies to install.

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

### Interactive Demo

The local UI uses your Meta account. First save your API key in a private file
**outside this checkout**, such as `$HOME/.config/meta-hackathon-2026/model-api-key`,
with owner-only permissions (`chmod 600` on that file). Do not put the key in
source, a shell command, browser code or a committed environment file.

With the same qualified Node/Ota prerequisites, prepare a new session and start it:

```sh
export META_DEMO_KEY_FILE="$HOME/.config/meta-hackathon-2026/model-api-key"
export META_DEMO_OTA_EXECUTABLE="$(command -v ota)"
export META_DEMO_SESSION_MINUTES=20
export META_DEMO_REQUEST_LIMIT=2
export META_DEMO_APPROVAL_FILE="$(pwd -P)/evidence/live/recording-$(date -u +%Y%m%dT%H%M%SZ)/approval.json"

ota run demo:live:budget --agent
ota run demo:live --agent
```

Open **http://127.0.0.1:48761** after Ota reports readiness. Startup makes no model
request: use the UI to run the baseline, ask Muse, review expected totals and
compare. Two requests allow one initial proposal and one feedback turn; native
baseline, comparison, control and regression checks do not consume model requests.
The limit is shared across both examples. Set it to four if you want one proposal
and one feedback turn for each example.
Press Ctrl-C to stop. The service also stops at its recorded session deadline.

Preparation creates a private approval and ledger under ignored `evidence/live/`,
automatically recording the current sources and Node/Ota executable hashes. No
manual hash list is needed. Choose 1-60 minutes and 1-6 requests. Existing session
directories, legacy approvals, missing/partial ledgers and exhausted budgets are
not reset or silently adopted. Source/binary changes or an expired window refuse
startup. Prepare a deliberately new session path when you need a fresh session;
do not edit stored hashes, limits or deadlines to revive an old one.

If setup reports a missing input, set the named variable above. A private-key error
means the file is missing, linked, inside the checkout or not owner-only. An
existing-scope error means that path is already in use; historical state is kept
unchanged. A partial/locked scope needs investigation, not an automatic retry.
The offline tests do not need a key. Opening `web/index.html` alone does not start
the backend, and historical recorded results are not imported into new sessions.

Exports are append-only: each is saved under that session's
`exports/<export-id>/regression.test.mjs` with its run, scenario and hash record.
The app stages identical frozen test bytes at `evidence/regression.test.mjs` inside
its disposable verification copies and runs `verify:export` there. A downloaded
test is not a standalone checkout; use the UI's regression action for the paired
red/green proof. A later session never overwrites a prior export or the legacy
root artifact.

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
