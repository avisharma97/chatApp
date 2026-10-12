import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import MessageComposer from "./MessageComposer";

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    draft: "",
    onDraftChange: vi.fn(),
    onSubmit: vi.fn((event) => event.preventDefault()),
    onUpload: vi.fn(),
    peerName: "Alice",
    sending: false,
    mediaUploading: false,
    uploadProgress: 0,
    fileInputRef: createRef<HTMLInputElement>(),
    ...overrides,
  };

  return { ...render(<MessageComposer {...props} />), props };
}

describe("MessageComposer", () => {
  it("disables send when the draft is empty", () => {
    setup();

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("disables send when the draft contains only whitespace", () => {
    setup({ draft: "   " });

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("enables send when the draft contains text", () => {
    setup({ draft: "Hello" });

    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("disables send while a message is being sent", () => {
    setup({ draft: "Hello", sending: true });

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("disables send while media is uploading", () => {
    setup({ draft: "Hello", mediaUploading: true });

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("forwards draft changes to the parent", () => {
    const onDraftChange = vi.fn();

    setup({ onDraftChange });

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello Alice" },
    });

    expect(onDraftChange).toHaveBeenCalledWith("Hello Alice");
  });

  it("submits the form when send is clicked", () => {
    const { props } = setup({ draft: "Hello" });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("shows upload progress and disables attachment during upload", () => {
    setup({ mediaUploading: true, uploadProgress: 45, draft: "Hello" });

    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Attach image or video" }),
    ).toBeDisabled();
  });

  it("supports keyboard input in the message field", () => {
    const onTypingKeyDown = vi.fn();

    setup({ onTypingKeyDown });

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), {
      key: "a",
    });

    expect(onTypingKeyDown).toHaveBeenCalledOnce();
  });
});
