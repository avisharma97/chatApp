import { describe, expect, it } from "vitest";
import chatReducer, {
  addMessage,
  clearChat,
  setConversations,
  setMessages,
  setMessagesError,
  setMessagesLoading,
  setSelectedConversationId,
  updateMessageReceipt,
  upsertConversation,
  type ChatMessage,
} from "./chatSlice";

const createMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "message-1",
  conversationId: "conversation-1",
  senderId: "user-1",
  clientMessageId: "client-1",
  content: "Hello",
  createdAt: "2026-10-12T10:00:00.000Z",
  receipts: [],
  ...overrides,
});

describe("chatSlice", () => {
  it("starts with the correct initial state", () => {
    const state = chatReducer(undefined, { type: "@@INIT" });

    expect(state.conversations).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.selectedConversationId).toBeNull();
    expect(state.messagesLoading).toBe(false);
    expect(state.messagesError).toBeNull();
  });

  it("stores messages", () => {
    const message = createMessage();

    const state = chatReducer(undefined, setMessages([message]));

    expect(state.messages).toEqual([message]);
  });

  it("does not add duplicate messages by ID", () => {
    const message = createMessage();

    let state = chatReducer(undefined, addMessage(message));
    state = chatReducer(state, addMessage(message));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe("message-1");
  });

  it("allows messages with different IDs", () => {
    let state = chatReducer(undefined, addMessage(createMessage()));

    state = chatReducer(
      state,
      addMessage(
        createMessage({
          id: "message-2",
          clientMessageId: "client-2",
          content: "Second message",
        }),
      ),
    );

    expect(state.messages).toHaveLength(2);
  });

  it("updates an existing delivery receipt", () => {
    const message = createMessage({
      receipts: [
        {
          userId: "user-2",
          deliveredAt: null,
          readAt: null,
        },
      ],
    });

    let state = chatReducer(undefined, addMessage(message));

    state = chatReducer(
      state,
      updateMessageReceipt({
        messageId: "message-1",
        userId: "user-2",
        deliveredAt: "2026-10-12T10:01:00.000Z",
        readAt: null,
      }),
    );

    expect(state.messages[0].receipts?.[0]).toEqual({
      userId: "user-2",
      deliveredAt: "2026-10-12T10:01:00.000Z",
      readAt: null,
    });
  });

  it("adds a receipt when the user does not have one", () => {
    let state = chatReducer(undefined, addMessage(createMessage()));

    state = chatReducer(
      state,
      updateMessageReceipt({
        messageId: "message-1",
        userId: "user-2",
        deliveredAt: null,
        readAt: "2026-10-12T10:02:00.000Z",
      }),
    );

    expect(state.messages[0].receipts).toContainEqual({
      userId: "user-2",
      deliveredAt: null,
      readAt: "2026-10-12T10:02:00.000Z",
    });
  });

  it("does nothing when the receipt message does not exist", () => {
    const state = chatReducer(
      undefined,
      updateMessageReceipt({
        messageId: "missing-message",
        userId: "user-2",
        deliveredAt: null,
        readAt: null,
      }),
    );

    expect(state.messages).toEqual([]);
  });

  it("updates loading and error states", () => {
    let state = chatReducer(undefined, setMessagesLoading(true));

    state = chatReducer(state, setMessagesError("Unable to load messages"));

    expect(state.messagesLoading).toBe(true);
    expect(state.messagesError).toBe("Unable to load messages");

    state = chatReducer(state, setMessagesLoading(false));
    state = chatReducer(state, setMessagesError(null));

    expect(state.messagesLoading).toBe(false);
    expect(state.messagesError).toBeNull();
  });

  it("updates the selected conversation", () => {
    const state = chatReducer(
      undefined,
      setSelectedConversationId("conversation-2"),
    );

    expect(state.selectedConversationId).toBe("conversation-2");
  });

  it("stores conversations", () => {
    const conversations = [
      { id: "conversation-1" },
      { id: "conversation-2" },
    ] as Parameters<typeof setConversations>[0];

    const state = chatReducer(undefined, setConversations(conversations));

    expect(state.conversations).toEqual(conversations);
  });

  it("moves an updated conversation to the beginning without duplicating it", () => {
    const first = { id: "conversation-1" } as Parameters<
      typeof upsertConversation
    >[0];

    const second = { id: "conversation-2" } as Parameters<
      typeof upsertConversation
    >[0];

    let state = chatReducer(undefined, setConversations([first, second]));
    state = chatReducer(state, upsertConversation(second));

    expect(state.conversations.map((item) => item.id)).toEqual([
      "conversation-2",
      "conversation-1",
    ]);
  });

  it("clears chat state", () => {
    let state = chatReducer(undefined, setMessages([createMessage()]));

    state = chatReducer(state, setSelectedConversationId("conversation-1"));
    state = chatReducer(state, setMessagesLoading(true));
    state = chatReducer(state, setMessagesError("Test error"));
    state = chatReducer(state, clearChat());

    expect(state.messages).toEqual([]);
    expect(state.conversations).toEqual([]);
    expect(state.selectedConversationId).toBeNull();
    expect(state.messagesLoading).toBe(false);
    expect(state.messagesError).toBeNull();
  });
});
