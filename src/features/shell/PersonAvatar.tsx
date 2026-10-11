/**
 * A player's face — or, for a spot with no account, their initials in a
 * dashed ring, so "this person hasn't joined" reads at a glance without a
 * word of text. Same size and shape either way, so a column of them lines up.
 */
export default function PersonAvatar({
  name,
  avatarUrl,
  linked,
  size = 24,
  className = "",
}: {
  name: string;
  avatarUrl: string | null;
  linked: boolean;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?";
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) };

  if (linked && avatarUrl) {
    return (
      <span className={`shrink-0 rounded-full overflow-hidden bg-surface-2 ${className}`} style={style}>
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      </span>
    );
  }
  return (
    <span
      className={`shrink-0 rounded-full flex items-center justify-center font-semibold leading-none ${
        linked ? "bg-graphite text-ivory" : "border border-dashed border-warm-gray/70 text-warm-gray bg-transparent"
      } ${className}`}
      style={style}
      aria-label={linked ? undefined : `${name} — no account`}
    >
      {initials}
    </span>
  );
}
