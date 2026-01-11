import { create } from "zustand";

interface File {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
}

interface Project {
  id: string;
  name: string;
  ownerId: string;
  files: File[];
}

interface ProjectState {
  currentProject: Project | null;
  openFiles: string[]; // file paths
  activeFile: string | null;

  setCurrentProject: (project: Project | null) => void;
  setFiles: (files: File[]) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
}

const STORAGE_KEY = "openleaf-project-state";

// Store open files per project
function getStoredState(projectId: string): {
  openFiles: string[];
  activeFile: string | null;
} {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY}-${projectId}`);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return { openFiles: [], activeFile: null };
}

function saveState(
  projectId: string,
  openFiles: string[],
  activeFile: string | null,
) {
  try {
    localStorage.setItem(
      `${STORAGE_KEY}-${projectId}`,
      JSON.stringify({ openFiles, activeFile }),
    );
  } catch {
    // Ignore errors
  }
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  openFiles: [],
  activeFile: null,

  setCurrentProject: (project) => {
    if (project) {
      // Restore open files for this project
      const stored = getStoredState(project.id);
      set({
        currentProject: project,
        openFiles: stored.openFiles,
        activeFile: stored.activeFile,
      });
    } else {
      set({ currentProject: project, openFiles: [], activeFile: null });
    }
  },

  setFiles: (files) => {
    set((state) => {
      if (!state.currentProject) return { currentProject: null };

      // Filter out any open files that no longer exist
      const existingPaths = new Set(files.map((f) => f.path));
      const validOpenFiles = state.openFiles.filter((path) =>
        existingPaths.has(path),
      );
      const validActiveFile =
        state.activeFile && existingPaths.has(state.activeFile)
          ? state.activeFile
          : null;

      // Save to localStorage
      saveState(state.currentProject.id, validOpenFiles, validActiveFile);

      return {
        currentProject: { ...state.currentProject, files },
        openFiles: validOpenFiles,
        activeFile: validActiveFile,
      };
    });
  },

  openFile: (path) => {
    set((state) => {
      let newOpenFiles = state.openFiles;
      const newActiveFile = path;

      if (!state.openFiles.includes(path)) {
        newOpenFiles = [...state.openFiles, path];
      }

      // Save to localStorage
      if (state.currentProject) {
        saveState(state.currentProject.id, newOpenFiles, newActiveFile);
      }

      return {
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
    });
  },

  closeFile: (path) => {
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f !== path);
      const newActiveFile =
        state.activeFile === path
          ? newOpenFiles[newOpenFiles.length - 1] || null
          : state.activeFile;

      // Save to localStorage
      if (state.currentProject) {
        saveState(state.currentProject.id, newOpenFiles, newActiveFile);
      }

      return { openFiles: newOpenFiles, activeFile: newActiveFile };
    });
  },

  setActiveFile: (path) => {
    set((state) => {
      // Save to localStorage
      if (state.currentProject) {
        saveState(state.currentProject.id, state.openFiles, path);
      }
      return { activeFile: path };
    });
  },
}));
