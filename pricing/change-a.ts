export function priceCart(
  lines: ReadonlyArray<{ amount: number; discountEligible: boolean }>,
): number {
  const eligibleSubtotal = lines
    .filter((line) => line.discountEligible)
    .reduce((total, line) => total + line.amount, 0);
  const ineligibleTotal = lines
    .filter((line) => !line.discountEligible)
    .reduce((total, line) => total + line.amount, 0);
  const voucher = eligibleSubtotal >= 10000 ? 500 : 0;
  const eligibleTotal = ((eligibleSubtotal - voucher) * 9) / 10;
  return eligibleTotal + ineligibleTotal;
}
