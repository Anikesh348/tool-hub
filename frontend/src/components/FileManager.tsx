import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type FileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink";
  size: number | null;
  modifiedAt: string;
};

type StorageInfo = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
};

type PreviewInfo = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  content: string;
};

const API_ROOT = "/admin-proxy/filemanager/api";

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes == null) return "Folder";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const parseDownloadName = (disposition: string | null) => {
  const match = disposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (!match) return "file-manager-selection.tar.gz";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const FileManager = () => {
  const [rootPath, setRootPath] = useState("/srv");
  const [currentPath, setCurrentPath] = useState("/srv");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const request = useCallback(async (path: string, options?: RequestInit) => {
    const response = await fetch(`${API_ROOT}${path}`, options);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${response.status})`);
    }
    return response;
  }, []);

  const loadStorage = useCallback(async () => {
    const response = await request("/storage");
    setStorage(await response.json());
  }, [request]);

  const loadDirectory = useCallback(
    async (path: string, addToHistory = true) => {
      setLoading(true);
      setError("");
      try {
        const response = await request(`/list?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        setCurrentPath(data.path);
        setEntries(data.entries);
        setSelected(new Set());
        if (addToHistory) {
          setHistory((values) =>
            values[values.length - 1] === data.path ? values : [...values, data.path]
          );
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load folder");
      } finally {
        setLoading(false);
      }
    },
    [request]
  );

  useEffect(() => {
    const initialize = async () => {
      try {
        const configResponse = await request("/config");
        const config = await configResponse.json();
        setRootPath(config.rootPath);
        await Promise.all([loadDirectory(config.rootPath), loadStorage()]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to initialize File Manager");
        setLoading(false);
      }
    };
    initialize();
  }, [loadDirectory, loadStorage, request]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      `${entry.name} ${entry.type}`.toLowerCase().includes(needle)
    );
  }, [entries, query]);

  const breadcrumbs = useMemo(() => {
    const relative = currentPath.slice(rootPath.length).split("/").filter(Boolean);
    const values = [{ label: rootPath, path: rootPath }];
    let path = rootPath;
    for (const part of relative) {
      path = `${path}/${part}`;
      values.push({ label: part, path });
    }
    return values;
  }, [currentPath, rootPath]);

  const storagePercent = storage?.totalBytes
    ? Math.min(100, (storage.usedBytes / storage.totalBytes) * 100)
    : 0;

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.type === "directory") {
      await loadDirectory(entry.path);
      return;
    }
    setBusy(entry.path);
    setError("");
    try {
      const response = await request(`/file?path=${encodeURIComponent(entry.path)}`);
      setPreview(await response.json());
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to preview file");
    } finally {
      setBusy("");
    }
  };

  const toggleSelection = (path: string) => {
    setSelected((values) => {
      const next = new Set(values);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const goBack = async () => {
    if (history.length <= 1) return;
    const nextHistory = history.slice(0, -1);
    setHistory(nextHistory);
    await loadDirectory(nextHistory[nextHistory.length - 1], false);
  };

  const refresh = async () => {
    await Promise.all([loadDirectory(currentPath, false), loadStorage()]);
    showNotice("Folder refreshed");
  };

  const copySelection = () => {
    const paths = [...selected];
    setClipboard(paths);
    showNotice(`Copied ${paths.length} item${paths.length === 1 ? "" : "s"}`);
  };

  const pasteSelection = async () => {
    if (!clipboard.length) return;
    setBusy("paste");
    setError("");
    try {
      const response = await request("/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: clipboard, destination: currentPath }),
      });
      const data = await response.json();
      showNotice(`Pasted ${data.pasted?.length || 0} item${data.pasted?.length === 1 ? "" : "s"}`);
      await refresh();
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "Paste failed");
    } finally {
      setBusy("");
    }
  };

  const downloadSelection = async () => {
    if (!selected.size) return;
    setBusy("download");
    setError("");
    try {
      const response = await request("/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [...selected] }),
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = parseDownloadName(response.headers.get("content-disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showNotice(`Downloading ${selected.size} item${selected.size === 1 ? "" : "s"}`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Download failed");
    } finally {
      setBusy("");
    }
  };

  const deleteSelection = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected item(s)? This cannot be undone.`)) return;
    setBusy("delete");
    setError("");
    try {
      const response = await request("/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [...selected] }),
      });
      const data = await response.json();
      showNotice(`Deleted ${data.deleted?.length || 0} item${data.deleted?.length === 1 ? "" : "s"}`);
      await Promise.all([loadDirectory(currentPath, false), loadStorage()]);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setBusy("");
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file, file.name));
    setBusy("upload");
    setError("");
    try {
      const response = await request(`/upload?path=${encodeURIComponent(currentPath)}`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      showNotice(`Uploaded ${data.uploaded?.length || files.length} file${files.length === 1 ? "" : "s"}`);
      await Promise.all([loadDirectory(currentPath, false), loadStorage()]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setBusy("");
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#050914] px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="grid gap-4 xl:grid-cols-[1fr_330px]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={history.length <= 1}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:border-violet-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-xl border border-white/[0.08] bg-[#070b13] px-3 py-2.5">
                  {breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.path}>
                      {index > 0 && <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 text-slate-600" />}
                      <button
                        type="button"
                        onClick={() => loadDirectory(crumb.path)}
                        className={`whitespace-nowrap text-xs font-semibold transition ${
                          index === breadcrumbs.length - 1 ? "text-violet-300" : "text-slate-500 hover:text-slate-200"
                        }`}
                      >
                        {crumb.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div className="relative min-w-0 lg:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this folder"
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#070b13] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-violet-400/40"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Storage</p>
                <p className="mt-1 text-sm font-bold text-white">
                  {storage ? `${formatBytes(storage.freeBytes)} free` : "Loading storage..."}
                </p>
              </div>
              <HardDrive className="h-5 w-5 text-amber-300" />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${storagePercent >= 90 ? "bg-rose-400" : "bg-gradient-to-r from-violet-500 to-sky-400"}`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              {storage ? `${storagePercent.toFixed(1)}% used · ${formatBytes(storage.totalBytes)} total` : ""}
            </p>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0a101c]/90 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => uploadInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-500">
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
            <input ref={uploadInput} type="file" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
            <button type="button" onClick={refresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button type="button" onClick={pasteSelection} disabled={!clipboard.length || !!busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300 transition hover:border-violet-400/40 hover:text-white disabled:opacity-30">
              <Clipboard className="h-3.5 w-3.5" />
              Paste {clipboard.length ? `(${clipboard.length})` : ""}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] text-slate-500">
              {selected.size ? `${selected.size} selected` : `${visibleEntries.length} items`}
            </span>
            <button type="button" onClick={copySelection} disabled={!selected.size || !!busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300 disabled:opacity-30">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button type="button" onClick={downloadSelection} disabled={!selected.size || !!busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300 disabled:opacity-30">
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            <button type="button" onClick={deleteSelection} disabled={!selected.size || !!busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-400/20 px-3 text-xs font-semibold text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-30">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </section>

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
            <button type="button" onClick={() => setError("")}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a101c]/90">
          <div className="grid grid-cols-[40px_minmax(240px,1fr)_120px_190px] border-b border-white/[0.07] bg-white/[0.02] px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <span />
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading folder...
              </div>
            ) : visibleEntries.length ? (
              visibleEntries.map((entry) => {
                const isSelected = selected.has(entry.path);
                const EntryIcon = entry.type === "directory" ? Folder : entry.type === "file" ? FileCode2 : File;
                return (
                  <div
                    key={entry.path}
                    className={`grid grid-cols-[40px_minmax(240px,1fr)_120px_190px] items-center px-3 py-2.5 transition ${
                      isSelected ? "bg-violet-500/10" : "hover:bg-white/[0.025]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelection(entry.path)}
                      className={`flex h-5 w-5 items-center justify-center rounded border transition ${
                        isSelected ? "border-violet-400 bg-violet-500 text-white" : "border-slate-700 text-transparent hover:border-slate-500"
                      }`}
                      aria-label={`Select ${entry.name}`}
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 items-center gap-3 text-left">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        entry.type === "directory" ? "bg-sky-400/10 text-sky-300" : "bg-violet-400/10 text-violet-300"
                      }`}>
                        {busy === entry.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <EntryIcon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-200">{entry.name}</span>
                        <span className="mt-0.5 block text-[10px] capitalize text-slate-600">{entry.type}</span>
                      </span>
                    </button>
                    <span className="text-xs text-slate-500">{formatBytes(entry.size)}</span>
                    <span className="text-xs text-slate-500">{formatDate(entry.modifiedAt)}</span>
                  </div>
                );
              })
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-slate-500">
                <FolderOpen className="h-8 w-8 text-slate-700" />
                <p className="text-xs">{query ? "No matching items" : "This folder is empty"}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {notice && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl border border-emerald-400/20 bg-[#0b1717] px-4 py-3 text-xs font-semibold text-emerald-200 shadow-2xl">
          {notice}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#080d17] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
              <FileCode2 className="h-5 w-5 text-violet-300" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-white">{preview.name}</h3>
                <p className="truncate text-[10px] text-slate-500">{preview.path} · {formatBytes(preview.size)}</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white" aria-label="Close preview">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-5 font-mono text-xs leading-6 text-slate-300">{preview.content}</pre>
          </div>
        </div>
      )}

      {busy && !entries.some((entry) => entry.path === busy) && (
        <div className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit items-center gap-2 rounded-xl border border-violet-400/20 bg-[#0b1020] px-4 py-3 text-xs text-violet-200 shadow-2xl">
          <Loader2 className="h-4 w-4 animate-spin" />
          Working...
        </div>
      )}
    </div>
  );
};

export default FileManager;
