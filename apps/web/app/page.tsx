"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, Bot, Menu, MessageSquarePlus, Pencil, RefreshCw, Send, Server } from "lucide-react";
import {
  createThread,
  listMessages,
  listThreads,
  renameThread,
  sendMessage,
  type Message,
  type Thread
} from "@/lib/api";

type ViewMode = "threads" | "chat";

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("threads");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!activeThreadId || !composer.trim()) return;

    const content = composer.trim();
    setComposer("");
    setBusy(true);
    setError(null);
    try {
      const result = await sendMessage(activeThreadId, content);
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
          <span>111 / 114 SSH 待配置</span>
          <span>{isRunning ? "运行中" : "CLI Runner"}</span>
        </div>

        {error ? <div className="errorBox">{error}</div> : null}

        <div className="messages">
          {!activeThread ? (
            <div className="emptyState">
              <Bot size={32} />
              <p>选择一个线程，或创建新线程开始。</p>
            </div>
          ) : null}

          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="messageRole">{message.role}</div>
              <p>{message.content}</p>
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
            disabled={!activeThread || busy || isRunning || !composer.trim()}
          >
            <Send size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
