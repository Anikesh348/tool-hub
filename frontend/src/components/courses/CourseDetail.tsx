import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CourseService, type Course, type CourseModuleSummary } from "../../apis/admin/courses";

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

export default function CourseDetail() {
  const { courseId = "" } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    CourseService.get(courseId)
      .then(({ course: loaded }) => setCourse(loaded))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load this course"))
      .finally(() => setLoading(false));
  }, [courseId]);

  if (error) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-red-500 dark:text-red-400">{error}</div>;
  if (loading || !course) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-slate-500 dark:text-slate-400">Loading course…</div>;

  const percent = course.moduleCount ? Math.round((course.completedModuleCount / course.moduleCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 px-5 pb-20 pt-24 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link to="/admin/courses" className="mb-6 flex w-fit items-center gap-2 text-sm text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-300"><ArrowLeft className="h-4 w-4" /> All courses</Link>

        <div className="overflow-hidden rounded-3xl border border-violet-300 bg-gradient-to-br from-violet-100 via-white to-blue-50 p-7 shadow-xl shadow-slate-900/5 dark:border-violet-400/20 dark:from-violet-500/15 dark:via-slate-900 dark:to-blue-500/10 dark:shadow-2xl dark:shadow-violet-950/30 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">{course.title}</h1>
              <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{course.description}</p>
              <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-600 dark:text-slate-300">
                <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">{course.level}</span>
                <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/5"><Clock3 className="h-4 w-4" /> {course.estimatedHours}</span>
                <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/5"><BookOpen className="h-4 w-4" /> {course.moduleCount} modules</span>
              </div>
            </div>
            <div className="min-w-36 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-black/20">
              <div className="text-2xl font-bold text-violet-600 dark:text-violet-300">{percent}%</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">course complete</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${percent}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {groupBySection(course.modules).map((group) => (
            <div key={group.section || "ungrouped"}>
              {group.section && (
                <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {group.section}
                  <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                </h2>
              )}
              <div className="grid gap-3">
                {group.modules.map((module) => (
                  <Link key={module.id} to={`/admin/courses/${course.id}/modules/${module.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-violet-400 hover:shadow-md dark:border-white/10 dark:bg-slate-900/70 dark:hover:border-violet-400/40 dark:hover:bg-slate-900 dark:hover:shadow-none sm:p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 font-bold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">{module.completed ? <CheckCircle2 className="h-6 w-6" /> : module.position}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 sm:text-xl">{module.title}</h3>
                          <span className="text-xs text-slate-500">{module.duration} · {module.readingMinutes} min read</span>
                        </div>
                        <p className="mt-2 leading-6 text-slate-500 dark:text-slate-400">{module.excerpt}</p>
                        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(module.readingProgress * 100)}%` }} /></div>
                      </div>
                      <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-violet-600 dark:text-slate-500 dark:group-hover:text-violet-300" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
