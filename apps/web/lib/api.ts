export type Thread = {
  id: string;
  display_name: string;
  workspace_path: string;
  status: string;
  model: string;
  updated_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata_json: {
    attachments?: Attachment[];
  };
  created_at: string;
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
  size: number;
  url?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function listThreads() {
  return request<{ threads: Thread[] }>("/threads");
}

export async function createThread(displayName?: string) {
  return request<{ thread: Thread }>("/threads", {
    method: "POST",
    body: JSON.stringify({ displayName })
  });
}

export async function renameThread(id: string, displayName: string) {
  return request<{ thread: Thread }>(`/threads/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ displayName })
  });
}

export async function updateThreadModel(id: string, model: string) {
  return request<{ thread: Thread }>(`/threads/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ model })
  });
}

export async function archiveThread(id: string) {
  return request<void>(`/threads/${id}`, {
    method: "DELETE"
  });
}

export async function deleteThreadPermanently(id: string) {
  return request<void>(`/threads/${id}/permanent`, {
    method: "DELETE"
  });
}

export async function listMessages(threadId: string) {
  return request<{ messages: Message[] }>(`/threads/${threadId}/messages`);
}

export async function uploadAttachments(threadId: string, files: File[]) {
  const body = new FormData();
  for (const file of files) {
    body.append("files", file);
  }

  const response = await fetch(`${API_BASE}/threads/${threadId}/attachments`, {
    method: "POST",
    body,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<{ attachments: Attachment[] }>;
}

export async function sendMessage(threadId: string, content: string, attachments: Attachment[] = []) {
  return request<{ message: Message; run: unknown }>(`/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, attachments })
  });
}
