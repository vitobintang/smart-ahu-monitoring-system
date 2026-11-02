import { test } from "node:test";
import { equal, ok, rejects } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { issueBrowserInvitation } from "../src/lib/device-invitations";
import {
  claimBrowserInvitation,
  type ClaimQuery,
} from "../src/lib/device-claims";
import { isBrowserAuthorized } from "../src/lib/device-verification";
import { revokeBrowserAuthorization } from "../src/lib/device-revocations";

test("only an Admin role can revoke a browser or invitation", async () => {
  const db = new PGlite();

  try {
    const files = (await readdir("drizzle"))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();

    for (const file of files) {
      await db.exec(await readFile(join("drizzle", file), "utf8"));
    }

    await db.exec(`
      INSERT INTO ahu_private.users (id, email, role)
      VALUES
        ('admin', 'admin@example.invalid', 'Admin'),
        ('engineering', 'eng@example.invalid', 'Engineering'),
        ('operator', 'operator@example.invalid', 'Operator'),
        ('viewer', 'viewer@example.invalid', 'Viewer'),
        ('target', 'target@example.invalid', 'Viewer');
    `);

    const query: ClaimQuery = (text, values) =>
      db.query<{ id: string }>(text, values);

    const invitation = await issueBrowserInvitation(
      query,
      "admin",
      "target",
      "Laptop",
    );
    ok(invitation);

    const claimed = await claimBrowserInvitation(
      query,
      "target",
      invitation.invitationToken,
    );
    ok(claimed);

    equal(await isBrowserAuthorized(query, "target", claimed.deviceToken), true);

    for (const issuer of ["engineering", "operator", "viewer", "missing"]) {
      equal(await revokeBrowserAuthorization(query, issuer, invitation.deviceId), false);
    }

    equal(await isBrowserAuthorized(query, "target", claimed.deviceToken), true);

    equal(await revokeBrowserAuthorization(query, "admin", invitation.deviceId), true);
    equal(await isBrowserAuthorized(query, "target", claimed.deviceToken), false);
    equal(await revokeBrowserAuthorization(query, "admin", invitation.deviceId), false);

    const pending = await issueBrowserInvitation(
      query,
      "admin",
      "target",
      "Tablet",
    );
    ok(pending);

    equal(await revokeBrowserAuthorization(query, "admin", pending.deviceId), true);
    equal(
      await claimBrowserInvitation(query, "target", pending.invitationToken),
      null,
    );

    equal(await revokeBrowserAuthorization(query, "admin", ""), false);
  } finally {
    await db.close();
  }
});

test("database errors are not treated as successful revocation", async () => {
  const query: ClaimQuery = async () => {
    throw new Error("database unavailable");
  };

  await rejects(
    revokeBrowserAuthorization(query, "admin", "device"),
    /database unavailable/,
  );
});