import { ArrowRight, BookOpen, Clock3, Eye } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BlogPost, BlogService } from "../../apis/blogs/blogs";

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value))
    : "";

export default function BlogIndex() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    BlogService.list()
      .then(({ items }) => setPosts(items))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load blogs"))
      .finally(() => setLoading(false));
  }, []);

  const featuredPost = posts[0];
  const earlierPosts = posts.slice(1);
  const oneEarlierPost = earlierPosts.length === 1;

  return (
    <div className="blog-page min-h-screen w-full px-5 pb-20 pt-28 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="border-b border-white/10 pb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-200">
            <BookOpen className="h-3.5 w-3.5" />
            Notes from the homelab
          </div>
          <h1 className="mt-5 max-w-3xl font-serif text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
            Things I learned by running them myself.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400">
            Practical write-ups about self-hosting, networking, media automation and the small tools that grew around my Raspberry Pi.
          </p>
          {!loading && !error && posts.length > 0 && (
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {posts.length} field {posts.length === 1 ? "note" : "notes"} · One ongoing build log
            </p>
          )}
        </section>

        {loading && <p className="py-16 text-sm text-slate-500">Loading stories…</p>}
        {error && <p className="py-16 text-sm text-rose-300">{error}</p>}
        {!loading && !error && !featuredPost && (
          <p className="py-16 text-sm text-slate-500">No published stories yet.</p>
        )}

        {!loading && !error && featuredPost && (
          <>
            <section className="py-10" aria-labelledby="featured-story-heading">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Featured story</p>
                  <h2 id="featured-story-heading" className="mt-1 text-sm text-slate-500">The latest note from the homelab</h2>
                </div>
                <span className="hidden h-px flex-1 bg-white/10 sm:block" />
              </div>

              <article className="group grid overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-[0_24px_80px_rgba(0,0,0,0.18)] lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                {featuredPost.coverImage && (
                  <Link to={`/blogs/${featuredPost.slug}`} className="min-h-[280px] overflow-hidden border-b border-white/10 bg-[#090e18] lg:min-h-[440px] lg:border-b-0 lg:border-r">
                    <img src={featuredPost.coverImage} alt={`${featuredPost.title} cover`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]" />
                  </Link>
                )}
                <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
                  {featuredPost.series && <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Part {featuredPost.seriesPart || 1} · {featuredPost.series}</p>}
                  <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-[-0.03em] text-white sm:text-4xl">
                    <Link to={`/blogs/${featuredPost.slug}`}>{featuredPost.title}</Link>
                  </h2>
                  <p className="mt-5 text-sm leading-7 text-slate-400">{featuredPost.excerpt}</p>
                  <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>{formatDate(featuredPost.publishedAt)}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-700" />
                    <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{featuredPost.readingMinutes || 1} min read</span>
                    <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />{featuredPost.viewCount || 0} views</span>
                  </div>
                  <div className="mt-7 flex flex-wrap gap-2">
                    {featuredPost.tags?.map((tag) => <span key={tag} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400">{tag}</span>)}
                  </div>
                  <Link to={`/blogs/${featuredPost.slug}`} className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-semibold text-violet-300 transition hover:text-violet-200">
                    Read featured story <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            </section>

            {earlierPosts.length > 0 && (
              <section className="border-t border-white/10 py-10" aria-labelledby="earlier-stories-heading">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">From the archive</p>
                    <h2 id="earlier-stories-heading" className="mt-2 font-serif text-3xl font-semibold tracking-[-0.025em] text-white">Earlier in the series</h2>
                  </div>
                  <p className="text-xs text-slate-500">Newest first</p>
                </div>

                <div className={`grid gap-6 ${oneEarlierPost ? "" : "md:grid-cols-2"}`}>
                  {earlierPosts.map((post) => (
                    <article key={post.slug} className={`group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] ${oneEarlierPost ? "sm:grid sm:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]" : ""}`}>
                      {post.coverImage && (
                        <Link to={`/blogs/${post.slug}`} className={`block overflow-hidden bg-[#090e18] ${oneEarlierPost ? "border-b border-white/10 sm:border-b-0 sm:border-r" : "border-b border-white/10"}`}>
                          <img src={post.coverImage} alt={`${post.title} cover`} className={`w-full object-cover transition duration-500 group-hover:scale-[1.015] ${oneEarlierPost ? "h-full min-h-[260px]" : "aspect-[16/9]"}`} />
                        </Link>
                      )}
                      <div className="flex flex-col p-6 sm:p-7">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span>{formatDate(post.publishedAt)}</span>
                          <span className="h-1 w-1 rounded-full bg-slate-700" />
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{post.readingMinutes || 1} min read</span>
                          <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />{post.viewCount || 0} views</span>
                        </div>
                        {post.series && <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Part {post.seriesPart || 1} · {post.series}</p>}
                        <h3 className="mt-3 font-serif text-2xl font-semibold leading-tight tracking-[-0.025em] text-white">
                          <Link to={`/blogs/${post.slug}`}>{post.title}</Link>
                        </h3>
                        <p className="mt-4 text-sm leading-7 text-slate-400">{post.excerpt}</p>
                        <div className="mt-6 flex flex-wrap gap-2">
                          {post.tags?.map((tag) => <span key={tag} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400">{tag}</span>)}
                        </div>
                        <Link to={`/blogs/${post.slug}`} className="mt-7 inline-flex w-fit items-center gap-2 text-sm font-semibold text-violet-300 transition hover:text-violet-200">
                          Read article <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
