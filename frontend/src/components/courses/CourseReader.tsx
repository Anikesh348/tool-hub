import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, Loader2, Maximize2, MessageSquareText, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router-dom";
import { CourseService, type Course, type CourseModule, type CourseModuleSummary, type CourseQuestion } from "../../apis/admin/courses";

interface SelectionContext { selectedText: string; contextBefore: string; contextAfter: string }

// Groups modules under their "section" label, preserving each section's first-appearance
// order and each module's original position order within its section.
function groupBySection(modules: CourseModuleSummary[]): Array<{ section: string; modules: CourseModuleSummary[] }> {
  const groups: Array<{ section: string; modules: CourseModuleSummary[] }> = [];
  const indexBySection = new Map<string, number>();
  for (const module of modules) {
    const key = module.section || "";
    let index = indexBySection.get(key);
    if (index === undefined) {
      index = groups.length;
      indexBySection.set(key, index);
      groups.push({ section: key, modules: [] });
    }
    groups[index].modules.push(module);
  }
  return groups;
}

export default function CourseReader() {
  const { courseId = "", moduleSlug = "" } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [module, setModule] = useState<CourseModule | null>(null);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [question, setQuestion] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [readProgress, setReadProgress] = useState(0);
  const articleRef = useRef<HTMLElement>(null);
  const readingStartRef = useRef<HTMLDivElement | null>(null);
  const readingEndRef = useRef<HTMLDivElement | null>(null);
  const lastSavedProgress = useRef(0);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const [{ course: loadedCourse }, { module: loadedModule }] = await Promise.all([
      CourseService.get(courseId), CourseService.getModule(courseId, moduleSlug),
    ]);
    // A slower response for a module the user has since navigated away from can resolve
    // after a newer request's response; only the most recently issued request may commit.
    if (requestIdRef.current !== requestId) return;
    setCourse(loadedCourse);
    setModule(loadedModule);
    lastSavedProgress.current = loadedModule.readingProgress;
  }, [courseId, moduleSlug]);

  useEffect(() => {
    window.scrollTo(0, 0);
    setSelection(null);
    setQuestion("");
    setError("");
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load this module"));
  }, [load]);

  // Whichever section contains the module currently being read is always expanded,
  // without collapsing any section the user already opened themselves.
  useEffect(() => {
    if (!course) return;
    const active = course.modules.find((item) => item.slug === moduleSlug);
    if (!active?.section) return;
    setExpandedSections((current) => (current.has(active.section) ? current : new Set(current).add(active.section)));
  }, [course, moduleSlug]);

  const toggleSection = (section: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // Same top-of-page reading-progress mechanic as the blog reader (start/end markers,
  // rAF-throttled scroll tracking) so both surfaces behave identically to the user.
  useEffect(() => {
    if (!module) return;
    let animationFrame = 0;

    const updateReadProgress = () => {
      animationFrame = 0;
      const start = readingStartRef.current;
      const end = readingEndRef.current;
      if (!start || !end) return;
      const startY = start.getBoundingClientRect().top + window.scrollY;
      const endY = end.getBoundingClientRect().top + window.scrollY;
      const finalScrollPosition = Math.max(startY + 1, endY - window.innerHeight);
      const nextProgress = Math.min(1, Math.max(0, (window.scrollY - startY) / (finalScrollPosition - startY)));
      setReadProgress((current) => (Math.abs(current - nextProgress) < 0.002 ? current : nextProgress));
    };

    const requestProgressUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateReadProgress);
    };

    // Resume where this user left off in this module: jump to the saved scroll
    // position (from the same per-user, per-module readingProgress already
    // persisted server-side via saveProgress) before the listener attaches, so
    // the updateReadProgress() call below reflects where we actually land.
    const resumeStart = readingStartRef.current;
    const resumeEnd = readingEndRef.current;
    if (resumeStart && resumeEnd && module.readingProgress > 0.02) {
      const resumeStartY = resumeStart.getBoundingClientRect().top + window.scrollY;
      const resumeEndY = resumeEnd.getBoundingClientRect().top + window.scrollY;
      const resumeFinalPosition = Math.max(resumeStartY + 1, resumeEndY - window.innerHeight);
      window.scrollTo(0, resumeStartY + (resumeFinalPosition - resumeStartY) * module.readingProgress);
    }

    setReadProgress(module.readingProgress);
    updateReadProgress();
    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressUpdate);
    return () => {
      window.removeEventListener("scroll", requestProgressUpdate);
      window.removeEventListener("resize", requestProgressUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [module?.slug]);

  useEffect(() => {
    if (!module) return;
    const timer = window.setTimeout(() => {
      if (readProgress - lastSavedProgress.current >= 0.08) {
        lastSavedProgress.current = readProgress;
        void CourseService.saveProgress(courseId, moduleSlug, readProgress, module.completed);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [readProgress, courseId, moduleSlug, module]);

  const captureSelection = () => {
    const selected = window.getSelection();
    const article = articleRef.current;
    if (!selected || selected.isCollapsed || !article || !selected.rangeCount) return;
    const range = selected.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return;
    const selectedText = selected.toString().trim().slice(0, 4000);
    if (!selectedText) return;
    const fullText = article.innerText;
    const start = fullText.indexOf(selectedText);
    setSelection({
      selectedText,
      contextBefore: start >= 0 ? fullText.slice(Math.max(0, start - 1400), start) : "",
      contextAfter: start >= 0 ? fullText.slice(start + selectedText.length, start + selectedText.length + 1400) : "",
    });
    setPanelOpen(true);
  };

  const replaceQuestion = (next: CourseQuestion) => {
    setModule((current) => current ? {
      ...current,
      questions: [next, ...current.questions.filter((item) => item.id !== next.id)],
    } : current);
  };

  const pollQuestion = async (questionId: string) => {
    for (let attempt = 0; attempt < 165; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const { question: updated } = await CourseService.getQuestion(questionId);
      replaceQuestion(updated);
      if (updated.status !== "pending") return;
    }
    throw new Error("The explanation is still processing. It is saved and will appear when you reopen this module.");
  };

  const ask = async () => {
    // A highlighted passage is enough context to explain on its own -- typing an
    // explicit question is only required when there's no selection to fall back on.
    if ((!question.trim() && !selection) || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { question: created } = await CourseService.ask(courseId, moduleSlug, {
        selectedText: selection?.selectedText || "",
        contextBefore: selection?.contextBefore || "",
        contextAfter: selection?.contextAfter || "",
        question: question.trim() || "Explain this",
      });
      replaceQuestion(created);
      setQuestion("");
      window.getSelection()?.removeAllRanges();
      await pollQuestion(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not ask this question");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadJavaCode = () => {
    if (!module?.javaCode) return;
    const blob = new Blob([module.javaCode], { type: "text/x-java-source" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = module.javaFileName || `${module.slug}.java`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const markComplete = async () => {
    if (!module) return;
    const completed = !module.completed;
    const saved = await CourseService.saveProgress(courseId, moduleSlug, completed ? 1 : module.readingProgress, completed);
    setModule({ ...module, ...saved });
  };

  if (error && !module) return <div className="mx-auto max-w-4xl px-6 pb-16 pt-28 text-red-500 dark:text-red-400">{error}</div>;
  if (!course || !module) return <div className="mx-auto max-w-4xl px-6 pb-16 pt-28 text-slate-500 dark:text-slate-400">Loading module…</div>;

  const index = course.modules.findIndex((item) => item.slug === moduleSlug);
  const previous = index > 0 ? course.modules[index - 1] : null;
  const next = index >= 0 && index < course.modules.length - 1 ? course.modules[index + 1] : null;
  const readPercent = Math.min(100, Math.round(readProgress * 100));
  const readPercentLeft = Math.max(0, 100 - readPercent);
  const readingMinutesLeft = Math.max(0, Math.ceil(module.readingMinutes * (1 - readProgress)));

  return (
    <div className="min-h-screen bg-slate-50 pt-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div
        className="blog-reading-progress"
        role="progressbar"
        aria-label="Module reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readPercent}
        aria-valuetext={`${readPercentLeft}% left, approximately ${readingMinutesLeft} minutes left`}
      >
        <div className="blog-reading-progress-track">
          <span className="blog-reading-progress-fill" style={{ width: `${readPercent}%` }} />
        </div>
        <div className="blog-reading-progress-meta">
          <span>{readPercentLeft}% left</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {readingMinutesLeft > 0 ? `~${readingMinutesLeft} min left` : "Finished"}
          </span>
        </div>
      </div>
      <div className={`mx-auto flex max-w-[1540px] transition-[padding] duration-300 ${panelOpen ? (panelExpanded ? "xl:pr-[min(880px,60vw)]" : "xl:pr-[410px]") : ""}`}>
        <div className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 lg:block">
        <div className="relative h-full">
        <aside className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ${navCollapsed ? "w-0" : "w-64"}`}>
          <div className="h-full w-64 overflow-y-auto border-r border-slate-200 px-4 py-6 dark:border-white/10">
            <Link to="/admin/courses" className="mb-6 flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-300"><ArrowLeft className="h-4 w-4" /> All courses</Link>
            <nav className="space-y-2">
              {groupBySection(course.modules).map((group) => {
                const isExpanded = !group.section || expandedSections.has(group.section);
                return (
                <div key={group.section || "ungrouped"}>
                  {group.section && (
                    <button
                      type="button"
                      onClick={() => toggleSection(group.section)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-300"
                    >
                      <span className="flex items-center gap-2">{group.section}<span className="text-[10px] font-normal normal-case text-slate-400 dark:text-slate-600">{group.modules.length}</span></span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                    </button>
                  )}
                  <div className={`space-y-1 overflow-hidden transition-[grid-template-rows] ${isExpanded ? "mt-1.5" : ""}`} style={{ display: "grid", gridTemplateRows: isExpanded ? "1fr" : "0fr" }}>
                    <div className="overflow-hidden">
                    {group.modules.map((item) => <Link key={item.id} to={`/admin/courses/${course.id}/modules/${item.slug}`} className={`flex gap-3 rounded-xl px-3 py-3 text-sm transition ${item.slug === moduleSlug ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"}`}><span className="mt-0.5">{item.completed ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : item.position}</span><span>{item.title}</span></Link>)}
                    </div>
                  </div>
                </div>
                );
              })}
            </nav>
          </div>
        </aside>
        <button
          onClick={() => setNavCollapsed((current) => !current)}
          title={navCollapsed ? "Show module list" : "Hide module list"}
          aria-label={navCollapsed ? "Show module list" : "Hide module list"}
          className="absolute -right-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md hover:border-violet-400 hover:text-violet-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-violet-300"
        >
          {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        </div>
        </div>

        <main className="min-w-0 flex-1 px-5 pb-24 pt-10 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Link to="/admin/courses" className="flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-300 lg:hidden"><ArrowLeft className="h-4 w-4" /> Course</Link>
                <button onClick={() => setNavCollapsed((current) => !current)} title={navCollapsed ? "Show module list" : "Hide module list"} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white lg:block">{navCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}</button>
              </div>
              <button onClick={() => setPanelOpen(true)} className="ml-auto flex items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"><Sparkles className="h-4 w-4" /> AI questions {module.questions.length ? `(${module.questions.length})` : ""}</button>
            </div>
            <div ref={readingStartRef}>
              <div className="text-sm font-semibold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-300">Module {module.position} · {module.duration}</div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl">{module.title}</h1>
              <p className="mt-4 text-slate-500 dark:text-slate-400">Highlight any passage to open the AI panel and ask a question about it.</p>
              {module.javaCode && <button onClick={downloadJavaCode} className="mt-5 flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"><Download className="h-4 w-4" /> Download Java code ({module.javaFileName})</button>}
            </div>
            {selection && <button onClick={() => setPanelOpen(true)} className="mt-5 flex items-center gap-2 rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 dark:shadow-violet-950/40"><Sparkles className="h-4 w-4" /> Ask AI about selection</button>}
            <article ref={articleRef} onMouseUp={captureSelection} onTouchEnd={captureSelection} className="blog-prose course-prose mt-10 select-text" data-course-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{module.content}</ReactMarkdown>
            </article>
            <div ref={readingEndRef} aria-hidden="true" />

            <div className="mt-14 border-t border-slate-200 pt-8 dark:border-white/10">
              <button onClick={() => void markComplete()} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold ${module.completed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-violet-500 text-white"}`}><Check className="h-5 w-5" /> {module.completed ? "Completed" : "Mark module complete"}</button>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {previous ? <Link to={`/admin/courses/${course.id}/modules/${previous.slug}`} className="rounded-xl border border-slate-200 p-4 text-slate-600 hover:border-violet-400 dark:border-white/10 dark:text-slate-300 dark:hover:border-violet-400/40"><span className="flex items-center gap-1 text-xs text-slate-500"><ChevronLeft className="h-3 w-3" /> Previous</span><span className="mt-1 block">{previous.title}</span></Link> : <div />}
                {next && <Link to={`/admin/courses/${course.id}/modules/${next.slug}`} className="rounded-xl border border-slate-200 p-4 text-right text-slate-600 hover:border-violet-400 dark:border-white/10 dark:text-slate-300 dark:hover:border-violet-400/40"><span className="flex items-center justify-end gap-1 text-xs text-slate-500">Next <ChevronRight className="h-3 w-3" /></span><span className="mt-1 block">{next.title}</span></Link>}
              </div>
            </div>
          </div>
        </main>
      </div>

      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-30 flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-xl shadow-violet-500/30 transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 dark:shadow-2xl dark:shadow-violet-950/60 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-6"
          aria-controls="course-ai-panel"
          aria-expanded="false"
        >
          <Sparkles className="h-5 w-5" />
          Ask AI
          {!!module.questions.length && <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{module.questions.length}</span>}
        </button>
      )}

      {panelOpen && <div className="fixed inset-0 z-40 bg-black/50 xl:hidden" onClick={() => setPanelOpen(false)} />}
      <aside id="course-ai-panel" className={`fixed right-0 top-16 z-50 h-[calc(100vh-4rem)] w-full ${panelExpanded ? "max-w-[min(880px,60vw)]" : "max-w-[410px]"} border-l border-slate-200 bg-white shadow-2xl transition-[transform,max-width] duration-300 dark:border-white/10 dark:bg-slate-900 ${panelOpen ? "translate-x-0" : "translate-x-full"}`} aria-label="AI course explanations">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10"><div className="rounded-lg bg-violet-100 p-2 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><Sparkles className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-900 dark:text-slate-100">Ask about this lesson</h2><p className="truncate text-xs text-slate-500">Answers and history are saved</p></div><button onClick={() => setPanelExpanded((current) => !current)} title={panelExpanded ? "Collapse panel" : "Expand panel"} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white lg:block">{panelExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}</button><button onClick={() => setPanelOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"><PanelRightClose className="h-5 w-5" /></button></header>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-400/20 dark:bg-violet-500/[0.08]">
              {selection ? <><div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">Selected passage<button onClick={() => setSelection(null)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button></div><blockquote className="max-h-36 overflow-y-auto border-l-2 border-violet-400 pl-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{selection.selectedText}</blockquote></> : <div className="flex gap-3 text-sm leading-6 text-slate-500 dark:text-slate-400"><BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" /><span>Ask anything about this module. The full lesson will be included as AI context.</span></div>}
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }} maxLength={2000} rows={3} placeholder={selection ? "What would you like clarified?" : "Ask a question about this module…"} className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-violet-400/60" />
              <button onClick={() => void ask()} disabled={(!question.trim() && !selection) || submitting} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {submitting ? "Explaining…" : selection ? "Explain this" : "Ask about this module"}</button>
            </div>
            {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
            <div className="mt-7 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><MessageSquareText className="h-4 w-4" /> Saved questions</div>
            <div className="mt-3 space-y-4">
              {!module.questions.length && <p className="text-sm text-slate-500">No questions yet for this module.</p>}
              {module.questions.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950/60"><div className="line-clamp-3 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-slate-500 dark:border-slate-700">{item.selectedText}</div><div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{item.question}</div>{item.status === "pending" && <div className="mt-3 flex items-center gap-2 text-sm text-violet-600 dark:text-violet-300"><Loader2 className="h-4 w-4 animate-spin" /> Codex is preparing an explanation…</div>}{item.status === "failed" && <div className="mt-3 text-sm text-red-600 dark:text-red-300">{item.error || "Explanation failed"}</div>}{item.status === "completed" && <div className="ai-markdown mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer}</ReactMarkdown></div>}<div className="mt-3 text-[11px] text-slate-400 dark:text-slate-600">{new Date(item.createdAt).toLocaleString()}</div></div>)}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
