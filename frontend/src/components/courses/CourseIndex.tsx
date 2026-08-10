import { ArrowRight, BookOpen, Clock3, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CourseService, type CourseSummary } from "../../apis/admin/courses";

export default function CourseIndex() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    CourseService.list()
      .then(({ items }) => setCourses(items))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load courses"))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-red-500 dark:text-red-400">{error}</div>;
  if (loading) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-slate-500 dark:text-slate-400">Loading courses…</div>;

  return (
    <div className="min-h-screen bg-slate-50 px-5 pb-20 pt-24 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-9 flex items-center gap-3 text-violet-600 dark:text-violet-300"><GraduationCap className="h-7 w-7" /><div><p className="text-xs font-semibold uppercase tracking-[0.18em]">ToolHub Learning</p><h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">My Courses</h1></div></div>
        {!courses.length && <p className="text-slate-500 dark:text-slate-400">No courses yet.</p>}
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => {
            const percent = course.moduleCount ? Math.round((course.completedModuleCount / course.moduleCount) * 100) : 0;
            return (
              <Link
                key={course.id}
                to={`/admin/courses/${course.id}`}
                className="group flex flex-col overflow-hidden rounded-3xl border border-violet-300 bg-gradient-to-br from-violet-100 via-white to-blue-50 p-6 shadow-xl shadow-slate-900/5 transition hover:-translate-y-1 hover:border-violet-400 dark:border-violet-400/20 dark:from-violet-500/15 dark:via-slate-900 dark:to-blue-500/10 dark:shadow-2xl dark:shadow-violet-950/30 dark:hover:border-violet-400/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{course.title}</h2>
                  <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-violet-600 dark:text-slate-500 dark:group-hover:text-violet-300" />
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{course.description}</p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 dark:border-white/10 dark:bg-white/5">{course.level}</span>
                  <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 dark:border-white/10 dark:bg-white/5"><Clock3 className="h-3.5 w-3.5" /> {course.estimatedHours}</span>
                  <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 dark:border-white/10 dark:bg-white/5"><BookOpen className="h-3.5 w-3.5" /> {course.moduleCount} modules</span>
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"><span>{percent}% complete</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${percent}%` }} /></div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
