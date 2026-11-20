import { useEffect, useState } from "react";
import { Bookmark, Bot, Users } from "lucide-react";
import { resolveAssetUrl } from "@/shared/emotes";

export type BotAvatarColor =
  | "azure"
  | "indigo"
  | "violet"
  | "emerald"
  | "cyan"
  | "amber"
  | "rose"
  | "slate";

export interface BotColorPreset {
  id: BotAvatarColor;
  label: string;
  solid: string;
  gradient: string;
}

export const BOT_AVATAR_COLORS: readonly BotColorPreset[] = [
  {
    id: "azure",
    label: "晴空蓝",
    solid: "#0071E3",
    gradient: "linear-gradient(145deg, #3296FF 0%, #0062CC 100%)",
  },
  {
    id: "indigo",
    label: "星际靛",
    solid: "#5856D6",
    gradient: "linear-gradient(145deg, #7674FF 0%, #4643CC 100%)",
  },
  {
    id: "violet",
    label: "极光紫",
    solid: "#8E44EC",
    gradient: "linear-gradient(145deg, #AD62FF 0%, #732CD1 100%)",
  },
  {
    id: "emerald",
    label: "翡翠绿",
    solid: "#10B981",
    gradient: "linear-gradient(145deg, #2ED39A 0%, #099264 100%)",
  },
  {
    id: "cyan",
    label: "冰川青",
    solid: "#06B6D4",
    gradient: "linear-gradient(145deg, #22CEEB 0%, #0888A6 100%)",
  },
  {
    id: "amber",
    label: "琥珀金",
    solid: "#F59E0B",
    gradient: "linear-gradient(145deg, #FFB338 0%, #D97706 100%)",
  },
  {
    id: "rose",
    label: "珊瑚粉",
    solid: "#F43F5E",
    gradient: "linear-gradient(145deg, #FF6682 0%, #D62849 100%)",
  },
  {
    id: "slate",
    label: "钛金灰",
    solid: "#475569",
    gradient: "linear-gradient(145deg, #64748B 0%, #334155 100%)",
  },
] as const;

const BOT_COLOR_MAP: Record<string, BotColorPreset> = Object.fromEntries(
  BOT_AVATAR_COLORS.map((item) => [item.id, item])
);

export function resolveBotAvatarPalette(
  name: string,
  color?: string | null
): BotColorPreset {
  const normalized = color?.trim().toLowerCase() || "";
  if (normalized && BOT_COLOR_MAP[normalized]) {
    return BOT_COLOR_MAP[normalized]!;
  }
  const autoPool = BOT_AVATAR_COLORS.slice(0, 7);
  let hash = 0;
  const seed = name.trim() || "Bot";
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return autoPool[hash % autoPool.length] || BOT_AVATAR_COLORS[0]!;
}

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
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export function Avatar({
  name,
  src,
  emoji,
  kind = "user",
  color,
  size = 40,
  className = "",
}: {
  name: string;
  src?: string;
  emoji?: string;
  kind?: "user" | "bot" | "group" | "saved";
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = src ? resolveAssetUrl(src) : "";
  const showImg = Boolean(resolvedSrc && failedSrc !== resolvedSrc);

  useEffect(() => {
    if (!failedSrc || typeof window === "undefined") return;
    const reset = () => setFailedSrc(null);
    window.addEventListener("online", reset);
    const timer = window.setTimeout(reset, 15_000);
    return () => {
      window.removeEventListener("online", reset);
      window.clearTimeout(timer);
    };
  }, [failedSrc]);
  const radius =
    kind === "group" || kind === "saved" || kind === "bot"
      ? Math.max(8, Math.round(size * 0.28))
      : size;

  if (kind === "saved") {
    return (
      <div
        data-avatar-kind="saved"
        style={{ width: size, height: size, borderRadius: radius }}
        className={`shrink-0 flex items-center justify-center bg-[var(--dl-accent)] text-white shadow-xs ${className}`}
      >
        <Bookmark size={Math.round(size * 0.48)} />
      </div>
    );
  }

  const botPalette = kind === "bot" ? resolveBotAvatarPalette(name, color) : null;
  const explicitBotColor =
    kind === "bot" && color?.trim() && BOT_COLOR_MAP[color.trim().toLowerCase()]
      ? BOT_COLOR_MAP[color.trim().toLowerCase()]
      : null;

  if (kind === "bot" && !showImg && !emoji && botPalette) {
    return (
      <div
        data-avatar-kind="bot"
        data-bot-color={botPalette.id}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundImage: botPalette.gradient,
        }}
        className={`relative shrink-0 overflow-hidden flex items-center justify-center text-white select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_1px_2px_rgba(15,23,42,0.14)] ring-1 ring-black/8 dark:ring-white/14 ${className}`}
      >
        <Bot size={Math.round(size * 0.52)} strokeWidth={2.15} />
      </div>
    );
  }

  return (
    <div
      data-avatar-kind={kind}
      data-bot-color={kind === "bot" ? botPalette?.id : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        ...(showImg && explicitBotColor
          ? { boxShadow: `0 0 0 1.75px ${explicitBotColor.solid}` }
          : {}),
      }}
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
      ) : (
        <span style={{ fontSize: Math.max(12, Math.round(size * 0.38)) }}>
          {(name || "?").trim().slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
