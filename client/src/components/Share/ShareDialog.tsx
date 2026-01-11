import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, UserPlus, Trash2, Users } from "lucide-react";
import { projectsApi, Collaborator } from "../../api/client";
import { useAuthStore } from "../../stores/authStore";

interface ShareDialogProps {
  projectId: string;
  projectOwnerId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareDialog({
  projectId,
  projectOwnerId,
  isOpen,
  onClose,
}: ShareDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");

  const isOwner = user?.id === projectOwnerId;

  const { data: collaboratorsData, isLoading } = useQuery({
    queryKey: ["collaborators", projectId],
    queryFn: () => projectsApi.listCollaborators(projectId),
    enabled: isOpen,
  });

  const addMutation = useMutation({
    mutationFn: () => projectsApi.addCollaborator(projectId, email, role),
    onSuccess: () => {
      setEmail("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["collaborators", projectId] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      projectsApi.removeCollaborator(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collaborators", projectId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    addMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Share Project
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Add collaborator form */}
          {isOwner && (
            <form onSubmit={handleSubmit} className="mb-4">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                />
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "editor" | "viewer")
                  }
                  className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={addMutation.isPending || !email.trim()}
                  className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 text-sm flex items-center gap-1"
                >
                  <UserPlus className="w-4 h-4" />
                  Add
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </form>
          )}

          {/* Collaborators list */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Collaborators</h3>

            {isLoading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : collaboratorsData?.collaborators.length === 0 ? (
              <p className="text-sm text-gray-500">
                No collaborators yet. Add someone by email.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {collaboratorsData?.collaborators.map((collab) => (
                  <CollaboratorItem
                    key={collab.user_id}
                    collaborator={collab}
                    canRemove={isOwner || collab.user_id === user?.id}
                    onRemove={() => removeMutation.mutate(collab.user_id)}
                    isRemoving={removeMutation.isPending}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <p className="text-xs text-gray-500">
            Editors can modify files and add comments. Viewers can only view
            files.
          </p>
        </div>
      </div>
    </div>
  );
}

interface CollaboratorItemProps {
  collaborator: Collaborator;
  canRemove: boolean;
  onRemove: () => void;
  isRemoving: boolean;
}

function CollaboratorItem({
  collaborator,
  canRemove,
  onRemove,
  isRemoving,
}: CollaboratorItemProps) {
  return (
    <li className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{collaborator.user_name}</p>
        <p className="text-xs text-gray-500 truncate">
          {collaborator.user_email}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            collaborator.role === "editor"
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {collaborator.role}
        </span>
        {canRemove && (
          <button
            onClick={onRemove}
            disabled={isRemoving}
            className="p-1 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
            title="Remove collaborator"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </li>
  );
}
