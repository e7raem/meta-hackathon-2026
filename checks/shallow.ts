import assert from "node:assert/strict";
import { checkoutTotal } from "../src/checkout.ts";

const cases = [
  {
    name: "one eligible line",
    lines: [{ amount: 10000, discountEligible: true }],
    expected: 9000,
  },
  {
    name: "two eligible lines",
    lines: [
      { amount: 10000, discountEligible: true },
      { amount: 2000, discountEligible: true },
    ],
    expected: 10800,
  },
] as const;

for (const testCase of cases) {
  const actual = checkoutTotal(testCase.lines);
  assert.equal(
    actual,
    testCase.expected,
    `${testCase.name}: expected ${testCase.expected}, got ${actual}`,
  );
  console.log(`PASS ${testCase.name}: ${actual}`);
}
