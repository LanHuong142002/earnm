export type Currency = "VND" | "USD";

function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

// Hand-rolled (no Intl / toLocaleString) so output never depends on device locale.
export function formatMoney(amount: number, currency: Currency): string {
  const decimals = currency === "VND" ? 0 : 2;
  const factor = 10 ** decimals;
  const scaled = Math.round(Math.abs(amount) * factor);
  const sign = amount < 0 && scaled !== 0 ? "-" : "";

  if (currency === "VND") {
    return `${sign}${group(String(scaled), ".")} ₫`;
  }

  const whole = Math.floor(scaled / factor);
  const cents = String(scaled % factor).padStart(2, "0");
  return `${sign}$${group(String(whole), ",")}.${cents}`;
}

function trimZeros(fraction: string, min: number): string {
  let out = fraction;
  while (out.length > min && out.endsWith("0")) out = out.slice(0, -1);
  return out;
}

// Unit costs keep decimals formatMoney would round away. `value` is in minor units
// (VND dong, USD cents), e.g. 63.16 dong per gram, or 0.63 cents per gram.
export function formatUnitCost(value: number, currency: Currency): string {
  const scaled = Math.round(Math.abs(value) * 100);
  const sign = value < 0 && scaled !== 0 ? "-" : "";

  if (currency === "VND") {
    const whole = group(String(Math.floor(scaled / 100)), ".");
    const fraction = trimZeros(String(scaled % 100).padStart(2, "0"), 0);
    return `${sign}${whole}${fraction ? `,${fraction}` : ""} ₫`;
  }

  // Cents with 2 decimals -> dollars with up to 4 decimals (min 2).
  const whole = group(String(Math.floor(scaled / 10000)), ",");
  const fraction = trimZeros(String(scaled % 10000).padStart(4, "0"), 2);
  return `${sign}$${whole}.${fraction}`;
}
