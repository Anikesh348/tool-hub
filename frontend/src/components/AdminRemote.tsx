import React, { useEffect, useState } from "react";
import { Cast, Lightbulb, MonitorOff, RefreshCw, Radio, Tv } from "lucide-react";
import { AdminRemoteService, Pi5RenderState, SmallLightsGuardState } from "../apis/admin/remote";
import { Loader } from "./Loader";

const statusText = (state: Pi5RenderState | null) => {
  if (!state) return "Unknown";
  if (state.casting) return "Casting";
  if (state.paused) return "Paused";
  if (state.rendererActive && state.streamActive) return "Live";
  return "Partial";
};

const AdminRemote = () => {
  const [state, setState] = useState<Pi5RenderState | null>(null);
  const [smallLightsGuard, setSmallLightsGuard] = useState<SmallLightsGuardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [smallLightsGuardBusy, setSmallLightsGuardBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = async () => {
    setError("");
    try {
      const [nextState, nextSmallLightsGuard] = await Promise.all([
        AdminRemoteService.pi5RenderStatus(),
        AdminRemoteService.smallLightsGuard(),
      ]);
      setState(nextState);
      setSmallLightsGuard(nextSmallLightsGuard);
    } catch (err: any) {
      setError(err?.message || "Remote status is unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setPaused = async (paused: boolean) => {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const nextState = await AdminRemoteService.setPi5RenderPaused(paused);
      setState(nextState);
      setFeedback(nextState.message || (paused ? "Pi5 render paused" : "Pi5 render resumed"));
    } catch (err: any) {
      setError(err?.message || "Remote action failed");
    } finally {
      setBusy(false);
    }
  };

  const setCasting = async (casting: boolean) => {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const nextState = await AdminRemoteService.setPi5AirplayCasting(casting);
      setState(nextState);
      setFeedback(nextState.message || (casting ? "AirPlay cast mode started" : "AirPlay cast mode stopped"));
    } catch (err: any) {
      setError(err?.message || "Remote action failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleSmallLightsGuard = async () => {
    if (!smallLightsGuard) return;
    setSmallLightsGuardBusy(true);
    setError("");
    setFeedback("");
    try {
      const nextState = await AdminRemoteService.setSmallLightsGuard(!smallLightsGuard.enabled);
      setSmallLightsGuard(nextState);
      setFeedback(`Small Lights safeguard ${nextState.enabled ? "enabled" : "disabled"}`);
    } catch (err: any) {
      setError(err?.message || "Small Lights safeguard is unavailable");
    } finally {
      setSmallLightsGuardBusy(false);
    }
  };

  if (loading) return <div className="portal-page flex min-h-screen items-center justify-center"><Loader /></div>;

  const paused = !!state?.paused;
  const casting = !!state?.casting;

  return (
    <div className="portal-page min-h-screen px-4 pb-12 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Admin only</p>
            <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Remote</h1>
            <p className="mt-2 text-sm text-slate-400">Control the Pi5 render stream that feeds the monitor.</p>
          </div>
          <button onClick={load} disabled={busy || smallLightsGuardBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-bold text-slate-200 hover:border-cyan-300/50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy || smallLightsGuardBusy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

        {error && <p className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
        {feedback && <p className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm font-semibold text-emerald-200">{feedback}</p>}

        <section aria-labelledby="small-lights-guard-heading" className="rounded-lg border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="flex gap-4">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${smallLightsGuard?.enabled ? "bg-emerald-300/15 text-emerald-200" : "bg-amber-300/15 text-amber-200"}`}>
                <Lightbulb className="h-6 w-6" />
              </span>
              <div>
                <h2 id="small-lights-guard-heading" className="text-lg font-black text-white">Small Lights safeguard</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">When enabled, Home Assistant promptly turns off only Small lights.</p>
                <p className={`mt-2 text-xs font-bold ${smallLightsGuard?.enabled ? "text-emerald-300" : "text-slate-400"}`} aria-live="polite">Current state: {smallLightsGuard?.enabled ? "Enabled" : "Disabled"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleSmallLightsGuard}
              disabled={!smallLightsGuard || smallLightsGuardBusy}
              aria-pressed={smallLightsGuard?.enabled || false}
              aria-label={`${smallLightsGuard?.enabled ? "Disable" : "Enable"} Small Lights safeguard`}
              className={`relative h-8 w-14 shrink-0 self-end rounded-full border transition disabled:cursor-wait disabled:opacity-60 sm:self-auto ${smallLightsGuard?.enabled ? "border-emerald-300/40 bg-emerald-300/30" : "border-amber-300/40 bg-amber-300/20"}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${smallLightsGuard?.enabled ? "left-7" : "left-1"}`} />
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex gap-4">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${paused ? "bg-rose-300/15 text-rose-200" : "bg-cyan-300/15 text-cyan-200"}`}>
                {paused ? <MonitorOff className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
              </span>
              <div>
                <h2 className="text-lg font-black text-white">Pause Pi5 render</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
                  When enabled, ToolHub stops the live Pi5 dashboard renderer and sends a black stream to the Pi Zero monitor.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              disabled={busy}
              aria-pressed={paused}
              className={`relative h-8 w-14 rounded-full border transition disabled:cursor-wait disabled:opacity-60 ${paused ? "border-rose-300/40 bg-rose-300/30" : "border-cyan-300/40 bg-cyan-300/20"}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${paused ? "left-7" : "left-1"}`} />
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "State", value: statusText(state), active: !paused },
              { label: "Renderer", value: state?.rendererActive ? "Running" : "Stopped", active: !!state?.rendererActive },
              { label: "Stream", value: state?.streamActive || state?.blackoutActive ? "Sending" : "Stopped", active: !!(state?.streamActive || state?.blackoutActive) },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-500"><Radio className={`h-3.5 w-3.5 ${item.active ? "text-cyan-300" : "text-slate-600"}`} />{item.label}</div>
                <p className="mt-2 text-sm font-black text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex gap-4">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${casting ? "bg-emerald-300/15 text-emerald-200" : "bg-violet-300/15 text-violet-200"}`}>
                <Cast className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-lg font-black text-white">AirPlay cast from Pi5</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
                  Starts AirPlay on the Pi5 and forwards a 1080p 30fps SRT stream to the Pi Zero monitor.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCasting(!casting)}
              disabled={busy}
              aria-pressed={casting}
              className={`relative h-8 w-14 rounded-full border transition disabled:cursor-wait disabled:opacity-60 ${casting ? "border-emerald-300/40 bg-emerald-300/30" : "border-violet-300/40 bg-violet-300/20"}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${casting ? "left-7" : "left-1"}`} />
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Mode", value: statusText(state), active: casting },
              { label: "AirPlay", value: state?.airplayActive ? "Available" : "Stopped", active: !!state?.airplayActive },
              { label: "Target", value: "Zero stream", active: !!state?.airplayActive },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-500"><Radio className={`h-3.5 w-3.5 ${item.active ? "text-emerald-300" : "text-slate-600"}`} />{item.label}</div>
                <p className="mt-2 text-sm font-black text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminRemote;
