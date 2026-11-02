import { createHash, randomBytes } from "node:crypto";

export type DeviceTokenPurpose = "invitation" | "browser";

export function createDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashDeviceToken(
  token: string,
  purpose: DeviceTokenPurpose,
): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Invalid device token format.");
  }

  if (purpose !== "invitation" && purpose !== "browser") {
    throw new Error("Invalid device token purpose.");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}