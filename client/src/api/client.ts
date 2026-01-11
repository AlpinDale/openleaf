import { useAuthStore } from "../stores/authStore";

const API_BASE = "/api";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useAuthStore.getState().token;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new ApiError(response.status, error.error || "Request failed");
  }

  return response.json();
}

// Auth API
export const authApi = {
  register: (email: string, name: string, password: string) =>
    request<{
      token: string;
      user: { id: string; email: string; name: string };
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    }),

  login: (email: string, password: string) =>
    request<{
      token: string;
      user: { id: string; email: string; name: string };
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};

// Projects API
export interface Collaborator {
  user_id: string;
  user_name: string;
  user_email: string;
  role: "editor" | "viewer";
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export const projectsApi = {
  list: () => request<{ projects: Project[] }>("/projects"),

  get: (id: string) => request<Project>(`/projects/${id}`),

  create: (name: string) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}`, {
      method: "DELETE",
    }),

  listCollaborators: (projectId: string) =>
    request<{ collaborators: Collaborator[] }>(
      `/projects/${projectId}/collaborators`,
    ),

  addCollaborator: (
    projectId: string,
    email: string,
    role: "editor" | "viewer",
  ) =>
    request<Collaborator>(`/projects/${projectId}/collaborators`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),

  removeCollaborator: (projectId: string, userId: string) =>
    request<void>(`/projects/${projectId}/collaborators/${userId}`, {
      method: "DELETE",
    }),
};

// Files API
export const filesApi = {
  list: (projectId: string) =>
    request<{
      files: Array<{
        id: string;
        name: string;
        path: string;
        is_folder: boolean;
      }>;
    }>(`/files/project/${projectId}`),

  create: (
    projectId: string,
    name: string,
    path: string,
    isFolder: boolean,
    content?: string,
  ) =>
    request<{
      file: { id: string; name: string; path: string; is_folder: boolean };
    }>(`/files/project/${projectId}/file`, {
      method: "POST",
      body: JSON.stringify({ name, path, is_folder: isFolder, content }),
    }),

  getContent: (fileId: string) =>
    request<{ content: string }>(`/files/${fileId}/content`),

  updateContent: (fileId: string, content: string) =>
    request<{ content: string }>(`/files/${fileId}/content`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  delete: (fileId: string) =>
    request<void>(`/files/${fileId}`, {
      method: "DELETE",
    }),

  upload: async (projectId: string, files: FileList | File[]) => {
    const token = useAuthStore.getState().token;
    const formData = new FormData();

    for (const file of files) {
      formData.append("file", file, file.name);
    }

    const response = await fetch(
      `${API_BASE}/files/project/${projectId}/upload`,
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ApiError(response.status, error.error || "Upload failed");
    }

    return (await response.json()) as {
      uploaded: Array<{
        id: string;
        name: string;
        path: string;
        is_folder: boolean;
      }>;
      errors: string[];
    };
  },
};

// Compile API
export const compileApi = {
  compile: (projectId: string, mainFile?: string) =>
    request<{
      success: boolean;
      pdf_url: string | null;
      errors: Array<{ file: string; line: number | null; message: string }>;
      warnings: Array<{ file: string; line: number | null; message: string }>;
    }>(`/compile/project/${projectId}`, {
      method: "POST",
      body: JSON.stringify({ main_file: mainFile }),
    }),
};

// Comments API
export interface Comment {
  id: string;
  project_id: string;
  file_path: string;
  author_id: string;
  author_name: string;
  content: string;
  line_start: number;
  line_end: number;
  resolved: boolean;
  created_at: string;
}

export const commentsApi = {
  listProject: (projectId: string) =>
    request<{ comments: Comment[] }>(`/comments/project/${projectId}`),

  listFile: (projectId: string, filePath: string) =>
    request<{ comments: Comment[] }>(
      `/comments/project/${projectId}/file?file_path=${encodeURIComponent(filePath)}`,
    ),

  create: (
    projectId: string,
    filePath: string,
    content: string,
    lineStart: number,
    lineEnd: number,
  ) =>
    request<Comment>("/comments", {
      method: "POST",
      body: JSON.stringify({
        project_id: projectId,
        file_path: filePath,
        content,
        line_start: lineStart,
        line_end: lineEnd,
      }),
    }),

  delete: (id: string) =>
    request<void>(`/comments/${id}`, {
      method: "DELETE",
    }),

  resolve: (id: string) =>
    request<Comment>(`/comments/${id}/resolve`, {
      method: "POST",
    }),
};

export { ApiError };
