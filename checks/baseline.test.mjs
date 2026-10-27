import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { priceCart as original } from "../pricing/original.ts";
import { priceCart as proposed } from "../pricing/change-a.ts";

// Public ordinary coverage only. Deliberate regression witnesses live elsewhere.
const coverage = JSON.parse(readFileSync(new URL("../pricing/baseline.json", import.meta.url), "utf8"));
for (const [name, implementation] of [["original", original], ["proposed", proposed]]) {
  for (const item of coverage.cases) {
    test(`${name}: ${item.title}`, () => {
      assert.equal(implementation(item.lines), item.expectedTotal);
    });
  }
}
