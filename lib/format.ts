/** Nestegg stores every amount in kobo (1 NGN = 100 kobo) to avoid float
 * rounding errors — the same unit Paystack's API uses. These helpers are the
 * only place naira <-> kobo conversion should happen. */

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

export function formatKobo(kobo: number | null | undefined): string {
  const naira = koboToNaira(kobo ?? 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: naira % 1 === 0 ? 0 : 2,
  }).format(naira);
}
