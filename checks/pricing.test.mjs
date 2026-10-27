import assert from "node:assert/strict";
import test from "node:test";
import { priceCart as original } from "../pricing/original.ts";
import { priceCart as changeA } from "../pricing/change-a.ts";
import { priceCart as changeB } from "../pricing/change-b.ts";

function cart(...entries) {
  return Object.freeze(
    entries.map(([amount, discountEligible]) =>
      Object.freeze({ amount, discountEligible }),
    ),
  );
}

// Expected amounts are fixed arithmetic witnesses, not another pricing implementation.
const witnesses = [
  ["minimum eligible amount", cart([100, true]), 90],
  ["minimum ineligible amount", cart([100, false]), 100],
  ["eligible subtotal below voucher range", cart([9000, true]), 8100],
  ["10000 before discount is below voucher threshold", cart([10000, true]), 9000],
  ["largest reachable eligible subtotal below threshold", cart([11100, true]), 9990],
  ["smallest reachable eligible subtotal above threshold", cart([11200, true]), 9580],
  ["eligible subtotal above threshold", cart([12000, true]), 10300],
  ["ineligible amounts do not qualify a cart", cart([100000, false]), 100000],
  ["mixed cart below eligible threshold", cart([10000, true], [100000, false]), 109000],
  ["mixed cart nearest lower threshold", cart([11100, true], [900, false]), 10890],
  ["mixed cart above eligible threshold", cart([11200, true], [500, false]), 10080],
  ["eligible lines aggregate before voucher", cart([6000, true], [6000, true]), 10300],
  ["four eligible lines receive one voucher", cart([2800, true], [2800, true], [2800, true], [2800, true]), 9580],
  ["two large eligible lines receive one voucher", cart([12000, true], [12000, true]), 21100],
  ["all eligible maximum amounts", cart([100000, true], [100000, true], [100000, true], [100000, true]), 359500],
  ["all ineligible maximum amounts", cart([100000, false], [100000, false], [100000, false], [100000, false]), 400000],
  ["four mixed lines", cart([6000, true], [6000, true], [100, false], [100000, false]), 110400],
];

for (const [name, implementation] of [["original", original], ["change-b", changeB]]) {
  for (const [description, lines, expected] of witnesses) {
    test(`${name}: ${description}`, () => {
      assert.equal(implementation(lines), expected);
      assert.equal(implementation(lines), expected, "repeated pure calls agree");
      assert.equal(implementation([...lines].reverse()), expected, "line order does not change price");
    });
  }
}

test("change-a: discount and voucher threshold interaction is observable", () => {
  const lines = cart([10000, true], [100000, false]);
  // 10000 * 90% = 9000; no voucher; unchanged ineligible amount = 100000.
  assert.equal(original(lines), 109000);
  assert.equal(changeB(lines), 109000);
  assert.equal(changeA(lines), 108550);
  assert.notEqual(changeA(lines), 109000);
});

test("change-a: voucher must not itself be percentage-discounted", () => {
  const lines = cart([12000, true]);
  // 12000 * 90% - 500 = 10300, not (12000 - 500) * 90% = 10350.
  assert.equal(original(lines), 10300);
  assert.equal(changeB(lines), 10300);
  assert.equal(changeA(lines), 10350);
  assert.notEqual(changeA(lines), 10300);
});

test("change-a: simple non-voucher cases remain unchanged", () => {
  assert.equal(changeA(cart([100, true])), 90);
  assert.equal(changeA(cart([100000, false])), 100000);
});
