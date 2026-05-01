"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  Cpu,
  ImagePlus,
  Menu,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Send,
  Server,
  X
} from "lucide-react";
import {
  createThread,
  listMessages,
  listThreads,
  renameThread,
  sendMessage,
  updateThreadModel,
  uploadAttachments,
  type Message,
  type Thread
} from "@/lib/api";

type ViewMode = "threads" | "chat";

const MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" }
];

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("threads");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );
  const isRunning = activeThread?.status === "running";

  async function refreshThreads(selectFirst = false) {
    const result = await listThreads();
    setThreads(result.threads);
    if (selectFirst && result.threads[0]) {
      setActiveThreadId(result.threads[0].id);
      setViewMode("chat");
    }
  }

  async function refreshMessages(threadId = activeThreadId) {
    if (!threadId) return;
    const result = await listMessages(threadId);
    setMessages(result.messages);
  }

  useEffect(() => {
    refreshThreads(true)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }

    refreshMessages(activeThreadId).catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || (!isRunning && !busy)) return;

    const interval = window.setInterval(() => {
      void refreshMessages(activeThreadId);
      void refreshThreads();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeThreadId, isRunning, busy]);

  async function handleNewThread() {
    setBusy(true);
    setError(null);
    try {
      const result = await createThread("新线程");
      setThreads((current) => [result.thread, ...current]);
      setActiveThreadId(result.thread.id);
      setViewMode("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!activeThread) return;
    const nextName = window.prompt("线程名称", activeThread.display_name);
    if (!nextName?.trim()) return;

    const result = await renameThread(activeThread.id, nextName.trim());
    setThreads((current) =>
      current.map((thread) => (thread.id === result.thread.id ? result.thread : thread))
    );
  }

  async function handleModelChange(model: string) {
    if (!activeThread || model === activeThread.model) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateThreadModel(activeThread.id, model);
      setThreads((current) =>
        current.map((thread) => (thread.id === result.thread.id ? result.thread : thread))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!activeThreadId || (!composer.trim() && selectedFiles.length === 0)) return;

    const content = composer.trim();
    setComposer("");
    const filesToSend = selectedFiles;
    setSelectedFiles([]);
    setBusy(true);
    setError(null);
    try {
      const uploaded = filesToSend.length
        ? await uploadAttachments(activeThreadId, filesToSend)
        : { attachments: [] };
      const result = await sendMessage(activeThreadId, content, uploaded.attachments);
      setMessages((current) => [...current, result.message]);
      setThreads((current) =>
        current.map((thread) =>
          thread.id === activeThreadId ? { ...thread, status: "running" } : thread
        )
      );
      window.setTimeout(() => {
        void refreshMessages(activeThreadId);
        void refreshThreads();
      }, 800);
    } catch (err) {
      setSelectedFiles(filesToSend);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleAddFiles(files: FileList | null) {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    setSelectedFiles((current) => [...current, ...images].slice(0, 8));
  }

  return (
    <main className="shell">
      <aside className={`threadPane ${viewMode === "threads" ? "isVisible" : ""}`}>
        <header className="appHeader">
          <div>
            <p className="eyebrow">SERVER CODEX</p>
            <h1>线程</h1>
          </div>
          <button className="iconButton" type="button" onClick={() => void refreshThreads()}>
            <RefreshCw size={18} />
          </button>
        </header>

        <button className="primaryButton" type="button" onClick={handleNewThread} disabled={busy}>
          <MessageSquarePlus size={18} />
          新建线程
        </button>

        <div className="threadList">
          {loading ? <p className="muted">加载中...</p> : null}
          {!loading && threads.length === 0 ? <p className="muted">还没有线程</p> : null}
          {threads.map((thread) => (
            <button
              className={`threadItem ${thread.id === activeThreadId ? "active" : ""}`}
              key={thread.id}
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setViewMode("chat");
              }}
            >
              <span>{thread.display_name}</span>
              <small>{thread.status}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className={`chatPane ${viewMode === "chat" ? "isVisible" : ""}`}>
        <header className="chatHeader">
          <button className="iconButton mobileOnly" type="button" onClick={() => setViewMode("threads")}>
            <Menu size={20} />
          </button>
          <div className="titleBlock">
            <p className="eyebrow">当前线程</p>
            <h2>{activeThread?.display_name ?? "选择或新建线程"}</h2>
          </div>
          <div className="headerActions">
            <button className="iconButton" type="button" onClick={handleRename} disabled={!activeThread}>
              <Pencil size={18} />
            </button>
            <button className="iconButton" type="button" disabled>
              <Archive size={18} />
            </button>
          </div>
        </header>

        <div className="statusStrip">
          <span>
            <Server size={16} />
            150 控制节点
          </span>
          <span>111 / 114 SSH 已配置</span>
          <span>{isRunning ? "运行中" : "CLI Runner"}</span>
          <label className="modelControl">
            <Cpu size={16} />
            <select
              value={activeThread?.model ?? "gpt-5.5"}
              onChange={(event) => void handleModelChange(event.target.value)}
              disabled={!activeThread || busy || isRunning}
            >
              {MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <div className="errorBox">{error}</div> : null}

        <div className="messages">
          {!activeThread ? (
            <div className="emptyState">
              <Bot size={32} />
              <p>选择一个线程，或创建新线程开始。</p>
            </div>
          ) : null}

          {messages.filter((message) => message.role !== "tool").map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="messageRole">{message.role}</div>
              {message.content ? <p>{message.content}</p> : null}
              {message.metadata_json?.attachments?.length ? (
                <div className="attachmentGrid">
                  {message.metadata_json.attachments.map((attachment) => (
                    <a
                      className="attachmentThumb"
                      href={attachment.url ?? "#"}
                      key={attachment.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {attachment.url ? <img src={attachment.url} alt={attachment.name} /> : null}
                      <span>{attachment.name}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {isRunning ? (
            <article className="message tool">
              <div className="messageRole">status</div>
              <p>Codex 正在执行，页面会自动刷新...</p>
            </article>
          ) : null}
        </div>

        <form className="composer" onSubmit={handleSend}>
          {selectedFiles.length ? (
            <div className="selectedFiles">
              {selectedFiles.map((file, index) => (
                <div className="selectedFile" key={`${file.name}-${file.lastModified}-${index}`}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                    }
                    aria-label="移除图片"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composerRow">
            <input
              id="imageInput"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                handleAddFiles(event.target.files);
                event.target.value = "";
              }}
              disabled={!activeThread || busy || isRunning}
            />
            <label className="iconButton attachButton" htmlFor="imageInput" aria-label="添加图片">
              <ImagePlus size={18} />
            </label>
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder={activeThread ? "输入任务或问题..." : "先选择线程"}
              disabled={!activeThread || busy || isRunning}
              rows={1}
            />
            <button
              className="sendButton"
              type="submit"
              disabled={!activeThread || busy || isRunning || (!composer.trim() && selectedFiles.length === 0)}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
