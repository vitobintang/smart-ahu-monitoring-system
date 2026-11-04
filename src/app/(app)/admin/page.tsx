"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HardDrive, KeyRound, Plus, ShieldAlert, UserPlus, Users } from "lucide-react";
import { api, fmtDateTime, usePoll } from "@/lib/client";
import { AHU_IDS, ROLES } from "@/lib/domain";
import { Btn, Empty, ErrorNote, Field, QualityTag, Spinner, cx, inputClass } from "@/components/ui";

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  createdAt: string;
}
interface DeviceRow {
  id: string;
  ahuId: string;
  label: string;
  sourceType: "PHYSICAL" | "SIMULATION";
  enabled: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "devices" ? "devices" : "users";
  const users = usePoll<{ users: UserRow[] }>("/api/users", 30000, tab === "users");
  const devices = usePoll<{ devices: DeviceRow[]; physicalControlUnlocked: boolean }>("/api/devices", 30000, tab === "devices");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<string>("Viewer");
  const [password, setPassword] = useState("");

  const [devAhu, setDevAhu] = useState<string>(AHU_IDS[0]);
  const [devLabel, setDevLabel] = useState("");
  const [devSource, setDevSource] = useState<"PHYSICAL" | "SIMULATION">("SIMULATION");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const access = usePoll<{ devices: { id: string; userId: string; email: string; label: string; claimedAt: string | null; revokedAt: string | null; invitationExpiresAt: string; expiresAt: string | null }[] }>("/api/access-devices", 30000, tab === "users");
  const [accessUser, setAccessUser] = useState("");
  const [accessLabel, setAccessLabel] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  async function issueAccess(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setAccessToken(null);
    try {
      const result = await api<{ token: string }>("/api/access-devices", { method: "POST", body: JSON.stringify({ userId: accessUser, label: accessLabel }) });
      setAccessToken(result.token); setAccessLabel(""); await access.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not issue token"); } finally { setBusy(false); }
  }
  async function revokeAccess(id: string) {
    setBusy(true); setError(null);
    try { await api("/api/access-devices", { method: "POST", body: JSON.stringify({ revokeId: id }) }); await access.reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not revoke device"); } finally { setBusy(false); }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ user: UserRow }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, fullName, role, password }),
      });
      setNotice(`User ${res.user.email} created with role ${res.user.role} (FR-20). Recorded in the audit log.`);
      setEmail("");
      setFullName("");
      setPassword("");
      await users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function provisionDevice(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ device: DeviceRow & { token: string } }>("/api/devices", {
        method: "POST",
        body: JSON.stringify({ ahuId: devAhu, label: devLabel || undefined, sourceType: devSource }),
      });
      setIssuedToken(res.device.token);
      setNotice(`Device provisioned for ${devAhu}. A new authentication token was issued (FR-21).`);
      setDevLabel("");
      await devices.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDevice(d: DeviceRow) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/devices", { method: "POST", body: JSON.stringify({ deviceId: d.id, enabled: !d.enabled }) });
      await devices.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device update failed");
    } finally {
      setBusy(false);
    }
  }

  if ((tab === "users" && users.loading && !users.data) || (tab === "devices" && devices.loading && !devices.data))
    return <Spinner label="Loading administration data…" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
          <Users size={20} className="text-cyan-300" /> User &amp; Device Administration
        </h1>
        <p className="text-xs text-slate-500">
          FR-20 user administration and FR-21 device provisioning — Admin only. Constraint: role editing, password
          reset and user deactivation are intentionally not available through the UI.
        </p>
      </div>

      <div className="no-print flex gap-2">
        {(["users", "devices"] as const).map((t) => (
          <button
            key={t}
            onClick={() => router.replace(`/admin?tab=${t}`)}
            className={cx(
              "rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide",
              tab === t ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-100" : "border-ink-600 bg-ink-900/60 text-slate-400",
            )}
          >
            {t === "users" ? "Users" : "Devices & tokens"}
          </button>
        ))}
      </div>

      {notice ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{notice}</p> : null}
      <ErrorNote message={error ?? users.error ?? devices.error} />

      {tab === "users" ? (
        <div className="panel rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-100">App access devices</h2>
          <p className="text-xs text-slate-400">Issue a one-time token to a specific user for one browser. It expires after 24 hours; authorized browsers expire after 90 days. Send tokens privately. A copied browser credential can still be misused.</p>
          <form onSubmit={issueAccess} className="flex flex-wrap gap-2">
            <select required className={inputClass} value={accessUser} onChange={(e) => setAccessUser(e.target.value)}>
              <option value="">Select user</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            <input required maxLength={120} className={inputClass} value={accessLabel} onChange={(e) => setAccessLabel(e.target.value)} placeholder="Device label, e.g. office laptop" />
            <Btn type="submit" variant="primary" disabled={busy}>Generate app access token</Btn>
          </form>
          {accessToken ? <div className="text-xs text-amber-200">Show once—copy and deliver securely: <code className="break-all">{accessToken}</code></div> : null}
          {access.error ? <ErrorNote message={access.error} /> : null}
          <ul className="space-y-2 text-xs text-slate-300">{access.data?.devices.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2"><span>{d.email} · {d.label} · {d.revokedAt ? "revoked" : d.claimedAt ? `authorized until ${fmtDateTime(d.expiresAt)}` : `token expires ${fmtDateTime(d.invitationExpiresAt)}`}</span>{!d.revokedAt ? <Btn variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Revoke this browser authorization? Its user will need a new token. Revoking your own browser will sign you out of protected pages.")) void revokeAccess(d.id); }}>Revoke</Btn> : null}</li>)}</ul>
        </div>
      ) : null}

      {tab === "users" ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className="panel overflow-hidden rounded-2xl">
            <header className="border-b border-ink-700/70 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Registered users</h2>
              <p className="text-[11px] text-slate-500">{users.data?.users.length ?? 0} accounts · roles per FR-02</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Full name</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {(users.data?.users ?? []).map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2.5 font-mono text-slate-200">{u.email}</td>
                      <td className="px-4 py-2.5 text-slate-400">{u.fullName ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-cyan-300">{u.role}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{fmtDateTime(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users.data?.users.length === 0 ? <div className="p-6"><Empty>No users found.</Empty></div> : null}
          </div>

          <form onSubmit={createUser} className="panel h-max rounded-2xl p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-100">
              <UserPlus size={14} className="text-cyan-300" /> Create account
            </h2>
            <div className="mt-3 space-y-3">
              <Field label="Email">
                <input type="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Full name">
                <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field label="Role" hint="Admin · Engineering · Operator · Viewer">
                <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Temporary password" hint="minimum 8 characters · managed by Supabase Auth">
                <input type="password" autoComplete="new-password" required minLength={8} className={cx(inputClass, "font-mono")} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Btn type="submit" variant="primary" disabled={busy} className="w-full">
                <Plus size={13} /> Create user
              </Btn>
              <p className="text-[10px] leading-relaxed text-slate-500">
                Role changes, password resets and deactivation are out of UI scope by design.
              </p>
            </div>
          </form>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className="panel overflow-hidden rounded-2xl">
            <header className="border-b border-ink-700/70 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">Provisioned devices</h2>
              <p className="text-[11px] text-slate-500">
                FR-21 device identity, source type (PHYSICAL / SIMULATION) and bearer token issuance
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">AHU</th>
                    <th className="px-4 py-2.5">Label</th>
                    <th className="px-4 py-2.5">Source</th>
                    <th className="px-4 py-2.5">Token</th>
                    <th className="px-4 py-2.5">State</th>
                    <th className="px-4 py-2.5">Provisioned</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {(devices.data?.devices ?? []).map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2.5 font-mono text-cyan-300">{d.ahuId}</td>
                      <td className="px-4 py-2.5 text-slate-300">{d.label}</td>
                      <td className="px-4 py-2.5">
                        <QualityTag quality={d.sourceType === "SIMULATION" ? "SIMULATED" : "OK"} title={d.sourceType} />
                        <span className="ml-1.5 font-mono text-[10px] text-slate-400">{d.sourceType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">Hidden after issuance</td>
                      <td className="px-4 py-2.5">
                        <span className={cx("font-mono text-[10px] uppercase", d.enabled ? "text-emerald-400" : "text-slate-500")}>
                          {d.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{fmtDateTime(d.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Btn variant="ghost" onClick={() => void toggleDevice(d)} disabled={busy}>
                          {d.enabled ? "Disable" : "Enable"}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {devices.data?.devices.length === 0 ? <div className="p-6"><Empty>No devices provisioned.</Empty></div> : null}
          </div>

          <div className="space-y-4">
            <form onSubmit={provisionDevice} className="panel h-max rounded-2xl p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-100">
                <KeyRound size={14} className="text-cyan-300" /> Register device
              </h2>
              <div className="mt-3 space-y-3">
                <Field label="AHU identity">
                  <select className={inputClass} value={devAhu} onChange={(e) => setDevAhu(e.target.value)}>
                    {AHU_IDS.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Label">
                  <input className={inputClass} value={devLabel} placeholder="e.g. BMS gateway" onChange={(e) => setDevLabel(e.target.value)} />
                </Field>
                <Field label="Source type" hint="FR-09 source identifier written with every telemetry row">
                  <select className={inputClass} value={devSource} onChange={(e) => setDevSource(e.target.value as "PHYSICAL" | "SIMULATION")}>
                    <option value="SIMULATION">SIMULATION</option>
                    <option value="PHYSICAL">PHYSICAL</option>
                  </select>
                </Field>
                <Btn type="submit" variant="primary" disabled={busy} className="w-full">
                  <HardDrive size={13} /> Provision &amp; issue token
                </Btn>
              </div>
            </form>

            <div className="panel rounded-2xl border-amber-500/30 p-4 text-[11px] leading-relaxed text-amber-200/90">
              <p className="flex items-center gap-2 font-semibold uppercase tracking-wide">
                <ShieldAlert size={13} /> Physical control {devices.data?.physicalControlUnlocked ? "unlocked" : "locked"}
              </p>
              <p className="mt-1">
                Physical commands are disabled: no commissioned physical control integration exists. Local hardware safety interlocks must be independently installed and verified; the web interface is not an emergency stop.
              </p>
            </div>

            {issuedToken ? (
              <div className="panel rounded-2xl p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Last issued token</p>
                <code className="mt-1 block break-all font-mono text-[11px] text-emerald-300">{issuedToken}</code>
                <p className="mt-2 text-[10px] text-slate-500">
                  Use as <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> on{" "}
                  <span className="font-mono">POST /api/telemetry</span>.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}