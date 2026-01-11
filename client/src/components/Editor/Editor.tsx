import { useEffect, useRef, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap, Decoration, DecorationSet } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { StateField, StateEffect } from "@codemirror/state";
import { useQuery } from "@tanstack/react-query";
import { useCommentsStore } from "../../stores/commentsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { filesApi } from "../../api/client";

interface EditorProps {
  filePath: string;
}

// Effect to set comment highlights
const setHighlights =
  StateEffect.define<{ from: number; to: number; id: string }[]>();

// Comment highlight decoration
const highlightMark = Decoration.mark({ class: "cm-comment-highlight" });

// State field to track highlights
const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(highlights, tr) {
    highlights = highlights.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlights)) {
        const decorations = effect.value.map(({ from, to }) =>
          highlightMark.range(from, to),
        );
        highlights = Decoration.set(decorations, true);
      }
    }
    return highlights;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export default function Editor({ filePath }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { setAddingComment, setPendingSelection, comments, selectedCommentId } =
    useCommentsStore();
  const { setFileContent, getFileContent, markFileSaved, setSaving } =
    useEditorStore();
  const { currentProject } = useProjectStore();

  // Find the file ID from the current project
  const file = currentProject?.files.find((f) => f.path === filePath);
  const fileId = file?.id;

  // Fetch file content
  const { data: fileContentData, isLoading } = useQuery({
    queryKey: ["fileContent", fileId],
    queryFn: () => filesApi.getContent(fileId!),
    enabled: !!fileId,
  });

  // Store the original content when loaded
  useEffect(() => {
    if (fileContentData?.content !== undefined) {
      setFileContent(filePath, fileContentData.content, true);
    }
  }, [fileContentData, filePath, setFileContent]);

  const handleSave = useCallback(async () => {
    if (!fileId) return;

    const content = getFileContent(filePath);
    if (content === undefined) return;

    setSaving(true);
    try {
      await filesApi.updateContent(fileId, content);
      markFileSaved(filePath);
    } catch (error) {
      console.error("Failed to save file:", error);
    } finally {
      setSaving(false);
    }
  }, [fileId, filePath, getFileContent, markFileSaved, setSaving]);

  const handleAddComment = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const selection = view.state.selection.main;
    if (selection.empty) return;

    const doc = view.state.doc;
    const lineStart = doc.lineAt(selection.from).number;
    const lineEnd = doc.lineAt(selection.to).number;

    setPendingSelection({ lineStart, lineEnd });
    setAddingComment(true);
  }, [setAddingComment, setPendingSelection]);

  // Get content from store or use loaded data
  const content = getFileContent(filePath) ?? fileContentData?.content ?? "";

  useEffect(() => {
    if (!containerRef.current || isLoading) return;

    // Clean up previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: "Mod-s",
            run: () => {
              handleSave();
              return true;
            },
          },
          {
            key: "Mod-m",
            run: () => {
              handleAddComment();
              return true;
            },
          },
        ]),
        StreamLanguage.define(stex),
        highlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setFileContent(filePath, update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": {
            height: "100%",
          },
          ".cm-scroller": {
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: "14px",
          },
          ".cm-comment-highlight": {
            backgroundColor: "rgba(255, 220, 100, 0.3)",
            borderBottom: "2px solid rgba(255, 180, 0, 0.6)",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [filePath, isLoading, fileContentData]); // Recreate editor when file changes or content loads

  // Update highlights when comments change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const doc = view.state.doc;
    const highlights: { from: number; to: number; id: string }[] = [];

    for (const comment of comments) {
      if (comment.resolved) continue;

      try {
        const fromLine = doc.line(Math.min(comment.line_start, doc.lines));
        const toLine = doc.line(Math.min(comment.line_end, doc.lines));
        highlights.push({
          from: fromLine.from,
          to: toLine.to,
          id: comment.id,
        });
      } catch {
        // Line may not exist
      }
    }

    view.dispatch({
      effects: setHighlights.of(highlights),
    });
  }, [comments]);

  // Scroll to selected comment
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectedCommentId) return;

    const comment = comments.find((c) => c.id === selectedCommentId);
    if (!comment) return;

    try {
      const line = view.state.doc.line(comment.line_start);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
    } catch {
      // Line may not exist
    }
  }, [selectedCommentId, comments]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500">
        Loading file...
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
