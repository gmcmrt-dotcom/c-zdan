// TR IBAN doğrulama yardımcıları
// Format: TR + 24 hane = 26 karakter; mod-97 ISO 13616 checksum.

export function cleanIban(s: string): string {
  return (s ?? "").replace(/\s+/g, "").toUpperCase();
}

export function formatIban(s: string): string {
  const c = cleanIban(s);
  return c.match(/.{1,4}/g)?.join(" ") ?? c;
}

// Boş alanları "_" ile gösterip eksikliği görsel olarak vurgula
export function maskIbanSkeleton(s: string): string {
  const c = cleanIban(s);
  const padded = (c + "_".repeat(26)).slice(0, 26);
  return padded.match(/.{1,4}/g)?.join(" ") ?? padded;
}

export function isValidTrIbanFormat(s: string): boolean {
  return /^TR\d{24}$/.test(cleanIban(s));
}

export function isValidTrIban(s: string): boolean {
  const c = cleanIban(s);
  if (!isValidTrIbanFormat(c)) return false;
  const rearranged = c.slice(4) + c.slice(0, 4);
  // A=10..Z=35
  let numeric = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else numeric += String(ch.charCodeAt(0) - 55);
  }
  // büyük sayı mod 97
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export function ibanLengthOk(s: string): boolean {
  return cleanIban(s).length === 26;
}
