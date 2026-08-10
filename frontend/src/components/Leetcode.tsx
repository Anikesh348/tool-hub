import React, { useState, useEffect, useMemo, useRef } from "react";
import { LeetCodeService } from "../apis/question/question";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Filters from "./Filters";
import { Loader } from "./Loader";
import { useNotification } from "../context/NotificationContext";
import {
  ArrowLeft,
  Bookmark,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Download,
  Home as HomeIcon,
  ListChecks,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { locationPath } from "../utils/authRedirect";
import LeetcodeAIBubble from "./LeetcodeAIBubble";
import CreateSetWizard from "./CreateSetWizard";

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
const PAGE_SIZE = 10;

type ViewKey = "home" | "problems" | "sets" | "tags" | "progress" | "notes" | "bookmarks";

const NAV_ITEMS: { key: ViewKey; label: string; icon: any }[] = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "problems", label: "Problems", icon: ListChecks },
  { key: "sets", label: "AI Sets", icon: Sparkles },
  { key: "tags", label: "Tags", icon: TagIcon },
  { key: "progress", label: "Progress", icon: TrendingUp },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "bookmarks", label: "Bookmarks", icon: Bookmark },
];

const difficultyBadgeClass = (difficulty: string) => {
  switch ((difficulty || "").toLowerCase()) {
    case "easy":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "hard":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
};

const difficultyBarClass = (name: string) => {
  switch (name) {
    case "Easy":
      return "bg-gradient-to-r from-green-500 to-emerald-500";
    case "Medium":
      return "bg-gradient-to-r from-yellow-500 to-amber-500";
    case "Hard":
      return "bg-gradient-to-r from-red-500 to-rose-500";
    default:
      return "bg-gradient-to-r from-blue-500 to-purple-500";
  }
};

export const Leetcode = () => {
  const { authToken, isAuthLoading } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [updatingQuestionId, setUpdatingQuestionId] = useState<string | null>(null);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);
  const [deletingCollection, setDeletingCollection] = useState<string | null>(null);
  const [bookmarkingId, setBookmarkingId] = useState<string | null>(null);

  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>("");

  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [solvedFilter, setSolvedFilter] = useState<string>("all");
  const [tagsOptions, setTagsOptions] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [difficultySort, setDifficultySort] = useState<"none" | "asc" | "desc">("none");
  const [page, setPage] = useState(1);

  // Left-nav app shell: which section is showing, plus where a topic/set
  // drill-down was opened from (so the Problems view can show a "back to
  // Tags / AI Sets" breadcrumb instead of looking like a dead end).
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [drillFrom, setDrillFrom] = useState<"tags" | "sets" | null>(null);
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [renamingSetLabel, setRenamingSetLabel] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [setsMeta, setSetsMeta] = useState<Record<string, { pinned: boolean; description: string }>>({});

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
  const { data: deleteCollectionData, fetchData: deleteCollectionApi } = useApiFetcher();
  const { data: updateNotesData, fetchData: updateNotesApi } = useApiFetcher();
  const { data: bookmarkData, fetchData: bookmarkApi } = useApiFetcher();
  const { data: setsListData, fetchData: fetchSetsListApi } = useApiFetcher();
  const { data: pinData, fetchData: pinSetApi } = useApiFetcher();
  const { data: duplicateData, fetchData: duplicateSetApi } = useApiFetcher();
  const { data: renameData, fetchData: renameSetApi } = useApiFetcher();
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

  const loadSets = () => {
    const { url, options } = LeetCodeService.listSets();
    fetchSetsListApi(url, options);
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
    loadSets();
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
          bookmarked: q?.bookmarked === true,
        }));
        setQuestions(normalized);
      } else if (body.success) {
        const normalized = (body.questions || []).map((q: any) => ({
          ...q,
          questionId: q?.questionId ?? q?._id,
          status: q?.status || "unsolved",
          notes: q?.notes || "",
          bookmarked: q?.bookmarked === true,
        }));
        setQuestions(normalized);
      }
    }
  }, [questionsData, fetchError]);

  useEffect(() => {
    if (setsListData?.body?.items) {
      const map: Record<string, { pinned: boolean; description: string }> = {};
      setsListData.body.items.forEach((item: any) => {
        map[item.label] = { pinned: !!item.pinned, description: item.description || "" };
      });
      setSetsMeta(map);
    }
  }, [setsListData]);

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

  // Bookmark toggle
  const handleToggleBookmark = (questionId: string) => {
    setBookmarkingId(questionId);
    const { url, options } = LeetCodeService.toggleBookmark(questionId);
    bookmarkApi(url, options);
  };

  useEffect(() => {
    if (bookmarkData?.status === 200) {
      fetchQuestions();
      setBookmarkingId(null);
    } else if (bookmarkData?.status && bookmarkData.status !== 200) {
      addNotification("Failed to update bookmark", "error");
      setBookmarkingId(null);
    }
  }, [bookmarkData, addNotification]);

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

  // Delete an entire AI-generated set (all questions sharing its label)
  const handleDeleteCollection = (label: string) => {
    if (
      !window.confirm(
        `Delete the "${label}" set? This removes every question in it from your tracker.`
      )
    )
      return;
    setDeletingCollection(label);
    const { url, options } = LeetCodeService.deleteCollection(label);
    deleteCollectionApi(url, options);
  };

  useEffect(() => {
    if (deleteCollectionData?.status === 200) {
      addNotification("Set deleted successfully!", "success");
      if (selectedCollection === deletingCollection) {
        setSelectedCollection("");
        setActiveView("sets");
        setDrillFrom(null);
      }
      fetchQuestions();
      loadSets();
      setDeletingCollection(null);
    } else if (deleteCollectionData?.status && deleteCollectionData.status !== 200) {
      addNotification("Failed to delete set", "error");
      setDeletingCollection(null);
    }
  }, [deleteCollectionData, addNotification]);

  // Pin / unpin a set
  const handleToggleSetPin = (label: string) => {
    const { url, options } = LeetCodeService.toggleSetPin(label);
    pinSetApi(url, options);
  };

  useEffect(() => {
    if (pinData?.status === 200) {
      loadSets();
    } else if (pinData?.status && pinData.status !== 200) {
      addNotification("Failed to update pin", "error");
    }
  }, [pinData, addNotification]);

  // Duplicate a set
  const handleDuplicateSet = (label: string) => {
    const { url, options } = LeetCodeService.duplicateSet(label);
    duplicateSetApi(url, options);
  };

  useEffect(() => {
    if (duplicateData?.status === 200) {
      const newLabel = duplicateData?.body?.response?.label;
      addNotification(newLabel ? `Duplicated as "${newLabel}"` : "Set duplicated!", "success");
      fetchQuestions();
      loadSets();
    } else if (duplicateData?.status && duplicateData.status !== 200) {
      addNotification("Failed to duplicate set", "error");
    }
  }, [duplicateData, addNotification]);

  // Rename a set (inline editable, like notes editing below)
  const startRenameSet = (label: string) => {
    setRenamingSetLabel(label);
    setRenameDraft(label);
  };

  const commitRenameSet = () => {
    const trimmed = renameDraft.trim();
    if (!renamingSetLabel || !trimmed || trimmed === renamingSetLabel) {
      setRenamingSetLabel(null);
      return;
    }
    const { url, options } = LeetCodeService.updateSet(renamingSetLabel, { name: trimmed });
    renameSetApi(url, options);
  };

  useEffect(() => {
    if (renameData?.status === 200) {
      addNotification("Set renamed!", "success");
      if (selectedCollection === renamingSetLabel) setSelectedCollection(renameDraft.trim());
      setRenamingSetLabel(null);
      fetchQuestions();
      loadSets();
    } else if (renameData?.status && renameData.status !== 200) {
      addNotification("Failed to rename set", "error");
    }
  }, [renameData, addNotification]);

  // Export a set as JSON - purely client-side, no backend involved.
  const handleExportSet = (label: string) => {
    const rows = questions
      .filter((q) => q.collectionLabel === label)
      .map((q) => ({
        title: q.title,
        url: q.url,
        difficulty: q.difficulty,
        tags: q.tags,
        status: q.status,
        notes: q.notes,
      }));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "question-set"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

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

  // Topic counts (with solved-count, used by the Progress view's "top tags"
  // breakdown) and AI-set counts, derived client-side from the questions
  // already loaded - sorted most-popular first so the default view lands on
  // whichever topic has the most problems.
  const topicCounts = useMemo(() => {
    const counts = new Map<string, { count: number; solved: number }>();
    questions.forEach((q) => {
      const isSolved = q.status === "solved" || q.solved === true;
      (q.tags || []).forEach((t: string) => {
        const entry = counts.get(t) || { count: 0, solved: 0 };
        entry.count += 1;
        if (isSolved) entry.solved += 1;
        counts.set(t, entry);
      });
    });
    return Array.from(counts.entries())
      .map(([name, stat]) => ({ name, count: stat.count, solved: stat.solved }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [questions]);

  const setsSummary = useMemo(() => {
    const counts = new Map<string, { count: number; solved: number }>();
    questions.forEach((q) => {
      if (!q.collectionLabel) return;
      const isSolved = q.status === "solved" || q.solved === true;
      const entry = counts.get(q.collectionLabel) || { count: 0, solved: 0 };
      entry.count += 1;
      if (isSolved) entry.solved += 1;
      counts.set(q.collectionLabel, entry);
    });
    return Array.from(counts.entries())
      .map(([name, stat]) => ({
        name,
        count: stat.count,
        solved: stat.solved,
        pinned: setsMeta[name]?.pinned || false,
      }))
      .sort((a, b) => (a.pinned === b.pinned ? a.name.localeCompare(b.name) : a.pinned ? -1 : 1));
  }, [questions, setsMeta]);

  const difficultyBreakdown = useMemo(() => {
    const order = ["Easy", "Medium", "Hard"];
    const stats: Record<string, { total: number; solved: number }> = {
      Easy: { total: 0, solved: 0 },
      Medium: { total: 0, solved: 0 },
      Hard: { total: 0, solved: 0 },
    };
    questions.forEach((q) => {
      const label = (q.difficulty || "").charAt(0).toUpperCase() + (q.difficulty || "").slice(1).toLowerCase();
      if (!stats[label]) return;
      stats[label].total += 1;
      if (q.status === "solved" || q.solved === true) stats[label].solved += 1;
    });
    return order.map((name) => ({ name, ...stats[name] }));
  }, [questions]);

  // Default to the most common topic (e.g. "Array") the first time questions
  // load, like leetcode.com's own tag pages - but only once, so it doesn't
  // fight the user's own topic pick on later refetches.
  useEffect(() => {
    if (topicDefaultSetRef.current || questions.length === 0) return;
    topicDefaultSetRef.current = true;
    if (topicCounts.length > 0) setSelectedTopic(topicCounts[0].name);
  }, [questions, topicCounts]);

  // Left-nav navigation: switching sections resets any topic/set drill-down
  // so "Problems" always means "everything" and stale filters don't linger.
  const goToView = (view: ViewKey) => {
    setActiveView(view);
    setSelectedTopic("");
    setSelectedCollection("");
    setDrillFrom(null);
  };

  // Home's own compact pill row - filters the table right there, no navigation.
  const handleSelectTopic = (topic: string) => {
    setSelectedTopic(topic);
    setSelectedCollection("");
    setDrillFrom(null);
  };

  // Tags / AI Sets grid pages - clicking a tile drills into the Problems view.
  const handleOpenTag = (topic: string) => {
    setSelectedTopic(topic);
    setSelectedCollection("");
    setDrillFrom("tags");
    setActiveView("problems");
  };

  const handleOpenSet = (label: string) => {
    setSelectedCollection(label);
    setSelectedTopic("");
    setDrillFrom("sets");
    setActiveView("problems");
  };

  const backFromDrill = () => {
    setActiveView(drillFrom || "home");
    setSelectedTopic("");
    setSelectedCollection("");
    setDrillFrom(null);
  };

  const handleViewCollection = (label: string) => {
    handleOpenSet(label);
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
    if (activeView === "notes" && !(q.notes && q.notes.trim())) return false;
    if (activeView === "bookmarks" && !q.bookmarked) return false;
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
    activeView,
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

  const listTitle =
    activeView === "notes"
      ? "Notes"
      : activeView === "bookmarks"
      ? "Bookmarks"
      : drillFrom
      ? selectedTopic || selectedCollection
      : "All Problems";

  const listSubtitle =
    activeView === "notes"
      ? "Questions with notes attached"
      : activeView === "bookmarks"
      ? "Your starred questions"
      : `${sortedQuestions.length} problem${sortedQuestions.length === 1 ? "" : "s"}`;

  // Metric cards + filters + the paginated question list/pagination footer -
  // shared by Home, Problems, Notes and Bookmarks so the (fairly large)
  // mobile/desktop row markup only lives in one place.
  const renderFiltersAndTable = (showHeading: boolean) => (
    <>
      {showHeading && (
        <div className="mb-4">
          {drillFrom && (
            <button
              onClick={backFromDrill}
              className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {drillFrom === "tags" ? "Tags" : "AI Question Sets"}
            </button>
          )}
          <h2 className="text-xl font-bold text-white">{listTitle}</h2>
          <p className="text-sm text-slate-500">{listSubtitle}</p>
        </div>
      )}

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

      <div id="question-library" className="tool-workspace-card scroll-mt-24 p-4 sm:p-6 lg:p-8">
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
              {activeView === "notes"
                ? "No questions have notes yet."
                : activeView === "bookmarks"
                ? "Nothing bookmarked yet - use the bookmark icon on any question."
                : "No questions found. Try adjusting filters or add new questions."}
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
                        {q.title !== undefined && q.title !== "" ? q.title : q.url}
                      </a>
                      <button
                        onClick={() => handleToggleBookmark(q.questionId)}
                        disabled={bookmarkingId === q.questionId}
                        aria-label={q.bookmarked ? "Remove bookmark" : "Bookmark this question"}
                        className={`shrink-0 rounded-lg p-1 transition-colors ${
                          q.bookmarked ? "text-amber-400" : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        <Bookmark className={`h-4 w-4 ${q.bookmarked ? "fill-amber-400" : ""}`} />
                      </button>
                    </div>
                    {q.notes && editingNotesId !== q.questionId && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 italic pl-9 truncate">
                        {q.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {q.difficulty && (
                      <span className={`px-2 py-1 rounded-full text-xs font-bold inline-block flex-shrink-0 ${difficultyBadgeClass(q.difficulty)}`}>
                        {q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}
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
                        {deletingQuestionId === q.questionId ? "..." : "Delete"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Desktop View - Side by side */}
                <div className="hidden sm:flex sm:flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm">
                      {(currentPage - 1) * PAGE_SIZE + idx + 1}
                    </div>
                    <button
                      onClick={() => handleToggleBookmark(q.questionId)}
                      disabled={bookmarkingId === q.questionId}
                      aria-label={q.bookmarked ? "Remove bookmark" : "Bookmark this question"}
                      className={`shrink-0 rounded-lg p-1 mt-0.5 transition-colors ${
                        q.bookmarked ? "text-amber-400" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      <Bookmark className={`h-4 w-4 ${q.bookmarked ? "fill-amber-400" : ""}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <a
                        href={q.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm lg:text-base font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors break-words"
                      >
                        {q.title !== undefined && q.title !== "" ? q.title : q.url}
                      </a>
                      {q.notes && editingNotesId !== q.questionId && (
                        <p className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 italic">
                          {q.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    {q.difficulty && (
                      <span className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-bold inline-block flex-shrink-0 ${difficultyBadgeClass(q.difficulty)}`}>
                        {q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}
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
                        {updatingQuestionId === q.questionId ? "..." : "Solved"}
                      </span>
                    </label>
                  </div>

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
                          {deletingQuestionId === q.questionId ? "..." : "Delete"}
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
    </>
  );

  const visibleTopics = topicsExpanded ? topicCounts : topicCounts.slice(0, 6);

  const renderHome = () => (
    <>
      <header className="mb-5 max-w-3xl">
        <p className="tool-workspace-kicker">Coding workspace</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          LeetCode Manager
        </h1>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl">
          Keep your problem list, progress, tags, and notes in one focused view.
        </p>
      </header>

      <div id="add-questions" className="tool-workspace-card scroll-mt-24 mb-5 overflow-hidden">
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
                {urls.split(/\n|,/).filter((u) => u.trim().length > 0).length > 0 && (
                  <span>{urls.split(/\n|,/).filter((u) => u.trim().length > 0).length} URL(s)</span>
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

      {topicCounts.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
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
          {visibleTopics.map((topic) => (
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
          {topicCounts.length > 6 && (
            <button
              onClick={() => setTopicsExpanded((v) => !v)}
              className="shrink-0 flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-400 hover:text-white"
            >
              {topicsExpanded ? "Less" : "More"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${topicsExpanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}

      <div className="tool-workspace-card p-4 sm:p-6 mb-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="tool-workspace-icon shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">AI Question Sets</h2>
              <p className="text-xs text-slate-500">Quick access to your AI generated collections</p>
            </div>
          </div>
          {setsSummary.length > 0 && (
            <button
              onClick={() => goToView("sets")}
              className="flex shrink-0 items-center gap-1 text-xs sm:text-sm font-semibold text-blue-400 hover:text-blue-300"
            >
              View all ({setsSummary.length}) <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {setsSummary.length === 0 ? (
          <button
            onClick={() => setWizardOpen(true)}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-8 text-center text-slate-400 hover:bg-white/[0.03] hover:text-white transition-colors"
          >
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-semibold">Generate your first AI question set</span>
          </button>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {setsSummary.slice(0, 4).map((set) => {
              const pct = set.count ? Math.round((set.solved / set.count) * 100) : 0;
              return (
                <button
                  key={set.name}
                  onClick={() => handleOpenSet(set.name)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06] transition-colors"
                >
                  <p className="mb-1 flex items-center gap-1.5 truncate text-sm font-bold text-white">
                    {set.pinned && <Pin className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
                    <span className="truncate">{set.name}</span>
                  </p>
                  <p className="mb-3 text-xs text-slate-500">{set.count} questions · {set.solved} solved</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-right text-[10px] text-slate-600">{pct}%</p>
                </button>
              );
            })}
            {setsSummary.length > 4 && (
              <button
                onClick={() => goToView("sets")}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 p-4 text-center text-slate-400 hover:bg-white/[0.03] hover:text-white transition-colors"
              >
                <span className="text-sm font-bold">+{setsSummary.length - 4} more sets</span>
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  View all <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            )}
          </div>
        )}
      </div>

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

      {renderFiltersAndTable(false)}
    </>
  );

  const renderSets = () => (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">AI Question Sets</h2>
          <p className="text-sm text-slate-500">
            {setsSummary.length} set{setsSummary.length === 1 ? "" : "s"} curated by the AI assistant
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2.5 text-sm font-bold text-white transition hover:from-blue-700 hover:to-purple-700"
        >
          <Sparkles className="h-4 w-4" /> Generate New Set
        </button>
      </div>

      {setsSummary.length === 0 ? (
        <div className="tool-workspace-card flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Sparkles className="h-8 w-8 text-slate-500" />
          <p className="text-sm text-slate-400">No AI question sets yet.</p>
          <button
            onClick={() => setWizardOpen(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-bold text-white hover:from-blue-700 hover:to-purple-700"
          >
            Generate your first set
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {setsSummary.map((set) => {
            const pct = set.count ? Math.round((set.solved / set.count) * 100) : 0;
            return (
              <div key={set.name} className="glass-card rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                {renamingSetLabel === set.name ? (
                  <div className="mb-3 flex items-center gap-1.5">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenameSet();
                        if (e.key === "Escape") setRenamingSetLabel(null);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-blue-500/60"
                    />
                    <button onClick={commitRenameSet} className="shrink-0 rounded-lg p-1.5 text-emerald-400 hover:bg-white/5">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setRenamingSetLabel(null)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/5">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => handleOpenSet(set.name)} className="mb-3 block w-full text-left">
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-white">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate">{set.name}</span>
                      {set.pinned && <Pin className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
                    </p>
                    <p className="mb-2 text-xs text-slate-500">{set.count} questions · {set.solved} solved</p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-slate-600">{pct}%</p>
                  </button>
                )}
                <div className="flex items-center gap-1 border-t border-white/5 pt-3">
                  <button
                    title={set.pinned ? "Unpin" : "Pin"}
                    onClick={() => handleToggleSetPin(set.name)}
                    className={`rounded-lg p-1.5 transition-colors ${set.pinned ? "text-amber-400" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"}`}
                  >
                    <Pin className={`h-3.5 w-3.5 ${set.pinned ? "fill-amber-400" : ""}`} />
                  </button>
                  <button title="Rename" onClick={() => startRenameSet(set.name)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button title="Duplicate" onClick={() => handleDuplicateSet(set.name)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button title="Export" onClick={() => handleExportSet(set.name)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Delete"
                    onClick={() => handleDeleteCollection(set.name)}
                    disabled={deletingCollection === set.name}
                    className="ml-auto rounded-lg p-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const renderTags = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">Browse by Tag</h2>
        <p className="text-sm text-slate-500">
          {topicCounts.length} tag{topicCounts.length === 1 ? "" : "s"} across {questions.length} problems
        </p>
      </div>
      {topicCounts.length === 0 ? (
        <div className="tool-workspace-card py-16 text-center text-sm text-slate-500">
          Add some questions to see tags here.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {topicCounts.map((topic) => {
            const pct = topic.count ? Math.round((topic.solved / topic.count) * 100) : 0;
            return (
              <button
                key={topic.name}
                onClick={() => handleOpenTag(topic.name)}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06] transition-colors"
              >
                <p className="truncate text-sm font-bold text-white">{topic.name}</p>
                <p className="text-xs text-slate-500">{topic.count} problems · {pct}% solved</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const renderProgress = () => (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">Your Progress</h2>
        <p className="text-sm text-slate-500">A breakdown of what you've solved so far</p>
      </div>

      <div className="tool-metric-grid mb-6">
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

      <div className="tool-workspace-card mb-6 p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-bold text-white">By difficulty</h3>
        <div className="space-y-4">
          {difficultyBreakdown.map((d) => (
            <div key={d.name}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-semibold text-slate-300">{d.name}</span>
                <span className="text-slate-500">{d.solved}/{d.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full ${difficultyBarClass(d.name)}`}
                  style={{ width: `${d.total ? (d.solved / d.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {topicCounts.length > 0 && (
        <div className="tool-workspace-card p-5 sm:p-6">
          <h3 className="mb-4 text-sm font-bold text-white">Top tags</h3>
          <div className="space-y-4">
            {topicCounts.slice(0, 8).map((t) => (
              <div key={t.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold text-slate-300">{t.name}</span>
                  <span className="text-slate-500">{t.solved}/{t.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                    style={{ width: `${t.count ? (t.solved / t.count) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // Drilling into a specific tag/set (handleOpenTag/handleOpenSet) always
  // switches activeView to "problems" with drillFrom set - so "sets"/"tags"
  // here only ever render their grid, never the filtered table.
  const renderMain = () => {
    switch (activeView) {
      case "home":
        return renderHome();
      case "sets":
        return renderSets();
      case "tags":
        return renderTags();
      case "progress":
        return renderProgress();
      case "problems":
      case "notes":
      case "bookmarks":
      default:
        return renderFiltersAndTable(true);
    }
  };

  return (
    <div className="portal-page leetcode-workspace min-h-screen w-full transition-colors duration-300">
      <div className="flex min-h-screen pt-16">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/10 bg-white/[0.02] px-3 py-6 lg:flex">
          <div className="mb-4 px-3">
            <p className="tool-workspace-kicker">Coding workspace</p>
            <h1 className="text-lg font-extrabold leading-tight text-white">LeetCode Manager</h1>
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => goToView(item.key)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "border border-blue-500/30 bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 flex-1">
          <div className="sticky top-16 z-10 flex gap-2 overflow-x-auto border-b border-white/10 bg-[#0b0e16]/95 px-4 py-3 backdrop-blur lg:hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => goToView(item.key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                      : "border border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="toolhub-desktop-container max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            {renderMain()}
          </div>
        </div>
      </div>

      <LeetcodeAIBubble onQuestionsChanged={fetchQuestions} onViewCollection={handleViewCollection} />

      <CreateSetWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        topicOptions={topicCounts.map((t) => t.name)}
        onCreated={(label) => {
          fetchQuestions();
          loadSets();
          handleOpenSet(label);
        }}
      />
    </div>
  );
};
