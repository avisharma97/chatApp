"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type CallItem = {
  id: string;
  conversationId: string;
  type: string;
  status: string;
  direction: "INCOMING" | "OUTGOING";
  startedAt: string;
  durationSeconds: number;
  otherUser: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  };
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadCalls = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${API}/api/v1/calls?limit=50`, {
        credentials: "include",
        signal,
      });

      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Please log in to view your call history."
            : "Could not load call history.",
        );
      }

      const data: { calls: CallItem[] } = await response.json();

      if (!signal?.aborted) {
        setCalls(data.calls);
        setError("");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      await loadCalls(controller.signal);
    };

    void run();

    return () => controller.abort();
  }, [loadCalls]);

  return (
    <main className="calls-page">
      <header className="calls-page-header">
        <div>
          <h1>Call history</h1>
          <p>Your recent audio and video calls</p>
        </div>
        <Link href="/">Back to chats</Link>
      </header>

      {loading && <p role="status">Loading calls…</p>}

      {error && (
        <div role="alert" className="calls-error">
          <p>{error}</p>
          <button type="button" onClick={() => void loadCalls()}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && calls.length === 0 && (
        <div className="calls-empty">
          <h2>No calls yet</h2>
          <p>Your audio and video call history will appear here.</p>
          <Link href="/">Start a call</Link>
        </div>
      )}

      <section className="calls-list" aria-label="Recent calls">
        {calls.map((call) => {
          const missed =
            call.status === "MISSED" ||
            call.status === "UNAVAILABLE" ||
            call.status === "REJECTED";

          return (
            <article className="call-history-item" key={call.id}>
              <div className="call-history-avatar">
                {call.otherUser.avatarUrl ? (
                  <img
                    src={call.otherUser.avatarUrl}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : (
                  call.otherUser.displayName.slice(0, 1).toUpperCase()
                )}
              </div>

              <div className="call-history-person">
                <strong>{call.otherUser.displayName}</strong>
                <span className={missed ? "call-history-missed" : ""}>
                  {call.direction === "INCOMING" ? "↙ Incoming" : "↗ Outgoing"}
                  {" · "}
                  {call.type === "video" ? "Video call" : "Audio call"}
                  {missed ? ` · ${call.status.toLowerCase()}` : ""}
                </span>
                <time dateTime={call.startedAt}>
                  {new Date(call.startedAt).toLocaleString()}
                </time>
              </div>

              <span className="call-history-duration">
                {call.durationSeconds > 0
                  ? formatDuration(call.durationSeconds)
                  : "—"}
              </span>

              <Link
                className="call-history-chat-link"
                href={`/?conversation=${encodeURIComponent(call.conversationId)}`}
                aria-label={`Open chat with ${call.otherUser.displayName}`}
              >
                Chat
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}
