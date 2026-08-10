import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import {
  GenerateSetRequest,
  LeetcodeSetWizardService,
  ProposedQuestion,
  SetGenerationJob,
} from "../apis/leetcodeAi/leetcodeSetWizard";

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 120_000;
const DIFFICULTIES: GenerateSetRequest["difficulty"][] = ["Easy", "Medium", "Hard", "Mixed"];
const STEPS = ["Configure", "Preview", "Generate"];

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const difficultyBadgeClass = (difficulty: string) => {
  switch ((difficulty || "").toLowerCase()) {
    case "easy":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "hard":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (label: string) => void;
  topicOptions: string[];
}

const CreateSetWizard: React.FC<Props> = ({ isOpen, onClose, onCreated, topicOptions }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<GenerateSetRequest["difficulty"]>("Medium");
  const [count, setCount] = useState(10);
  const [interviewOnly, setInterviewOnly] = useState(true);
  const [excludePremium, setExcludePremium] = useState(false);
  const [includeCompanyTags, setIncludeCompanyTags] = useState(true);
  const [customPrompt, setCustomPrompt] = useState("");

  const [job, setJob] = useState<SetGenerationJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [excludedUrls, setExcludedUrls] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ label: string; count: number } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (isOpen) return;
    cancelledRef.current = true;
    window.setTimeout(() => {
      setStep(1);
      setTopic("");
      setDifficulty("Medium");
      setCount(10);
      setInterviewOnly(true);
      setExcludePremium(false);
      setIncludeCompanyTags(true);
      setCustomPrompt("");
      setJob(null);
      setGenerating(false);
      setGenError("");
      setExcludedUrls(new Set());
      setConfirming(false);
      setResult(null);
    }, 200);
  }, [isOpen]);

  if (!isOpen) return null;

  const startPreview = async () => {
    if (!topic.trim()) return;
    cancelledRef.current = false;
    setGenError("");
    setGenerating(true);
    setStep(2);
    try {
      const started = await LeetcodeSetWizardService.beginGeneration({
        topic: topic.trim(),
        difficulty,
        count,
        interviewOnly,
        excludePremium,
        includeCompanyTags,
        customPrompt: customPrompt.trim(),
      });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let current = started;
      while (!cancelledRef.current && current.status === "running" && Date.now() < deadline) {
        await wait(POLL_INTERVAL_MS);
        current = await LeetcodeSetWizardService.getGeneration(started.id);
      }
      if (cancelledRef.current) return;
      setJob(current);
      if (current.status === "failed") {
        setGenError(current.error || "Generation failed. Try a different topic.");
      } else if (current.status === "running") {
        setGenError("This is taking longer than expected. Try again in a moment.");
      }
    } catch (err: any) {
      if (!cancelledRef.current) setGenError(err?.message || "Generation failed. Try again.");
    } finally {
      if (!cancelledRef.current) setGenerating(false);
    }
  };

  const toggleExcluded = (url: string) => {
    setExcludedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const includedCount = (job?.proposed.length || 0) - excludedUrls.size;

  const confirm = async () => {
    if (!job) return;
    setConfirming(true);
    setGenError("");
    try {
      const outcome = await LeetcodeSetWizardService.confirmGeneration(
        job.id,
        job.label || topic.trim(),
        Array.from(excludedUrls)
      );
      setResult(outcome);
      setStep(3);
      onCreated(outcome.label);
    } catch (err: any) {
      setGenError(err?.message || "Could not save this set. Try again.");
    } finally {
      setConfirming(false);
    }
  };

  const close = () => {
    cancelledRef.current = true;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 sm:py-16">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0f1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 className="text-base font-bold text-white sm:text-lg">Create New Question Set</h2>
          <button onClick={close} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 sm:px-6">
          {STEPS.map((label, idx) => {
            const num = idx + 1;
            const active = step === num;
            const done = step > num;
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                        : "bg-white/10 text-slate-400"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : num}
                  </span>
                  <span className={`text-xs sm:text-sm font-semibold ${active ? "text-white" : "text-slate-500"}`}>
                    {label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && <span className="h-px flex-1 bg-white/10" />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-400">1. Select Topic / Type</label>
                <input
                  list="wizard-topics"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Graph, Dynamic Programming, Sliding Window..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500/60"
                />
                <datalist id="wizard-topics">
                  {topicOptions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-400">2. Select Difficulty</label>
                <div className="grid grid-cols-4 gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      className={`rounded-xl border px-2 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                        difficulty === d
                          ? "border-amber-400/60 bg-amber-500/15 text-amber-300"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-400">3. Number of Questions</label>
                  <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs font-bold text-white">{count}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                  <span>5</span>
                  <span>20</span>
                  <span>50</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-400">4. Additional Filters (Optional)</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={interviewOnly} onChange={(e) => setInterviewOnly(e.target.checked)} className="h-4 w-4 rounded accent-blue-500" />
                    Interview questions only
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={excludePremium} onChange={(e) => setExcludePremium(e.target.checked)} className="h-4 w-4 rounded accent-blue-500" />
                    Exclude premium
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={includeCompanyTags} onChange={(e) => setIncludeCompanyTags(e.target.checked)} className="h-4 w-4 rounded accent-blue-500" />
                    Include company tags
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-400">5. Custom Prompt (Optional)</label>
                  <span className="text-[10px] text-slate-600">{customPrompt.length}/200</span>
                </div>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value.slice(0, 200))}
                  rows={2}
                  placeholder="Eg. Focus on BFS, shortest path, topological sort..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500/60"
                />
              </div>

              <button
                onClick={startPreview}
                disabled={!topic.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 text-sm font-bold text-white transition hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Preview Questions <Sparkles className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {generating ? (
                <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
                  <p className="text-sm text-slate-400">Asking the assistant for {count} {difficulty.toLowerCase()} "{topic}" questions...</p>
                </div>
              ) : genError ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{genError}</div>
                  <button onClick={() => setStep(1)} className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10">
                    Back to Configure
                  </button>
                </div>
              ) : job ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{job.label}</h3>
                    <span className="text-xs text-slate-500">{includedCount} of {job.proposed.length} selected</span>
                  </div>
                  {job.skippedExisting.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Skipped {job.skippedExisting.length} already in your tracker.
                    </p>
                  )}
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {job.proposed.map((q: ProposedQuestion) => {
                      const excluded = excludedUrls.has(q.url);
                      return (
                        <label
                          key={q.url}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                            excluded ? "border-white/5 bg-white/[0.02] opacity-50" : "border-white/10 bg-white/5"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() => toggleExcluded(q.url)}
                            className="mt-1 h-4 w-4 shrink-0 rounded accent-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white">{q.title}</span>
                              {q.difficulty && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${difficultyBadgeClass(q.difficulty)}`}>
                                  {q.difficulty}
                                </span>
                              )}
                            </div>
                            {q.reason && <p className="mt-0.5 text-xs text-slate-500">{q.reason}</p>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setStep(1)} className="flex-1 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10">
                      Back
                    </button>
                    <button
                      onClick={confirm}
                      disabled={includedCount === 0 || confirming}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2.5 text-sm font-bold text-white transition hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Generate Set
                    </button>
                  </div>
                  {genError && <p className="text-xs text-rose-300">{genError}</p>}
                </>
              ) : null}
            </div>
          )}

          {step === 3 && result && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <Check className="h-7 w-7" />
              </span>
              <h3 className="text-lg font-bold text-white">Set created</h3>
              <p className="max-w-xs text-sm text-slate-400">
                Added {result.count} question{result.count === 1 ? "" : "s"} to <strong className="text-slate-200">{result.label}</strong>.
              </p>
              <button onClick={close} className="mt-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2.5 text-sm font-bold text-white hover:from-blue-700 hover:to-purple-700">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateSetWizard;
