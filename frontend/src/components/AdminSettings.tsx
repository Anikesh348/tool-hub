import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  HardDrive,
  History,
  MemoryStick,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { AdminAuditItem, AdminSettingsService, AdminStatus } from "../apis/admin/settings";
import { Loader } from "./Loader";
import FleetSpeedTestPanel from "./FleetSpeedTestPanel";
import { formatIstDateTime } from "../utils/formatIst";

type ActionName = "cache" | "refresh" | "toolhub" | "reboot";

const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const formatUptime = (seconds = 0) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
};

const ACTIONS: Record<ActionName, {
  title: string;
  description: string;
  phrase: string;
  tone: "cyan" | "amber" | "rose";
  icon: React.ComponentType<{ className?: string }>;
}> = {
  cache: { title: "Clear BuzzWatch cache", description: "Remove Redis response entries without deleting catalog data.", phrase: "CLEAR CACHE", tone: "amber", icon: Trash2 },
  refresh: { title: "Refresh BuzzWatch", description: "Fetch recent catalog data and rebuild recommendation caches.", phrase: "REFRESH BUZZWATCH", tone: "cyan", icon: RefreshCw },
  toolhub: { title: "Restart ToolHub", description: "Restart the backend and frontend containers.", phrase: "RESTART TOOLHUB", tone: "amber", icon: RotateCcw },
  reboot: { title: "Restart Raspberry Pi", description: "Reboot the host and temporarily take every service offline.", phrase: "RESTART PI", tone: "rose", icon: Power },
};

const ActionDialog = ({ action, busy, onClose, onConfirm }: {
  action: ActionName;
  busy: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) => {
  const [value, setValue] = useState("");
  const config = ACTIONS[action];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label={config.title} className="w-full max-w-md rounded-lg border border-white/10 bg-[#080d17] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-black text-white">{config.title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{config.description}</p></div>
          <button onClick={onClose} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <label className="mt-5 block text-xs font-bold uppercase text-slate-500">Type {config.phrase}</label>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white outline-none focus:border-amber-300/60" />
        <button onClick={() => onConfirm(value)} disabled={busy || value !== config.phrase} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-rose-300 px-4 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          Confirm action
        </button>
      </section>
    </div>
  );
};

const AdminSettings = () => {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [audit, setAudit] = useState<AdminAuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [action, setAction] = useState<ActionName | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError("");
    try {
      const [nextStatus, nextAudit] = await Promise.all([AdminSettingsService.status(), AdminSettingsService.audit()]);
      setStatus(nextStatus);
      setAudit(nextAudit.items);
    } catch (err: any) {
      setError(err?.message || "Admin settings are unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runAction = async (confirmation: string) => {
    if (!action) return;
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      const result = action === "cache"
        ? await AdminSettingsService.clearCache()
        : action === "refresh"
          ? await AdminSettingsService.refreshBuzzWatch()
          : action === "toolhub"
            ? await AdminSettingsService.restartToolHub(confirmation)
            : await AdminSettingsService.rebootPi(confirmation);
      setFeedback(result.message);
      setAction(null);
      if (action === "cache" || action === "refresh") await load();
    } catch (err: any) {
      setError(err?.message || "Admin action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="portal-page flex min-h-screen items-center justify-center"><Loader /></div>;

  const memoryPercent = status?.host.memory?.totalBytes ? (status.host.memory.usedBytes / status.host.memory.totalBytes) * 100 : 0;
  const diskPercent = status?.host.disk?.totalBytes ? (status.host.disk.usedBytes / status.host.disk.totalBytes) * 100 : 0;

  return (
    <div className="portal-page min-h-screen px-4 pb-12 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Admin only</p><h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Settings</h1><p className="mt-2 text-sm text-slate-400">Host health, cache maintenance and controlled restart operations.</p></div>
          <button onClick={load} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-bold text-slate-200 hover:border-cyan-300/50"><RefreshCw className="h-4 w-4" />Refresh status</button>
        </header>

        {error && <p className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
        {feedback && <p className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm font-semibold text-emerald-200">{feedback}</p>}

        <section>
          <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300" /><h2 className="text-base font-black text-white">System status</h2></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Host", value: status?.host.hostname || "Unavailable", detail: status?.host.available ? formatUptime(status.host.uptimeSeconds) : "Agent offline", icon: Server },
              { label: "Memory", value: `${memoryPercent.toFixed(0)}%`, detail: `${formatBytes(status?.host.memory?.usedBytes)} used`, icon: MemoryStick },
              { label: "Disk", value: `${diskPercent.toFixed(0)}%`, detail: `${formatBytes(status?.host.disk?.freeBytes)} free`, icon: HardDrive },
              { label: "Redis", value: status?.redis.status === "up" ? "Online" : "Offline", detail: `${status?.redis.keys || 0} cached keys`, icon: Database },
            ].map(({ label, value, detail, icon: Icon }) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.035] p-4"><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><Icon className="h-5 w-5 text-cyan-300" /></div></div>
            ))}
          </div>
        </section>

        <FleetSpeedTestPanel onAuditRefresh={load} />

        <section>
          <h2 className="text-base font-black text-white">Maintenance</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(["cache", "refresh", "toolhub"] as ActionName[]).map((name) => {
              const config = ACTIONS[name]; const Icon = config.icon;
              return <button key={name} onClick={() => setAction(name)} className="flex items-start gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-300/10 text-cyan-200"><Icon className="h-5 w-5" /></span><span><span className="block text-sm font-black text-white">{config.title}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{config.description}</span></span></button>;
            })}
          </div>
        </section>

        <section className="border-t border-rose-300/20 pt-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-300">Danger zone</p>
          <button onClick={() => setAction("reboot")} className="mt-3 flex w-full items-start gap-4 rounded-lg border border-rose-300/25 bg-rose-300/[0.06] p-4 text-left transition hover:bg-rose-300/10"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-300/15 text-rose-200"><Power className="h-5 w-5" /></span><span><span className="block text-sm font-black text-white">{ACTIONS.reboot.title}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{ACTIONS.reboot.description}</span></span></button>
        </section>

        <section>
          <div className="flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="text-base font-black text-white">Recent admin actions</h2></div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            {audit.length ? audit.map((item) => <div key={item._id} className="grid gap-1 border-b border-white/[0.07] px-4 py-3 text-xs last:border-b-0 sm:grid-cols-[1fr_140px_200px]"><span className="font-bold text-slate-200">{item.action.replaceAll("_", " ")}</span><span className="font-semibold text-slate-400">{item.status}</span><span className="text-slate-500">{formatIstDateTime(item.createdAt)}</span></div>) : <p className="p-4 text-sm text-slate-500">No administrative actions recorded yet.</p>}
          </div>
        </section>
      </div>
      {action && <ActionDialog action={action} busy={busy} onClose={() => !busy && setAction(null)} onConfirm={runAction} />}
    </div>
  );
};

export default AdminSettings;
