/** 25000000000n, 6 → "25,000.00" */
export function formatUnits(v: bigint, decimals: number, shown = 2): string {
  const base = 10n ** BigInt(decimals)
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, shown)
  return shown ? `${whole}.${frac}` : whole
}
