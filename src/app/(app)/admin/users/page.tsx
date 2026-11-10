"use client";

import { useState } from "react";

import {
  AtSign,
  Check,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, fmtDateTime, usePoll } from "@/lib/client";
import { ROLES } from "@/lib/domain";
import { isAdminRole, suggestUsernameFromEmail } from "@/lib/role-auth";
import { Btn, Empty, ErrorNote, Field, Spinner, cx, inputClass } from "@/components/ui";

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: string;
  createdAt: string;
}

function displayUserLabel(u: UserRow) {
  const base = u.fullName?.trim() || u.username || u.email;
  return u.username ? `${base} (@${u.username})` : `${base} (${u.email})`;
}

export default function AdminUsersPage() {
  const users = usePoll<{ users: UserRow[]; currentUserId?: string }>("/api/users", 30000);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create user form (all roles: Admin, Engineering, Operator)
  const [role, setRole] = useState<string>("Operator");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  // Inline edit user state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editFullName, setEditFullName] = useState("");

  // Password reset form (any role)
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const allUsers = users.data?.users ?? [];
  const currentUserId = users.data?.currentUserId ?? "";
  const adminCount = allUsers.filter((u) => isAdminRole(u.role)).length;

  function onEmailChange(nextEmail: string) {
    setEmail(nextEmail);
    if (!usernameTouched) {
      setUsername(nextEmail.includes("@") ? suggestUsernameFromEmail(nextEmail) : "");
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ user: UserRow }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          role,
          email: email.trim(),
          username: username.trim() || undefined,
          fullName: fullName.trim() || undefined,
          password,
        }),
      });
      setNotice(
        `${res.user.role} account created: ${res.user.email}${
          res.user.username ? ` (@${res.user.username})` : ""
        }. User can sign in with either email or username + password.`,
      );
      setEmail("");
      setUsername("");
      setUsernameTouched(false);
      setFullName("");
      setPassword("");
      await users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeUserRole(target: UserRow, nextRole: string) {
    if (nextRole === target.role) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/api/users", {
        method: "PATCH",
        body: JSON.stringify({ userId: target.id, role: nextRole }),
      });
      setNotice(`Updated role for ${displayUserLabel(target)} from ${target.role} to ${nextRole} (FR-20).`);
      await users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user role");
    } finally {
      setBusy(false);
    }
  }

  function startEditUser(u: UserRow) {
    setEditingUserId(u.id);
    setEditUsername(u.username ?? suggestUsernameFromEmail(u.email));
    setEditFullName(u.fullName ?? "");
  }

  async function saveUserIdentity(target: UserRow) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/api/users", {
        method: "PATCH",
        body: JSON.stringify({
          userId: target.id,
          username: editUsername.trim(),
          fullName: editFullName,
        }),
      });
      setEditingUserId(null);
      setNotice(`Updated profile details for ${target.email}.`);
      await users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user details");
    } finally {
      setBusy(false);
    }
  }

  async function updateUserPassword(e: React.FormEvent) {
    e.preventDefault();
    const targetId = resetUserId || allUsers[0]?.id;
    if (!targetId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ ok: boolean; email: string; username: string | null }>("/api/users", {
        method: "PATCH",
        body: JSON.stringify({ userId: targetId, password: resetPassword }),
      });
      setNotice(
        `Password updated for ${res.email}${res.username ? ` (@${res.username})` : ""}.`,
      );
      setResetPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  async function removeUserAccount(target: UserRow) {
    const label = displayUserLabel(target);
    const confirmed = window.confirm(
      `Remove ${target.role} account "${label}"?\n\nTheir login credentials will be permanently deleted while historical audit logs, alarms, and command history remain preserved.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/users?userId=${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setNotice(`Removed ${target.role} account "${label}" (FR-20).`);
      await users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove user account");
    } finally {
      setBusy(false);
    }
  }

  if (users.loading && !users.data)
    return <Spinner label="Loading administration data…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-bold tracking-tight text-[#12294d] sm:text-[22px]">
            <Users size={20} className="text-[#1d6ef2]" /> Users
          </h1>
          <p className="text-xs text-[#475569]">
            FR-20 user accounts (Email or Username + Password across all roles)
          </p>
        </div>
      </div>

      <ErrorNote message={error || users.error} />
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          {/* Registered Users list (responsive cards on < md, table on >= md) */}
          <div className="panel overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e4eaf3] bg-[#f8fafd] px-4 py-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#12294d]">
                  Registered User Accounts ({allUsers.length})
                </h2>
                <p className="text-[11px] text-[#475569]">
                  All roles sign in with Email or Username + Password · no user tokens required
                </p>
              </div>
            </div>

            {/* Mobile / small-tablet stacked cards */}
            <div className="divide-y divide-[#eef2f7] md:hidden">
              {allUsers.map((u) => {
                const isSelf = u.id === currentUserId;
                const isLastAdmin = isAdminRole(u.role) && adminCount <= 1;
                const removeDisabled = busy || isSelf || isLastAdmin;
                const roleLocked = busy || (isAdminRole(u.role) && (isSelf || isLastAdmin));
                const isEditing = editingUserId === u.id;

                return (
                  <div key={u.id} className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#12294d]">
                          {u.fullName || u.username || u.email}
                          {isSelf ? (
                            <span className="ml-1.5 rounded bg-[#dbeafe] px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-[#1d6ef2]">
                              you
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate font-mono text-xs font-semibold text-[#1d6ef2]">
                          {u.username ? `@${u.username}` : "no username"}
                        </p>
                        <p className="truncate font-mono text-[11px] text-[#475569]">{u.email}</p>
                      </div>
                      <select
                        aria-label={`Role for ${displayUserLabel(u)}`}
                        className={cx(
                          "rounded-lg border px-2.5 py-1.5 font-mono text-xs font-bold uppercase outline-none transition",
                          roleLocked
                            ? "border-[#dbe7fb] bg-[#f4f8ff] text-[#1d6ef2]"
                            : "border-[#cbd5e1] bg-white text-[#12294d] focus:border-[#2563eb]",
                        )}
                        value={u.role}
                        disabled={roleLocked}
                        onChange={(e) => void changeUserRole(u, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2 rounded-xl border border-[#e4eaf3] bg-[#f8fafd] p-3">
                        <Field label="Display name">
                          <input
                            className={inputClass}
                            value={editFullName}
                            onChange={(e) => setEditFullName(e.target.value)}
                            placeholder="Display name"
                          />
                        </Field>
                        <Field label="Username">
                          <input
                            className={cx(inputClass, "font-mono")}
                            value={editUsername}
                            onChange={(e) => setEditUsername(e.target.value)}
                            placeholder="username"
                          />
                        </Field>
                        <div className="flex justify-end gap-2">
                          <Btn size="sm" variant="default" onClick={() => setEditingUserId(null)}>
                            <X size={12} /> Cancel
                          </Btn>
                          <Btn size="sm" variant="primary" disabled={busy} onClick={() => void saveUserIdentity(u)}>
                            <Check size={12} /> Save
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="font-mono text-[10.5px] text-[#475569]">
                          Joined {fmtDateTime(u.createdAt).split(",")[0]}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Btn size="sm" variant="default" disabled={busy} onClick={() => startEditUser(u)}>
                            <Pencil size={12} /> Edit
                          </Btn>
                          <Btn
                            size="sm"
                            variant="danger"
                            disabled={removeDisabled}
                            onClick={() => void removeUserAccount(u)}
                          >
                            <Trash2 size={12} /> Remove
                          </Btn>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {allUsers.length === 0 ? (
                <div className="p-6">
                  <Empty>No users registered yet.</Empty>
                </div>
              ) : null}
            </div>

            {/* Tablet / Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#e4eaf3] bg-[#f8fafd] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                  <tr>
                    <th className="px-4 py-2.5">User</th>
                    <th className="px-4 py-2.5">Username</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Created</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {allUsers.map((u) => {
                    const isSelf = u.id === currentUserId;
                    const isLastAdmin = isAdminRole(u.role) && adminCount <= 1;
                    const removeDisabled = busy || isSelf || isLastAdmin;
                    const roleLocked = busy || (isAdminRole(u.role) && (isSelf || isLastAdmin));
                    const isEditing = editingUserId === u.id;

                    return (
                      <tr key={u.id} className="hover:bg-[#f6f9fd]">
                        <td className="px-4 py-2.5 font-semibold text-[#12294d]">
                          {isEditing ? (
                            <input
                              className={cx(inputClass, "py-1 text-xs")}
                              value={editFullName}
                              onChange={(e) => setEditFullName(e.target.value)}
                              placeholder="Display name"
                            />
                          ) : (
                            <>
                              {u.fullName || "—"}
                              {isSelf ? (
                                <span className="ml-1.5 rounded bg-[#dbeafe] px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-[#1d6ef2]">
                                  you
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11.5px] font-semibold text-[#1d6ef2]">
                          {isEditing ? (
                            <input
                              className={cx(inputClass, "py-1 font-mono text-xs")}
                              value={editUsername}
                              onChange={(e) => setEditUsername(e.target.value)}
                              placeholder="username"
                            />
                          ) : u.username ? (
                            `@${u.username}`
                          ) : (
                            <span className="text-[#64748b]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#334155]">{u.email}</td>
                        <td className="px-4 py-2.5">
                          <select
                            aria-label={`Role for ${displayUserLabel(u)}`}
                            className={cx(
                              "rounded-md border px-2 py-1 font-mono text-[11px] font-bold uppercase outline-none transition",
                              roleLocked
                                ? "border-[#dbe7fb] bg-[#f4f8ff] text-[#1d6ef2]"
                                : "border-[#cbd5e1] bg-white text-[#12294d] focus:border-[#2563eb]",
                            )}
                            value={u.role}
                            disabled={roleLocked}
                            title={
                              isSelf && isAdminRole(u.role)
                                ? "Cannot demote your own active Admin account"
                                : isLastAdmin
                                  ? "Cannot demote the last remaining Admin account"
                                  : "Change user role"
                            }
                            onChange={(e) => void changeUserRole(u, e.target.value)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#475569]">
                          {fmtDateTime(u.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {isEditing ? (
                              <>
                                <Btn size="sm" variant="default" onClick={() => setEditingUserId(null)}>
                                  Cancel
                                </Btn>
                                <Btn size="sm" variant="primary" disabled={busy} onClick={() => void saveUserIdentity(u)}>
                                  Save
                                </Btn>
                              </>
                            ) : (
                              <>
                                <Btn
                                  size="sm"
                                  variant="default"
                                  disabled={busy}
                                  onClick={() => startEditUser(u)}
                                  title="Edit display name or username"
                                >
                                  <Pencil size={12} /> Edit
                                </Btn>
                                <Btn
                                  size="sm"
                                  variant="danger"
                                  disabled={removeDisabled}
                                  title={
                                    isSelf
                                      ? "You cannot remove your own currently signed-in account"
                                      : isLastAdmin
                                        ? "Cannot remove the last remaining Administrator account"
                                        : `Remove ${displayUserLabel(u)}`
                                  }
                                  onClick={() => void removeUserAccount(u)}
                                >
                                  <Trash2 size={12} /> Remove
                                </Btn>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {allUsers.length === 0 ? (
                <div className="p-6">
                  <Empty>No users registered yet.</Empty>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right column: Create User + Reset Password */}
          <div className="space-y-4">
            <form onSubmit={createUser} className="panel h-max rounded-2xl p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#12294d]">
                <Plus size={14} className="text-[#1d6ef2]" /> Create User Account
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-[#475569]">
                Creates an Email + Username + Password login for any role (Admin, Engineering, or Operator).
              </p>

              <div className="mt-3.5 space-y-3">
                <Field label="Role">
                  <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Email address">
                  <input
                    type="email"
                    required
                    className={inputClass}
                    placeholder="e.g. operator@ahu.local"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                  />
                </Field>

                <Field
                  label="Username"
                  hint="Substitute for email on sign-in · 3–32 chars (letters, numbers, ., _, -)"
                >
                  <div className="relative">
                    <AtSign size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
                    <input
                      required
                      maxLength={32}
                      className={cx(inputClass, "pl-8 font-mono")}
                      placeholder="e.g. shift.operator"
                      value={username}
                      onChange={(e) => {
                        setUsernameTouched(true);
                        setUsername(e.target.value);
                      }}
                    />
                  </div>
                </Field>

                <Field label="Full name" hint="Optional display name">
                  <input
                    maxLength={120}
                    className={inputClass}
                    placeholder="e.g. Shift A Operator"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>

                <Field label="Password" hint="Minimum 8 characters">
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className={cx(inputClass, "font-mono")}
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>

                <Btn type="submit" variant="primary" disabled={busy} className="w-full py-2">
                  <Plus size={13} /> Create {role} account
                </Btn>
              </div>
            </form>

            {allUsers.length > 0 ? (
              <form onSubmit={updateUserPassword} className="panel h-max rounded-2xl p-4">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#12294d]">
                  <KeyRound size={14} className="text-[#1d6ef2]" /> Reset User Password
                </h2>
                <div className="mt-3 space-y-3">
                  <Field label="User account">
                    <select
                      className={inputClass}
                      value={resetUserId || allUsers[0]?.id || ""}
                      onChange={(e) => setResetUserId(e.target.value)}
                    >
                      {allUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {displayUserLabel(u)} · {u.role}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="New password" hint="Minimum 8 characters">
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      className={cx(inputClass, "font-mono")}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                    />
                  </Field>
                  <Btn type="submit" variant="default" disabled={busy} className="w-full">
                    <KeyRound size={13} /> Update password
                  </Btn>
                </div>
              </form>
            ) : null}
          </div>
        </div>
    </div>
  );
}
