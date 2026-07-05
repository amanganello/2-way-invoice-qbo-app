import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/shared/crypto/encryption";

const KEY = "a".repeat(64); // 32-byte hex

describe("encrypt / decrypt", () => {
  it("round-trips plaintext", () => {
    const cipher = encrypt("hello world", KEY);
    expect(decrypt(cipher, KEY)).toBe("hello world");
  });

  it("produces iv:ciphertext:authtag format", () => {
    const cipher = encrypt("test", KEY);
    const parts = cipher.split(":");
    expect(parts).toHaveLength(3);
    expect(parts.every(p => /^[0-9a-f]+$/.test(p))).toBe(true);
  });

  it("produces unique ciphertext each call (unique IV)", () => {
    const a = encrypt("same", KEY);
    const b = encrypt("same", KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe("same");
    expect(decrypt(b, KEY)).toBe("same");
  });

  it("throws on tampered auth tag", () => {
    const [iv, ct] = encrypt("secret", KEY).split(":");
    const tampered = `${iv}:${ct}:${"ff".repeat(16)}`;
    expect(() => decrypt(tampered, KEY)).toThrow();
  });
});
