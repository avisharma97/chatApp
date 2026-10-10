"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type User = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

type SearchUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

type Member = {
  conversationId?: string;
  userId: string;
  role?: string;
  joinedAt?: string;
  lastReadAt?: string | null;
  user: User | SearchUser;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId?: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  receipts?: {
    userId: string;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
};

type Conversation = {
  id: string;
  type: "DIRECT" | "GROUP";
  title?: string | null;
  createdAt?: string;
  updatedAt?: string;
  members: Member[];
  latestMessage?: Message | null;
  messages?: Message[];
  unreadCount?: number;
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detailMessage = Array.isArray(data.details)
      ? data.details
          .map((issue: { path?: (string | number)[]; message?: string }) => {
            const field = issue.path?.length ? `${issue.path.join(".")}: ` : "";
            return `${field}${issue.message ?? "Invalid value"}`;
          })
          .join("; ")
      : "";

    throw new Error(
      detailMessage ||
        data.message ||
        data.error ||
        `Request failed (${response.status})`,
    );
  }

  return data as T;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function peerFor(conversation: Conversation, userId: string) {
  return conversation.members?.find((member) => member.userId !== userId)?.user;
}

function latestMessageFor(conversation: Conversation) {
  return conversation.latestMessage ?? conversation.messages?.[0] ?? null;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketStatus, setSocketStatus] = useState("Connecting");

  const [showNewChat, setShowNewChat] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef(selectedId);
  const previousSelectedIdRef = useRef("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [typingUsers, setTypingUsers] = useState<
    { userId: string; username: string }[]
  >([]);
  const conversationsRef = useRef(conversations);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Keep the current selection available to Socket.IO callbacks.
  selectedIdRef.current = selectedId;

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedId,
  );
  const selectedPeer =
    selectedConversation && user
      ? peerFor(selectedConversation, user.id)
      : undefined;

  const peerOnline = selectedPeer
    ? onlineUserIds.includes(selectedPeer.id)
    : false;

  const refreshConversations = useCallback(async () => {
    const data = await api<Conversation[] | { conversations?: Conversation[] }>(
      "/api/v1/conversations",
    );
    const list = Array.isArray(data) ? data : (data.conversations ?? []);
    setConversations(list);
    return list;
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const data = await api<{ messages: Message[] }>(
        `/api/v1/conversations/${conversationId}/messages?limit=50`,
      );
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Restore an existing login session when the page opens.
  useEffect(() => {
    let active = true;

    api<{ user?: User }>("/api/v1/auth/me")
      .then((data) => {
        if (active) setUser(data.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Load conversations after authentication changes.
  useEffect(() => {
    if (!user) {
      setConversations([]);
      setSelectedId("");
      setMessages([]);
      return;
    }

    let active = true;
    refreshConversations()
      .then((list) => {
        if (!active) return;
        if (list.length > 0) {
          setSelectedId((current) =>
            list.some((conversation) => conversation.id === current)
              ? current
              : list[0].id,
          );
        } else {
          setSelectedId("");
        }
      })
      .catch((err) => {
        if (active) setError(errorText(err));
      });

    return () => {
      active = false;
    };
  }, [user, refreshConversations]);

  // Load message history when the selected conversation changes.
  useEffect(() => {
    if (!selectedId || !user) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
  }, [selectedId, user, loadMessages]);

  // One authenticated Socket.IO connection per logged-in user.
  useEffect(() => {
    if (!user) {
      setSocketStatus("Disconnected");
      return;
    }

    const socket = io(API, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("Connected");

      const conversationId = selectedIdRef.current;

      if (conversationId) {
        socket.emit(
          "conversation:join",
          { conversationId },
          (result: { ok: boolean }) => {
            if (result.ok) {
              socket.emit("conversation:read", {
                conversationId,
              });
            }
          },
        );
      }

      previousSelectedIdRef.current = conversationId;
    });

    socket.on("disconnect", () => setSocketStatus("Disconnected"));
    socket.on("connect_error", () => setSocketStatus("Connection error"));

    socket.on("message:new", (message: Message) => {
      const activeConversationId = selectedIdRef.current;

      if (message.conversationId === activeConversationId) {
        setMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
        );

        // Recipient acknowledges delivery and reading.
        if (message.senderId !== user.id) {
          socket.emit("message:delivered", {
            messageId: message.id,
          });
        }
      }

      void refreshConversations().catch(() => undefined);
    });

    socket.on(
      "message:receipt",
      (receipt: {
        messageId: string;
        userId: string;
        deliveredAt: string | null;
        readAt: string | null;
      }) => {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== receipt.messageId) {
              return message;
            }

            const receipts = message.receipts ?? [];
            const existing = receipts.find(
              (item) => item.userId === receipt.userId,
            );

            if (!existing) {
              return {
                ...message,
                receipts: [
                  ...receipts,
                  {
                    userId: receipt.userId,
                    deliveredAt: receipt.deliveredAt,
                    readAt: receipt.readAt,
                  },
                ],
              };
            }

            return {
              ...message,
              receipts: receipts.map((item) =>
                item.userId === receipt.userId
                  ? {
                      ...item,
                      deliveredAt: receipt.deliveredAt ?? item.deliveredAt,
                      readAt: receipt.readAt ?? item.readAt,
                    }
                  : item,
              ),
            };
          }),
        );
      },
    );
    socket.on(
      "typing:update",
      (event: {
        conversationId: string;
        userId: string;
        isTyping: boolean;
      }) => {
        if (event.conversationId !== selectedIdRef.current) return;
        if (event.userId === user?.id) return;

        const conversation = conversationsRef.current?.find(
          (item) => item.id === event.conversationId,
        );

        const member = conversation?.members.find(
          (item) => item.user.id === event.userId,
        );

        const username =
          member?.user.displayName || member?.user.username || "Someone";

        setTypingUsers((current) => {
          if (!event.isTyping) {
            return current.filter((item) => item.userId !== event.userId);
          }

          if (current.some((item) => item.userId === event.userId)) {
            return current;
          }

          return [...current, { userId: event.userId, username }];
        });
      },
    );
    socket.on("presence:initial", (data: { onlineUserIds: string[] }) => {
      setOnlineUserIds(data.onlineUserIds);
    });

    socket.on(
      "presence:update",
      (event: { userId: string; isOnline: boolean }) => {
        setOnlineUserIds((current) =>
          event.isOnline
            ? current.includes(event.userId)
              ? current
              : [...current, event.userId]
            : current.filter((id) => id !== event.userId),
        );
      },
    );
    return () => {
      socket.disconnect();
      socketRef.current = null;
      previousSelectedIdRef.current = "";
    };
  }, [user, refreshConversations]);

  // Join/leave rooms when the selected conversation changes.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    const previousId = previousSelectedIdRef.current;
    if (previousId && previousId !== selectedId) {
      socket.emit("conversation:leave", { conversationId: previousId });
    }
    if (selectedId && selectedId !== previousId) {
      socket.emit("conversation:join", { conversationId: selectedId });
    }
    previousSelectedIdRef.current = selectedId;
  }, [selectedId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      if (authMode === "register") {
        await api("/api/v1/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, username, displayName, password }),
        });
        setNotice("Account created. Please log in.");
        setAuthMode("login");
        setPassword("");
      } else {
        const data = await api<{ user?: User }>("/api/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        if (data.user) {
          setUser(data.user);
        } else {
          const me = await api<{ user: User }>("/api/v1/auth/me");
          setUser(me.user);
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setError("");
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
    } catch (err) {
      setError(errorText(err));
      return;
    }

    socketRef.current?.disconnect();
    setUser(null);
    setMessages([]);
    setConversations([]);
    setSelectedId("");
    setPassword("");
    setShowNewChat(false);
    setUserSearch("");
    setSearchResults([]);
    setNotice("You have logged out.");
  }

  async function searchUsers(query: string) {
    setUserSearch(query);
    setError("");

    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    setSearchingUsers(true);
    try {
      const data = await api<{ users: SearchUser[] }>(
        `/api/v1/users?search=${encodeURIComponent(normalizedQuery)}`,
      );
      // Ensure the result IDs are the IDs returned by the server (UUIDs).
      setSearchResults(data.users ?? []);
    } catch (err) {
      setSearchResults([]);
      setError(errorText(err));
    } finally {
      setSearchingUsers(false);
    }
  }

  async function startConversation(targetUserId: string) {
    setError("");
    setNotice("");

    // Catch a malformed/missing user ID before making the POST request.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        targetUserId,
      )
    ) {
      setError(
        "The selected user has an invalid ID. Refresh the user search and try again.",
      );
      return;
    }

    setBusy(true);
    try {
      const data = await api<{ conversation: Conversation; created?: boolean }>(
        "/api/v1/conversations/direct",
        {
          method: "POST",
          body: JSON.stringify({ userId: targetUserId }),
        },
      );

      const list = await refreshConversations();
      if (!list.some((item) => item.id === data.conversation.id)) {
        setConversations((current) => [
          data.conversation,
          ...current.filter((item) => item.id !== data.conversation.id),
        ]);
      }

      setSelectedId(data.conversation.id);
      setShowNewChat(false);
      setUserSearch("");
      setSearchResults([]);
      setNotice("Conversation ready.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function handleDraftChange(value: string) {
    setDraft(value);

    const conversationId = selectedIdRef.current;
    const socket = socketRef.current;

    if (!conversationId || !socket?.connected) return;

    if (!value.trim()) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      socket.emit("typing:stop", { conversationId });
      return;
    }

    socket.emit("typing:start", { conversationId });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing:stop", { conversationId });
      typingTimeoutRef.current = null;
    }, 1500);
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId || sending) return;

    setError("");
    setSending(true);
    const clientMessageId = crypto.randomUUID();

    try {
      const data = await api<{ message: Message }>(
        `/api/v1/conversations/${selectedId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ clientMessageId, content }),
        },
      );
      setMessages((current) =>
        current.some((item) => item.id === data.message.id)
          ? current
          : [...current, data.message],
      );
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      socketRef.current?.emit("typing:stop", {
        conversationId: selectedId,
      });
      setDraft("");
      void refreshConversations().catch(() => undefined);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  if (authLoading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">c</div>
        <p>Getting your chats ready…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="auth-decoration decoration-one" />
        <div className="auth-decoration decoration-two" />

        <section className="auth-card">
          <div className="brand-row">
            <div className="brand-mark">c</div>
            <span>chatapp</span>
          </div>

          <p className="eyebrow">YOUR PEOPLE, IN REAL TIME</p>
          <h1>
            {authMode === "login" ? "Welcome back." : "Find your people."}
          </h1>
          <p className="muted">
            {authMode === "login"
              ? "Sign in to pick up where you left off."
              : "Create your account and start a conversation."}
          </p>

          <div className="auth-switch">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setError("");
                setNotice("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setError("");
                setNotice("");
              }}
            >
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "register" && (
              <>
                <label>
                  Display name
                  <input
                    required
                    minLength={1}
                    maxLength={80}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Alice Johnson"
                  />
                </label>
                <label>
                  Username
                  <input
                    required
                    minLength={3}
                    maxLength={30}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="alice"
                    autoComplete="username"
                  />
                </label>
              </>
            )}

            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                required
                minLength={authMode === "register" ? 12 : 1}
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  authMode === "register"
                    ? "At least 12 characters"
                    : "Your password"
                }
              />
            </label>

            {error && <p className="feedback error">{error}</p>}
            {notice && <p className="feedback success">{notice}</p>}

            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : authMode === "login"
                  ? "Sign in →"
                  : "Create account →"}
            </button>
          </form>
          <div className="auth-divider">
            <span>OR</span>
          </div>

          <button
            className="google-button"
            type="button"
            onClick={() => {
              window.location.href = "http://localhost:4000/api/v1/auth/google";
            }}
          >
            Continue with Google
          </button>
          <p className="auth-footnote">
            Protected by secure, HttpOnly session cookies.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">c</div>
          <span>chatapp</span>
          <span className="brand-dot" />
        </div>

        <div className="sidebar-heading">
          <div>
            <p className="eyebrow">YOUR SPACE</p>
            <h2>Messages</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            title="Start a conversation"
            aria-label="Start a conversation"
            onClick={() => {
              setShowNewChat((current) => !current);
              setUserSearch("");
              setSearchResults([]);
              setError("");
            }}
          >
            +
          </button>
        </div>

        {showNewChat && (
          <div className="new-chat-panel">
            <label htmlFor="userSearch">Start a new conversation</label>
            <input
              id="userSearch"
              type="search"
              value={userSearch}
              onChange={(event) => void searchUsers(event.target.value)}
              placeholder="Search username or name..."
              aria-label="Search users"
            />

            {searchingUsers && <p>Searching users...</p>}
            {!searchingUsers &&
              userSearch.trim().length >= 2 &&
              searchResults.length === 0 && <p>No users found.</p>}
            {userSearch.trim().length < 2 && (
              <p>Type at least 2 characters to search.</p>
            )}

            {searchResults.map((result) => (
              <button
                type="button"
                key={result.id}
                disabled={busy}
                onClick={() => void startConversation(result.id)}
              >
                <strong>{result.displayName}</strong>
                <span>@{result.username}</span>
              </button>
            ))}
          </div>
        )}

        <div className="conversation-list">
          {conversations.map((conversation) => {
            const peer = peerFor(conversation, user.id);
            const active = conversation.id === selectedId;
            const latestMessage = latestMessageFor(conversation);

            return (
              <button
                type="button"
                key={conversation.id}
                className={`conversation-item ${active ? "selected" : ""}`}
                onClick={() => setSelectedId(conversation.id)}
              >
                <div className="avatar">
                  {initials(peer?.displayName ?? conversation.title ?? "Group")}
                </div>
                <div className="conversation-summary">
                  <div className="conversation-title">
                    <span>
                      {conversation.title ??
                        peer?.displayName ??
                        "Conversation"}
                    </span>
                  </div>

                  <p>{latestMessage?.content ?? "Start a conversation"}</p>
                </div>
                {(conversation.unreadCount ?? 0) > 0 &&
                  conversation.id !== selectedId && (
                    <span className="unread-badge">
                      {conversation.unreadCount! > 99
                        ? "99+"
                        : conversation.unreadCount}
                    </span>
                  )}
              </button>
            );
          })}

          {conversations.length === 0 && (
            <div className="empty-sidebar">
              <div className="empty-icon">✳</div>
              <p>No conversations yet</p>
              <span>Use + to start a chat with someone.</span>
            </div>
          )}
        </div>

        <div className="sidebar-profile">
          <div className="avatar profile-avatar">
            {initials(user.displayName || user.username)}
          </div>
          <div className="profile-copy">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <button
            type="button"
            className="logout-button"
            onClick={() => void logout()}
            title="Log out"
          >
            ↗
          </button>
        </div>
      </aside>

      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <div className="avatar">
                {initials(
                  peerFor(selectedConversation, user.id)?.displayName ??
                    selectedConversation.title ??
                    "Group",
                )}
              </div>
              <div className="chat-heading-copy">
                <h2>
                  {selectedConversation.title ??
                    peerFor(selectedConversation, user.id)?.displayName ??
                    "Conversation"}
                </h2>
                <p>
                  <span
                    className={`status-dot ${peerOnline ? "online" : ""}`}
                  />
                  {peerOnline ? "Online" : "Offline"}
                </p>
                {typingUsers.length > 0 && (
                  <p className="typing-indicator" aria-live="polite">
                    {typingUsers.map((item) => item.username).join(", ")}
                    {typingUsers.length === 1 ? " is typing…" : " are typing…"}
                  </p>
                )}
              </div>
              <div className="header-pill">Private conversation</div>
            </header>

            <div className="messages-area">
              <div className="conversation-start">
                <div className="start-symbol">✳</div>
                <h3>You&apos;re connected.</h3>
                <p>Messages in this conversation appear here.</p>
              </div>

              {loadingMessages && (
                <p className="inline-status">Loading message history…</p>
              )}
              {!loadingMessages &&
                messages.map((message) => {
                  const own = message.senderId === user.id;
                  return (
                    <div
                      key={message.id}
                      className={`message-row ${own ? "own" : "incoming"}`}
                    >
                      <div className="message-content">
                        <div className="message-bubble">{message.content}</div>

                        <span className="message-time">
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {own ? " · You" : ""}

                          {own &&
                            (() => {
                              const peerReceipts = (
                                message.receipts ?? []
                              ).filter((receipt) => receipt.userId !== user.id);

                              const isRead =
                                peerReceipts.length > 0 &&
                                peerReceipts.every((receipt) => receipt.readAt);

                              const isDelivered =
                                peerReceipts.length > 0 &&
                                peerReceipts.every(
                                  (receipt) => receipt.deliveredAt,
                                );

                              return (
                                <span
                                  style={{
                                    marginLeft: "5px",
                                    color: isRead ? "#53bdeb" : "inherit",
                                    fontWeight: 600,
                                  }}
                                >
                                  {isRead ? "✓✓" : isDelivered ? "✓✓" : "✓"}
                                </span>
                              );
                            })()}
                        </span>
                      </div>
                    </div>
                  );
                })}

              {error && <p className="feedback error chat-error">{error}</p>}

              {notice && <p className="feedback success">{notice}</p>}
              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                placeholder={`Message ${peerFor(selectedConversation, user.id)?.displayName ?? "your group"}…`}
                maxLength={5000}
                aria-label="Message"
              />
              <span className="composer-hint">Enter to send</span>
              <button
                className="send-button"
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Send message"
              >
                {sending ? "…" : "↑"}
              </button>
            </form>
            <p className="composer-footer">
              Be kind. Your conversations are private.
            </p>
          </>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-orbit orbit-a" />
            <div className="welcome-orbit orbit-b" />
            <div className="welcome-symbol">c</div>
            <p className="eyebrow">A LITTLE CLOSER</p>
            <h1>
              Good conversations
              <br />
              start here.
            </h1>
            <p>
              Choose a conversation or start a new one to connect with your
              people.
            </p>
            <button
              type="button"
              className="primary-button welcome-button"
              onClick={() => setShowNewChat(true)}
            >
              Start a conversation <span>→</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
