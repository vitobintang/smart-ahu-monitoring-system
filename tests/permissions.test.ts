import { test } from "node:test";
import { equal } from "node:assert/strict";

import { USER_ROLES, type UserRole } from "../src/lib/ahu";
import { PERMISSIONS, hasPermission, type Permission } from "../src/lib/permissions";

test("each role has only its expected permissions", () => {
  const read: Permission[] = [
    "monitoring:read",
    "alarms:read",
    "reports:read",
  ];

  const operate: Permission[] = [
    "alarms:acknowledge",
    "warnings:acknowledge",
    "commands:request",
  ];

  const configure: Permission[] = ["configuration:edit", "audit:read"];

  const adminOnly: Permission[] = [
    "users:read",
    "users:create",
    "telemetry-devices:manage",
    "access-devices:manage",
  ];

  const expected: Record<UserRole, readonly Permission[]> = {
    Operator: [...read, ...operate],
    Engineering: [...read, ...operate, ...configure],
    Admin: [...read, ...operate, ...configure, ...adminOnly],
  };

  for (const role of USER_ROLES) {
    for (const permission of PERMISSIONS) {
      equal(
        hasPermission(role, permission),
        expected[role].includes(permission),
        `${role}: ${permission}`,
      );
    }
  }
});

test("unknown roles and permissions are denied", () => {
  equal(hasPermission("admin", "users:create"), false);
  equal(hasPermission("__proto__", "monitoring:read"), false);
  equal(hasPermission(null, "monitoring:read"), false);
  equal(hasPermission("Admin", "unknown:permission"), false);
  equal(hasPermission("Admin", null), false);
});