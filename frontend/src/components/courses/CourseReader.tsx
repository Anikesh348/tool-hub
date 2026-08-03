import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Loader2, MessageSquareText, PanelRightClose, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useParams } from "react-router-dom";
import { CourseService, type Course, type CourseModule, type CourseQuestion } from "../../apis/admin/courses";

interface SelectionContext { selectedText: string; contextBefore: string; contextAfter: string }

export default function CourseReader() {
  const { courseId = "", moduleSlug = "" } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [module, setModule] = useState<CourseModule | null>(null);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [question, setQuestion] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const articleRef = useRef<HTMLElement>(null);
  const lastSavedProgress = useRef(0);

  const load = useCallback(async () => {
    const [{ course: loadedCourse }, { module: loadedModule }] = await Promise.all([
      CourseService.get(courseId), CourseService.getModule(courseId, moduleSlug),
    ]);
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

  useEffect(() => {
    if (!module) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const article = articleRef.current;
        if (!article) return;
        const top = article.getBoundingClientRect().top + window.scrollY;
        const available = Math.max(1, article.offsetHeight - window.innerHeight * 0.45);
        const progress = Math.max(0, Math.min(1, (window.scrollY - top + 180) / available));
        if (progress - lastSavedProgress.current >= 0.08) {
          lastSavedProgress.current = progress;
          void CourseService.saveProgress(courseId, moduleSlug, progress, module.completed);
        }
      }, 500);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  }, [courseId, module, moduleSlug]);

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
    if (!question.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { question: created } = await CourseService.ask(courseId, moduleSlug, {
        selectedText: selection?.selectedText || "",
        contextBefore: selection?.contextBefore || "",
        contextAfter: selection?.contextAfter || "",
        question: question.trim(),
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

  const markComplete = async () => {
    if (!module) return;
    const completed = !module.completed;
    const saved = await CourseService.saveProgress(courseId, moduleSlug, completed ? 1 : module.readingProgress, completed);
    setModule({ ...module, ...saved });
  };

  if (error && !module) return <div className="mx-auto max-w-4xl px-6 pb-16 pt-28 text-red-400">{error}</div>;
  if (!course || !module) return <div className="mx-auto max-w-4xl px-6 pb-16 pt-28 text-slate-400">Loading module…</div>;

  const index = course.modules.findIndex((item) => item.slug === moduleSlug);
  const previous = index > 0 ? course.modules[index - 1] : null;
  const next = index >= 0 && index < course.modules.length - 1 ? course.modules[index + 1] : null;

  return (
    <div className="min-h-screen bg-slate-950 pt-16 text-slate-100">
      <div className={`mx-auto flex max-w-[1540px] transition-[padding] duration-300 ${panelOpen ? "xl:pr-[410px]" : ""}`}>
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-white/10 px-4 py-6 lg:block">
          <Link to="/admin/courses" className="mb-6 flex items-center gap-2 text-sm text-slate-400 hover:text-violet-300"><ArrowLeft className="h-4 w-4" /> All courses</Link>
          <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Course modules</div>
          <nav className="space-y-1">
            {course.modules.map((item) => <Link key={item.id} to={`/admin/courses/${course.id}/modules/${item.slug}`} className={`flex gap-3 rounded-xl px-3 py-3 text-sm transition ${item.slug === moduleSlug ? "bg-violet-500/15 text-violet-200" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}><span className="mt-0.5">{item.completed ? <Check className="h-4 w-4 text-emerald-400" /> : item.position}</span><span>{item.title}</span></Link>)}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-5 pb-24 pt-10 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-3xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <Link to="/admin/courses" className="flex items-center gap-2 text-sm text-slate-400 hover:text-violet-300 lg:hidden"><ArrowLeft className="h-4 w-4" /> Course</Link>
              <button onClick={() => setPanelOpen(true)} className="ml-auto flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20"><Sparkles className="h-4 w-4" /> AI questions {module.questions.length ? `(${module.questions.length})` : ""}</button>
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.15em] text-violet-300">Module {module.position} · {module.duration}</div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{module.title}</h1>
            <p className="mt-4 text-slate-400">Highlight any passage to open the AI panel and ask a question about it.</p>
            {selection && <button onClick={() => setPanelOpen(true)} className="mt-5 flex items-center gap-2 rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-950/40"><Sparkles className="h-4 w-4" /> Ask AI about selection</button>}
            <article ref={articleRef} onMouseUp={captureSelection} onTouchEnd={captureSelection} className="blog-prose course-prose mt-10 select-text" data-course-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{module.content}</ReactMarkdown>
            </article>

            <div className="mt-14 border-t border-white/10 pt-8">
              <button onClick={() => void markComplete()} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold ${module.completed ? "bg-emerald-500/15 text-emerald-300" : "bg-violet-500 text-white"}`}><Check className="h-5 w-5" /> {module.completed ? "Completed" : "Mark module complete"}</button>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {previous ? <Link to={`/admin/courses/${course.id}/modules/${previous.slug}`} className="rounded-xl border border-white/10 p-4 text-slate-300 hover:border-violet-400/40"><span className="flex items-center gap-1 text-xs text-slate-500"><ChevronLeft className="h-3 w-3" /> Previous</span><span className="mt-1 block">{previous.title}</span></Link> : <div />}
                {next && <Link to={`/admin/courses/${course.id}/modules/${next.slug}`} className="rounded-xl border border-white/10 p-4 text-right text-slate-300 hover:border-violet-400/40"><span className="flex items-center justify-end gap-1 text-xs text-slate-500">Next <ChevronRight className="h-3 w-3" /></span><span className="mt-1 block">{next.title}</span></Link>}
              </div>
            </div>
          </div>
        </main>
      </div>

      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-30 flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-violet-950/60 transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-6"
          aria-controls="course-ai-panel"
          aria-expanded="false"
        >
          <Sparkles className="h-5 w-5" />
          Ask AI
          {!!module.questions.length && <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{module.questions.length}</span>}
        </button>
      )}

      {panelOpen && <div className="fixed inset-0 z-40 bg-black/50 xl:hidden" onClick={() => setPanelOpen(false)} />}
      <aside id="course-ai-panel" className={`fixed right-0 top-16 z-50 h-[calc(100vh-4rem)] w-full max-w-[410px] border-l border-white/10 bg-slate-900 shadow-2xl transition-transform duration-300 ${panelOpen ? "translate-x-0" : "translate-x-full"}`} aria-label="AI course explanations">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4"><div className="rounded-lg bg-violet-500/15 p-2 text-violet-300"><Sparkles className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h2 className="font-semibold">Ask about this lesson</h2><p className="truncate text-xs text-slate-500">Answers and history are saved</p></div><button onClick={() => setPanelOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"><PanelRightClose className="h-5 w-5" /></button></header>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-violet-400/20 bg-violet-500/8 p-4">
              {selection ? <><div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-violet-300">Selected passage<button onClick={() => setSelection(null)} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button></div><blockquote className="max-h-36 overflow-y-auto border-l-2 border-violet-400 pl-3 text-sm leading-6 text-slate-300">{selection.selectedText}</blockquote></> : <div className="flex gap-3 text-sm leading-6 text-slate-400"><BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" /><span>Ask anything about this module. The full lesson will be included as AI context.</span></div>}
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }} maxLength={2000} rows={3} placeholder={selection ? "What would you like clarified?" : "Ask a question about this module…"} className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-violet-400/60" />
              <button onClick={() => void ask()} disabled={!question.trim() || submitting} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {submitting ? "Explaining…" : selection ? "Explain this" : "Ask about this module"}</button>
            </div>
            {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
            <div className="mt-7 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><MessageSquareText className="h-4 w-4" /> Saved questions</div>
            <div className="mt-3 space-y-4">
              {!module.questions.length && <p className="text-sm text-slate-500">No questions yet for this module.</p>}
              {module.questions.map((item) => <div key={item.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="line-clamp-3 border-l-2 border-slate-700 pl-3 text-xs leading-5 text-slate-500">{item.selectedText}</div><div className="mt-3 text-sm font-semibold text-slate-200">{item.question}</div>{item.status === "pending" && <div className="mt-3 flex items-center gap-2 text-sm text-violet-300"><Loader2 className="h-4 w-4 animate-spin" /> Codex is preparing an explanation…</div>}{item.status === "failed" && <div className="mt-3 text-sm text-red-300">{item.error || "Explanation failed"}</div>}{item.status === "completed" && <div className="ai-markdown mt-3 text-sm leading-6 text-slate-300"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer}</ReactMarkdown></div>}<div className="mt-3 text-[11px] text-slate-600">{new Date(item.createdAt).toLocaleString()}</div></div>)}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
