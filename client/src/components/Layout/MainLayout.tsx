import { useEffect, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeft,
  Play,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  Share2,
  Save,
} from "lucide-react";
import { projectsApi, filesApi, compileApi } from "../../api/client";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import FileTree from "../FileTree/FileTree";
import Editor from "../Editor/Editor";
import EditorTabs from "../Editor/EditorTabs";
import PDFViewer from "../PDFViewer/PDFViewer";
import CommentsPanel from "../Comments/CommentsPanel";
import ShareDialog from "../Share/ShareDialog";

const PANEL_STORAGE_KEY = "openleaf-panel-sizes";

interface PanelSizes {
  fileTree: number;
  editor: number;
  pdf: number;
}

function loadPanelSizes(): PanelSizes {
  try {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore errors
  }
  return { fileTree: 15, editor: 45, pdf: 40 };
}

function savePanelSizes(sizes: PanelSizes) {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Ignore errors
  }
}

export default function MainLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { setCurrentProject, setFiles, activeFile, currentProject } =
    useProjectStore();
  const {
    isCompiling,
    isSaving,
    setCompiling,
    setSaving,
    setCompileResult,
    compileErrors,
    getFileContent,
    markFileSaved,
    isFileDirty,
    restorePdfUrl,
  } = useEditorStore();

  const [panelSizes, setPanelSizes] = useState<PanelSizes>(loadPanelSizes);
  const [showFileTree, setShowFileTree] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const { data: projectData } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: filesData } = useQuery({
    queryKey: ["files", projectId],
    queryFn: () => filesApi.list(projectId!),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (projectData) {
      setCurrentProject({
        id: projectData.id,
        name: projectData.name,
        ownerId: projectData.owner_id,
        files: [],
      });
      // Restore PDF URL for this project
      restorePdfUrl(projectData.id);
    }
  }, [projectData, setCurrentProject, restorePdfUrl]);

  useEffect(() => {
    if (filesData?.files) {
      setFiles(
        filesData.files.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          isFolder: f.is_folder,
        })),
      );
    }
  }, [filesData, setFiles]);

  const handleCompile = async () => {
    if (!projectId) return;

    setCompiling(true);
    try {
      const result = await compileApi.compile(projectId);
      setCompileResult(
        result.success,
        result.pdf_url,
        result.errors,
        result.warnings,
        projectId,
      );
    } catch {
      setCompileResult(
        false,
        null,
        [{ file: "", line: null, message: "Compilation failed" }],
        [],
        projectId,
      );
    }
  };

  const handleSave = async () => {
    if (!activeFile || !currentProject) return;

    const content = getFileContent(activeFile);
    if (content === undefined) return;

    const file = currentProject.files.find((f) => f.path === activeFile);
    if (!file) return;

    setSaving(true);
    try {
      await filesApi.updateContent(file.id, content);
      markFileSaved(activeFile);
    } catch (error) {
      console.error("Failed to save file:", error);
    } finally {
      setSaving(false);
    }
  };

  const activeFileDirty = activeFile ? isFileDirty(activeFile) : false;

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      const newSizes = showFileTree
        ? { fileTree: sizes[0], editor: sizes[1], pdf: sizes[2] }
        : { ...panelSizes, editor: sizes[0], pdf: sizes[1] };
      setPanelSizes(newSizes);
      savePanelSizes(newSizes);
    },
    [showFileTree, panelSizes],
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowFileTree(!showFileTree)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title={showFileTree ? "Hide file tree" : "Show file tree"}
          >
            {showFileTree ? (
              <PanelLeftClose className="w-5 h-5" />
            ) : (
              <PanelLeft className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={() => navigate("/projects")}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Projects
          </button>
          <span className="text-lg font-medium">
            {projectData?.name || "Loading..."}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {compileErrors.length > 0 && (
            <span className="text-sm text-red-600">
              {compileErrors.length} error
              {compileErrors.length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving || !activeFileDirty}
            className={`flex items-center gap-2 px-4 py-1.5 rounded border ${
              activeFileDirty
                ? "bg-white border-primary-600 text-primary-600 hover:bg-primary-50"
                : "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
            } disabled:opacity-50`}
            title={
              activeFileDirty ? "Save file (Ctrl+S)" : "No changes to save"
            }
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleCompile}
            disabled={isCompiling}
            className="flex items-center gap-2 px-4 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {isCompiling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isCompiling ? "Compiling..." : "Compile"}
          </button>
          <button
            onClick={() => setShowComments(!showComments)}
            className={`p-1.5 rounded hover:bg-gray-100 ${showComments ? "text-primary-600 bg-primary-50" : "text-gray-600"}`}
            title={showComments ? "Hide comments" : "Show comments"}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowShareDialog(true)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="Share project"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" onLayout={handlePanelResize}>
          {/* File tree */}
          {showFileTree && (
            <>
              <Panel
                defaultSize={panelSizes.fileTree}
                minSize={10}
                maxSize={30}
              >
                <div className="h-full bg-gray-50 border-r border-gray-200 overflow-auto">
                  <FileTree />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-primary-500 transition-colors" />
            </>
          )}

          {/* Editor with tabs */}
          <Panel
            defaultSize={
              showFileTree
                ? panelSizes.editor
                : panelSizes.editor + panelSizes.fileTree
            }
            minSize={20}
          >
            <div className="h-full flex flex-col">
              <EditorTabs />
              <div className="flex-1 overflow-hidden">
                {activeFile ? (
                  <Editor filePath={activeFile} />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    Select a file to edit
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-primary-500 transition-colors" />

          {/* PDF viewer */}
          <Panel defaultSize={panelSizes.pdf} minSize={20}>
            <div className="h-full bg-gray-100">
              <PDFViewer />
            </div>
          </Panel>

          {/* Comments panel */}
          {showComments && projectId && (
            <>
              <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-primary-500 transition-colors" />
              <Panel defaultSize={20} minSize={15} maxSize={35}>
                <div className="h-full border-l border-gray-200">
                  <CommentsPanel projectId={projectId} />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Share Dialog */}
      {projectId && projectData && (
        <ShareDialog
          projectId={projectId}
          projectOwnerId={projectData.owner_id}
          isOpen={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  );
}
