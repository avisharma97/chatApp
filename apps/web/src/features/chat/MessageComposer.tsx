"use client";

import type { FormEvent, ChangeEvent, DragEvent, RefObject } from "react";

type MessageComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpload: (file?: File) => void;
  onTypingKeyDown?: () => void;
  peerName: string;
  sending: boolean;
  mediaUploading: boolean;
  uploadProgress: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export default function MessageComposer({
  draft,
  onDraftChange,
  onSubmit,
  onUpload,
  onTypingKeyDown,
  peerName,
  sending,
  mediaUploading,
  uploadProgress,
  fileInputRef,
}: MessageComposerProps) {
  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUpload(event.dataTransfer.files[0]);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUpload(event.target.files?.[0]);
    event.target.value = "";
  };

  return (
    <form
      className="composer"
      onSubmit={onSubmit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        hidden
        onChange={handleFileChange}
        aria-label="Choose image or video"
      />

      <button
        className="send-button"
        type="button"
        aria-label="Attach image or video"
        disabled={mediaUploading || sending}
        onClick={() => fileInputRef.current?.click()}
      >
        +
      </button>

      <input
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onTypingKeyDown}
        placeholder={`Message ${peerName || "your group"}…`}
        maxLength={5000}
        aria-label="Message"
      />

      <span className="composer-hint">
        {mediaUploading ? `${uploadProgress}%` : "Enter to send"}
      </span>

      <button
        className="send-button"
        type="submit"
        disabled={!draft.trim() || sending || mediaUploading}
        aria-label="Send message"
      >
        {sending ? "…" : "↑"}
      </button>
    </form>
  );
}
