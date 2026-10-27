import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function isCart(lines) {
  return Array.isArray(lines) && lines.length >= 1 && lines.length <= 4
    && lines.every((line) => line && Object.keys(line).length === 2
      && Object.hasOwn(line, "amount") && Object.hasOwn(line, "discountEligible")
      && Number.isInteger(line.amount) && line.amount >= 100 && line.amount <= 100000
      && line.amount % 100 === 0 && typeof line.discountEligible === "boolean");
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Arguments are not supported");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8192) throw new Error("Input too large");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || Object.keys(input).length !== 2 || !["a", "b", "c"].includes(input.changeId)
    || !Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 3
    || !input.cases.every(isCart)) throw new Error("Invalid fixed-runner input");
  const original = await import("../pricing/original.ts");
  const proposed = input.changeId === "a" ? await import("../pricing/change-a.ts")
    : input.changeId === "c" ? await import("../pricing/change-c.ts") : await import("../pricing/change-b.ts");
  const evaluate = (fn, lines) => {
    try {
      const value = fn(Object.freeze(lines.map((line) => Object.freeze({ ...line }))));
      return Number.isSafeInteger(value) && value >= 0 && value <= 400000
        ? { value, error: null } : { value: null, error: "INVALID_RETURN" };
    } catch {
      return { value: null, error: "IMPLEMENTATION_ERROR" };
    }
  };
  const rows = input.cases.map((lines) => ({
    original: evaluate(original.priceCart, lines), candidate: evaluate(proposed.priceCart, lines),
  }));
  process.stdout.write(JSON.stringify({ rows }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write("FIXED_RUNNER_REFUSED\n"); process.exitCode = 1; });
}
