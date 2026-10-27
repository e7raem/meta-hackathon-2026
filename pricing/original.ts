export function priceCart(
  lines: ReadonlyArray<{ amount: number; discountEligible: boolean }>,
): number {
  const eligibleTotal = lines
    .filter((line) => line.discountEligible)
    .reduce((total, line) => total + (line.amount * 9) / 10, 0);
  const ineligibleTotal = lines
    .filter((line) => !line.discountEligible)
    .reduce((total, line) => total + line.amount, 0);
  const voucher = eligibleTotal >= 10000 ? 500 : 0;
  return eligibleTotal - voucher + ineligibleTotal;
}
