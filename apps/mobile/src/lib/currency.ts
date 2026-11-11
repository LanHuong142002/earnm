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
