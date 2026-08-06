import { ArrowRight, BookOpen, CheckCircle2, Clock3, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CourseService, type Course } from "../../apis/admin/courses";

export default function CourseIndex() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    CourseService.list()
      .then(({ items }) => Promise.all(items.map((item) => CourseService.get(item.id))))
      .then((results) => setCourses(results.map(({ course }) => course)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load courses"))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-red-400">{error}</div>;
  if (loading) return <div className="mx-auto max-w-5xl px-6 pb-16 pt-28 text-slate-400">Loading courses…</div>;

  return (
    <div className="min-h-screen bg-slate-950 px-5 pb-20 pt-24 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-9 flex items-center gap-3 text-violet-300"><GraduationCap className="h-7 w-7" /><div><p className="text-xs font-semibold uppercase tracking-[0.18em]">ToolHub Learning</p><h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">My Courses</h1></div></div>
        <div className="space-y-14">
          {courses.map((course) => {
            const percent = course.moduleCount ? Math.round((course.completedModuleCount / course.moduleCount) * 100) : 0;
            return <section key={course.id}>
              <div className="overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-900 to-blue-500/10 p-7 shadow-2xl shadow-violet-950/30 sm:p-9">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="max-w-3xl"><h2 className="text-2xl font-bold tracking-tight sm:text-4xl">{course.title}</h2><p className="mt-3 text-base leading-7 text-slate-300">{course.description}</p><div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-300"><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{course.level}</span><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><Clock3 className="h-4 w-4" /> {course.estimatedHours}</span><span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><BookOpen className="h-4 w-4" /> {course.moduleCount} modules</span></div></div>
                  <div className="min-w-36 rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-2xl font-bold text-violet-300">{percent}%</div><div className="mt-1 text-xs text-slate-400">course complete</div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${percent}%` }} /></div></div>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {course.modules.map((module) => (
            <Link key={module.id} to={`/admin/courses/${course.id}/modules/${module.slug}`} className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:-translate-y-0.5 hover:border-violet-400/40 hover:bg-slate-900 sm:p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 font-bold text-violet-300">{module.completed ? <CheckCircle2 className="h-6 w-6" /> : module.position}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">{module.title}</h2>
                    <span className="text-xs text-slate-500">{module.duration} · {module.readingMinutes} min read</span>
                  </div>
                  <p className="mt-2 leading-6 text-slate-400">{module.excerpt}</p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(module.readingProgress * 100)}%` }} /></div>
                </div>
                <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-slate-500 transition group-hover:translate-x-1 group-hover:text-violet-300" />
              </div>
            </Link>
                ))}
              </div>
            </section>;
          })}
        </div>
      </div>
    </div>
  );
}
