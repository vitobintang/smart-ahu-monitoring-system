import { timingSafeEqual } from "node:crypto";

import { checkLoginPreflight, type LoginPreflightResult } from "./login-preflight";
import { makeLoginRateKey } from "./login-rate-key";
import { isSameOrigin } from "./request-security";
import { consumeSharedLoginAttempt, type RateTransaction } from "./shared-login-rate";

/**
 * UNWIRED server-side building block. A trusted gateway must overwrite both
 * headers, keep its proof private, and be the only network path to the app.
 * Header checks alone do not establish network isolation or a trusted gateway.
 */
export type LoginGatewayGuardOptions = {
  headers: Pick<Headers, "get">;
  publicOrigin: unknown;
  gatewayProof: unknown;
  rateKeySecret: unknown;
  transaction: RateTransaction;
};

function secureOrigin(value: unknown): value is string {
  if (typeof value !== "string" || !isSameOrigin(value, value)) return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

function hexSecret(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function checkGatewayLoginAttempt(
  options: LoginGatewayGuardOptions,
): Promise<LoginPreflightResult> {
  const { headers, publicOrigin, gatewayProof, rateKeySecret, transaction } = options;

  if (
    !secureOrigin(publicOrigin) ||
    !hexSecret(gatewayProof) ||
    !(rateKeySecret instanceof Uint8Array) ||
    rateKeySecret.byteLength !== 32 ||
    typeof transaction !== "function"
  ) return { ok: false, status: 503 };

  try {
    const requestOrigin = headers.get("origin");
    // Configured origin is never derived from an untrusted Host header.
    if (!isSameOrigin(requestOrigin, publicOrigin)) return { ok: false, status: 403 };

    const suppliedProof = headers.get("x-ahu-gateway-proof");
    if (!hexSecret(suppliedProof) || !timingSafeEqual(
      Buffer.from(suppliedProof, "hex"), Buffer.from(gatewayProof, "hex"),
    )) return { ok: false, status: 403 };

    const address = headers.get("x-ahu-client-ip");
    if (address === null) return { ok: false, status: 503 };
    // makeLoginRateKey validates and normalizes the whole header as one IP.
    const bucket = makeLoginRateKey(address, rateKeySecret);
    return await checkLoginPreflight(requestOrigin, publicOrigin, () =>
      consumeSharedLoginAttempt(transaction, bucket),
    );
  } catch {
    // Malformed gateway input or rate storage failure must not grant access.
    return { ok: false, status: 503 };
  }
}