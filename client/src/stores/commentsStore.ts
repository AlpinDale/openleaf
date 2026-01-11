import { create } from "zustand";
import type { Comment } from "../api/client";

interface CommentsState {
  comments: Comment[];
  selectedCommentId: string | null;
  isAddingComment: boolean;
  pendingSelection: { lineStart: number; lineEnd: number } | null;

  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  removeComment: (id: string) => void;
  updateComment: (id: string, updates: Partial<Comment>) => void;
  selectComment: (id: string | null) => void;
  setAddingComment: (isAdding: boolean) => void;
  setPendingSelection: (
    selection: { lineStart: number; lineEnd: number } | null,
  ) => void;
}

export const useCommentsStore = create<CommentsState>((set) => ({
  comments: [],
  selectedCommentId: null,
  isAddingComment: false,
  pendingSelection: null,

  setComments: (comments) => set({ comments }),

  addComment: (comment) =>
    set((state) => ({
      comments: [comment, ...state.comments],
    })),

  removeComment: (id) =>
    set((state) => ({
      comments: state.comments.filter((c) => c.id !== id),
      selectedCommentId:
        state.selectedCommentId === id ? null : state.selectedCommentId,
    })),

  updateComment: (id, updates) =>
    set((state) => ({
      comments: state.comments.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      ),
    })),

  selectComment: (id) => set({ selectedCommentId: id }),

  setAddingComment: (isAdding) => set({ isAddingComment: isAdding }),

  setPendingSelection: (selection) => set({ pendingSelection: selection }),
}));
