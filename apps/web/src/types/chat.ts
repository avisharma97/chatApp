export type User = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type SearchUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type Member = {
  conversationId?: string;
  userId: string;
  role?: string;
  joinedAt?: string;
  lastReadAt?: string | null;
  user: User | SearchUser;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId?: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  mediaUrl?: string | null;
  mediaPublicId?: string | null;
  mediaMimeType?: string | null;
  mediaResourceType?: string | null;
  mediaSize?: number | null;
  mediaOriginalName?: string | null;
  receipts?: {
    userId: string;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
};

export type Conversation = {
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
