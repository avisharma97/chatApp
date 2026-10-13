"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from "react";

import UserAvatar from "@/components/UserAvatar";
import CallControls from "../features/chat/CallControls";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import { useAppDispatch, useAppSelector } from "../lib/hooks";
import { useConversationMessages } from "@/features/chat/useConversationMessages";
import {
  addMessage,
  setMessages,
  setConversations,
  updateMessage,
  deleteMessage,
  updateMessageReceipt,
  upsertConversation,
  setMessagesLoading,
  setMessagesError,
} from "../features/chat/chatSlice";
import MessageComposer from "../features/chat/MessageComposer";
import MessageList from "../features/chat/MessageList";
import type { User, SearchUser, Message, Conversation } from "../types/chat";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(!isFormData && options.body
        ? { "Content-Type": "application/json" }
        : {}),
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
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
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
  const [selectedId, setSelectedId] = useState("");
  const {
    loadMessages,
    loadOlderMessages,
    cancelMessages,
    hasMore,
    loadingOlder,
  } = useConversationMessages(user?.id ?? null);
  const dispatch = useAppDispatch();
  const messages = useAppSelector((state) => state.chat.messages);
  const conversations = useAppSelector((state) => state.chat.conversations);
  const [draft, setDraft] = useState("");
  const loadingMessages = useAppSelector((state) => state.chat.messagesLoading);
  const messagesError = useAppSelector((state) => state.chat.messagesError);
  const [sending, setSending] = useState(false);
  const [socketStatus, setSocketStatus] = useState("Connecting");
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardConversationId, setForwardConversationId] = useState("");
  const [forwarding, setForwarding] = useState(false);
  const [forwardError, setForwardError] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [forwardSuccess, setForwardSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const forwardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const forwardDialogRef = useRef<HTMLElement | null>(null);
  const forwardSelectRef = useRef<HTMLSelectElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const draggedMessageRef = useRef<Message | null>(null);
  const [dragOverConversationId, setDragOverConversationId] = useState<
    string | null
  >(null);
  const pendingScrollRestoreRef = useRef<{
    messageId: string;
    top: number;
    messageCount: number;
  } | null>(null);

  const draftStorageKey =
    user && selectedId ? `chatapp:draft:${user.id}:${selectedId}` : null;

  useLayoutEffect(() => {
    const snapshot = pendingScrollRestoreRef.current;
    const container = messagesAreaRef.current;

    if (!snapshot || !container) return;

    if (messages.length <= snapshot.messageCount) return;

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-message-id]"),
    );

    const anchor = rows.find(
      (row) => row.dataset.messageId === snapshot.messageId,
    );

    if (anchor) {
      const currentTop = anchor.getBoundingClientRect().top;
      container.scrollTop += currentTop - snapshot.top;
    }

    pendingScrollRestoreRef.current = null;
  }, [messages]);

  useEffect(() => {
    if (!draftStorageKey) {
      setDraft("");
      return;
    }

    try {
      setDraft(localStorage.getItem(draftStorageKey) ?? "");
    } catch {
      setDraft("");
    }
  }, [draftStorageKey]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Keep the current selection available to Socket.IO callbacks.
  selectedIdRef.current = selectedId;
  const activeConversationIdRef = useRef<string | null>(null);

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
    dispatch(setConversations(list));
    return list;
  }, [dispatch]);

  useEffect(() => {
    if (authLoading || !user) return;

    let active = true;

    void (async () => {
      try {
        const list = await refreshConversations();

        if (!active || list.length === 0) return;

        const storageKey = `chatapp:last-conversation:${user.id}`;

        let savedId: string | null = null;

        try {
          savedId = localStorage.getItem(storageKey);
        } catch {
          // Storage may be unavailable.
        }

        const conversationId =
          list.find((conversation) => conversation.id === savedId)?.id ??
          list[0].id;

        setSelectedId(conversationId);
      } catch (error) {
        if (active) {
          console.error("Failed to restore conversations:", error);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [authLoading, user?.id, refreshConversations, dispatch]);

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
    activeConversationIdRef.current = selectedId ?? null;

    if (!selectedId || !user) {
      cancelMessages();
      dispatch(setMessages([]));
      dispatch(setMessagesLoading(false));
      dispatch(setMessagesError(null));
      return;
    }

    const controller = new AbortController();

    void loadMessages(selectedId);

    return () => {
      controller.abort();
    };
  }, [selectedId, user, loadMessages, dispatch]);

  useEffect(() => {
    if (!user || !selectedId) return;

    try {
      localStorage.setItem(`chatapp:last-conversation:${user.id}`, selectedId);
    } catch {
      // Continue without persistence if storage is unavailable.
    }
  }, [user?.id, selectedId]);

  const uploadMedia = (file?: File) => {
    if (!file || !selectedConversation?.id || mediaUploading) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ];

    if (!allowedTypes.includes(file.type)) {
      setUploadError("Please select a supported image or video.");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setUploadError("File size must be 25 MB or less.");
      return;
    }

    setMediaUploading(true);
    setUploadProgress(0);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientMessageId", crypto.randomUUID());
    formData.append("caption", draft.trim());

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${API}/api/v1/conversations/${selectedConversation.id}/media`,
    );
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);

        if (xhr.status < 200 || xhr.status >= 300) {
          setUploadError(data.error ?? "Upload failed. Please try again.");
          return;
        }

        if (data.message) {
          dispatch(addMessage(data.message));
          handleDraftChange("");
        } else {
          setUploadError("Upload succeeded, but no message was returned.");
        }
      } catch {
        setUploadError("Invalid server response. Please retry.");
      } finally {
        setMediaUploading(false);
        setUploadProgress(0);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    xhr.onerror = () => {
      setUploadError("Network error during upload. Please retry.");
      setMediaUploading(false);
      setUploadProgress(0);
    };

    xhr.onabort = () => {
      setMediaUploading(false);
      setUploadProgress(0);
    };

    xhr.send(formData);
  };

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
              if (selectedIdRef.current === conversationId) {
                void loadMessages(conversationId);
              }

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
      dispatch(addMessage(message));
    });
    socket.on("message:updated", (message: Message) => {
      if (message.conversationId !== selectedIdRef.current) return;

      const content = message.content;

      dispatch(
        updateMessage({
          id: message.id,
          content,
          editedAt: message.editedAt ?? new Date().toISOString(),
        }),
      );
    });

    socket.on(
      "message:deleted",
      (event: {
        id: string;
        conversationId: string;
        deletedAt: string | null;
      }) => {
        if (event.conversationId !== selectedIdRef.current) return;

        dispatch(
          deleteMessage({
            id: event.id,
            deletedAt: event.deletedAt ?? new Date().toISOString(),
          }),
        );
      },
    );
    socket.on(
      "message:receipt",
      (receipt: {
        messageId: string;
        userId: string;
        deliveredAt: string | null;
        readAt: string | null;
      }) => {
        dispatch(
          updateMessageReceipt({
            messageId: receipt.messageId,
            userId: receipt.userId,
            deliveredAt: receipt.deliveredAt ?? null,
            readAt: receipt.readAt ?? null,
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

        const username: string =
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
  // Join/leave rooms and mark messages as read.
  useEffect(() => {
    setTypingUsers([]);

    const socket = socketRef.current;

    if (!socket?.connected) return;

    const previousId = previousSelectedIdRef.current;

    if (previousId && previousId !== selectedId) {
      socket.emit("conversation:leave", {
        conversationId: previousId,
      });
    }

    if (selectedId && selectedId !== previousId) {
      socket.emit(
        "conversation:join",
        { conversationId: selectedId },
        (result: { ok: boolean }) => {
          if (result.ok && selectedIdRef.current === selectedId) {
            socket.emit("conversation:read", {
              conversationId: selectedId,
            });
          }
        },
      );
    }

    previousSelectedIdRef.current = selectedId;

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [selectedId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!forwardMessage) return;

    const previousFocus = document.activeElement;

    requestAnimationFrame(() => {
      forwardSelectRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !forwarding) {
        event.preventDefault();
        setForwardMessage(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      requestAnimationFrame(() => {
        if (forwardTriggerRef.current?.isConnected) {
          forwardTriggerRef.current.focus();
        } else if (
          previousFocus instanceof HTMLElement &&
          previousFocus.isConnected
        ) {
          previousFocus.focus();
        }
      });
    };
  }, [forwardMessage, forwarding]);

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
      dispatch(upsertConversation(data.conversation));

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
    if (user && selectedId) {
      try {
        const key = `chatapp:draft:${user.id}:${selectedId}`;

        if (value.length > 0) {
          localStorage.setItem(key, value);
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // Draft persistence is best-effort.
      }
    }
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

  async function editMessage(message: Message, content: string): Promise<void> {
    const { message: updated } = await api<{ message: Message }>(
      `/api/v1/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ content }),
      },
    );

    dispatch(
      updateMessage({
        id: updated.id,
        content: updated.content,
        editedAt: updated.editedAt ?? new Date().toISOString(),
      }),
    );
  }

  async function deleteChatMessage(message: Message): Promise<void> {
    const { message: deleted } = await api<{ message: Message }>(
      `/api/v1/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message.id)}`,
      {
        method: "DELETE",
      },
    );

    dispatch(
      deleteMessage({
        id: deleted.id,
        deletedAt: deleted.deletedAt ?? new Date().toISOString(),
      }),
    );
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId || sending) return;

    setError("");
    setSending(true);
    const clientMessageId = crypto.randomUUID();
    try {
      const conversation = conversations.find((item) => item.id === selectedId);

      if (!conversation || !user) {
        throw new Error("CONVERSATION_NOT_FOUND");
      }

      const data = await api<{ message: Message }>(
        `/api/v1/conversations/${selectedId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            clientMessageId,
            content,
          }),
        },
      );
      dispatch(addMessage(data.message));
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      socketRef.current?.emit("typing:stop", {
        conversationId: selectedId,
      });
      if (user && selectedId) {
        try {
          localStorage.removeItem(`chatapp:draft:${user.id}:${selectedId}`);
        } catch {
          // Sending the message must not depend on localStorage.
        }
      }
      setDraft("");
      void refreshConversations().catch(() => undefined);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }
  const handleForwardMessage = async (
    messageToForward: Message | null = forwardMessage,
    destinationId: string = forwardConversationId,
    closeDialog = true,
  ) => {
    if (!messageToForward || !destinationId || forwarding) return;
    if (messageToForward.conversationId === destinationId) return;
    setForwardSuccess("");
    setForwarding(true);
    setForwardError("");

    try {
      const data = await api<{ message: Message; duplicate?: boolean }>(
        `/api/v1/conversations/${messageToForward.conversationId}/messages/${messageToForward.id}/forward`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinationConversationId: destinationId,
            clientMessageId: crypto.randomUUID(),
          }),
        },
      );
      if (destinationId === selectedId) {
        dispatch(addMessage(data.message));
      }

      await refreshConversations();
      setForwardSuccess("Message forwarded successfully.");
      setError("");

      // Open the destination conversation after forwarding.
      setSelectedId(destinationId);

      if (closeDialog) {
        setForwardMessage(null);
        setForwardConversationId("");
        setForwardError("");
      }

      setError("");
    } catch (error) {
      setForwardSuccess("");
      const message =
        error instanceof Error
          ? error.message
          : "Forward failed. Please retry.";

      if (closeDialog) {
        setForwardError(message);
      } else {
        setError(message);
      }
    } finally {
      setForwarding(false);
      draggedMessageRef.current = null;
      setDragOverConversationId(null);
    }
  };

  function openProfileEditor() {
    if (!user) return;

    setProfileName(user.displayName);
    setProfileUsername(user.username);
    setProfileError("");
    setAvatarPreview(null);
    setShowProfileEditor(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (profileSaving) return;

    setProfileSaving(true);
    setProfileError("");

    try {
      const result = await api<{ user: User }>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: profileName,
          username: profileUsername,
        }),
      });

      setUser(result.user);
      setShowProfileEditor(false);
    } catch (error) {
      setProfileError(`Avatar upload failed: ${errorText(error)}`);
    } finally {
      setProfileSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!user) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProfileError("Choose a JPG, PNG or WebP image.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileError("Avatar must be 5 MB or smaller.");
      return;
    }

    setAvatarUploading(true);
    setProfileError("");

    try {
      const form = new FormData();
      form.append("file", file);

      // Do not set Content-Type manually; fetch adds the multipart boundary.
      const result = await api<{ user: User }>("/api/v1/conversations/avatar", {
        method: "POST",
        body: form,
      });

      setUser(result.user);
      console.log("Avatar URL returned by API:", result.user.avatarUrl);
      setAvatarPreview(null);
    } catch (error) {
      setProfileError(`Profile save failed: ${errorText(error)}`);
    } finally {
      setAvatarUploading(false);
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
            {authMode === "login" && (
              <div className="text-right">
                <Link
                  href="/forgot-password"
                  className="text-sm text-blue-400 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            )}

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

          <p className="mt-5 text-center text-sm text-gray-400">
            {authMode === "login"
              ? "Don't have an account? "
              : "Already have an account? "}

            <button
              type="button"
              className="font-medium text-blue-400 hover:underline"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setError("");
                setNotice("");
                setPassword("");
              }}
            >
              {authMode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>

          <div className="auth-divider">
            <span>OR</span>
          </div>

          <button
            className="google-button"
            type="button"
            onClick={() => {
              window.location.href = `${API}/api/v1/auth/google`;
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
    <main
      className={`app-shell ${selectedId ? "has-selected-chat" : "show-conversations"}`}
    >
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">c</div>
          <span>chatapp</span>
          <span className="brand-dot" />
        </div>

        <Link href="/calls" className="sidebar-calls-link">
          <span aria-hidden="true">◷</span>
          Call history
        </Link>
        <div className="new-chat-panel">
          <div className="user-search-box">
            <span aria-hidden="true">⌕</span>
            <input
              id="userSearch"
              type="search"
              value={userSearch}
              onChange={(event) => void searchUsers(event.target.value)}
              placeholder="Search people..."
              aria-label="Search users"
            />
            {searchingUsers && (
              <span className="search-spinner" aria-label="Searching">
                …
              </span>
            )}
          </div>

          {userSearch.trim().length >= 2 &&
            !searchingUsers &&
            searchResults.length === 0 && <p>No users found.</p>}

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

        <div className="conversation-list">
          {conversations.map((conversation) => {
            const peer = peerFor(conversation, user.id);
            const active = conversation.id === selectedId;
            const latestMessage = latestMessageFor(conversation);

            return (
              <button
                type="button"
                key={conversation.id}
                className={`conversation-item ${active ? "selected" : ""} ${
                  dragOverConversationId === conversation.id
                    ? "drop-target"
                    : ""
                }`}
                onClick={() => {
                  if (draggedMessageRef.current) return;
                  setSelectedId(conversation.id);
                }}
                onDragOver={(event) => {
                  if (
                    draggedMessageRef.current &&
                    draggedMessageRef.current.conversationId !== conversation.id
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setDragOverConversationId(conversation.id);
                  }
                }}
                onDragEnter={(event) => {
                  if (
                    draggedMessageRef.current &&
                    draggedMessageRef.current.conversationId !== conversation.id
                  ) {
                    event.preventDefault();
                    setDragOverConversationId(conversation.id);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  ) {
                    setDragOverConversationId((current) =>
                      current === conversation.id ? null : current,
                    );
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();

                  const message = draggedMessageRef.current;
                  setDragOverConversationId(null);

                  if (message && message.conversationId !== conversation.id) {
                    void handleForwardMessage(message, conversation.id, false);
                  } else {
                    draggedMessageRef.current = null;
                  }
                }}
              >
                <div className="avatar">
                  <UserAvatar
                    name={
                      peer?.displayName ??
                      peer?.username ??
                      conversation.title ??
                      "User"
                    }
                    avatarUrl={peer?.avatarUrl}
                  />

                  <span className="avatar-fallback">
                    <UserAvatar
                      name={
                        peer?.displayName ??
                        peer?.username ??
                        conversation.title ??
                        "User"
                      }
                      avatarUrl={peer?.avatarUrl}
                    />
                  </span>
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
          <button
            type="button"
            className="avatar profile-avatar"
            onClick={openProfileEditor}
            aria-label="Edit profile"
            title="Edit profile"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              initials(user.displayName || user.username)
            )}
          </button>
          <div className="profile-copy">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
            <button type="button" onClick={openProfileEditor}>
              Edit profile
            </button>
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
      {showProfileEditor && (
        <div className="profile-editor-overlay">
          <form className="profile-editor" onSubmit={saveProfile}>
            <h2>Edit profile</h2>

            <div className="profile-editor-avatar">
              {avatarPreview || user?.avatarUrl ? (
                <img
                  src={avatarPreview ?? user?.avatarUrl ?? ""}
                  alt="Profile preview"
                />
              ) : (
                <span>{initials(user?.displayName ?? "")}</span>
              )}
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;

                setAvatarPreview(URL.createObjectURL(file));
                void uploadAvatar(file);
                event.target.value = "";
              }}
            />

            <button
              type="button"
              disabled={avatarUploading}
              onClick={() => avatarInputRef.current?.click()}
            >
              {avatarUploading ? "Uploading…" : "Change photo"}
            </button>

            <label htmlFor="profile-display-name">Display name</label>
            <input
              id="profile-display-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={80}
              required
            />

            <label htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              value={profileUsername}
              onChange={(event) => setProfileUsername(event.target.value)}
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]+"
              required
            />

            {profileError && <p role="alert">{profileError}</p>}

            <div className="profile-editor-actions">
              <button
                type="button"
                onClick={() => {
                  setShowProfileEditor(false);
                  setAvatarPreview(null);
                  setProfileError("");
                }}
              >
                Cancel
              </button>

              <button type="submit" disabled={profileSaving}>
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </form>
        </div>
      )}
      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <button
                type="button"
                className="mobile-back-button"
                onClick={() => setSelectedId("")}
                aria-label="Back to conversations"
              >
                ←
              </button>

              <UserAvatar
                name={
                  peerFor(selectedConversation, user.id)?.displayName ??
                  peerFor(selectedConversation, user.id)?.username ??
                  selectedConversation?.title ??
                  "User"
                }
                avatarUrl={peerFor(selectedConversation, user.id)?.avatarUrl}
              />

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

              <div className="chat-header-actions">
                <div className="header-pill">Private conversation</div>

                <CallControls
                  socket={socketRef.current}
                  conversationId={selectedId || null}
                  userId={user.id}
                  peerName={
                    peerFor(selectedConversation, user.id)?.displayName ??
                    selectedConversation.title ??
                    "Chat user"
                  }
                  peerAvatarUrl={
                    peerFor(selectedConversation, user.id)?.avatarUrl ?? null
                  }
                />
              </div>
            </header>

            <div className="messages-area" ref={messagesAreaRef}>
              <div className="conversation-start">
                <div className="start-symbol">✳</div>
                <h3>You&apos;re connected.</h3>
                <p>Messages in this conversation appear here.</p>
              </div>

              {hasMore && (
                <div className="load-older-container">
                  <button
                    type="button"
                    className="load-older-button"
                    disabled={loadingOlder || !selectedId}
                    onClick={() => {
                      if (!selectedId || loadingOlder) return;

                      const container = messagesAreaRef.current;
                      if (!container) return;

                      if (!selectedId || loadingOlder) return;

                      const containerTop =
                        container.getBoundingClientRect().top;

                      const rows = Array.from(
                        container.querySelectorAll<HTMLElement>(
                          "[data-message-id]",
                        ),
                      );

                      const firstVisibleRow = rows.find(
                        (row) =>
                          row.getBoundingClientRect().bottom > containerTop,
                      );

                      if (firstVisibleRow?.dataset.messageId) {
                        pendingScrollRestoreRef.current = {
                          messageId: firstVisibleRow.dataset.messageId,
                          top: firstVisibleRow.getBoundingClientRect().top,
                          messageCount: messages.length,
                        };
                      }

                      void loadOlderMessages(selectedId);
                    }}
                  >
                    {loadingOlder
                      ? "Loading older messages..."
                      : "Load older messages"}
                  </button>
                </div>
              )}

              <MessageList
                messages={messages}
                currentUserId={user.id}
                loading={loadingMessages}
                error={messagesError}
                onRetry={() => {
                  if (selectedId) {
                    void loadMessages(selectedId);
                  }
                }}
                onForward={(message, trigger) => {
                  forwardTriggerRef.current = trigger;
                  setForwardMessage(message);
                  setForwardConversationId("");
                  setForwardError("");
                }}
                onDragStart={(message, event) => {
                  draggedMessageRef.current = message;
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("text/plain", message.id);
                }}
                onEdit={editMessage}
                onDelete={deleteChatMessage}
              />
              {forwardMessage && (
                <div
                  role="presentation"
                  className="forward-overlay"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget && !forwarding) {
                      setForwardMessage(null);
                    }
                  }}
                >
                  <section
                    ref={forwardDialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="forward-dialog-title"
                    aria-describedby="forward-dialog-description"
                    className="forward-dialog"
                    onKeyDown={(event) => {
                      if (event.key !== "Tab") return;

                      const focusable =
                        event.currentTarget.querySelectorAll<HTMLElement>(
                          'button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
                        );

                      if (focusable.length === 0) {
                        event.preventDefault();
                        return;
                      }

                      const first = focusable[0];
                      const last = focusable[focusable.length - 1];

                      if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                      } else if (
                        !event.shiftKey &&
                        document.activeElement === last
                      ) {
                        event.preventDefault();
                        first.focus();
                      }
                    }}
                  >
                    <h2 id="forward-dialog-title">Forward message</h2>

                    <p id="forward-dialog-description">
                      {forwardMessage.mediaUrl
                        ? forwardMessage.mediaResourceType === "video"
                          ? "Video attachment"
                          : forwardMessage.mediaResourceType === "image"
                            ? "Image attachment"
                            : "File attachment"
                        : forwardMessage.content || "Message"}
                    </p>

                    <label htmlFor="forward-conversation">
                      Destination conversation
                    </label>

                    <select
                      ref={forwardSelectRef}
                      id="forward-conversation"
                      value={forwardConversationId}
                      onChange={(event) =>
                        setForwardConversationId(event.target.value)
                      }
                      required
                    >
                      <option value="">Choose a conversation</option>

                      {conversations
                        .filter(
                          (conversation) => conversation.id !== selectedId,
                        )
                        .map((conversation) => (
                          <option key={conversation.id} value={conversation.id}>
                            {conversation.title ||
                              conversation.members
                                .filter((member) => member.userId !== user.id)
                                .map((member) => member.user.displayName)
                                .join(", ") ||
                              "Conversation"}
                          </option>
                        ))}
                    </select>

                    {forwardError && (
                      <p role="alert" aria-live="assertive">
                        {forwardError}
                      </p>
                    )}

                    <div className="forward-actions">
                      <button
                        type="button"
                        disabled={forwarding}
                        onClick={() => setForwardMessage(null)}
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        disabled={!forwardConversationId || forwarding}
                        onClick={() => {
                          void handleForwardMessage();
                        }}
                      >
                        {forwarding ? "Forwarding…" : "Forward"}
                      </button>
                    </div>
                  </section>
                </div>
              )}
              {error && <p className="feedback error chat-error">{error}</p>}

              {notice && <p className="feedback success">{notice}</p>}
              <div ref={bottomRef} />
            </div>

            <MessageComposer
              draft={draft}
              onDraftChange={handleDraftChange}
              onSubmit={sendMessage}
              onUpload={(file) => {
                void uploadMedia(file);
              }}
              peerName={
                peerFor(selectedConversation, user.id)?.displayName ??
                "your group"
              }
              sending={sending}
              mediaUploading={mediaUploading}
              uploadProgress={uploadProgress}
              fileInputRef={fileInputRef}
            />

            {mediaUploading && (
              <progress
                value={uploadProgress}
                max={100}
                aria-label="Media upload progress"
              />
            )}

            {uploadError && (
              <div role="alert">
                <p>{uploadError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setUploadError("");
                    fileInputRef.current?.click();
                  }}
                >
                  Choose file again
                </button>
              </div>
            )}
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
