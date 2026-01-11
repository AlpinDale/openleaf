import { X, Circle } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";

export default function EditorTabs() {
  const { openFiles, activeFile, setActiveFile, closeFile, currentProject } =
    useProjectStore();
  const { isFileDirty } = useEditorStore();

  const getFileName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  if (openFiles.length === 0) {
    return null;
  }

  return (
    <div className="flex bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {openFiles.map((path) => {
        const isActive = path === activeFile;
        const isDirty = isFileDirty(path);
        const file = currentProject?.files.find((f) => f.path === path);
        const fileName = file?.name || getFileName(path);

        return (
          <div
            key={path}
            className={`
              flex items-center gap-2 px-3 py-1.5 border-r border-gray-200 dark:border-gray-700 cursor-pointer
              min-w-[100px] max-w-[200px] group
              ${isActive ? "bg-white dark:bg-gray-900 border-b-2 border-b-primary-500 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}
            `}
            onClick={() => setActiveFile(path)}
          >
            <span className="truncate text-sm" title={path}>
              {fileName}
            </span>
            {isDirty ? (
              <Circle className="w-2 h-2 fill-primary-500 text-primary-500 flex-shrink-0" />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(path);
                }}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
