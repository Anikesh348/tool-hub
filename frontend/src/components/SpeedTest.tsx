import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Download,
  Gauge,
  History,
  Play,
  RotateCcw,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { SpeedTestService } from "../apis/speedtest/speedtest";

type Stage = "idle" | "ping" | "download" | "upload" | "complete";
type TestResult = {
  id: string;
  createdAt: string;
  ping: number;
  jitter: number;
  download: number;
  upload: number;
};

const HISTORY_KEY = "toolhub:speedtest:history";
const THROUGHPUT_STAGE_MS = 7_000;
const SAMPLE_TARGET_MS = 700;
const MIN_SAMPLE_BYTES = 64 * 1024;
const MAX_DOWNLOAD_SAMPLE_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_SAMPLE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_STAGE_LIMIT_BYTES = 768 * 1024 * 1024;
const UPLOAD_STAGE_LIMIT_BYTES = 384 * 1024 * 1024;
const MAX_DOWNLOAD_WORKERS = 4;
const MAX_UPLOAD_WORKERS = 2;
const mbps = (bytes: number, milliseconds: number) => (bytes * 8) / (milliseconds / 1000) / 1_000_000;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundToSampleBlock = (bytes: number) => Math.max(MIN_SAMPLE_BYTES, Math.round(bytes / MIN_SAMPLE_BYTES) * MIN_SAMPLE_BYTES);
const workerCountFor = (speedMbps: number, maxWorkers: number) => {
  if (speedMbps >= 90) return maxWorkers;
  if (speedMbps >= 25) return Math.min(2, maxWorkers);
  return 1;
};
const sampleBytesFor = (perWorkerMbps: number, remainingMs: number, maxSampleBytes: number, remainingBytes: number) => {
  if (remainingBytes <= MIN_SAMPLE_BYTES) return remainingBytes;
  const sampleCap = Math.min(maxSampleBytes, remainingBytes);
  if (!Number.isFinite(perWorkerMbps) || perWorkerMbps <= 0.25) {
    return MIN_SAMPLE_BYTES;
  }
  const targetMs = clamp(Math.min(SAMPLE_TARGET_MS, remainingMs * 0.6), 250, SAMPLE_TARGET_MS);
  const bytesPerMs = (perWorkerMbps * 1_000_000) / 8 / 1000;
  const estimatedBytes = bytesPerMs * targetMs;
  return clamp(roundToSampleBlock(estimatedBytes), MIN_SAMPLE_BYTES, sampleCap);
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const quality = (result: TestResult | null) => {
  if (!result) return { label: "Ready", detail: "Start when you are ready", tone: "text-slate-300" };
  if (result.download >= 100 && result.upload >= 20 && result.ping <= 35) return { label: "Excellent", detail: "Great for 4K streaming, calls and large transfers", tone: "text-emerald-300" };
  if (result.download >= 40 && result.upload >= 10 && result.ping <= 70) return { label: "Very good", detail: "Comfortable for streaming and video calls", tone: "text-cyan-300" };
  if (result.download >= 15 && result.upload >= 5) return { label: "Good", detail: "Suitable for everyday browsing and HD video", tone: "text-amber-300" };
  return { label: "Limited", detail: "Large downloads and video calls may struggle", tone: "text-rose-300" };
};

const Metric = ({ icon: Icon, label, value, unit, active }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
  active?: boolean;
}) => (
  <div className={`rounded-lg border p-4 transition-colors ${active ? "border-cyan-300/50 bg-cyan-300/[0.07]" : "border-white/10 bg-white/[0.03]"}`}>
    <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><Icon className={`h-4 w-4 ${active ? "text-cyan-300" : "text-slate-500"}`} /></div>
    <p className="mt-3 text-2xl font-black text-white">{value}<span className="ml-1 text-xs font-bold text-slate-500">{unit}</span></p>
  </div>
);

