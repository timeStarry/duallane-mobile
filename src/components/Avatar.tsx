import { useState } from "react";
import { Bookmark, Bot, Users } from "lucide-react";
import { resolveAssetUrl } from "@/shared/emotes";

const AVATAR_TONES = [
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
];

function pickTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export function Avatar({
  name,
  src,
  emoji,
  kind = "user",
  size = 40,
  className = "",
}: {
  name: string;
  src?: string;
  emoji?: string;
  kind?: "user" | "bot" | "group" | "saved";
  size?: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = src ? resolveAssetUrl(src) : "";
  const showImg = Boolean(resolvedSrc && failedSrc !== resolvedSrc);
  const radius = kind === "group" || kind === "saved" ? Math.round(size * 0.3) : size;

  if (kind === "saved") {
    return (
      <div
        style={{ width: size, height: size, borderRadius: radius }}
        className={`shrink-0 flex items-center justify-center bg-[var(--dl-accent)] text-white shadow-xs ${className}`}
      >
        <Bookmark size={Math.round(size * 0.48)} />
      </div>
    );
  }

  return (
    <div
      style={{ width: size, height: size, borderRadius: radius }}
      className={`relative shrink-0 overflow-hidden flex items-center justify-center font-semibold select-none border border-[var(--dl-border)] ${pickTone(
        name || kind
      )} ${className}`}
    >
      {showImg ? (
        <img
          src={resolvedSrc}
          alt={name}
          onError={() => setFailedSrc(resolvedSrc)}
          className="w-full h-full object-cover"
        />
      ) : emoji ? (
        <span style={{ fontSize: Math.round(size * 0.5) }} className="leading-none">
          {emoji}
        </span>
      ) : kind === "group" ? (
        <Users size={Math.round(size * 0.46)} />
      ) : kind === "bot" ? (
        <Bot size={Math.round(size * 0.48)} />
      ) : (
        <span style={{ fontSize: Math.max(12, Math.round(size * 0.38)) }}>
          {(name || "?").trim().slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
