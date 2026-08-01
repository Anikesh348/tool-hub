import { ArrowLeft, Clock3, Eye, Heart, MessageCircle, MonitorSmartphone, MousePointerClick, Share2, Users } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BlogMetrics, BlogPost, BlogService } from "../../apis/blogs/blogs";

const number = new Intl.NumberFormat("en-IN");

export default function AdminBlogAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState(30);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [metrics, setMetrics] = useState<BlogMetrics | null>(null);
  const [error, setError] = useState("");
  const [postError, setPostError] = useState("");
  const selectedSlug = searchParams.get("slug") || "";
  const selectedPost = posts.find((post) => post.slug === selectedSlug);

  useEffect(() => {
    BlogService.adminList()
      .then(({ items }) => setPosts(items))
      .catch((reason) => setPostError(reason instanceof Error ? reason.message : "Unable to load articles"));
  }, []);

  useEffect(() => {
    setError("");
    setMetrics(null);
    BlogService.metrics(days, selectedSlug || undefined).then(setMetrics).catch((reason) => setError(reason.message));
  }, [days, selectedSlug]);

  const selectArticle = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    if (slug) next.set("slug", slug);
    else next.delete("slug");
    setSearchParams(next, { replace: true });
  };

  const cards = metrics ? [
    { label: "Views", value: number.format(metrics.totalViews), icon: Eye },
    { label: "Unique readers", value: number.format(metrics.uniqueVisitors), icon: Users },
    { label: "Views today", value: number.format(metrics.viewsToday), icon: MousePointerClick },
    { label: "Current likes", value: number.format(metrics.totalLikes), icon: Heart },
    { label: "Shares", value: number.format(metrics.totalShares), icon: Share2 },
    { label: "Comments", value: number.format(metrics.totalComments), icon: MessageCircle },
    { label: "Average engaged", value: `${metrics.averageEngagedSeconds}s`, icon: Clock3 },
    { label: "Completion", value: `${metrics.completionRate}%`, icon: MonitorSmartphone },
  ] : [];

  return (
    <div className="portal-page min-h-screen w-full px-4 pb-16 pt-24 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <Link to="/admin/blogs" className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300"><ArrowLeft className="h-4 w-4" />Blog Studio</Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Blog analytics</h1>
            <p className="mt-2 text-sm text-slate-400">
              {selectedPost ? `Traffic and reading engagement for “${selectedPost.title}”.` : "Privacy-conscious traffic and reading engagement across all stories."}
            </p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[minmax(260px,1fr)_160px]">
            <label>
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Article</span>
              <select value={selectedSlug} onChange={(event) => selectArticle(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b111d] px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-400/40">
                <option value="">All articles</option>
                {posts.map((post) => <option key={post.slug} value={post.slug}>{post.title}{post.status === "DRAFT" ? " (Draft)" : ""}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Range</span>
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-[#0b111d] px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-400/40">
                <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
              </select>
            </label>
          </div>
        </div>
        {postError && <p className="mt-6 text-sm text-amber-300">{postError}</p>}
        {error && <p className="mt-6 text-sm text-rose-300">{error}</p>}
        {!metrics && !error && <p className="mt-10 text-sm text-slate-500">Loading analytics…</p>}
        {metrics && (
          <>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><Icon className="h-5 w-5 text-violet-300" /><p className="mt-5 text-3xl font-bold text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}
            </div>
            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-white">Daily engagement</h2>
              <div className="mt-5 h-72">
                <ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.daily}><defs><linearGradient id="blogViews" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false}/><XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(value) => value.slice(5)} axisLine={false}/><YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false}/><Tooltip contentStyle={{ background: "#0b111d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }}/><Area type="monotone" dataKey="views" stroke="#a78bfa" fill="url(#blogViews)" strokeWidth={2}/><Area type="monotone" dataKey="likes" stroke="#fb7185" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="shares" stroke="#38bdf8" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="comments" stroke="#34d399" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer>
              </div>
            </section>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:col-span-2"><h2 className="text-sm font-semibold text-white">{selectedSlug ? "Article activity" : "Top articles"}</h2><div className="mt-4 space-y-3">{metrics.topPosts.length ? metrics.topPosts.map((post) => <div key={post.slug} className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/10 p-4"><div><p className="text-sm font-semibold text-white">{post.title}</p><p className="mt-1 text-[11px] text-slate-500">{post.uniqueVisitors} unique · {post.likes} likes · {post.shares} shares · {post.comments} comments</p></div><p className="text-lg font-bold text-violet-200">{post.views} views</p></div>) : <p className="text-sm text-slate-500">{selectedSlug ? "No views for this article in the selected range." : "No views in this range yet."}</p>}</div></section>
              <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="text-sm font-semibold text-white">Devices</h2><div className="mt-4 space-y-3">{metrics.devices.map((item) => <div key={item.label} className="flex items-center justify-between text-sm"><span className="capitalize text-slate-400">{item.label}</span><strong className="text-white">{item.views}</strong></div>)}</div><h2 className="mt-8 text-sm font-semibold text-white">Referrers</h2><div className="mt-4 space-y-3">{metrics.referrers.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-400">{item.label}</span><strong className="text-white">{item.views}</strong></div>)}</div><h2 className="mt-8 text-sm font-semibold text-white">Share methods</h2><div className="mt-4 space-y-3">{metrics.shareChannels.length ? metrics.shareChannels.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 text-sm"><span className="capitalize text-slate-400">{item.label}</span><strong className="text-white">{item.shares}</strong></div>) : <p className="text-sm text-slate-500">No shares yet.</p>}</div></section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
