"use client";

import type { Message } from "../../types/chat";

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onForward: (message: Message, trigger: HTMLButtonElement) => void;
  onDragStart?: (
    message: Message,
    event: React.DragEvent<HTMLDivElement>,
  ) => void;
};

function formatMessageTime(value: string | null | undefined): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export default function MessageList({
  messages,
  currentUserId,
  loading,
  error,
  onRetry,
  onForward,
  onDragStart,
}: MessageListProps) {
  return (
    <>
      {loading && (
        <p className="inline-status" role="status">
          Loading message history…
        </p>
      )}

      {!loading && error && (
        <div role="alert" className="inline-status">
          <p>Could not load messages: {error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && messages.length === 0 && (
        <p className="inline-status">
          No messages yet. Start the conversation!
        </p>
      )}

      {!loading &&
        !error &&
        messages.map((message) => {
          const own = message.senderId === currentUserId;

          return (
            <div
              key={message.id}
              className={`message-row ${own ? "own" : "incoming"}`}
              data-message-id={message.id}
              draggable
              onDragStart={(event) => onDragStart?.(message, event)}
            >
              <div className="message-content">
                <div className="message-bubble">
                  {message.mediaUrl &&
                    message.mediaResourceType === "image" && (
                      <a
                        href={message.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open image: ${message.mediaOriginalName ?? "Shared image"}`}
                      >
                        <img
                          src={message.mediaUrl}
                          alt={
                            message.mediaOriginalName ?? "Image shared in chat"
                          }
                          loading="lazy"
                          style={{
                            display: "block",
                            maxWidth: "100%",
                            width: "auto",
                            maxHeight: "320px",
                            objectFit: "contain",
                            borderRadius: "8px",
                            marginBottom: message.content ? "8px" : "0",
                          }}
                        />
                      </a>
                    )}

                  {message.mediaUrl &&
                    message.mediaResourceType === "video" && (
                      <video
                        src={message.mediaUrl}
                        controls
                        preload="metadata"
                        aria-label={
                          message.mediaOriginalName ?? "Video shared in chat"
                        }
                        style={{
                          display: "block",
                          maxWidth: "100%",
                          width: "100%",
                          maxHeight: "320px",
                          borderRadius: "8px",
                          marginBottom: message.content ? "8px" : "0",
                        }}
                      >
                        Your browser does not support video playback.
                      </video>
                    )}

                  {message.content && <p>{message.content}</p>}
                </div>
                {own &&
                  (() => {
                    const receipts = message.receipts ?? [];

                    const readAt =
                      receipts.length > 0 &&
                      receipts.every((r) => Boolean(r.readAt))
                        ? receipts.reduce<string | null>(
                            (latest, receipt) =>
                              !latest ||
                              (receipt.readAt && receipt.readAt > latest)
                                ? receipt.readAt
                                : latest,
                            null,
                          )
                        : null;

                    const deliveredAt =
                      receipts.length > 0 &&
                      receipts.every((r) => Boolean(r.deliveredAt))
                        ? receipts.reduce<string | null>(
                            (latest, receipt) =>
                              !latest ||
                              (receipt.deliveredAt &&
                                receipt.deliveredAt > latest)
                                ? receipt.deliveredAt
                                : latest,
                            null,
                          )
                        : null;

                    const status = readAt
                      ? "Read"
                      : deliveredAt
                        ? "Delivered"
                        : "Sent";

                    const statusTime =
                      readAt ?? deliveredAt ?? message.createdAt;

                    return (
                      <div className="message-meta">
                        <time
                          className="message-time"
                          dateTime={message.createdAt}
                          title={new Date(message.createdAt).toLocaleString()}
                        >
                          {formatMessageTime(message.createdAt)}
                        </time>

                        <span
                          className="message-receipt"
                          aria-label={`${status} at ${formatMessageTime(statusTime)}`}
                          title={`${status}: ${new Date(statusTime).toLocaleString()}`}
                        >
                          {status === "Read"
                            ? "✓✓ Read"
                            : status === "Delivered"
                              ? "✓✓ Delivered"
                              : "✓ Sent"}
                          {" · "}
                          {formatMessageTime(statusTime)}
                        </span>
                      </div>
                    );
                  })()}
              </div>

              <button
                type="button"
                className="forward-button"
                aria-label="Forward message"
                title="Forward message"
                onClick={(event) => onForward(message, event.currentTarget)}
              >
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          );
        })}
    </>
  );
}
