type UserAvatarProps = {
  name: string;
  avatarUrl?: string | null;
  className?: string;
};

export default function UserAvatar({
  name,
  avatarUrl,
  className = "",
}: UserAvatarProps) {
  const letters =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  const hasCustomAvatar =
    Boolean(avatarUrl) && avatarUrl!.includes("res.cloudinary.com");

  return (
    <div className={`avatar ${className}`}>
      {hasCustomAvatar && (
        <img
          src={avatarUrl ?? undefined}
          alt=""
          className="avatar-image"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}

      <span className="avatar-fallback">{letters}</span>
    </div>
  );
}
