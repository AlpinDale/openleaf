import { create } from "zustand";

interface CompileError {
  file: string;
  line: number | null;
  message: string;
}

interface CompileWarning {
  file: string;
  line: number | null;
  message: string;
}

interface FileContent {
  content: string;
  originalContent: string;
  isDirty: boolean;
}

interface EditorState {
  isCompiling: boolean;
  isSaving: boolean;
  pdfUrl: string | null;
  compileErrors: CompileError[];
  compileWarnings: CompileWarning[];
  fileContents: Record<string, FileContent>;

  setCompiling: (isCompiling: boolean) => void;
  setSaving: (isSaving: boolean) => void;
  setCompileResult: (
    success: boolean,
    pdfUrl: string | null,
    errors: CompileError[],
    warnings: CompileWarning[],
    projectId?: string,
  ) => void;
  clearCompileResult: () => void;
  setFileContent: (
    filePath: string,
    content: string,
    isOriginal?: boolean,
  ) => void;
  markFileSaved: (filePath: string) => void;
  getFileContent: (filePath: string) => string | undefined;
  isFileDirty: (filePath: string) => boolean;
  hasUnsavedChanges: () => boolean;
  restorePdfUrl: (projectId: string) => void;
}

const PDF_STORAGE_KEY = "openleaf-pdf-url";

function getStoredPdfUrl(projectId: string): string | null {
  try {
    const stored = localStorage.getItem(`${PDF_STORAGE_KEY}-${projectId}`);
    return stored;
  } catch {
    return null;
  }
}

function savePdfUrl(projectId: string, pdfUrl: string | null) {
  try {
    if (pdfUrl) {
      localStorage.setItem(`${PDF_STORAGE_KEY}-${projectId}`, pdfUrl);
    } else {
      localStorage.removeItem(`${PDF_STORAGE_KEY}-${projectId}`);
    }
  } catch {
    // Ignore errors
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  isCompiling: false,
  isSaving: false,
  pdfUrl: null,
  compileErrors: [],
  compileWarnings: [],
  fileContents: {},

  setCompiling: (isCompiling) => {
    set({ isCompiling });
  },

  setSaving: (isSaving) => {
    set({ isSaving });
  },

  setCompileResult: (success, pdfUrl, errors, warnings, projectId) => {
    const newPdfUrl = success ? pdfUrl : null;
    // Save PDF URL to localStorage if we have a projectId
    if (projectId) {
      savePdfUrl(projectId, newPdfUrl);
    }
    set({
      isCompiling: false,
      pdfUrl: newPdfUrl,
      compileErrors: errors,
      compileWarnings: warnings,
    });
  },

  clearCompileResult: () => {
    set({
      pdfUrl: null,
      compileErrors: [],
      compileWarnings: [],
    });
  },

  setFileContent: (filePath, content, isOriginal = false) => {
    set((state) => {
      const existing = state.fileContents[filePath];
      if (isOriginal) {
        return {
          fileContents: {
            ...state.fileContents,
            [filePath]: {
              content,
              originalContent: content,
              isDirty: false,
            },
          },
        };
      }
      return {
        fileContents: {
          ...state.fileContents,
          [filePath]: {
            content,
            originalContent: existing?.originalContent ?? content,
            isDirty: content !== (existing?.originalContent ?? content),
          },
        },
      };
    });
  },

  markFileSaved: (filePath) => {
    set((state) => {
      const existing = state.fileContents[filePath];
      if (!existing) return state;
      return {
        fileContents: {
          ...state.fileContents,
          [filePath]: {
            ...existing,
            originalContent: existing.content,
            isDirty: false,
          },
        },
      };
    });
  },

  getFileContent: (filePath) => {
    return get().fileContents[filePath]?.content;
  },

  isFileDirty: (filePath) => {
    return get().fileContents[filePath]?.isDirty ?? false;
  },

  hasUnsavedChanges: () => {
    return Object.values(get().fileContents).some((f) => f.isDirty);
  },

  restorePdfUrl: (projectId) => {
    const storedUrl = getStoredPdfUrl(projectId);
    if (storedUrl) {
      set({ pdfUrl: storedUrl });
    }
  },
}));
