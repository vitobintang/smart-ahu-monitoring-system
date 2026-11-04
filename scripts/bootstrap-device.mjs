// Deprecated: Administrators now sign in using email and password only (no browser device token required).
// Non-Admin roles (Engineering, Operator, Viewer) receive one-time access tokens from an Admin at /admin?tab=users.
console.log(
  "Administrators sign in using email and password only — no admin device token is needed.\n" +
    "To reset a forgotten Admin password, run: npm run db:reset-admin\n" +
    "To issue tokens for Engineering, Operator, or Viewer roles, sign in as Admin and open /admin?tab=users.",
);
