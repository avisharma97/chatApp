import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MessageList from "./MessageList";
import type { Message } from "../../types/chat";

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "message-1",
  conversationId: "conversation-1",
  senderId: "user-1",
  content: "Hello there",
  createdAt: "2026-10-12T10:00:00.000Z",
  ...overrides,
});

const defaultProps = {
  messages: [] as Message[],
  currentUserId: "user-1",
  loading: false,
  error: null,
  onRetry: vi.fn(),
  onForward: vi.fn(),
};

describe("MessageList", () => {
  it("shows loading status", () => {
    render(<MessageList {...defaultProps} loading />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading message history",
    );
  });

  it("shows an error and retries on click", () => {
    const onRetry = vi.fn();

    render(
      <MessageList {...defaultProps} error="Network error" onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Network error");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the empty state", () => {
    render(<MessageList {...defaultProps} />);

    expect(
      screen.getByText("No messages yet. Start the conversation!"),
    ).toBeInTheDocument();
  });

  it("renders own and incoming messages", () => {
    const messages = [
      createMessage({ id: "own-message", content: "My message" }),
      createMessage({
        id: "incoming-message",
        senderId: "user-2",
        content: "Their message",
      }),
    ];

    const { container } = render(
      <MessageList {...defaultProps} messages={messages} />,
    );

    expect(screen.getByText("My message")).toBeInTheDocument();
    expect(screen.getByText("Their message")).toBeInTheDocument();
    expect(container.querySelector(".message-row.own")).toBeInTheDocument();
    expect(
      container.querySelector(".message-row.incoming"),
    ).toBeInTheDocument();
  });

  it("renders an image with accessible alternative text", () => {
    const message = createMessage({
      content: "",
      mediaUrl: "https://example.com/image.jpg",
      mediaResourceType: "image",
      mediaOriginalName: "photo.jpg",
    });

    render(<MessageList {...defaultProps} messages={[message]} />);

    expect(screen.getByRole("img", { name: "photo.jpg" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open image: photo.jpg" }),
    ).toHaveAttribute("href", "https://example.com/image.jpg");
  });

  it("renders a video with controls", () => {
    const message = createMessage({
      content: "",
      mediaUrl: "https://example.com/video.mp4",
      mediaResourceType: "video",
      mediaOriginalName: "clip.mp4",
    });

    render(<MessageList {...defaultProps} messages={[message]} />);

    const video = screen.getByLabelText("clip.mp4");

    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("controls");
  });

  it("passes the selected message and trigger to the forward callback", () => {
    const onForward = vi.fn();
    const message = createMessage();

    render(
      <MessageList
        {...defaultProps}
        messages={[message]}
        onForward={onForward}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forward message" }));

    expect(onForward).toHaveBeenCalledOnce();
    expect(onForward.mock.calls[0][0]).toEqual(message);
    expect(onForward.mock.calls[0][1]).toBeInstanceOf(HTMLButtonElement);
  });

  it("does not show stale messages while loading or in an error state", () => {
    const message = createMessage();

    const { rerender } = render(
      <MessageList {...defaultProps} messages={[message]} loading />,
    );

    expect(screen.queryByText("Hello there")).not.toBeInTheDocument();

    rerender(
      <MessageList
        {...defaultProps}
        messages={[message]}
        error="Request failed"
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Hello there")).not.toBeInTheDocument();
  });
});
