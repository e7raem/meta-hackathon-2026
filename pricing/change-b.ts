export function priceCart(
  lines: ReadonlyArray<{ amount: number; discountEligible: boolean }>,
): number {
  let eligibleTotal = 0;
  let ineligibleTotal = 0;
  for (const line of lines) {
    if (line.discountEligible) {
      eligibleTotal += (line.amount * 9) / 10;
    } else {
      ineligibleTotal += line.amount;
    }
  }
  return eligibleTotal + ineligibleTotal - (eligibleTotal >= 10000 ? 500 : 0);
}
