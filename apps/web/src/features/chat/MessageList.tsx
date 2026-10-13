"use client";

import { useState, type FormEvent } from "react";
import type { Message } from "../../types/chat";

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onForward: (message: Message, trigger: HTMLButtonElement) => void;
  onEdit: (message: Message, content: string) => Promise<void>;
  onDelete: (message: Message) => Promise<void>;
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
  onEdit,
  onDelete,
  onDragStart,
}: MessageListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function startEditing(message: Message) {
    setEditingId(message.id);
    setDraft(message.content);
    setActionError(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setDraft("");
    setActionError(null);
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = messages.find((item) => item.id === editingId);
    const content = draft.trim();

    if (!message || !content || content.length > 5000 || saving) return;

    if (content === message.content) {
      cancelEditing();
      return;
    }

    setSaving(true);
    setActionError(null);

    try {
      await onEdit(message, content);
      cancelEditing();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not edit message.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(message: Message) {
    const confirmed = window.confirm(
      "Delete this message? This action cannot be undone.",
    );

    if (!confirmed || saving) return;

    setSaving(true);
    setActionError(null);

    try {
      await onDelete(message);

      if (editingId === message.id) cancelEditing();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not delete message.",
      );
    } finally {
      setSaving(false);
    }
  }

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
          const deleted = Boolean(message.deletedAt);
          const editing = editingId === message.id;

          const receipts = message.receipts ?? [];

          const readAt =
            receipts.length > 0 && receipts.every((r) => Boolean(r.readAt))
              ? receipts.reduce<string | null>(
                  (latest, receipt) =>
                    !latest || (receipt.readAt && receipt.readAt > latest)
                      ? receipt.readAt
                      : latest,
                  null,
                )
              : null;

          const deliveredAt =
            receipts.length > 0 && receipts.every((r) => Boolean(r.deliveredAt))
              ? receipts.reduce<string | null>(
                  (latest, receipt) =>
                    !latest ||
                    (receipt.deliveredAt && receipt.deliveredAt > latest)
                      ? receipt.deliveredAt
                      : latest,
                  null,
                )
              : null;

          const status = readAt ? "Read" : deliveredAt ? "Delivered" : "Sent";
          const statusTime = readAt ?? deliveredAt ?? message.createdAt;

          return (
            <div
              key={message.id}
              className={`message-row ${own ? "own" : "incoming"}`}
              data-message-id={message.id}
              draggable={!deleted && !editing}
              onDragStart={(event) => {
                if (!deleted && !editing) onDragStart?.(message, event);
              }}
            >
              <div className="message-content">
                <div className="message-bubble">
                  {deleted ? (
                    <p className="deleted-message">This message was deleted.</p>
                  ) : editing ? (
                    <form
                      className="message-edit-form"
                      onSubmit={handleEditSubmit}
                    >
                      <label
                        htmlFor={`edit-message-${message.id}`}
                        className="sr-only"
                      >
                        Edit message
                      </label>

                      <textarea
                        id={`edit-message-${message.id}`}
                        className="message-edit-input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={5000}
                        required
                        autoFocus
                        rows={Math.min(
                          5,
                          Math.max(2, draft.split("\n").length),
                        )}
                        disabled={saving}
                        aria-describedby={`edit-help-${message.id}`}
                      />

                      <div className="message-edit-footer">
                        <span
                          id={`edit-help-${message.id}`}
                          className="message-edit-count"
                        >
                          {draft.length}/5000
                        </span>

                        <div className="message-edit-actions">
                          <button
                            type="submit"
                            className="message-edit-save"
                            disabled={
                              saving || !draft.trim() || draft.length > 5000
                            }
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>

                          <button
                            type="button"
                            className="message-edit-cancel"
                            onClick={cancelEditing}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <>
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
                                message.mediaOriginalName ??
                                "Image shared in chat"
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
                              message.mediaOriginalName ??
                              "Video shared in chat"
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

                      {message.editedAt && (
                        <small className="message-edited">Edited</small>
                      )}
                    </>
                  )}
                </div>

                {own && !deleted && (
                  <div className="message-footer">
                    {!editing && (
                      <div className="message-actions">
                        <button
                          type="button"
                          onClick={() => startEditing(message)}
                          disabled={saving}
                          aria-label="Edit message"
                          title="Edit message"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDelete(message)}
                          disabled={saving}
                          aria-label="Delete message"
                          title="Delete message"
                        >
                          Delete
                        </button>
                      </div>
                    )}

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
                  </div>
                )}

                {editing && actionError && (
                  <p role="alert" className="inline-status">
                    {actionError}
                  </p>
                )}
              </div>

              {!deleted && !editing && (
                <button
                  type="button"
                  className="forward-button"
                  aria-label="Forward message"
                  title="Forward message"
                  onClick={(event) => onForward(message, event.currentTarget)}
                >
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          );
        })}

      {actionError && !editingId && (
        <p role="alert" className="inline-status">
          {actionError}
        </p>
      )}
    </>
  );
}
