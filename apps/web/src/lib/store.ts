import { configureStore, createSelector } from "@reduxjs/toolkit";
import chatReducer from "../features/chat/chatSlice";

export const store = configureStore({
  reducer: {
    chat: chatReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Memoized selector: recomputes only when conversations or selected ID changes.
const selectConversations = (state: RootState) => state.chat.conversations;

const selectSelectedConversationId = (state: RootState) =>
  state.chat.selectedConversationId;

export const selectSelectedConversation = createSelector(
  [selectConversations, selectSelectedConversationId],
  (conversations, selectedId) =>
    conversations.find((conversation) => conversation.id === selectedId) ??
    null,
);

export const selectUnreadConversationCount = createSelector(
  [selectConversations],
  (conversations) =>
    conversations.filter((conversation) => (conversation.unreadCount ?? 0) > 0)
      .length,
);
