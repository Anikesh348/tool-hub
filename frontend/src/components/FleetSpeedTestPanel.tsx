import React, { useEffect, useState } from "react";
import { Activity, Download, Gauge, RefreshCw, Server, Upload } from "lucide-react";
import { AdminSettingsService, FleetSpeedTestResult } from "../apis/admin/settings";
import { formatIstDateTime } from "../utils/formatIst";

const formatSpeed = (value?: number) => value === undefined ? "--" : value.toFixed(1);
const TARGETS = [
  { id: "hp-purva", label: "Proxmox", kind: "Hypervisor" },
  { id: "ubuntu-purva", label: "Ubuntu", kind: "VM 100" },
  { id: "homeassistant", label: "Home Assistant", kind: "VM 101" },
  { id: "hp-codex", label: "Codex", kind: "VM 102" },
  { id: "pi-purva", label: "Pi 5", kind: "Server" },
] as const;

const FleetSpeedTestPanel = ({ onAuditRefresh }: { onAuditRefresh: () => Promise<void> }) => {
  const [result, setResult] = useState<FleetSpeedTestResult | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    AdminSettingsService.latestFleetSpeedTest()
      .then((latest) => { if (latest.available) setResult(latest); })
      .catch(() => undefined);
  }, []);

  const run = async (targetId?: string) => {
    setBusyTarget(targetId || "all");
    setError("");
    try {
      const next = await AdminSettingsService.runSpeedTest(targetId);
      setResult((current) => {
        if (!targetId) return next;
        const updated = next.results[0];
        const existing = current?.results || [];
        return {
          ...next,
          results: [...existing.filter((item) => item.id !== targetId), ...(updated ? [updated] : [])],
        };
      });
      await onAuditRefresh();
    } catch (err: any) {
      setError(err?.message || "Server speed test failed");
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-cyan-300" /><h2 className="text-base font-black text-white">Server and VM internet speed</h2></div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">Tests Proxmox, Ubuntu, Home Assistant, Codex, and Pi 5 sequentially so they do not compete. Each node uses five latency samples, a 50 MB download, and a 25 MB upload.</p>
        </div>
        <button onClick={() => run()} disabled={busyTarget !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-300 px-4 text-xs font-black text-slate-950 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
          {busyTarget === "all" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
          {busyTarget === "all" ? "Testing nodes..." : "Run all nodes"}
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-xs leading-5 text-amber-100">
        A complete run transfers approximately 358 MiB. Only one fleet test can run at a time.
      </div>

      {error && <p className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}

      <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
        <div className="hidden grid-cols-[1.2fr_0.65fr_repeat(3,0.72fr)_0.65fr_0.55fr] gap-3 border-b border-white/10 bg-white/[0.035] px-4 py-3 text-[11px] font-bold uppercase text-slate-500 md:grid">
          <span>Node</span><span>Type</span><span>Latency</span><span>Download</span><span>Upload</span><span>Status</span><span>Action</span>
        </div>
        {TARGETS.map((target) => {
          const node = result?.results?.find((item) => item.id === target.id);
          return (
            <div key={target.id} className="grid gap-3 border-b border-white/[0.07] px-4 py-4 last:border-b-0 md:grid-cols-[1.2fr_0.65fr_repeat(3,0.72fr)_0.65fr_0.55fr] md:items-center">
              <div className="flex items-center gap-3"><Server className="h-4 w-4 shrink-0 text-cyan-300" /><div><p className="text-sm font-black text-white">{target.label}</p><p className="text-xs text-slate-500">{node?.hostname || target.id}</p></div></div>
              <p className="text-xs font-bold text-slate-400">{target.kind}</p>
              <p className="text-sm font-black text-slate-200"><Activity className="mr-1 inline h-3.5 w-3.5 text-slate-500" />{node?.latencyMs === undefined ? "--" : `${node.latencyMs.toFixed(1)} ms`}</p>
              <p className="text-sm font-black text-cyan-200"><Download className="mr-1 inline h-3.5 w-3.5" />{formatSpeed(node?.downloadMbps)} Mbps</p>
              <p className="text-sm font-black text-emerald-200"><Upload className="mr-1 inline h-3.5 w-3.5" />{formatSpeed(node?.uploadMbps)} Mbps</p>
              <div>{node ? <><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase ${node.status === "ok" ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>{node.status}</span>{node.error && <p className="mt-1 text-xs text-rose-200">{node.error}</p>}</> : <span className="text-xs text-slate-500">Not tested</span>}</div>
              <button onClick={() => run(target.id)} disabled={busyTarget !== null} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-cyan-300/25 px-3 text-xs font-black text-cyan-200 transition hover:border-cyan-300/60 disabled:cursor-wait disabled:opacity-50">
                {busyTarget === target.id && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {busyTarget === target.id ? "Testing" : "Test"}
              </button>
            </div>
          );
        })}
      </div>

      {result?.completedAt && <p className="mt-3 text-xs text-slate-500">Last completed {formatIstDateTime(result.completedAt)} via {result.provider}; {result.mode} mode, {result.estimatedTotalMiB.toFixed(1)} MiB.</p>}
    </section>
  );
};

export default FleetSpeedTestPanel;
