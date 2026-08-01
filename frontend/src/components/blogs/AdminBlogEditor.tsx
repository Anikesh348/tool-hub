import { BarChart3, Check, FilePlus2, GitBranch, ImagePlus, Plus, Save, Send, SquarePen } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { BlogPost, BlogService, BlogStatus, BlogVersion } from "../../apis/blogs/blogs";

type FormState = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  tags: string;
  author: string;
  series: string;
  seriesPart: string;
  status: BlogStatus;
};

const emptyForm: FormState = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  coverImage: "",
  tags: "Homelab, Self-hosting",
  author: "Anikesh Thakur",
  series: "",
  seriesPart: "",
  status: "DRAFT",
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

const toForm = (post: BlogPost | BlogVersion): FormState => ({
  title: post.title,
  slug: post.slug,
  excerpt: post.excerpt || "",
  content: post.content || "",
  coverImage: post.coverImage || "",
  tags: post.tags?.join(", ") || "",
  author: post.author || "Anikesh Thakur",
  series: post.series || "",
  seriesPart: post.seriesPart ? String(post.seriesPart) : "",
  status: post.status,
});

export default function AdminBlogEditor() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [versions, setVersions] = useState<BlogVersion[]>([]);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [versionName, setVersionName] = useState("");
  const [newVersionName, setNewVersionName] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPosts = () => BlogService.adminList().then(({ items }) => setPosts(items));
  useEffect(() => { loadPosts().catch((reason) => setError(reason.message)); }, []);

  const activeVersion = versions.find((version) => version.versionId === activeVersionId) || null;
  const versionIsReadOnly = Boolean(editingSlug && activeVersion?.status === "PUBLISHED");

  const payload = useMemo(() => ({
    ...form,
    tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    seriesPart: Number(form.seriesPart || 0),
  }), [form]);

  const updateField = (field: keyof FormState, value: string) => {
    setDirty(true);
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "title" && !editingSlug && (!current.slug || current.slug === slugify(current.title))
        ? { slug: slugify(value) }
        : {}),
    }));
  };

  const applyVersion = (version: BlogVersion) => {
    setActiveVersionId(version.versionId);
    setVersionName(version.name);
    setForm(toForm(version));
    setDirty(false);
    setPreview(false);
  };

  const loadVersions = async (slug: string, preferredVersionId?: string) => {
    setLoadingVersions(true);
    try {
      const result = await BlogService.versions(slug);
      setVersions(result.items);
      const selected = result.items.find((version) => version.versionId === preferredVersionId)
        || result.items.find((version) => version.isCurrent)
        || result.items[0];
      if (selected) applyVersion(selected);
    } finally {
      setLoadingVersions(false);
    }
  };

  const selectPost = async (post: BlogPost) => {
    setEditingSlug(post.slug);
    setForm(toForm(post));
    setVersions([]);
    setActiveVersionId(null);
    setVersionName("");
    setDirty(false);
    setPreview(false);
    setMessage("");
    setError("");
    try {
      await loadVersions(post.slug);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load article versions");
    }
  };

  const resetForNewArticle = () => {
    setEditingSlug(null);
    setVersions([]);
    setActiveVersionId(null);
    setVersionName("");
    setNewVersionName("");
    setForm(emptyForm);
    setDirty(false);
    setPreview(false);
    setMessage("");
    setError("");
  };

  const saveDraft = async (showMessage = true): Promise<BlogVersion | null> => {
    setSaving(true); setError(""); if (showMessage) setMessage("");
    try {
      if (!editingSlug) {
        const post = await BlogService.create({ ...payload, status: "DRAFT" });
        setEditingSlug(post.slug);
        await loadPosts();
        await loadVersions(post.slug);
        if (showMessage) setMessage("Article created with its first draft.");
        return null;
      }
      if (!activeVersion) throw new Error("Select a draft version first");
      if (activeVersion.status !== "DRAFT") throw new Error("Published versions are read-only. Create a new draft from this version.");
      const updated = await BlogService.updateVersion(editingSlug, activeVersion.versionId, {
        ...payload,
        name: versionName,
      });
      setVersions((current) => current.map((version) => version.versionId === updated.versionId ? updated : version));
      applyVersion(updated);
      if (showMessage) setMessage("Draft version saved.");
      return updated;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save draft version");
      return null;
    } finally { setSaving(false); }
  };

  const createDraftVersion = async () => {
    if (!editingSlug || !activeVersion) return;
    setSaving(true); setError(""); setMessage("");
    try {
      let sourceVersionId = activeVersion.versionId;
      if (activeVersion.status === "DRAFT" && dirty) {
        const saved = await BlogService.updateVersion(editingSlug, activeVersion.versionId, { ...payload, name: versionName });
        sourceVersionId = saved.versionId;
      }
      const created = await BlogService.createVersion(editingSlug, newVersionName, sourceVersionId);
      setNewVersionName("");
      await loadVersions(editingSlug, created.versionId);
      setMessage(`Created ${created.name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create another draft");
    } finally { setSaving(false); }
  };

  const selectVersion = async (version: BlogVersion) => {
    if (version.versionId === activeVersionId) return;
    setError(""); setMessage("");
    if (dirty && activeVersion?.status === "DRAFT") {
      const saved = await saveDraft(false);
      if (!saved) return;
    }
    applyVersion(version);
  };

  const publishSelectedVersion = async () => {
    if (!editingSlug || !activeVersion) return;
    setSaving(true); setError(""); setMessage("");
    try {
      let versionId = activeVersion.versionId;
      if (activeVersion.status === "DRAFT") {
        const saved = await BlogService.updateVersion(editingSlug, versionId, { ...payload, name: versionName });
        versionId = saved.versionId;
      }
      const result = await BlogService.publishVersion(editingSlug, versionId);
      await Promise.all([loadPosts(), loadVersions(editingSlug, result.version.versionId)]);
      setMessage(`${result.version.name} is now the published version.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to publish this version");
    } finally { setSaving(false); }
  };

  const uploadImage = async (file?: File) => {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const asset = await BlogService.upload(file);
      setForm((current) => ({ ...current, content: `${current.content}${current.content ? "\n\n" : ""}${asset.markdown}\n` }));
      setDirty(true);
      setMessage("Image uploaded and inserted into the article.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload image");
    } finally { setUploading(false); }
  };

  return (
    <div className="portal-page min-h-screen w-full px-4 pb-16 pt-24 sm:px-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Admin only</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Blog Studio</h1>
            <p className="mt-2 text-sm text-slate-400">Keep multiple draft versions, compare them, and choose exactly which one goes live.</p>
          </div>
          <Link to="/admin/blogs/analytics" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]">
            <BarChart3 className="h-4 w-4" /> View analytics
          </Link>
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <button onClick={resetForNewArticle} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500">
              <FilePlus2 className="h-4 w-4" /> New article
            </button>
            <div className="mt-5 space-y-2">
              {posts.map((post) => (
                <button key={post.slug} onClick={() => selectPost(post)} className={`w-full rounded-xl border p-3 text-left transition ${editingSlug === post.slug ? "border-violet-400/40 bg-violet-500/10" : "border-white/5 bg-black/10 hover:border-white/10"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-semibold text-white">{post.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${post.status === "PUBLISHED" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{post.status}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{post.viewCount || 0} views · {post.slug}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            {editingSlug ? (
              <div className="mb-6 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-white"><GitBranch className="h-4 w-4 text-violet-300" />Article versions</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">Published versions stay unchanged. Create a draft from any version, edit it, then publish the one you want.</p>
                    <Link to={`/admin/blogs/analytics?slug=${encodeURIComponent(editingSlug)}`} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200">
                      <BarChart3 className="h-3.5 w-3.5" />View this article’s analytics
                    </Link>
                  </div>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <input
                      value={newVersionName}
                      onChange={(event) => setNewVersionName(event.target.value)}
                      className="blog-input min-w-0 flex-1 py-2 text-xs sm:w-48"
                      placeholder={`Draft ${versions.length + 1} name`}
                    />
                    <button disabled={saving || !activeVersion} onClick={createDraftVersion} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
                      <Plus className="h-3.5 w-3.5" />New draft
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {loadingVersions && <p className="text-xs text-slate-400">Loading versions…</p>}
                  {!loadingVersions && versions.map((version) => (
                    <button
                      key={version.versionId}
                      onClick={() => selectVersion(version)}
                      className={`rounded-xl border p-3 text-left transition ${activeVersionId === version.versionId ? "border-violet-400/50 bg-violet-500/15" : "border-white/10 bg-black/10 hover:border-violet-400/25"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-white">v{version.versionNumber} · {version.name}</span>
                        {version.isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-300"><Check className="h-2.5 w-2.5" />Live</span>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${version.status === "DRAFT" ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-300"}`}>{version.status}</span>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">Updated {new Date(version.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </button>
                  ))}
                </div>

                {activeVersion && (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <label>
                      <span className="blog-label">Version to publish</span>
                      <select
                        value={activeVersionId || ""}
                        onChange={(event) => {
                          const version = versions.find((item) => item.versionId === event.target.value);
                          if (version) void selectVersion(version);
                        }}
                        className="blog-input py-2 text-sm"
                        aria-describedby="publish-version-help"
                      >
                        {versions.map((version) => (
                          <option key={version.versionId} value={version.versionId}>
                            v{version.versionNumber} · {version.name}{version.isCurrent ? " (Live)" : ""}
                          </option>
                        ))}
                      </select>
                      <span id="publish-version-help" className="mt-1.5 block text-[11px] leading-5 text-slate-400">
                        {activeVersion.isCurrent
                          ? "This version is live. Choose another version to preview it before publishing."
                          : `v${activeVersion.versionNumber} will replace the live version only when you press Publish v${activeVersion.versionNumber}.`}
                      </span>
                    </label>
                    <label>
                      <span className="blog-label">Selected version name</span>
                      <input
                        value={versionName}
                        onChange={(event) => { setVersionName(event.target.value); setDirty(true); }}
                        disabled={versionIsReadOnly}
                        className="blog-input py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-6 rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400">
                Create the article to start its version history. The first save becomes <span className="font-semibold text-slate-200">Initial draft</span>.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
                <button onClick={() => setPreview(false)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${!preview ? "bg-white/10 text-white" : "text-slate-400"}`}><SquarePen className="mr-1.5 inline h-3.5 w-3.5" />Edit</button>
                <button onClick={() => setPreview(true)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${preview ? "bg-white/10 text-white" : "text-slate-400"}`}>Preview</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={saving || versionIsReadOnly} onClick={() => saveDraft()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{editingSlug ? "Save version" : "Create first draft"}</button>
                <button disabled={saving || !editingSlug || !activeVersion || activeVersion.isCurrent} onClick={publishSelectedVersion} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />{activeVersion && !activeVersion.isCurrent ? `Publish v${activeVersion.versionNumber}` : "Publish selected"}</button>
              </div>
            </div>

            {message && <p className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p>}
            {error && <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

            {preview ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-[#050a13] p-6 sm:p-10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">{form.series ? `Part ${form.seriesPart || 1} · ${form.series}` : "Preview"}</p>
                <h2 className="mt-3 font-sans text-4xl font-bold leading-tight text-white">{form.title || "Untitled article"}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-400">{form.excerpt}</p>
                {form.coverImage && <img src={form.coverImage} alt="" className="mt-7 max-h-[500px] w-full rounded-2xl border border-white/10 object-contain" />}
                <div className="blog-prose mt-8"><ReactMarkdown remarkPlugins={[remarkGfm]}>{form.content || "Start writing to see a preview."}</ReactMarkdown></div>
              </div>
            ) : (
              <fieldset disabled={versionIsReadOnly} className="mt-6 space-y-5 disabled:opacity-75">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="md:col-span-2"><span className="blog-label">Title</span><input value={form.title} onChange={(e) => updateField("title", e.target.value)} className="blog-input" placeholder="A clear, specific article title" /></label>
                  <label><span className="blog-label">Slug</span><input value={form.slug} onChange={(e) => updateField("slug", slugify(e.target.value))} disabled={Boolean(editingSlug)} className="blog-input disabled:cursor-not-allowed disabled:opacity-60" placeholder="article-url" /></label>
                  <label><span className="blog-label">Author</span><input value={form.author} onChange={(e) => updateField("author", e.target.value)} className="blog-input" /></label>
                  <label><span className="blog-label">Series</span><input value={form.series} onChange={(e) => updateField("series", e.target.value)} className="blog-input" placeholder="Optional series name" /></label>
                  <label><span className="blog-label">Series part</span><input type="number" min="0" value={form.seriesPart} onChange={(e) => updateField("seriesPart", e.target.value)} className="blog-input" /></label>
                  <label className="md:col-span-2"><span className="blog-label">Excerpt</span><textarea rows={3} value={form.excerpt} onChange={(e) => updateField("excerpt", e.target.value)} className="blog-input resize-y" placeholder="One or two sentences for the blog listing and social preview." /></label>
                  <label><span className="blog-label">Cover image URL</span><input value={form.coverImage} onChange={(e) => updateField("coverImage", e.target.value)} className="blog-input" placeholder="/blogs/.../cover.png" /></label>
                  <label><span className="blog-label">Tags, comma separated</span><input value={form.tags} onChange={(e) => updateField("tags", e.target.value)} className="blog-input" /></label>
                </div>
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="blog-label">Article body · Markdown</span>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06]">
                      <ImagePlus className="h-4 w-4" />{uploading ? "Uploading…" : "Upload image"}
                      <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} />
                    </label>
                  </div>
                  <textarea rows={28} value={form.content} onChange={(e) => updateField("content", e.target.value)} className="blog-input min-h-[620px] resize-y font-mono text-[13px] leading-6" placeholder="## Start with a useful heading…" />
                </div>
              </fieldset>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
