import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Check, Trash2, Send } from "lucide-react";
import { commentsApi, Comment } from "../../api/client";
import { useCommentsStore } from "../../stores/commentsStore";
import { useProjectStore } from "../../stores/projectStore";

interface CommentsPanelProps {
  projectId: string;
}

export default function CommentsPanel({ projectId }: CommentsPanelProps) {
  const queryClient = useQueryClient();
  const { activeFile } = useProjectStore();
  const {
    comments,
    setComments,
    selectedCommentId,
    selectComment,
    isAddingComment,
    setAddingComment,
    pendingSelection,
    setPendingSelection,
    addComment,
    removeComment,
    updateComment,
  } = useCommentsStore();

  const [newCommentText, setNewCommentText] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  // Fetch comments for current file
  const { data: commentsData } = useQuery({
    queryKey: ["comments", projectId, activeFile],
    queryFn: () =>
      activeFile
        ? commentsApi.listFile(projectId, activeFile)
        : commentsApi.listProject(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (commentsData?.comments) {
      setComments(commentsData.comments);
    }
  }, [commentsData, setComments]);

  const createMutation = useMutation({
    mutationFn: (params: {
      content: string;
      lineStart: number;
      lineEnd: number;
    }) =>
      commentsApi.create(
        projectId,
        activeFile!,
        params.content,
        params.lineStart,
        params.lineEnd,
      ),
    onSuccess: (comment) => {
      addComment(comment);
      setNewCommentText("");
      setAddingComment(false);
      setPendingSelection(null);
      queryClient.invalidateQueries({ queryKey: ["comments", projectId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => commentsApi.resolve(id),
    onSuccess: (comment) => {
      updateComment(comment.id, { resolved: true });
      queryClient.invalidateQueries({ queryKey: ["comments", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => commentsApi.delete(id),
    onSuccess: (_, id) => {
      removeComment(id);
      queryClient.invalidateQueries({ queryKey: ["comments", projectId] });
    },
  });

  const handleSubmitComment = () => {
    if (!newCommentText.trim() || !pendingSelection || !activeFile) return;
    createMutation.mutate({
      content: newCommentText,
      lineStart: pendingSelection.lineStart,
      lineEnd: pendingSelection.lineEnd,
    });
  };

  const filteredComments = comments.filter((c) => {
    if (filter === "open") return !c.resolved;
    if (filter === "resolved") return c.resolved;
    return true;
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <MessageSquare className="w-4 h-4" />
            Comments
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filteredComments.length} comment
            {filteredComments.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(["all", "open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-xs rounded ${
                filter === f
                  ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Add comment form */}
      {isAddingComment && pendingSelection && (
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Line
            {pendingSelection.lineStart !== pendingSelection.lineEnd
              ? "s"
              : ""}{" "}
            {pendingSelection.lineStart}
            {pendingSelection.lineStart !== pendingSelection.lineEnd &&
              `-${pendingSelection.lineEnd}`}
          </div>
          <textarea
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                setAddingComment(false);
                setPendingSelection(null);
                setNewCommentText("");
              }}
              className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitComment}
              disabled={!newCommentText.trim() || createMutation.isPending}
              className="px-2 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              Add
            </button>
          </div>
        </div>
      )}

      {/* Comments list */}
      <div className="flex-1 overflow-auto">
        {filteredComments.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
            {activeFile
              ? "No comments on this file. Select text and press Ctrl+M to add a comment."
              : "Select a file to view comments."}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filteredComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                isSelected={comment.id === selectedCommentId}
                onSelect={() => selectComment(comment.id)}
                onResolve={() => resolveMutation.mutate(comment.id)}
                onDelete={() => deleteMutation.mutate(comment.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  isSelected: boolean;
  onSelect: () => void;
  onResolve: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

function CommentItem({
  comment,
  isSelected,
  onSelect,
  onResolve,
  onDelete,
  formatDate,
}: CommentItemProps) {
  return (
    <div
      className={`p-3 cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary-50 dark:bg-primary-900/20"
          : "hover:bg-gray-50 dark:hover:bg-gray-700"
      } ${comment.resolved ? "opacity-60" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate text-gray-900 dark:text-gray-100">
              {comment.author_name}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {formatDate(comment.created_at)}
            </span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            Line{comment.line_start !== comment.line_end ? "s" : ""}{" "}
            {comment.line_start}
            {comment.line_start !== comment.line_end && `-${comment.line_end}`}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
            {comment.content}
          </p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!comment.resolved && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              className="p-1 text-gray-400 hover:text-green-600 dark:hover:text-green-400 rounded"
              title="Resolve"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {comment.resolved && (
        <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <Check className="w-3 h-3" />
          Resolved
        </div>
      )}
    </div>
  );
}
