export function checkoutTotal(
  lines: ReadonlyArray<{ amount: number; discountEligible: boolean }>,
): number {
  const basketTotal = lines.reduce(
    (total, line) => total + line.amount,
    0,
  );

  return basketTotal * 9 / 10;
}
