import { checkoutTotal } from "../src/checkout.ts";

// Meta-proposed cases accepted by Bobai and implemented by the maintainer.
const cases = [
  {
    name: "ineligible line",
    lines: [{ amount: 10000, discountEligible: false }],
    expected: 10000,
  },
  {
    name: "eligible and ineligible lines",
    lines: [
      { amount: 10000, discountEligible: true },
      { amount: 2000, discountEligible: false },
    ],
    expected: 11000,
  },
  {
    name: "two ineligible lines",
    lines: [
      { amount: 5000, discountEligible: false },
      { amount: 3000, discountEligible: false },
    ],
    expected: 8000,
  },
] as const;

let hasMismatch = false;

for (const testCase of cases) {
  const actual = checkoutTotal(testCase.lines);
  const passed = actual === testCase.expected;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${testCase.name}: expected ${testCase.expected}, actual ${actual}`,
  );
  hasMismatch ||= !passed;
}

if (hasMismatch) {
  process.exitCode = 1;
}
