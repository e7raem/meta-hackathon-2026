# Break This PR

Six checkout checks pass. A shopper who should pay £99.00 gets charged £94.50.
Break This PR uses Meta's **Muse Spark 1.3** to find baskets the tests missed,
runs them against the checkout change, and lets you save a regression test.

In the demo, Muse suggested a £110.00 basket. The 10% discount brings it below
the £100.00 voucher threshold, but the refactor checks eligibility too early
and gives the shopper a voucher anyway. The pre-reviewed correction brings
the charge back to £99.00.

## Quick Start

With Ota and Node.js installed, run Preview to try it without an API key:

```sh
git clone https://github.com/e7raem/meta-hackathon-2026.git
cd meta-hackathon-2026
ota run demo:preview
```

Open [the app](http://127.0.0.1:48761/) when Ota reports readiness. Preview
uses scripted results: it makes no model calls and runs no checkout code.
For actual execution and Muse calls, use [live mode](#live-mode). Both modes
use the same port; stop one with Ctrl-C before starting the other.

## How It Works

1. Run the three existing baskets against both versions of the code.
2. Ask Muse to read the [pricing rule](pricing/rule.json) and find a new basket
   worth testing. Review the expected total before running it.
3. Run the checkout code and compare what it charged with what the rule says.
4. Check the pre-reviewed correction and save the failing case as a regression
   test. You can also send the observed results back to Muse for an explanation.

The app has two sample refactors: A checks the voucher too early, and C
counts full-price items toward voucher eligibility. For A, you can also ask
Muse for a patch. Muse chooses from a fixed set of pricing expressions.
The runner checks the same regression test and all six baseline assertions
in temporary copies. It doesn't apply the patch to the checkout.

## Live Mode

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

```sh
ota run demo:record
```

This starts a 20-minute session with two Muse requests. Startup, the baseline,
charge comparison and pre-reviewed correction make no model calls. If you want
Muse to propose a patch, save the second request for it instead of using feedback.
The request limit is not a provider billing cap.

<details>
<summary>Change the session length or request limit</summary>

Use the qualified binaries on `PATH`. Start a new session with 1–60 minutes
and 1–6 requests. For example:

```sh
export META_DEMO_KEY_FILE="$HOME/.config/meta-hackathon-2026/model-api-key"
export META_DEMO_OTA_EXECUTABLE="$(command -v ota)"
export META_DEMO_SESSION_MINUTES=30
export META_DEMO_REQUEST_LIMIT=3
export META_DEMO_APPROVAL_FILE="$(pwd -P)/evidence/live/custom-$(date -u +%Y%m%dT%H%M%SZ)/approval.json"
ota run demo:live:budget && ota run demo:live
```

Session records and exported tests stay in ignored `evidence/live/`. Start a
new session if the source or binaries change; don't reset an old budget. Use
the app to run an exported test against both versions. The downloaded file
isn't a standalone checkout.

</details>

## Run The Tests

Use Node 24.22.1. These checks need no API key or model calls.

### Humans

```sh
ota validate
ota run verify:baseline
ota run verify:baseline:c
ota run verify:pricing
ota run verify:web
```

### Agents

```sh
ota validate
ota run verify:baseline --agent
ota run verify:baseline:c --agent
ota run verify:pricing --agent
ota run verify:web --agent
```

For the full offline suite, including Preview and the before/after execution
checks, use a trusted Ota 1.6.28 binary:

```sh
export OTA_DEMO_TEST_OTA="$(command -v ota)"
export OTA_DEMO_TEST_OTA_SHA256="$(shasum -a 256 "$OTA_DEMO_TEST_OTA" | awk '{print $1}')"
ota run verify:live-mvp
```

## Scope

Built for the Meta AI Developer Hackathon using the existing Ota task runner.
This is a local demo for two prepared checkout changes, not a general PR
reviewer or a guarantee that a payment system is correct.
