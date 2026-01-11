import { useState, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  Plus,
  FolderPlus,
  Trash2,
  X,
  Upload,
  Loader2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProjectStore } from "../../stores/projectStore";
import { filesApi } from "../../api/client";

interface TreeNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  children?: TreeNode[];
}

function buildTree(
  files: { id: string; name: string; path: string; isFolder: boolean }[],
): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  // Sort files: folders first, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const file of sortedFiles) {
    const node: TreeNode = {
      id: file.id,
      name: file.name,
      path: file.path,
      isFolder: file.isFolder,
      children: file.isFolder ? [] : undefined,
    };
    map.set(file.path, node);

    const parentPath = file.path.split("/").slice(0, -1).join("/");
    if (parentPath && map.has(parentPath)) {
      map.get(parentPath)!.children!.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

function TreeItem({
  node,
  depth = 0,
  projectId,
  onDelete,
}: {
  node: TreeNode;
  depth?: number;
  projectId: string;
  onDelete: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const { activeFile, openFile } = useProjectStore();
  const isActive = activeFile === node.path;

  const handleClick = () => {
    if (node.isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      openFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-200 group ${
          isActive ? "bg-primary-100 text-primary-700" : ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
            <Folder className="w-4 h-4 text-yellow-500" />
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="w-4 h-4 text-gray-500" />
          </>
        )}
        <span className="text-sm truncate flex-1">{node.name}</span>
        {showActions && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            className="p-0.5 text-gray-400 hover:text-red-500 rounded"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {node.isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              projectId={projectId}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CreateDialogProps {
  type: "file" | "folder";
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateDialog({
  type,
  projectId,
  onClose,
  onSuccess,
}: CreateDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const isFolder = type === "folder";
      return filesApi.create(
        projectId,
        name,
        name,
        isFolder,
        isFolder ? undefined : "",
      );
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      setError(
        "Name can only contain letters, numbers, dots, dashes, and underscores",
      );
      return;
    }
    setError("");
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg p-4 w-80">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">
            New {type === "file" ? "File" : "Folder"}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "file" ? "filename.tex" : "folder-name"}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function FileTree() {
  const { currentProject } = useProjectStore();
  const queryClient = useQueryClient();
  const [createType, setCreateType] = useState<"file" | "folder" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => filesApi.delete(id),
    onSuccess: () => {
      if (currentProject) {
        queryClient.invalidateQueries({
          queryKey: ["files", currentProject.id],
        });
      }
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({ projectId, files }: { projectId: string; files: File[] }) =>
      filesApi.upload(projectId, files),
    onSuccess: (data, variables) => {
      // Use the projectId from the mutation variables to ensure correct invalidation
      queryClient.invalidateQueries({
        queryKey: ["files", variables.projectId],
      });
      if (data.errors.length > 0) {
        alert(`Upload completed with errors:\n${data.errors.join("\n")}`);
      }
    },
    onError: (err: Error) => {
      console.error("Upload failed:", err);
      alert(`Upload failed: ${err.message}`);
    },
  });

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this item?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleCreateSuccess = () => {
    if (currentProject) {
      queryClient.invalidateQueries({ queryKey: ["files", currentProject.id] });
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0 && currentProject) {
      // Copy files to an array before resetting input (FileList is live and gets cleared)
      const files = Array.from(fileList);
      // Reset input first so the same file can be uploaded again
      e.target.value = "";
      // Now upload with the copied array
      uploadMutation.mutate({ projectId: currentProject.id, files });
    }
  };

  if (!currentProject) {
    return <div className="p-4 text-gray-500 text-sm">Loading...</div>;
  }

  const tree = buildTree(currentProject.files);

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 uppercase">
          Files
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setCreateType("file")}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
            title="New file"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCreateType("folder")}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
            title="New folder"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={handleUploadClick}
            disabled={uploadMutation.isPending}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded disabled:opacity-50"
            title="Upload files"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            accept=".tex,.bib,.sty,.cls,.bst,.png,.jpg,.jpeg,.gif,.pdf,.eps,.svg"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto py-1">
        {tree.length === 0 ? (
          <div className="p-4 text-gray-500 text-sm text-center">
            No files yet. Click + to create a file.
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              projectId={currentProject.id}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {createType && (
        <CreateDialog
          type={createType}
          projectId={currentProject.id}
          onClose={() => setCreateType(null)}
          onSuccess={handleCreateSuccess}
        />
      )}
    </div>
  );
}
