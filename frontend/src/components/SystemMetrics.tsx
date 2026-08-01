import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Layers3,
  MemoryStick,
  Server,
  Thermometer,
  Wifi,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { refreshAccessToken } from "../apis/auth/authSession";
import { useAuth } from "../context/AuthContext";

type ChartResponse = {
  labels: string[];
  data: number[][];
};

type MetricsResponse = {
  node: string;
  nodes: Array<{
    id: string;
    label: string;
  }>;
  host: {
    hostname: string;
    version?: string;
    osName?: string;
    osVersion?: string;
    kernelVersion?: string;
    architecture?: string;
    cores?: number;
    cpuFrequency?: string;
    ramBytes?: number;
    diskBytes?: number;
  };
  live: LiveMetrics;
  charts: {
    cpu: ChartResponse;
    memory: ChartResponse;
    load: ChartResponse;
    diskIo: ChartResponse;
    network: ChartResponse;
    temperature: ChartResponse;
  };
  alarms: Array<{
    name: string;
    status: "WARNING" | "CRITICAL";
    value?: number;
    units?: string;
    info?: string;
  }>;
};

type LiveMetrics = {
  sampledAt: number;
  sampleAgeSeconds: number;
  cpu: {
    percent: number;
    user: number;
    system: number;
    nice: number;
    iowait: number;
    softirq: number;
    irq: number;
    steal: number;
  };
  memory: {
    percent: number;
    usedMiB: number;
    cachedMiB: number;
    freeMiB: number;
    availableMiB: number;
    totalMiB: number;
  };
  load: {
    load1: number;
    load5: number;
    load15: number;
  };
  disk: {
    percent: number;
    usedGiB: number;
    availableGiB: number;
    usableGiB: number;
    reservedGiB: number;
  };
  diskIo: {
    readKiBps: number;
    writeKiBps: number;
  };
  network: {
    receivedKbps: number;
    sentKbps: number;
  };
  temperatureCelsius: number;
  prodeskTemperatureCelsius: number | null;
  prodeskTemperatureSampledAt: number | null;
  uptimeSeconds: number;
  processes: ProcessMetric[];
};

type ProcessMetric = {
  name: string;
  cpuPercent: number;
  memoryMiB: number;
  memoryPercent: number;
  processCount: number;
};

type SeriesPoint = Record<string, number | string>;

const API_BASE = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");
const PROCESS_ROW_COUNT = 12;
const DEFAULT_NODES = [
  { id: "pi5", label: "Pi 5" },
  { id: "ubuntu", label: "HP / Ubuntu" },
];
const colors = {
  violet: "#8b5cf6",
  blue: "#38bdf8",
  green: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};

const rows = (chart?: ChartResponse): SeriesPoint[] => {
  if (!chart?.labels?.length || !chart.data?.length) return [];
  return [...chart.data].reverse().map((values) =>
    chart.labels.reduce<SeriesPoint>((point, label, index) => {
      point[label] =
        label === "time"
          ? new Date(Number(values[index]) * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : Number(values[index] || 0);
      return point;
    }, {})
  );
};

const appendChartPoint = (
  chart: ChartResponse,
  sampledAt: number,
  values: Record<string, number>,
): ChartResponse => {
  const point = chart.labels.map((label) =>
    label === "time" ? sampledAt : Number(values[label] || 0)
  );
  const withoutDuplicate = chart.data.filter((row) => Number(row[0]) !== sampledAt);
  return { ...chart, data: [point, ...withoutDuplicate].slice(0, 120) };
};

const appendLiveCharts = (
  charts: MetricsResponse["charts"],
  live: LiveMetrics,
): MetricsResponse["charts"] => ({
  cpu: appendChartPoint(charts.cpu, live.sampledAt, live.cpu),
  memory: appendChartPoint(charts.memory, live.sampledAt, {
    used: live.memory.usedMiB,
    cached: live.memory.cachedMiB,
    free: live.memory.freeMiB,
  }),
  load: appendChartPoint(charts.load, live.sampledAt, live.load),
  diskIo: appendChartPoint(charts.diskIo, live.sampledAt, {
    reads: live.diskIo.readKiBps,
    writes: live.diskIo.writeKiBps,
  }),
  network: appendChartPoint(charts.network, live.sampledAt, {
    received: live.network.receivedKbps,
    sent: live.network.sentKbps,
  }),
  temperature: appendChartPoint(charts.temperature, live.sampledAt, {
    input: live.temperatureCelsius,
  }),
});

const formatBytes = (bytes = 0) => {
  if (!bytes) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const formatUptime = (seconds = 0) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days}d ` : ""}${hours}h ${minutes}m`;
};

