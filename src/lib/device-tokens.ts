import { createHash, randomBytes } from "node:crypto";

export type DeviceTokenPurpose = "invitation" | "browser";

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(
  token: string,
  purpose: DeviceTokenPurpose,
): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Invalid device token format.");
  }

  if (purpose !== "invitation" && purpose !== "browser") {
    throw new Error("Invalid device token purpose.");
  }

  return createHash("sha256")
    .update(`smart-ahu/device-token/${purpose}\0`, "utf8")
    .update(token, "utf8")
    .digest("hex");
}