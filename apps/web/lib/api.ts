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
  created_at: string;
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

export async function listMessages(threadId: string) {
  return request<{ messages: Message[] }>(`/threads/${threadId}/messages`);
}

export async function sendMessage(threadId: string, content: string) {
  return request<{ message: Message; run: unknown }>(`/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}
