// TR mobil telefon maskesi: (5XX) XXX XX XX
// DB'de yalın 10 hane (örn. 5325323232) saklanır.

export function digitsOnly(value: string): string {
  return (value || "").replace(/\D+/g, "");
}

/**
 * Kullanıcı yazdıkça maskeleyen yardımcı.
 * - Baştaki 90 veya 0 ön ekini temizler.
 * - İlk 10 haneyi (5XX) XXX XX XX biçiminde dizer.
 * - Eksik hanelerde sadece yazılan kadarını maskeler.
 */
export function formatTrPhone (input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith("90")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 10);

    if (d.length === 0) return "";
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    if (d.length <= 8) return `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

/** Maskelenmi? veya yalın değerden tam 10 haneli, 5 ile başlayan TR mobil mi? */
export function isValidTrMobile (value: string): boolean {
  const d = digitsOnly(value);
  return d.length === 10 && d.startsWith("5");
}
