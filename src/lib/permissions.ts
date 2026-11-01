import { USER_ROLES, type UserRole } from "./ahu";

export const PERMISSIONS = [
  "monitoring:read",
  "alarms:read",
  "reports:read",
  "alarms:acknowledge",
  "warnings:acknowledge",
  "commands:request",
  "configuration:edit",
  "audit:read",
  "users:read",
  "users:create",
  "telemetry-devices:manage",
  "access-devices:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const viewerPermissions: Permission[] = [
  "monitoring:read",
  "alarms:read",
  "reports:read",
];

const operatorPermissions: Permission[] = [
  ...viewerPermissions,
  "alarms:acknowledge",
  "warnings:acknowledge",
  "commands:request",
];

const engineeringPermissions: Permission[] = [
  ...operatorPermissions,
  "configuration:edit",
  "audit:read",
];

const adminPermissions: Permission[] = [
  ...engineeringPermissions,
  "users:read",
  "users:create",
  "telemetry-devices:manage",
  "access-devices:manage",
];

const permissionsByRole: Record<UserRole, readonly Permission[]> = {
  Viewer: viewerPermissions,
  Operator: operatorPermissions,
  Engineering: engineeringPermissions,
  Admin: adminPermissions,
};

export function hasPermission(role: unknown, permission: unknown): boolean {
  if (typeof role !== "string" || typeof permission !== "string") {
    return false;
  }

  if (!USER_ROLES.some((validRole) => validRole === role)) {
    return false;
  }

  return permissionsByRole[role as UserRole].some(
    (allowedPermission) => allowedPermission === permission,
  );
}