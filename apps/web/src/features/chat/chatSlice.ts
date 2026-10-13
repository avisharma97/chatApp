import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Conversation, Message } from "../../types/chat";

export type ChatMessage = {
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

type ChatState = {
  conversations: Conversation[];
  messages: Message[];
  selectedConversationId: string | null;
  messagesLoading: boolean;
  messagesError: string | null;
};

const initialState: ChatState = {
  conversations: [],
  messages: [],
  selectedConversationId: null,
  messagesLoading: false,
  messagesError: null,
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    setConversations(state, action: PayloadAction<Conversation[]>) {
      state.conversations = action.payload;
    },

    setMessages(state, action: PayloadAction<ChatMessage[]>) {
      state.messages = action.payload;
    },
    prependMessages(state, action: PayloadAction<ChatMessage[]>) {
      const existingIds = new Set(state.messages.map((message) => message.id));

      const olderMessages = action.payload.filter((message) => {
        if (existingIds.has(message.id)) return false;
        existingIds.add(message.id);
        return true;
      });

      state.messages = [...olderMessages, ...state.messages];
    },

    addMessage(state, action: PayloadAction<ChatMessage>) {
      const incoming = action.payload;

      // Prevent duplicate messages arriving from REST and Socket.IO.
      if (!state.messages.some((message) => message.id === incoming.id)) {
        state.messages.push(incoming);
      }
    },
    updateMessage(
      state,
      action: PayloadAction<{
        id: string;
        content: string;
        editedAt: string;
      }>,
    ) {
      const message = state.messages.find(
        (item) => item.id === action.payload.id,
      );

      if (!message || message.deletedAt) return;

      message.content = action.payload.content;
      message.editedAt = action.payload.editedAt;
    },

    deleteMessage(
      state,
      action: PayloadAction<{
        id: string;
        deletedAt: string;
      }>,
    ) {
      const message = state.messages.find(
        (item) => item.id === action.payload.id,
      );

      if (!message) return;

      message.content = "";
      message.deletedAt = action.payload.deletedAt;
    },
    upsertConversation(state, action: PayloadAction<Conversation>) {
      const conversation = action.payload;

      state.conversations = [
        conversation,
        ...state.conversations.filter((item) => item.id !== conversation.id),
      ];
    },
    updateMessageReceipt(
      state,
      action: PayloadAction<{
        messageId: string;
        userId: string;
        deliveredAt: string | null;
        readAt: string | null;
      }>,
    ) {
      const { messageId, userId, deliveredAt, readAt } = action.payload;
      const message = state.messages.find((item) => item.id === messageId);

      if (!message) return;

      const receipts = message.receipts ?? [];
      const existing = receipts.find((receipt) => receipt.userId === userId);

      if (existing) {
        if (deliveredAt !== null) existing.deliveredAt = deliveredAt;
        if (readAt !== null) existing.readAt = readAt;
      } else {
        receipts.push({ userId, deliveredAt, readAt });
      }

      message.receipts = receipts;
    },

    setSelectedConversationId(state, action: PayloadAction<string | null>) {
      state.selectedConversationId = action.payload;
    },

    setMessagesLoading(state, action: PayloadAction<boolean>) {
      state.messagesLoading = action.payload;
    },

    setMessagesError(state, action: PayloadAction<string | null>) {
      state.messagesError = action.payload;
    },

    clearChat(state) {
      state.conversations = [];
      state.messages = [];
      state.selectedConversationId = null;
      state.messagesLoading = false;
      state.messagesError = null;
    },
  },
});

export const {
  setConversations,
  setMessages,
  addMessage,
  prependMessages,
  updateMessageReceipt,
  setSelectedConversationId,
  setMessagesLoading,
  setMessagesError,
  clearChat,
  upsertConversation,
  updateMessage,
  deleteMessage,
} = chatSlice.actions;

export default chatSlice.reducer;
