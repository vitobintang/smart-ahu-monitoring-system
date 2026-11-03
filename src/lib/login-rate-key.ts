import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// Only pass an address obtained by a separately verified,
// trusted network adapter. This function does not determine
// whether an address or proxy is trustworthy.
export function normalizeLoginIp(address: string): string {
  if (
    typeof address !== "string" ||
    address.includes("%")
  ) {
    throw new Error("Invalid IP address");
  }

  const version = isIP(address);

  if (version === 4) {
    return address;
  }

  if (version !== 6) {
    throw new Error("Invalid IP address");
  }

  const hostname = new URL(`http://[${address}]/`).hostname;
  const normalized = hostname.slice(1, -1);

  const mapped =
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(
      normalized,
    );

  if (!mapped) {
    return normalized;
  }

  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);

  return [
    high >> 8,
    high & 255,
    low >> 8,
    low & 255,
  ].join(".");
}

// A stable random secret must eventually be provisioned privately,
// outside source control. Length alone does not prove randomness.
export function makeLoginRateKey(
  address: string,
  secret: Uint8Array,
): string {
  if (
    !(secret instanceof Uint8Array) ||
    secret.byteLength !== 32
  ) {
    throw new Error("Invalid rate key secret");
  }

  const normalized = normalizeLoginIp(address);

  return createHmac("sha256", secret)
    .update("ahu-login-rate-v1\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}