const MetricCard = ({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone: keyof typeof colors;
}) => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4 shadow-xl shadow-black/10">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{detail}</p>
      </div>
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${colors[tone]}18`, color: colors[tone] }}
      >
        <Icon className="h-5 w-5" />
      </span>
    </div>
  </div>
);

const TrendChart = ({
  title,
  subtitle,
  data,
  series,
}: {
  title: string;
  subtitle: string;
  data: SeriesPoint[];
  series: Array<{ key: string; label: string; color: string }>;
}) => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4">
    <div className="mb-4">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="text-[11px] text-slate-500">{subtitle}</p>
    </div>
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {series.map(({ key, color }) => (
              <linearGradient key={key} id={`metric-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "#080d17",
              border: "1px solid #243047",
              borderRadius: "12px",
              color: "#e2e8f0",
              fontSize: "12px",
            }}
          />
          {series.map(({ key, label, color }) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={label}
              stroke={color}
              fill={`url(#metric-${key})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const SystemMetrics = () => {
  const { authToken } = useAuth();
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [processSort, setProcessSort] = useState<"cpu" | "memory">("cpu");
  const [selectedNode, setSelectedNode] = useState("pi5");
  const [availableNodes, setAvailableNodes] = useState(DEFAULT_NODES);
  const fullRequestRunning = useRef(false);

  const loadMetrics = useCallback(async () => {
    if (!authToken || fullRequestRunning.current) return;
    fullRequestRunning.current = true;
    try {
      setError("");
      const query = new URLSearchParams({ node: selectedNode });
      const send = () => fetch(`${API_BASE}/v2/admin/system-metrics?${query}`, {
        credentials: "include",
      });
      let response = await send();
      if (response.status === 401 && (await refreshAccessToken())) response = await send();
      if (!response.ok) throw new Error(`Metrics request failed (${response.status})`);
      const nextMetrics = (await response.json()) as MetricsResponse;
      setMetrics(nextMetrics);
      setAvailableNodes(nextMetrics.nodes?.length ? nextMetrics.nodes : DEFAULT_NODES);
      setUpdatedAt(new Date(nextMetrics.live.sampledAt * 1000));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Metrics are unavailable");
    } finally {
      fullRequestRunning.current = false;
      setLoading(false);
    }
  }, [authToken, selectedNode]);

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    loadMetrics();
    setStreamState("connecting");
    const query = new URLSearchParams({ node: selectedNode });
    const source = new EventSource(`${API_BASE}/v2/admin/system-metrics/stream?${query}`, {
      withCredentials: true,
    });
    source.onopen = () => setStreamState("live");
    source.addEventListener("metrics", (event) => {
      const live = JSON.parse((event as MessageEvent<string>).data) as LiveMetrics;
      setMetrics((current) =>
        current
          ? { ...current, live, charts: appendLiveCharts(current.charts, live) }
          : current
      );
      setUpdatedAt(new Date(live.sampledAt * 1000));
      setStreamState("live");
      setError("");
    });
    source.addEventListener("stream-error", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { message?: string };
        setError(payload.message || "Live metrics are temporarily unavailable");
      } catch {
        setError("Live metrics are temporarily unavailable");
      }
    });
    source.onerror = () => setStreamState("reconnecting");
    const historyInterval = window.setInterval(loadMetrics, 60000);
    return () => {
      window.clearInterval(historyInterval);
      source.close();
    };
  }, [authToken, loadMetrics, selectedNode]);

  const values = useMemo(() => {
    if (!metrics) return null;
    const live = metrics.live;
    return {
      cpuPercent: live.cpu.percent,
      ramPercent: live.memory.percent,
      ramUsed: live.memory.usedMiB,
      ramTotal: live.memory.totalMiB,
      diskPercent: live.disk.percent,
      diskUsed: live.disk.usedGiB,
      diskAvailable: live.disk.availableGiB,
      load1: live.load.load1,
      temperature: live.temperatureCelsius,
      prodeskTemperature: live.prodeskTemperatureCelsius,
      prodeskTemperatureSampledAt: live.prodeskTemperatureSampledAt,
      received: live.network.receivedKbps,
      sent: live.network.sentKbps,
      diskRead: live.diskIo.readKiBps,
      diskWrite: live.diskIo.writeKiBps,
      uptime: live.uptimeSeconds,
      sampleAge: live.sampleAgeSeconds,
    };
  }, [metrics]);

  const processRows = useMemo(() => {
    const processes = [...(metrics?.live.processes || [])];
    processes.sort((left, right) =>
      processSort === "cpu"
        ? right.cpuPercent - left.cpuPercent
        : right.memoryMiB - left.memoryMiB
    );
    const ranked = processes.slice(0, PROCESS_ROW_COUNT);
    return Array.from(
      { length: PROCESS_ROW_COUNT },
      (_, index) => ranked[index] || null
    );
  }, [metrics, processSort]);

  if (loading && !metrics) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#050914] text-sm text-slate-400">
        Loading live system metrics...
      </div>
    );
  }

  if (!metrics || !values) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#050914] px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-300" />
        <p className="text-sm font-semibold text-white">System metrics are unavailable</p>
        <p className="text-xs text-slate-500">{error}</p>
        <button
          type="button"
          onClick={loadMetrics}
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const status =
    metrics.alarms.some((alarm) => alarm.status === "CRITICAL")
      ? "Critical"
      : metrics.alarms.length
        ? "Attention"
        : "Healthy";
  const statusClass =
    status === "Critical"
      ? "bg-rose-400/10 text-rose-300"
      : status === "Attention"
        ? "bg-amber-400/10 text-amber-300"
        : "bg-emerald-400/10 text-emerald-300";
  const StatusIcon = status === "Healthy" ? CheckCircle2 : AlertTriangle;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#050914] px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <section className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Monitoring node
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Switch between the Raspberry Pi 5 and the HP-hosted Ubuntu VM.
            </p>
          </div>
          <div className="flex flex-wrap rounded-xl border border-white/[0.08] bg-[#060b14] p-1">
            {availableNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  if (node.id === selectedNode) return;
                  setError("");
                  setLoading(true);
                  setSelectedNode(node.id);
                }}
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  selectedNode === node.id
                    ? "bg-violet-500/20 text-violet-200"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {node.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col justify-between gap-4 rounded-2xl border border-violet-400/15 bg-gradient-to-br from-violet-500/10 via-[#0a101c] to-sky-500/5 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
              <Server className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{metrics.host.hostname}</h2>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass}`}>
                  <StatusIcon className="h-3 w-3" />
                  {status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {metrics.host.osName} {metrics.host.osVersion} · {metrics.host.architecture} · Kernel{" "}
                {metrics.host.kernelVersion}
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="flex items-center gap-2 sm:justify-end">
              <span className={`h-2 w-2 rounded-full ${streamState === "live" ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "animate-pulse bg-amber-300"}`} />
              <p className="text-xs font-semibold text-slate-300">
                {streamState === "live" ? "Live stream" : streamState === "connecting" ? "Connecting" : "Reconnecting"}
              </p>
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-300">Uptime {formatUptime(values.uptime)}</p>
            <p className="mt-1 text-[10px] text-slate-500">
              SSE · one-second samples
              {updatedAt ? ` · Sampled ${updatedAt.toLocaleTimeString()}` : ""}
            </p>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
            Refresh failed; showing the last successful reading. {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Cpu} label="CPU Usage" value={`${values.cpuPercent.toFixed(1)}%`} detail={`${metrics.host.cores || "?"} cores · Load ${values.load1.toFixed(2)}`} tone="violet" />
          <MetricCard icon={MemoryStick} label="Memory" value={`${values.ramPercent.toFixed(1)}%`} detail={`${values.ramUsed.toFixed(1)} of ${values.ramTotal.toFixed(1)} MiB used`} tone="blue" />
          <MetricCard icon={HardDrive} label="Storage" value={`${values.diskPercent.toFixed(1)}%`} detail={`${values.diskUsed.toFixed(1)} GiB used · ${values.diskAvailable.toFixed(1)} GiB free`} tone="amber" />
          <MetricCard icon={Thermometer} label="CPU Temperature" value={`${values.temperature.toFixed(1)}°C`} detail={values.temperature >= 75 ? "Running hot" : "Thermals normal"} tone={values.temperature >= 75 ? "rose" : "green"} />
          <MetricCard
            icon={Thermometer}
            label="ProDesk CPU"
            value={values.prodeskTemperature == null ? "Unavailable" : `${values.prodeskTemperature.toFixed(1)}°C`}
            detail={
              values.prodeskTemperature == null
                ? "Host sensor unavailable"
                : values.prodeskTemperature >= 90
                  ? "Critical temperature"
                  : values.prodeskTemperature >= 80
                    ? "Running warm"
                    : "Thermals normal"
            }
            tone={
              values.prodeskTemperature == null || values.prodeskTemperature >= 90
                ? "rose"
                : values.prodeskTemperature >= 80
                  ? "amber"
                  : "green"
            }
          />
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 [overflow-anchor:none]">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
                <Layers3 className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-white">Process &amp; Application Usage</h3>
                <p className="text-[11px] text-slate-500">Host processes grouped by executable · updates every second</p>
              </div>
            </div>
            <div className="flex rounded-xl border border-white/[0.08] bg-[#060b14] p-1">
              {(["cpu", "memory"] as const).map((sort) => (
                <button
                  key={sort}
                  type="button"
                  onClick={() => setProcessSort(sort)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${processSort === sort ? "bg-violet-500/20 text-violet-200" : "text-slate-500 hover:text-slate-300"}`}
                >
                  Top {sort === "cpu" ? "CPU" : "RAM"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] table-fixed text-left">
              <colgroup>
                <col />
                <col className="w-24" />
                <col className="w-48" />
                <col className="w-56" />
              </colgroup>
              <thead className="bg-white/[0.02] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                <tr className="h-10">
                  <th className="px-4">Application / process</th>
                  <th className="px-4 text-right">Processes</th>
                  <th className="px-4">CPU</th>
                  <th className="px-4">RAM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {processRows.map((process, index) => process ? (
                  <tr key={index} className="h-12 text-xs transition hover:bg-white/[0.025]">
                    <td className="overflow-hidden px-4">
                      <span className="block truncate whitespace-nowrap font-semibold text-slate-200" title={process.name.replace(/_/g, " ")}>
                        {process.name.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 text-right tabular-nums text-slate-500">{process.processCount}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, process.cpuPercent)}%` }} />
                        </div>
                        <span className="w-14 text-right font-medium tabular-nums text-violet-200">{process.cpuPercent.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, process.memoryPercent)}%` }} />
                        </div>
                        <span className="w-24 text-right font-medium tabular-nums text-sky-200">{process.memoryMiB.toFixed(1)} MiB</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={index} className="h-12 text-xs">
                    <td className="px-4 text-slate-700" colSpan={4}>Waiting for process data…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-white/[0.05] px-4 py-3 text-[10px] text-slate-600">
            Process CPU is normalized per core (100% = one fully utilized core). RAM is resident memory reported by the kernel.
          </p>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <TrendChart title="CPU Utilization" subtitle="Last 2 minutes · one-second live trend" data={rows(metrics.charts.cpu)} series={[{ key: "user", label: "User", color: colors.violet }, { key: "system", label: "System", color: colors.blue }, { key: "iowait", label: "I/O wait", color: colors.amber }]} />
          <TrendChart title="System Load" subtitle="Last 2 minutes · process demand" data={rows(metrics.charts.load)} series={[{ key: "load1", label: "1 minute", color: colors.rose }, { key: "load5", label: "5 minutes", color: colors.amber }, { key: "load15", label: "15 minutes", color: colors.green }]} />
          <TrendChart title="Memory" subtitle="Last 2 minutes · MiB" data={rows(metrics.charts.memory)} series={[{ key: "used", label: "Used", color: colors.violet }, { key: "cached", label: "Cached", color: colors.blue }, { key: "free", label: "Free", color: colors.green }]} />
          <TrendChart title="Network Throughput" subtitle="Last 2 minutes · kilobits per second" data={rows(metrics.charts.network).map((point) => ({ ...point, sent: Math.abs(Number(point.sent || 0)) }))} series={[{ key: "received", label: "Received", color: colors.blue }, { key: "sent", label: "Sent", color: colors.green }]} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Active Health Alerts</h3>
                <p className="text-[11px] text-slate-500">Warnings reported by Netdata</p>
              </div>
              <Activity className="h-5 w-5 text-violet-300" />
            </div>
            <div className="mt-4 space-y-2">
              {metrics.alarms.length ? (
                metrics.alarms.map((alarm) => (
                  <div key={alarm.name} className="flex items-start gap-3 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{alarm.info || alarm.name}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300">
                        {alarm.status}{alarm.value != null ? ` · ${alarm.value.toFixed(1)} ${alarm.units || ""}` : ""}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4 text-xs text-emerald-200">
                  <CheckCircle2 className="h-5 w-5" />
                  No active warnings or critical alarms.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4">
            <h3 className="text-sm font-bold text-white">Server Details</h3>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Netdata</span><span className="text-right text-slate-300">{metrics.host.version || "Unknown"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">RAM</span><span className="text-right text-slate-300">{formatBytes(metrics.host.ramBytes)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Disk</span><span className="text-right text-slate-300">{formatBytes(metrics.host.diskBytes)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Disk I/O</span><span className="text-right text-slate-300">R {values.diskRead.toFixed(0)} · W {values.diskWrite.toFixed(0)} KiB/s</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Download</span><span className="inline-flex items-center gap-1 text-sky-300"><ArrowDown className="h-3 w-3" />{values.received.toFixed(1)} Kb/s</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Upload</span><span className="inline-flex items-center gap-1 text-emerald-300"><ArrowUp className="h-3 w-3" />{values.sent.toFixed(1)} Kb/s</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Oldest sample</span><span className={values.sampleAge > 8 ? "text-amber-300" : "text-emerald-300"}>{values.sampleAge}s ago</span></div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <span className="flex h-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300"><Database className="h-4 w-4" /></span>
              <span className="flex h-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><Wifi className="h-4 w-4" /></span>
              <span className="flex h-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300"><HardDrive className="h-4 w-4" /></span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SystemMetrics;