const SpeedTest = () => {
  const [stage, setStage] = useState<Stage>("idle");
  const [ping, setPing] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [history, setHistory] = useState<TestResult[]>([]);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]")); } catch { setHistory([]); }
    return () => abortRef.current?.abort();
  }, []);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage("idle");
  };

  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(""); setResult(null); setPing(null); setJitter(null); setDownload(null); setUpload(null);
    try {
      const session = await SpeedTestService.createSession();
      setStage("ping");
      const pings: number[] = [];
      for (let index = 0; index < 6; index += 1) pings.push(await SpeedTestService.ping(session.sessionId, controller.signal));
      const stablePings = pings.slice(1);
      const measuredPing = median(stablePings);
      const measuredJitter = stablePings.reduce((sum, value) => sum + Math.abs(value - measuredPing), 0) / stablePings.length;
      setPing(measuredPing); setJitter(measuredJitter);

      setStage("download");
      const downloadStartedAt = performance.now();
      let downloadedBytes = 0;
      let downloadEstimate = connection?.downlink || 0;
      while (
        performance.now() - downloadStartedAt < THROUGHPUT_STAGE_MS &&
        downloadedBytes < DOWNLOAD_STAGE_LIMIT_BYTES - MIN_SAMPLE_BYTES
      ) {
        const elapsed = performance.now() - downloadStartedAt;
        const remainingMs = Math.max(350, THROUGHPUT_STAGE_MS - elapsed);
        const workers = downloadedBytes === 0 ? 1 : workerCountFor(downloadEstimate, MAX_DOWNLOAD_WORKERS);
        const remainingBytes = DOWNLOAD_STAGE_LIMIT_BYTES - downloadedBytes;
        const sampleBytes = downloadedBytes === 0
          ? MIN_SAMPLE_BYTES
          : sampleBytesFor(downloadEstimate / workers, remainingMs, MAX_DOWNLOAD_SAMPLE_BYTES, Math.floor(remainingBytes / workers));
        const activeDownloads = Array(workers).fill(0) as number[];
        const samples = await Promise.all(
          Array.from({ length: workers }, (_, workerIndex) =>
            SpeedTestService.download(
              session.sessionId,
              sampleBytes,
              controller.signal,
              (receivedBytes) => {
                activeDownloads[workerIndex] = receivedBytes;
                const observedBytes = downloadedBytes + activeDownloads.reduce((sum, value) => sum + value, 0);
                const observedMbps = mbps(observedBytes, Math.max(performance.now() - downloadStartedAt, 1));
                downloadEstimate = observedMbps;
                setDownload(observedMbps);
              },
            ),
          ),
        );
        downloadedBytes += samples.reduce((sum, sample) => sum + sample.bytes, 0);
        downloadEstimate = mbps(downloadedBytes, Math.max(performance.now() - downloadStartedAt, 1));
        setDownload(downloadEstimate);
      }
      const measuredDownload = mbps(downloadedBytes, performance.now() - downloadStartedAt);
      setDownload(measuredDownload);

      setStage("upload");
      const uploadStartedAt = performance.now();
      let uploadedBytes = 0;
      let uploadEstimate = Math.max(measuredDownload * 0.25, 1);
      while (
        performance.now() - uploadStartedAt < THROUGHPUT_STAGE_MS &&
        uploadedBytes < UPLOAD_STAGE_LIMIT_BYTES - MIN_SAMPLE_BYTES
      ) {
        const elapsed = performance.now() - uploadStartedAt;
        const remainingMs = Math.max(350, THROUGHPUT_STAGE_MS - elapsed);
        const workers = uploadedBytes === 0 ? 1 : workerCountFor(uploadEstimate, MAX_UPLOAD_WORKERS);
        const remainingBytes = UPLOAD_STAGE_LIMIT_BYTES - uploadedBytes;
        const sampleBytes = uploadedBytes === 0
          ? MIN_SAMPLE_BYTES
          : sampleBytesFor(uploadEstimate / workers, remainingMs, MAX_UPLOAD_SAMPLE_BYTES, Math.floor(remainingBytes / workers));
        const samples = await Promise.all(
          Array.from({ length: workers }, () =>
            SpeedTestService.upload(
              session.sessionId,
              sampleBytes,
              controller.signal,
            ),
          ),
        );
        uploadedBytes += samples.reduce((sum, sample) => sum + sample.bytes, 0);
        uploadEstimate = mbps(uploadedBytes, Math.max(performance.now() - uploadStartedAt, 1));
        setUpload(uploadEstimate);
      }
      const measuredUpload = mbps(uploadedBytes, performance.now() - uploadStartedAt);
      setUpload(measuredUpload);

      const completed: TestResult = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ping: measuredPing, jitter: measuredJitter, download: measuredDownload, upload: measuredUpload };
      const nextHistory = [completed, ...history].slice(0, 8);
      setResult(completed); setHistory(nextHistory); localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      setStage("complete");
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err?.message || "The speed test could not be completed");
      setStage("idle");
    } finally {
      abortRef.current = null;
    }
  };

  const busy = !["idle", "complete"].includes(stage);
  const gaugeValue = stage === "upload" ? upload || 0 : download || 0;
  const gaugeMaximum = Math.max(100, Math.ceil(gaugeValue / 100) * 100);
  const gaugeProgress = Math.min(100, (gaugeValue / gaugeMaximum) * 100);
  const verdict = quality(result);

  return (
    <div className="portal-page min-h-screen px-4 pb-12 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Network tools</p><h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Speed Test</h1><p className="mt-2 text-sm text-slate-400">Browser connection to the ToolHub server.</p></div>
          {connection?.effectiveType && <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold uppercase text-slate-300"><Wifi className="h-4 w-4 text-cyan-300" />{connection.effectiveType}</span>}
        </header>

        <section className="grid items-center gap-8 py-4 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col items-center">
            <div className="relative flex aspect-square w-full max-w-[320px] items-center justify-center rounded-full p-5" style={{ background: `conic-gradient(#67e8f9 ${gaugeProgress}%, rgba(255,255,255,0.07) ${gaugeProgress}% 100%)` }}>
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#060b14] text-center shadow-2xl shadow-black/40">
                {busy ? <Activity className="h-6 w-6 animate-pulse text-cyan-300" /> : stage === "complete" ? <CheckCircle2 className="h-6 w-6 text-emerald-300" /> : <Gauge className="h-6 w-6 text-slate-500" />}
                <p className="mt-4 text-5xl font-black text-white">{gaugeValue ? gaugeValue.toFixed(1) : "0.0"}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Mbps</p>
                <p className="mt-4 text-sm font-bold capitalize text-cyan-200">{stage === "idle" ? "Ready" : stage}</p>
              </div>
            </div>
            {busy ? <button onClick={stop} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300/30 px-5 text-sm font-black text-rose-200"><X className="h-4 w-4" />Stop test</button> : <button onClick={run} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-lg bg-cyan-300 px-7 text-sm font-black text-slate-950 transition hover:brightness-110">{stage === "complete" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}{stage === "complete" ? "Test again" : "Start test"}</button>}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={Activity} label="Ping" value={ping === null ? "--" : ping.toFixed(0)} unit="ms" active={stage === "ping"} />
              <Metric icon={Activity} label="Jitter" value={jitter === null ? "--" : jitter.toFixed(1)} unit="ms" active={stage === "ping"} />
              <Metric icon={Download} label="Download" value={download === null ? "--" : download.toFixed(1)} unit="Mbps" active={stage === "download"} />
              <Metric icon={Upload} label="Upload" value={upload === null ? "--" : upload.toFixed(1)} unit="Mbps" active={stage === "upload"} />
            </div>
            <div className="border-t border-white/10 pt-4"><p className={`text-xl font-black ${verdict.tone}`}>{verdict.label}</p><p className="mt-1 text-sm text-slate-400">{verdict.detail}</p></div>
            {error && <p className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
          </div>
        </section>

        <section className="border-t border-white/10 pt-6">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="text-base font-black text-white">Recent tests</h2></div>{history.length > 0 && <button onClick={() => { setHistory([]); localStorage.removeItem(HISTORY_KEY); }} className="text-xs font-bold text-slate-500 hover:text-rose-300">Clear history</button>}</div>
          {history.length ? <div className="mt-3 overflow-hidden rounded-lg border border-white/10">{history.map((item) => <div key={item.id} className="grid grid-cols-[1fr_repeat(3,auto)] items-center gap-4 border-b border-white/[0.07] px-4 py-3 text-xs last:border-b-0"><span className="text-slate-500">{new Date(item.createdAt).toLocaleString()}</span><span className="font-bold text-slate-300">{item.ping.toFixed(0)} ms</span><span className="font-bold text-cyan-200">↓ {item.download.toFixed(1)}</span><span className="font-bold text-emerald-200">↑ {item.upload.toFixed(1)}</span></div>)}</div> : <p className="mt-3 text-sm text-slate-500">Completed tests will appear here.</p>}
        </section>
      </div>
    </div>
  );
};

export default SpeedTest;
