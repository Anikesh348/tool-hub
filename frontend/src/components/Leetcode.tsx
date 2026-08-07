import React, { useState, useEffect, useMemo, useRef } from "react";
import { LeetCodeService } from "../apis/question/question";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Filters from "./Filters";
import { Loader } from "./Loader";
import { useNotification } from "../context/NotificationContext";
import { BookOpenCheck, CheckCircle2, ChevronDown, Circle, Plus, Sparkles } from "lucide-react";
import { locationPath } from "../utils/authRedirect";
import LeetcodeAIBubble from "./LeetcodeAIBubble";

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
const PAGE_SIZE = 10;

export const Leetcode = () => {
  const { authToken, isAuthLoading } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [updatingQuestionId, setUpdatingQuestionId] = useState<string | null>(
    null
  );
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(
    null
  );

  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>("");

  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [solvedFilter, setSolvedFilter] = useState<string>("all");
  const [tagsOptions, setTagsOptions] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [difficultySort, setDifficultySort] = useState<"none" | "asc" | "desc">("none");
  const [page, setPage] = useState(1);

  // Topic-first browsing (mirrors leetcode.com's tag pages): a single active
  // topic pill by default, plus AI-curated collections shown the same way.
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const topicDefaultSetRef = useRef(false);

  // Add Questions starts collapsed so the page opens on the browsing view,
  // not a form - it only expands when the user actually wants to add something.
  const [addQuestionsOpen, setAddQuestionsOpen] = useState(false);

  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!location.hash) return;
    const sectionId = location.hash.slice(1);
    const timeoutId = window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [location.hash]);

  // Hooks for fetching, adding, updating, deleting questions
  const {
    loading: loadingQuestions,
    data: questionsData,
    error: fetchError,
    fetchData: fetchQuestionsApi,
  } = useApiFetcher();

  const {
    loading: addingQuestions,
    data: addData,
    fetchData: addQuestionsApi,
  } = useApiFetcher();

  const { data: updateData, fetchData: updateQuestionApi } = useApiFetcher();
  const { data: deleteData, fetchData: deleteQuestionApi } = useApiFetcher();
  const { data: updateNotesData, fetchData: updateNotesApi } = useApiFetcher();
  const {
    loading: applyingTags,
    data: applyTagsData,
    fetchData: applyTagsApi,
  } = useApiFetcher();

  // Fetch questions
  const fetchQuestions = () => {
    const { url, options } = LeetCodeService.getQuestions();
    fetchQuestionsApi(url, options);
  };

  useEffect(() => {
    if (isAuthLoading) return;

    if (!authToken) {
      navigate("/login", { state: { from: locationPath(location) } });
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchQuestions();
  }, [authToken, isAuthLoading, location, navigate]);

  // Handle fetch results
  useEffect(() => {
    if (questionsData?.body) {
      const body = questionsData.body;
      if (Array.isArray(body)) {
        const normalized = body.map((q: any) => ({
          ...q,
          questionId: q?.questionId ?? q?._id,
          status: q?.status || "unsolved",
          notes: q?.notes || "",
        }));
        setQuestions(normalized);
      } else if (body.success) {
        const normalized = (body.questions || []).map((q: any) => ({
          ...q,
          questionId: q?.questionId ?? q?._id,
          status: q?.status || "unsolved",
          notes: q?.notes || "",
        }));
        setQuestions(normalized);
      }
    }
  }, [questionsData, fetchError]);

  // Handle adding questions
  const handleSubmit = () => {
    const urlList = urls
      .split(/\n|,/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urlList.length === 0) return;

    const { url, options } = LeetCodeService.addQuestions(urlList);
    addQuestionsApi(url, options);
  };

  useEffect(() => {
    if (addData?.status === 200) {
      addNotification("Questions added successfully!", "success");
      fetchQuestions(); // refetch updated list
      setUrls("");
      setAddQuestionsOpen(false);
    } else if (addData?.status && addData.status !== 200) {
      addNotification(
        addData?.body?.message || "Failed to add questions",
        "error"
      );
    }
  }, [addData, addNotification]);

  // Toggle solved/unsolved
  const toggleSolved = (questionId: string) => {
    setUpdatingQuestionId(questionId);

    const question = questions.find((q) => q.questionId === questionId);
    if (!question) return;

    const currentStatus = question.status || "unsolved";
    const newStatus = currentStatus === "solved" ? "unsolved" : "solved";

    const { url, options } = LeetCodeService.updateQuestionStatus(
      questionId,
      newStatus
    );
    updateQuestionApi(url, options);
  };

  useEffect(() => {
    if (updateData?.status === 200) {
      addNotification("Question status updated!", "success");
      fetchQuestions();
      setUpdatingQuestionId(null);
    } else if (updateData?.status && updateData.status !== 200) {
      addNotification("Failed to update question status", "error");
      setUpdatingQuestionId(null);
    }
  }, [updateData, addNotification]);

  // Delete question
  const handleDelete = (questionId: string) => {
    setDeletingQuestionId(questionId);
    const { url, options } = LeetCodeService.deleteQuestion(questionId);
    deleteQuestionApi(url, options);
  };

  useEffect(() => {
    if (deleteData?.status === 200) {
      addNotification("Question deleted successfully!", "success");
      fetchQuestions();
      setDeletingQuestionId(null);
    } else if (deleteData?.status && deleteData.status !== 200) {
      addNotification("Failed to delete question", "error");
      setDeletingQuestionId(null);
    }
  }, [deleteData, addNotification]);

  // Notes handlers
  const handleSaveNotes = (questionId: string) => {
    const { url, options } = LeetCodeService.updateQuestionNotes(
      questionId,
      notesDraft
    );
    updateNotesApi(url, options);
  };

  useEffect(() => {
    if (updateNotesData?.status === 200) {
      addNotification("Notes updated successfully!", "success");
      fetchQuestions();
      setEditingNotesId(null);
      setNotesDraft("");
    } else if (updateNotesData?.status && updateNotesData.status !== 200) {
      addNotification("Failed to update notes", "error");
    }
  }, [updateNotesData, addNotification]);

  // derive tags options from questions
  useEffect(() => {
    const tagsSet = new Set<string>();
    questions.forEach((q) => {
      (q.tags || []).forEach((t: string) => tagsSet.add(t));
    });
    setTagsOptions(Array.from(tagsSet));
  }, [questions]);

  // Topic and AI-collection counts, derived client-side from the questions
  // already loaded (same source the "Tags" filter uses), sorted most-popular
  // first so the default view lands on whichever topic has the most problems.
  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((q) => {
      (q.tags || []).forEach((t: string) => counts.set(t, (counts.get(t) || 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [questions]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((q) => {
      if (q.collectionLabel) counts.set(q.collectionLabel, (counts.get(q.collectionLabel) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [questions]);

  // Default to the most common topic (e.g. "Array") the first time questions
  // load, like leetcode.com's own tag pages - but only once, so it doesn't
  // fight the user's own topic pick on later refetches.
  useEffect(() => {
    if (topicDefaultSetRef.current || questions.length === 0) return;
    topicDefaultSetRef.current = true;
    if (topicCounts.length > 0) setSelectedTopic(topicCounts[0].name);
  }, [questions, topicCounts]);

  const handleSelectTopic = (topic: string) => {
    setSelectedTopic(topic);
    setSelectedCollection("");
  };

  const handleSelectCollection = (collection: string) => {
    setSelectedCollection(collection);
    setSelectedTopic("");
  };

  const handleViewCollection = (label: string) => {
    handleSelectCollection(label);
    window.setTimeout(() => {
      document.getElementById("question-library")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  // Track applied tags and operation for UI
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  const [appliedOperation, setAppliedOperation] = useState<
    "union" | "intersection" | null
  >(null);
  const [tagsModalKey, setTagsModalKey] = useState(0); // for forcing modal reset

  // Modified tags filter handler to update UI state
  const handleTagsFilter = (
    tags: string[],
    operation: "union" | "intersection"
  ) => {
    setAppliedTags(tags);
    setAppliedOperation(tags.length > 0 ? operation : null);
    const { url, options } = LeetCodeService.getQuestions(tags, operation);
    fetchQuestionsApi(url, options);
  };

  // Reset tags filter
  const handleResetTags = () => {
    setAppliedTags([]);
    setAppliedOperation(null);
    setTagsModalKey((k) => k + 1); // force modal to reset
    fetchQuestions();
  };

  useEffect(() => {
    if (applyTagsData?.status === 200) {
      fetchQuestions();
    }
  }, [applyTagsData]);

  // Filtered questions for display (UI-level for difficulty and solved)
  const filteredQuestions = questions.filter((q) => {
    if (selectedCollection) {
      if ((q.collectionLabel || "") !== selectedCollection) return false;
    } else if (selectedTopic) {
      if (!(q.tags || []).includes(selectedTopic)) return false;
    }
    if (difficultyFilter !== "all") {
      if (!q.difficulty) return false;
      if (q.difficulty.toLowerCase() !== difficultyFilter.toLowerCase())
        return false;
    }
    if (solvedFilter !== "all") {
      const isSolved = q.status === "solved" || q.solved === true;
      if (solvedFilter === "solved" && !isSolved) return false;
      if (solvedFilter === "unsolved" && isSolved) return false;
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const titleMatch = q.title?.toLowerCase().includes(query);
      const numberMatch = q.number?.toString().includes(query);
      if (!titleMatch && !numberMatch) return false;
    }
    return true;
  });

  // Any change to what's being shown should land back on page 1.
  useEffect(() => {
    setPage(1);
  }, [
    selectedTopic,
    selectedCollection,
    difficultyFilter,
    solvedFilter,
    searchQuery,
    difficultySort,
  ]);

  // Sort by difficulty (client-side, on top of the active filters)
  const sortedQuestions =
    difficultySort === "none"
      ? filteredQuestions
      : [...filteredQuestions].sort((a, b) => {
          const rankA = DIFFICULTY_RANK[(a.difficulty || "").toLowerCase()] ?? 3;
          const rankB = DIFFICULTY_RANK[(b.difficulty || "").toLowerCase()] ?? 3;
          return difficultySort === "asc" ? rankA - rankB : rankB - rankA;
        });

  const totalPages = Math.max(1, Math.ceil(sortedQuestions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedQuestions = sortedQuestions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const solvedCount = questions.filter(
    (question) => question.status === "solved" || question.solved === true,
  ).length;
  const completionRate = questions.length
    ? Math.round((solvedCount / questions.length) * 100)
    : 0;

  return (
    <div className="portal-page leetcode-workspace min-h-screen w-full transition-colors duration-300">
      <div className="toolhub-desktop-container max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 pt-24">
        <header className="mb-5 max-w-3xl">
          <p className="tool-workspace-kicker">Coding workspace</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            LeetCode Manager
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl">
            Keep your problem list, progress, tags, and notes in one focused view.
          </p>
        </header>

        {/* Add Question Section - collapsed by default, top of page */}
        <div
          id="add-questions"
          className="tool-workspace-card scroll-mt-24 mb-5 overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setAddQuestionsOpen((open) => !open)}
            className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="tool-workspace-icon shrink-0">
                <Plus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
                  Add Questions
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Paste LeetCode URLs to track your practice
                </p>
              </div>
            </div>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                addQuestionsOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {addQuestionsOpen && (
            <div className="space-y-3 sm:space-y-4 px-4 sm:px-6 pb-4 sm:pb-6 pt-1 border-t border-gray-200 dark:border-gray-700">
              <div className="relative">
                <textarea
                  className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg sm:rounded-xl p-3 sm:p-4 resize-none bg-white dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 font-mono text-xs sm:text-sm"
                  rows={3}
                  autoFocus
                  placeholder="Paste URLs (comma or new line)&#10;Example: https://leetcode.com/problems/two-sum/"
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                />
                <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 text-xs text-gray-400 dark:text-gray-500">
                  {urls.split(/\n|,/).filter((u) => u.trim().length > 0).length >
                    0 && (
                    <span>
                      {
                        urls.split(/\n|,/).filter((u) => u.trim().length > 0)
                          .length
                      }{" "}
                      URL(s)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500 order-2 sm:order-1">
                  Separate URLs with a comma or new line.
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={addingQuestions || urls.trim().length === 0}
                  className="order-1 sm:order-2 w-full sm:w-auto py-2.5 sm:py-3 px-4 sm:px-8 rounded-lg sm:rounded-xl text-white font-semibold text-sm sm:text-base bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {addingQuestions ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Topics - primary, leetcode-style navigation */}
        {(topicCounts.length > 0 || collectionCounts.length > 0) && (
          <div className="mb-5">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <button
                onClick={() => handleSelectTopic("")}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                  !selectedTopic && !selectedCollection
                    ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                    : "bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10"
                }`}
              >
                All ({questions.length})
              </button>
              {topicCounts.map((topic) => (
                <button
                  key={topic.name}
                  onClick={() => handleSelectTopic(topic.name)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                    selectedTopic === topic.name
                      ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                      : "bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10"
                  }`}
                >
                  {topic.name} ({topic.count})
                </button>
              ))}
            </div>
            {collectionCounts.length > 0 && (
              <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                {collectionCounts.map((collection) => (
                  <button
                    key={collection.name}
                    onClick={() => handleSelectCollection(collection.name)}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                      selectedCollection === collection.name
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow"
                        : "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20"
                    }`}
                  >
                    <Sparkles className="h-3 w-3" />
                    {collection.name} ({collection.count})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="tool-metric-grid mb-5">
          <div className="tool-metric-card">
            <BookOpenCheck />
            <span><strong>{questions.length}</strong>Total problems</span>
          </div>
          <div className="tool-metric-card">
            <CheckCircle2 />
            <span><strong>{solvedCount}</strong>Solved</span>
          </div>
          <div className="tool-metric-card">
            <Circle />
            <span><strong>{Math.max(questions.length - solvedCount, 0)}</strong>Remaining</span>
          </div>
          <div className="tool-metric-card">
            <span className="tool-progress-ring">{completionRate}%</span>
            <span><strong>{completionRate}%</strong>Completion</span>
          </div>
        </div>

        {/* Filters - compact single-row toolbar, sits right above the list */}
        <div className="mb-4">
          <Filters
            difficulty={difficultyFilter}
            solved={solvedFilter}
            tagsOptions={tagsOptions}
            questions={questions}
            onDifficultyChange={(v) => setDifficultyFilter(v)}
            onSolvedChange={(v) => setSolvedFilter(v)}
            onApplyTags={handleTagsFilter}
            onSearchChange={setSearchQuery}
            searchQuery={searchQuery}
            applying={applyingTags}
            tagsModalKey={tagsModalKey}
          />
        </div>

        {/* Applied Tags Section */}
        {appliedTags.length > 0 && (
          <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-xl p-3 sm:p-4 mb-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="font-semibold text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                Tags:
              </span>
              {appliedTags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 text-blue-700 dark:text-blue-300 text-xs sm:text-sm font-medium border border-blue-200 dark:border-blue-700 truncate"
                >
                  {tag}
                </span>
              ))}
              {appliedOperation && (
                <span className="px-2 sm:px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-semibold border border-purple-300 dark:border-purple-700 whitespace-nowrap">
                  {appliedOperation === "union" ? "Union" : "Intersection"}
                </span>
              )}
              <button
                onClick={handleResetTags}
                className="ml-auto px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 text-xs sm:text-sm font-semibold transition-colors duration-200 border border-red-200 dark:border-red-800 whitespace-nowrap"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Questions Table */}
        <div
          id="question-library"
          className="tool-workspace-card scroll-mt-24 p-4 sm:p-6 lg:p-8"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              Your Questions ({sortedQuestions.length})
            </h3>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Sort:
              </label>
              <select
                value={difficultySort}
                onChange={(e) => setDifficultySort(e.target.value as "none" | "asc" | "desc")}
                className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
              >
                <option value="none">Default order</option>
                <option value="asc">Difficulty: Easy → Hard</option>
                <option value="desc">Difficulty: Hard → Easy</option>
              </select>
            </div>
          </div>

          {loadingQuestions ? (
            <div className="flex justify-center items-center py-12">
              <Loader />
            </div>
          ) : sortedQuestions.length === 0 ? (
            <div className="text-center py-8 sm:py-12">
              <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400">
                No questions found. Try adjusting filters or add new questions.
              </p>
            </div>
          ) : (
            <>
            <div className="space-y-2 sm:space-y-3">
              {paginatedQuestions.map((q, idx) => (
                <div
                  key={q.questionId}
                  className="glass-card border border-gray-200 dark:border-gray-700 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:shadow-md transition-all duration-300"
                >
                  {/* Mobile View - Stacked */}
                  <div className="block sm:hidden space-y-3">
                    {/* Header with number and title */}
                    <div>
                      <div className="flex items-start gap-2 mb-2">
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs">
                          {(currentPage - 1) * PAGE_SIZE + idx + 1}
                        </div>
                        <a
                          href={q.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors break-words flex-1"
                        >
                          {q.title !== undefined && q.title !== ""
                            ? q.title
                            : q.url}
                        </a>
                      </div>
                      {q.notes && editingNotesId !== q.questionId && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 italic pl-9 truncate">
                          {q.notes}
                        </p>
                      )}
                    </div>

                    {/* Status and difficulty badges */}
                    <div className="flex items-center gap-2">
                      {q.difficulty && (
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-bold inline-block flex-shrink-0
                            ${
                              q.difficulty.toLowerCase() === "easy"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                : q.difficulty.toLowerCase() === "medium"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                                : q.difficulty.toLowerCase() === "hard"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                        >
                          {q.difficulty.charAt(0).toUpperCase() +
                            q.difficulty.slice(1)}
                        </span>
                      )}

                      <label className="flex items-center gap-2 cursor-pointer flex-1 justify-end">
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {q.status === "solved" ? "Solved" : "Unsolved"}
                        </span>
                        <input
                          type="checkbox"
                          checked={q.status === "solved"}
                          onChange={() => toggleSolved(q.questionId)}
                          disabled={updatingQuestionId === q.questionId}
                          className="h-4 w-4 text-blue-600 dark:text-blue-400 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Notes editing - Mobile */}
                    {editingNotesId === q.questionId ? (
                      <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <textarea
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          rows={2}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-2 resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs"
                          placeholder="Add your notes..."
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleSaveNotes(q.questionId)}
                            className="px-3 py-1.5 bg-gradient-to-r from-green-600 to-teal-600 hover:shadow-md text-white text-xs font-medium rounded-lg transition-all"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingNotesId(null);
                              setNotesDraft("");
                            }}
                            className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-xs font-medium rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => {
                            setEditingNotesId(q.questionId);
                            setNotesDraft(q.notes || "");
                          }}
                          className="px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 text-xs font-medium rounded-lg transition-all flex-1"
                        >
                          Notes
                        </button>
                        <button
                          onClick={() => handleDelete(q.questionId)}
                          disabled={deletingQuestionId === q.questionId}
                          className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium rounded-lg transition-all flex-1"
                        >
                          {deletingQuestionId === q.questionId
                            ? "..."
                            : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop View - Side by side */}
                  <div className="hidden sm:flex sm:flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                    {/* Left: Number & Question */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm">
                        {(currentPage - 1) * PAGE_SIZE + idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <a
                          href={q.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm lg:text-base font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors break-words"
                        >
                          {q.title !== undefined && q.title !== ""
                            ? q.title
                            : q.url}
                        </a>
                        {q.notes && editingNotesId !== q.questionId && (
                          <p className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 italic">
                            {q.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Middle: Difficulty & Status */}
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      {q.difficulty && (
                        <span
                          className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-bold inline-block flex-shrink-0
                            ${
                              q.difficulty.toLowerCase() === "easy"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                : q.difficulty.toLowerCase() === "medium"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                                : q.difficulty.toLowerCase() === "hard"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                        >
                          {q.difficulty.charAt(0).toUpperCase() +
                            q.difficulty.slice(1)}
                        </span>
                      )}

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={q.status === "solved"}
                          onChange={() => toggleSolved(q.questionId)}
                          disabled={updatingQuestionId === q.questionId}
                          className="h-4 sm:h-5 w-4 sm:w-5 text-blue-600 dark:text-blue-400 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 cursor-pointer"
                        />
                        <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                          {updatingQuestionId === q.questionId
                            ? "..."
                            : "Solved"}
                        </span>
                      </label>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex gap-2 justify-end flex-wrap lg:flex-nowrap">
                      {editingNotesId === q.questionId ? (
                        <div className="w-full lg:w-auto flex flex-col gap-2">
                          <textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            rows={2}
                            className="w-full lg:w-48 border border-gray-300 dark:border-gray-600 rounded-lg p-2 resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs sm:text-sm"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => handleSaveNotes(q.questionId)}
                              className="px-3 py-1.5 bg-gradient-to-r from-green-600 to-teal-600 hover:shadow-md text-white text-xs sm:text-sm font-medium rounded-lg transition-all"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingNotesId(null);
                                setNotesDraft("");
                              }}
                              className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-xs sm:text-sm font-medium rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingNotesId(q.questionId);
                              setNotesDraft(q.notes || "");
                            }}
                            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap"
                          >
                            Notes
                          </button>
                          <button
                            onClick={() => handleDelete(q.questionId)}
                            disabled={deletingQuestionId === q.questionId}
                            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm font-medium rounded-lg transition-all whitespace-nowrap"
                          >
                            {deletingQuestionId === q.questionId
                              ? "..."
                              : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, sortedQuestions.length)} of{" "}
                  {sortedQuestions.length}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <span className="px-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>
      <LeetcodeAIBubble
        onQuestionsChanged={fetchQuestions}
        onViewCollection={handleViewCollection}
      />
    </div>
  );
};
