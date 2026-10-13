"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch } from "../../lib/hooks";
import {
  setMessages,
  setMessagesError,
  setMessagesLoading,
  prependMessages,
} from "./chatSlice";
import type { Message } from "../../types/chat";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function useConversationMessages(userId: string | null) {
  const dispatch = useAppDispatch();
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequestRef = useRef<AbortController | null>(null);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!userId) return;
      activeRequestRef.current?.abort();

      const controller = new AbortController();
      activeRequestRef.current = controller;
      const requestId = ++requestIdRef.current;
      setHasMore(false);
      setNextCursor(null);
      olderRequestRef.current?.abort();
      olderRequestRef.current = null;
      setLoadingOlder(false);
      dispatch(setMessagesLoading(true));
      dispatch(setMessagesError(null));

      try {
        const response = await fetch(
          `${API}/api/v1/conversations/${conversationId}/messages?limit=50`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );

        const data = (await response.json()) as {
          messages?: Message[];
          pagination?: {
            hasMore: boolean;
            nextCursor: string | null;
          };
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load messages");
        }

        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }

        dispatch(setMessages(data.messages ?? []));
        setHasMore(data.pagination?.hasMore ?? false);
        setNextCursor(data.pagination?.nextCursor ?? null);
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }

        dispatch(
          setMessagesError(
            error instanceof Error ? error.message : "Failed to load messages",
          ),
        );
      } finally {
        if (requestId === requestIdRef.current) {
          dispatch(setMessagesLoading(false));
          activeRequestRef.current = null;
        }
      }
    },
    [dispatch, userId],
  );

  const loadOlderMessages = useCallback(
    async (conversationId: string) => {
      if (!userId) return;
      if (!hasMore || !nextCursor || loadingOlder) return;

      olderRequestRef.current?.abort();

      const controller = new AbortController();
      olderRequestRef.current = controller;
      const requestId = requestIdRef.current;

      setLoadingOlder(true);
      dispatch(setMessagesError(null));

      try {
        const response = await fetch(
          `${API}/api/v1/conversations/${conversationId}/messages?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );

        const data = (await response.json()) as {
          messages?: Message[];
          pagination?: {
            hasMore: boolean;
            nextCursor: string | null;
          };
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load older messages");
        }

        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }

        dispatch(prependMessages(data.messages ?? []));
        setHasMore(data.pagination?.hasMore ?? false);
        setNextCursor(data.pagination?.nextCursor ?? null);
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }

        dispatch(
          setMessagesError(
            error instanceof Error
              ? error.message
              : "Failed to load older messages",
          ),
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingOlder(false);
          olderRequestRef.current = null;
        }
      }
    },
    [dispatch, hasMore, nextCursor, loadingOlder, userId],
  );

  const cancelMessages = useCallback(() => {
    olderRequestRef.current?.abort();
    olderRequestRef.current = null;
    setLoadingOlder(false);
    requestIdRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    dispatch(setMessagesLoading(false));
  }, [dispatch]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      activeRequestRef.current?.abort();
    },
    [],
  );

  return {
    loadMessages,
    loadOlderMessages,
    cancelMessages,
    hasMore,
    loadingOlder,
    userId,
  };
}
