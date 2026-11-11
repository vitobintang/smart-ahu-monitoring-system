import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Fan,
  FileText,
  Home,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { auth, firebaseConfigured } from "./firebase";
import { api, apiConfigurationError } from "./api";

type Role = "Admin" | "Engineering" | "Operator";
type Tab = "dashboard" | "devices" | "alarms" | "more";
type User = { id: string; email: string; fullName: string | null; username: string | null; role: Role };
type DeviceCard = {
  ahu: { id: string; name: string; location: string; setpoint: number };
  status: string;
  lastSeenAt: string | null;
  values: Record<string, number | null>;
  unackedAlarms: number;
};
type Overview = {
  totals: { ahus: number; online: number; run: number; fault: number; offline: number; activeAlarms: number; unackedAlarms: number };
  cards: DeviceCard[];
  recentAlarms: Alarm[];
  sync?: { mode: string; lastSuccessAt: string | null };
};
type Alarm = {
  id: string;
  ahuId: string;
  parameter: string;
  priority: string;
  message: string;
  triggeredAt: string | number;
  acknowledged: boolean;
  acknowledgedBy?: string | null;
};
type SessionResponse = { user: User | null };
type AlarmResponse = { alarms: Alarm[]; activeCount: number; state: string };
type LoginResponse = { customToken: string };

const tabs: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Home", icon: Home },
  { id: "devices", label: "Devices", icon: Building2 },
  { id: "alarms", label: "Alarms", icon: AlertTriangle },
  { id: "more", label: "More", icon: MoreHorizontal },
];

