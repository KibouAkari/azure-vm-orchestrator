import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function generatePassword(length = 18): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((value) => ALPHABET[value % ALPHABET.length])
    .join("");
}
