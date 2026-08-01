import { Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { BlogTermSummary } from "../../apis/blogs/blogs";

interface TermSummaryDialogProps {
  term: string;
  summary: BlogTermSummary | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}

export default function TermSummaryDialog({
  term,
  summary,
  loading,
  error,
  onClose,
  onRetry,
}: TermSummaryDialogProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="blog-term-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="term-summary-title"
      onClick={onClose}
    >
      <section className="blog-term-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="blog-term-dialog-heading">
          <span className="blog-term-ai-label"><Sparkles className="h-3.5 w-3.5" /> AI context note</span>
          <button ref={closeRef} type="button" className="blog-term-close" onClick={onClose} aria-label="Close explanation">
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 id="term-summary-title">{summary?.term || term}</h2>

        {loading && (
          <div className="blog-term-loading" role="status">
            <span />
            <span />
            <span />
            <span className="sr-only">Generating a contextual explanation…</span>
          </div>
        )}

        {!loading && error && (
          <div className="blog-term-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </div>
        )}

        {!loading && summary && <p className="blog-term-summary">{summary.summary}</p>}
        {!loading && summary && (
          <p className="blog-term-source">AI-generated for this passage</p>
        )}
      </section>
    </div>
  );
}