function formatTime(value: string | number | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(value: string) {
  return ({ RUN: "Running", STOP: "Stopped", FAULT: "Fault", OFFLINE: "Offline" } as Record<string, string>)[value] ?? value;
}

function statusClass(value: string) {
  return ({ RUN: "status-run", STOP: "status-stop", FAULT: "status-fault", OFFLINE: "status-offline" } as Record<string, string>)[value] ?? "status-offline";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  useEffect(() => {
    const firebaseAuth = auth;
    if (!firebaseAuth) {
      setAuthReady(true);
      return;
    }
    let active = true;
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!active) return;
      if (!firebaseUser) {
        setUser(null);
        setAuthReady(true);
        return;
      }
      try {
        const session = await api<SessionResponse>("/api/auth/session");
        if (!active) return;
        setUser(session.user);
        if (!session.user) await signOut(firebaseAuth);
      } catch {
        if (active) setError("Could not verify your session. Check the server connection.");
      } finally {
        if (active) setAuthReady(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const loadData = useCallback(async (silent = false) => {
    if (!auth?.currentUser || tab === "more") return;
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      if (tab === "alarms") {
        const result = await api<AlarmResponse>("/api/alarms?state=active");
        setAlarms(result.alarms ?? []);
      } else {
        const overviewRequest = api<Overview>("/api/overview?window=15&lite=1");
        const alarmsRequest = tab === "dashboard"
          ? api<AlarmResponse>("/api/alarms?state=active")
          : Promise.resolve(null);
        const [result, alarmResult] = await Promise.all([overviewRequest, alarmsRequest]);
        setOverview(result);
        if (alarmResult) setAlarms(alarmResult.alarms ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load monitoring data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!user) return;
    void loadData();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadData(true);
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loadData]);

  const activeAlarms = useMemo(() => alarms.filter((item) => !item.acknowledged), [alarms]);
  const alarmBadgeCount = tab === "alarms" ? activeAlarms.length : (overview?.totals.unackedAlarms ?? 0);

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const result = await api<LoginResponse>("/api/auth/mobile-login", {
        method: "POST",
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      await signInWithCustomToken(auth, result.customToken);
      setPassword("");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoginBusy(false);
    }
  }

  async function acknowledge(alarmId: string) {
    setAcknowledging(alarmId);
    try {
      await api("/api/alarms", { method: "POST", body: JSON.stringify({ alarmId }) });
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge alarm");
    } finally {
      setAcknowledging(null);
    }
  }

  async function logout() {
    if (auth) await signOut(auth);
    setOverview(null);
    setAlarms([]);
    setTab("dashboard");
  }

  if (!firebaseConfigured) {
    return <SetupMessage title="Firebase setup needed" message="Copy mobile/.env.example to mobile/.env.local and add the public Firebase Auth web-app values for the same project as the server." />;
  }
  const apiError = apiConfigurationError();
  if (apiError) return <SetupMessage title="API setup needed" message={apiError} />;
  if (!authReady) return <Splash label="Checking secure sign-in…" />;
  if (!user) {
    return (
      <main className="login-screen">
        <div className="login-glow" />
        <div className="login-brand">
          <img src="/ahu/logo.png" alt="" className="brand-mark" />
          <div><strong>Smart AHU</strong><span>Monitoring &amp; Control</span></div>
        </div>
        <section className="login-card">
          <div className="eyebrow"><ShieldCheck size={14} /> Secure operator portal</div>
          <h1>Welcome back</h1>
          <p className="subtle">Sign in with your registered email or username.</p>
          <form onSubmit={submitLogin} className="login-form">
            <label htmlFor="identifier">Email or username</label>
            <input id="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required placeholder="you@example.com" />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Enter your password" />
            {loginError ? <p className="error-note" role="alert">{loginError}</p> : null}
            <button className="primary-button" type="submit" disabled={loginBusy}>
              {loginBusy ? <><RefreshCw size={16} className="spin" /> Verifying…</> : <>Sign in <ChevronRight size={17} /></>}
            </button>
          </form>
          <div className="login-foot"><ShieldCheck size={14} /> Role-based access · Protected connection</div>
        </section>
        <p className="version-note">LIVE FACILITY MONITORING</p>
      </main>
    );
  }

  const totals = overview?.totals;
  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-compact"><img src="/ahu/logo.png" alt="" /><div><strong>Smart AHU</strong><span>Facility monitoring</span></div></div>
        <button className="icon-button refresh-button" type="button" aria-label="Refresh" onClick={() => void loadData()} disabled={refreshing}>
          <RefreshCw size={18} className={refreshing ? "spin" : ""} />
        </button>
      </header>
      <main className="screen-content">
        {error ? <div className="error-banner" role="alert"><WifiOff size={17} /><span>{error}</span><button onClick={() => void loadData()}>Retry</button></div> : null}
        {tab === "dashboard" ? (
          <>
            <section className="welcome-block">
              <div className="eyebrow"><span className="live-dot" /> LIVE MONITORING</div>
              <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {(user.fullName || user.username || user.email.split("@")[0]).split(" ")[0]}</h1>
              <p>Your AHU fleet at a glance.</p>
            </section>
            <section className="metric-grid" aria-label="Fleet summary">
              <Metric label="Total units" value={totals?.ahus} icon={<Building2 size={18} />} tone="blue" />
              <Metric label="Running" value={totals?.run} icon={<Fan size={18} />} tone="green" />
              <Metric label="Active alarms" value={totals?.activeAlarms} icon={<AlertTriangle size={18} />} tone="red" />
              <Metric label="Offline" value={totals?.offline} icon={<WifiOff size={18} />} tone="slate" />
            </section>
            <section className="section-block">
              <SectionTitle title="Fleet status" action={`${overview?.cards?.length ?? 0} units`} />
              {loading && !overview ? <LoadingCard /> : overview?.cards?.length ? overview.cards.slice(0, 5).map((card) => <DeviceRow key={card.ahu.id} device={card} compact />) : <EmptyCard icon={<Wifi size={20} />} title="No devices yet" message="Your fleet will appear here when data is available." />}
            </section>
            <section className="section-block">
              <SectionTitle title="Active alarms" action="Latest" />
              {activeAlarms.length ? activeAlarms.slice(0, 3).map((alarm) => <AlarmRow key={alarm.id} alarm={alarm} />) : <EmptyCard icon={<Check size={20} />} title="All clear" message="No active alarms reported." />}
            </section>
          </>
        ) : null}
        {tab === "devices" ? (
          <>
            <PageHeading eyebrow="LIVE FLEET" title="Devices" detail="Current status from the active fleet." />
            {loading && !overview ? <LoadingCard /> : overview?.cards?.length ? <div className="device-list">{overview.cards.map((card) => <DeviceRow key={card.ahu.id} device={card} />)}</div> : <EmptyCard icon={<Building2 size={20} />} title="No active devices" message="Devices will appear after they are configured." />}
          </>
        ) : null}
        {tab === "alarms" ? (
          <>
            <PageHeading eyebrow="ATTENTION REQUIRED" title="Alarms" detail={`${activeAlarms.length} active · refreshes every 5 seconds`} />
            {loading && !alarms.length ? <LoadingCard /> : activeAlarms.length ? <div className="alarm-list">{activeAlarms.map((alarm) => <AlarmRow key={alarm.id} alarm={alarm} onAcknowledge={() => void acknowledge(alarm.id)} busy={acknowledging === alarm.id} />)}</div> : <EmptyCard icon={<Check size={20} />} title="All clear" message="There are no active alarms right now." />}
          </>
        ) : null}
        {tab === "more" ? (
          <>
            <PageHeading eyebrow="ACCOUNT" title="More" detail="Session and app information." />
            <section className="profile-card">
              <span className="avatar">{(user.fullName || user.email).slice(0, 1).toUpperCase()}</span>
              <span className="profile-meta"><strong>{user.fullName || user.username || user.email}</strong><small>{user.email}</small></span>
              <span className="role-chip">{user.role}</span>
            </section>
            <div className="info-card"><ShieldCheck size={18} /><span><strong>Access is protected</strong><small>Role permissions are verified by the monitoring API for every request.</small></span></div>
            <div className="info-card"><Activity size={18} /><span><strong>Live refresh</strong><small>Dashboard and active alarms refresh while the app is open.</small></span></div>
            <button className="logout-button" onClick={() => void logout()}><LogOut size={17} /> Sign out</button>
            <div className="mobile-note"><CircleHelp size={15} /> This first mobile release focuses on monitoring and alarm acknowledgement. Control actions remain available in the web app until native safety workflows are reviewed.</div>
          </>
        ) : null}
      </main>
      <nav className="bottom-tabs" aria-label="Main navigation">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={tab === id ? "tab-button is-active" : "tab-button"} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            <span className="tab-icon-wrap"><Icon size={20} strokeWidth={tab === id ? 2.35 : 1.9} />{id === "alarms" && alarmBadgeCount > 0 ? <i className="tab-badge">{alarmBadgeCount > 99 ? "99+" : alarmBadgeCount}</i> : null}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Metric({ label, value, icon, tone }: { label: string; value?: number; icon: React.ReactNode; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><span className="metric-icon">{icon}</span><strong>{value ?? "—"}</strong><span>{label}</span></article>;
}

function SectionTitle({ title, action }: { title: string; action: string }) {
  return <div className="section-title"><h2>{title}</h2><span>{action}</span></div>;
}

function PageHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <section className="page-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></section>;
}

function DeviceRow({ device, compact = false }: { device: DeviceCard; compact?: boolean }) {
  const supply = device.values?.supplyTemp;
  const room = device.values?.roomTemp;
  return (
    <article className={compact ? "device-card device-card-compact" : "device-card"}>
      <div className="device-topline"><div className="device-symbol"><Fan size={18} /></div><span className={`status-pill ${statusClass(device.status)}`}><i />{statusLabel(device.status)}</span></div>
      <div className="device-title"><div><strong>{device.ahu.name || device.ahu.id}</strong><small>{device.ahu.location || device.ahu.id}</small></div><span className="device-id">{device.ahu.id}</span></div>
      <div className="device-readings">
        <span><small>Supply air</small><strong>{supply == null ? "—" : `${supply.toFixed(1)}°C`}</strong></span>
        <span><small>Room temp</small><strong>{room == null ? "—" : `${room.toFixed(1)}°C`}</strong></span>
        <span><small>Setpoint</small><strong>{Number.isFinite(device.ahu.setpoint) ? `${device.ahu.setpoint.toFixed(1)}°C` : "—"}</strong></span>
      </div>
      <div className="device-foot"><span><Clock3 size={13} /> Last seen {formatTime(device.lastSeenAt)}</span><span>{device.unackedAlarms > 0 ? <><AlertTriangle size={13} /> {device.unackedAlarms} unacknowledged</> : <><Check size={13} /> No unacknowledged alarms</>}</span></div>
    </article>
  );
}

function AlarmRow({ alarm, onAcknowledge, busy = false }: { alarm: Alarm; onAcknowledge?: () => void; busy?: boolean }) {
  const tone = alarm.priority.toLowerCase();
  return (
    <article className={`alarm-card alarm-${tone}`}>
      <div className="alarm-mark"><AlertTriangle size={18} /></div>
      <div className="alarm-content"><div className="alarm-top"><strong>{alarm.ahuId}</strong><span className="priority-chip">{alarm.priority}</span></div><p>{alarm.message || alarm.parameter}</p><div className="alarm-meta"><span>{alarm.parameter}</span><span>{formatTime(alarm.triggeredAt)}</span></div>
        {onAcknowledge ? <button className="ack-button" disabled={busy || alarm.acknowledged} onClick={onAcknowledge}>{busy ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}{alarm.acknowledged ? "Acknowledged" : "Acknowledge"}</button> : null}
      </div>
    </article>
  );
}

function LoadingCard() {
  return <div className="loading-card"><RefreshCw size={18} className="spin" /> Loading live data…</div>;
}

function EmptyCard({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return <div className="empty-card"><span>{icon}</span><strong>{title}</strong><p>{message}</p></div>;
}

function SetupMessage({ title, message }: { title: string; message: string }) {
  return <main className="setup-screen"><div className="setup-card"><ShieldCheck size={26} /><h1>{title}</h1><p>{message}</p><small>See mobile/README.md for setup steps.</small></div></main>;
}

function Splash({ label }: { label: string }) {
  return <main className="setup-screen"><div className="setup-card"><RefreshCw className="spin" size={22} /><p>{label}</p></div></main>;
}
