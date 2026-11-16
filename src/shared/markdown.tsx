import React, { useState } from "react";
import { Check, Copy, ExternalLink, ShieldAlert } from "lucide-react";
import { BottomSheet } from "@/components/BottomSheet";
import { nativeBridge } from "@/native/bridge";
import { getBuiltInEmote, resolveAssetUrl } from "@/shared/emotes";
import { useNavStore } from "@/store/nav-store";

export const WHITELISTED_EXTERNAL_DOMAINS: readonly string[] = [
  "duallane.tsio.top",
  "tsio.top",
  "github.com",
  "gist.github.com",
  "npmjs.com",
  "pkg.go.dev",
  "crates.io",
  "pypi.org",
  "developer.mozilla.org",
  "stackoverflow.com",
  "arxiv.org",
  "bilibili.com",
  "youtube.com",
  "youtu.be",
  "zhihu.com",
  "juejin.cn",
  "v2ex.com",
  "mp.weixin.qq.com",
  "wikipedia.org",
  "figma.com",
  "notion.site",
  "feishu.cn",
];

export interface MarkdownMentionTarget {
  userId: string;
  label: string;
}

export function isWhitelistedDomain(hostname: string, extraAllowedHost?: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (extraAllowedHost) {
    const cleanExtra = extraAllowedHost.trim().toLowerCase().replace(/\.$/, "");
    if (cleanExtra && (host === cleanExtra || host.endsWith(`.${cleanExtra}`))) {
      return true;
    }
  }
  return WHITELISTED_EXTERNAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

export function normalizeSafeHref(
  rawHref: string,
  lane: "workspace" | "direct" = "workspace"
): { url: string; hostname: string } | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      if (lane === "direct") return null;
      const origin = nativeBridge.getSessionSnapshot().apiOrigin.replace(/\/+$/, "");
      const parsed = new URL(`${origin}${trimmed}`);
      return { url: parsed.toString(), hostname: parsed.hostname };
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return { url: parsed.toString(), hostname: parsed.hostname };
  } catch {
    return null;
  }
}

export function handleChatLinkClick(
  rawHref: string,
  lane: "workspace" | "direct" = "workspace"
): void {
  const safe = normalizeSafeHref(rawHref, lane);
  if (!safe) return;

  if (lane === "direct") {
    // E2E Direct lane never performs any server probing or origin resolution
    if (isWhitelistedDomain(safe.hostname)) {
      nativeBridge.openExternalUrl(safe.url);
    } else {
      useNavStore.getState().setPendingExternalUrl(safe.url);
    }
    return;
  }

  let apiHost = "";
  try {
    apiHost = new URL(nativeBridge.getSessionSnapshot().apiOrigin).hostname;
  } catch {
    apiHost = "";
  }

  if (isWhitelistedDomain(safe.hostname, apiHost)) {
    nativeBridge.openExternalUrl(safe.url);
  } else {
    useNavStore.getState().setPendingExternalUrl(safe.url);
  }
}

export function stripAutoLinkTrailingPunctuation(rawUrl: string): {
  cleanUrl: string;
  trailing: string;
} {
  let end = rawUrl.length;
  const trailingPunctRe = /[.,;:!?，。；：！？、\]】"'”’>》]/u;

  while (end > 0) {
    const ch = rawUrl[end - 1];
    if (ch === ")" || ch === "）") {
      const openChar = ch === ")" ? "(" : "（";
      const slice = rawUrl.slice(0, end);
      let opens = 0;
      let closes = 0;
      for (const c of slice) {
        if (c === openChar) opens++;
        else if (c === ch) closes++;
      }
      if (closes > opens) {
        end--;
        continue;
      }
      break;
    }
    if (trailingPunctRe.test(ch)) {
      end--;
      continue;
    }
    break;
  }

  return {
    cleanUrl: rawUrl.slice(0, end),
    trailing: rawUrl.slice(end),
  };
}

function CodeFenceBlock({
  lang,
  code,
  tone,
}: {
  lang: string;
  code: string;
  tone: "own" | "peer";
}) {
  const [copied, setCopied] = useState(false);
  const showToast = useNavStore((s) => s.showToast);

  const handleCopy = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    nativeBridge.copyText(code);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopied(true);
    showToast("代码已复制", "success");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      onClick={(ev) => ev.stopPropagation()}
      className={`my-1.5 rounded-xl overflow-hidden border max-w-full ${
        tone === "own"
          ? "bg-black/25 border-white/18 text-white"
          : "bg-[var(--dl-card)] border-[var(--dl-border)] text-[var(--dl-text)]"
      }`}
    >
      <div
        className={`px-3 py-1.5 flex items-center justify-between text-[11px] border-b ${
          tone === "own"
            ? "bg-black/20 border-white/12 text-white/80"
            : "bg-[var(--dl-surface)]/75 border-[var(--dl-border)] text-[var(--dl-text-muted)]"
        }`}
      >
        <span className="font-mono uppercase tracking-wider truncate">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="复制代码"
          className={`px-2 py-0.5 rounded-md flex items-center gap-1 font-medium transition active:scale-95 ${
            tone === "own"
              ? "bg-white/15 text-white active:bg-white/25"
              : "bg-[var(--dl-card)] text-[var(--dl-accent)] active:opacity-80"
          }`}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-[12px] leading-[1.55] select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isMentionBoundary(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[\s,.;:!?，。；：！？、)）\]】"'”’]/u.test(ch);
}

function renderTextWithMentionsAndEmotes(
  text: string,
  keyPrefix: string,
  tone: "own" | "peer",
  mentions: MarkdownMentionTarget[],
  onMentionClick?: (userId: string, label: string) => void
): React.ReactNode[] {
  if (!text) return [];

  // Combine @所有人 + explicit member mentions (longest label first)
  const mentionMap = new Map<string, MarkdownMentionTarget>();
  mentionMap.set("所有人", { userId: "all", label: "所有人" });
  for (const m of mentions) {
    const clean = m.label.replace(/^@+/, "").trim();
    if (clean) {
      mentionMap.set(clean, { userId: m.userId, label: clean });
    }
  }
  const sortedCandidates = Array.from(mentionMap.values()).sort(
    (a, b) => b.label.length - a.label.length
  );

  const out: React.ReactNode[] = [];
  let cursor = 0;
  let plainStart = 0;
  let keySeq = 0;

  while (cursor < text.length) {
    const ch = text[cursor];

    // Check [pack:id] inline emote
    if (ch === "[") {
      const rest = text.slice(cursor);
      const emMatch = rest.match(/^\[([a-z0-9_-]+:[a-z0-9_-]+)\]/i);
      if (emMatch) {
        const rawKey = emMatch[1];
        const item = getBuiltInEmote(rawKey) || getBuiltInEmote(rawKey.toLowerCase());
        if (item) {
          if (cursor > plainStart) {
            out.push(text.slice(plainStart, cursor));
          }
          if (item.kind === "image" && item.src) {
            out.push(
              <img
                key={`${keyPrefix}_em_${keySeq++}`}
                src={resolveAssetUrl(item.src)}
                alt={item.label}
                title={item.label}
                className="inline-block w-6 h-6 mx-0.5 align-[-5px] object-contain select-none"
              />
            );
          } else if (item.kind === "unicode" && item.value) {
            out.push(item.value);
          } else {
            out.push(emMatch[0]);
          }
          cursor += emMatch[0].length;
          plainStart = cursor;
          continue;
        }
      }
    }

    // Check @mention or @所有人
    if (ch === "@") {
      let matched: MarkdownMentionTarget | null = null;
      for (const c of sortedCandidates) {
        if (text.startsWith(c.label, cursor + 1)) {
          const nextCh = text[cursor + 1 + c.label.length];
          if (isMentionBoundary(nextCh)) {
            matched = c;
            break;
          }
        }
      }
      if (matched) {
        if (cursor > plainStart) {
          out.push(text.slice(plainStart, cursor));
        }
        const target = matched;
        const isAll = target.userId === "all" || target.label === "所有人";
        out.push(
          <span
            key={`${keyPrefix}_mt_${keySeq++}`}
            data-mention-id={target.userId}
            onClick={(ev) => {
              if (!onMentionClick) return;
              ev.stopPropagation();
              onMentionClick(target.userId, target.label);
            }}
            className={`inline font-semibold px-1.5 py-0.5 rounded-md mx-0.5 break-all [overflow-wrap:anywhere] ${
              tone === "own"
                ? isAll
                  ? "bg-amber-300/30 text-white ring-1 ring-white/35"
                  : "bg-white/22 text-white"
                : isAll
                ? "bg-amber-500/16 text-amber-700 dark:text-amber-300"
                : "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
            } ${onMentionClick ? "cursor-pointer active:opacity-75" : ""}`}
          >
            @{target.label}
          </span>
        );
        cursor += 1 + target.label.length;
        plainStart = cursor;
        continue;
      }
    }

    cursor++;
  }

  if (plainStart < text.length) {
    out.push(text.slice(plainStart));
  }

  return out;
}

function renderFormattedText(
  text: string,
  keyPrefix: string,
  tone: "own" | "peer",
  mentions: MarkdownMentionTarget[],
  onMentionClick?: (userId: string, label: string) => void
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+?\*\*|~~[^~\n]+?~~|(?<![*\w])\*[^*\s\n][^*\n]*?\*(?![*\w]))/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let seq = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(
        ...renderTextWithMentionsAndEmotes(
          text.slice(lastIdx, m.index),
          `${keyPrefix}_t_${seq++}`,
          tone,
          mentions,
          onMentionClick
        )
      );
    }
    const tok = m[0];
    if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(
        <strong key={`${keyPrefix}_b_${seq++}`} className="font-bold">
          {renderTextWithMentionsAndEmotes(
            tok.slice(2, -2),
            `${keyPrefix}_bi_${seq}`,
            tone,
            mentions,
            onMentionClick
          )}
        </strong>
      );
    } else if (tok.startsWith("~~") && tok.endsWith("~~")) {
      out.push(
        <del key={`${keyPrefix}_s_${seq++}`} className="line-through opacity-80">
          {renderTextWithMentionsAndEmotes(
            tok.slice(2, -2),
            `${keyPrefix}_si_${seq}`,
            tone,
            mentions,
            onMentionClick
          )}
        </del>
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      out.push(
        <em key={`${keyPrefix}_i_${seq++}`} className="italic">
          {renderTextWithMentionsAndEmotes(
            tok.slice(1, -1),
            `${keyPrefix}_ii_${seq}`,
            tone,
            mentions,
            onMentionClick
          )}
        </em>
      );
    } else {
      out.push(tok);
    }
    lastIdx = m.index + tok.length;
  }

  if (lastIdx < text.length) {
    out.push(
      ...renderTextWithMentionsAndEmotes(
        text.slice(lastIdx),
        `${keyPrefix}_tail`,
        tone,
        mentions,
        onMentionClick
      )
    );
  }

  return out;
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  options: {
    tone: "own" | "peer";
    lane: "workspace" | "direct";
    mentions: MarkdownMentionTarget[];
    onMentionClick?: (userId: string, label: string) => void;
  }
): React.ReactNode[] {
  const { tone, lane, mentions, onMentionClick } = options;
  const out: React.ReactNode[] = [];
  // Priority 1: inline `code`, Markdown [label](url), or bare http(s):// auto-link
  const tokenRe =
    /(`[^`\n]+`|\[([^\]\n]+)\]\(((?:https?:\/\/|\/)(?:[^()\s]+|\([^()\s]*\))+)\)|https?:\/\/[^\s<>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let seq = 0;

  const linkCls =
    tone === "own"
      ? "inline text-left font-medium text-white underline decoration-white/75 underline-offset-2 break-all [overflow-wrap:anywhere] active:opacity-75"
      : "inline text-left font-medium text-[var(--dl-accent)] underline underline-offset-2 break-all [overflow-wrap:anywhere] active:opacity-75";

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(
        ...renderFormattedText(
          text.slice(lastIndex, match.index),
          `${keyPrefix}_f_${seq++}`,
          tone,
          mentions,
          onMentionClick
        )
      );
    }

    const full = match[0];
    if (full.startsWith("`") && full.endsWith("`")) {
      out.push(
        <code
          key={`${keyPrefix}_code_${seq++}`}
          className={`px-1.5 py-0.5 rounded-md font-mono text-[12.5px] break-all whitespace-pre-wrap [overflow-wrap:anywhere] ${
            tone === "own"
              ? "bg-black/22 text-white border border-white/15"
              : "bg-[var(--dl-card)] text-[var(--dl-text)] border border-[var(--dl-border)]"
          }`}
        >
          {full.slice(1, -1)}
        </code>
      );
    } else if (full.startsWith("[") && match[2] && match[3]) {
      const label = match[2];
      const href = match[3];
      const safe = normalizeSafeHref(href, lane);
      if (safe) {
        out.push(
          <button
            key={`${keyPrefix}_mdlink_${seq++}`}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              handleChatLinkClick(href, lane);
            }}
            className={linkCls}
          >
            {label}
          </button>
        );
      } else {
        out.push(full);
      }
    } else if (full.startsWith("http://") || full.startsWith("https://")) {
      const { cleanUrl, trailing } = stripAutoLinkTrailingPunctuation(full);
      const safe = normalizeSafeHref(cleanUrl, lane);
      if (safe) {
        out.push(
          <button
            key={`${keyPrefix}_autolink_${seq++}`}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              handleChatLinkClick(cleanUrl, lane);
            }}
            className={linkCls}
          >
            {cleanUrl}
          </button>
        );
        if (trailing) {
          out.push(trailing);
        }
      } else {
        out.push(full);
      }
    } else {
      out.push(full);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    out.push(
      ...renderFormattedText(
        text.slice(lastIndex),
        `${keyPrefix}_end`,
        tone,
        mentions,
        onMentionClick
      )
    );
  }

  return out;
}

function splitTableCells(rowLine: string): string[] {
  const trimmed = rowLine.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isGfmTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  const cells = splitTableCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function ChatMarkdown({
  text,
  tone = "peer",
  lane = "workspace",
  mentions = [],
  onMentionClick,
  className = "",
}: {
  text: string;
  tone?: "own" | "peer";
  lane?: "workspace" | "direct";
  mentions?: MarkdownMentionTarget[];
  onMentionClick?: (userId: string, label: string) => void;
  className?: string;
}) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: React.ReactNode[] = [];
  const inlineOpts = { tone, lane, mentions, onMentionClick };

  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Fenced code block ```lang
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i++;
      }
      blocks.push(
        <CodeFenceBlock
          key={`cf_${blockKey++}`}
          lang={lang}
          code={codeLines.join("\n")}
          tone={tone}
        />
      );
      continue;
    }

    // 2. Empty line spacer
    if (!trimmed) {
      i++;
      continue;
    }

    // 3. Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr_${blockKey++}`}
          className={tone === "own" ? "border-white/25 my-1.5" : "border-[var(--dl-border)] my-1.5"}
        />
      );
      i++;
      continue;
    }

    // 4. GFM Table
    if (
      rawLine.includes("|") &&
      i + 1 < lines.length &&
      isGfmTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableCells(rawLine);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableCells(lines[i]));
        i++;
      }
      const tblKey = blockKey++;
      blocks.push(
        <div
          key={`tbl_${tblKey}`}
          onClick={(ev) => ev.stopPropagation()}
          className={`my-1.5 max-w-full overflow-x-auto rounded-xl border ${
            tone === "own" ? "border-white/20 bg-black/15" : "border-[var(--dl-border)] bg-[var(--dl-card)]/50"
          }`}
        >
          <table className="min-w-full text-[12.5px] border-collapse">
            <thead>
              <tr
                className={
                  tone === "own"
                    ? "bg-black/20 border-b border-white/15"
                    : "bg-[var(--dl-card)] border-b border-[var(--dl-border)]"
                }
              >
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                    {renderInlineMarkdown(h, `th_${tblKey}_${hi}`, inlineOpts)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={
                    tone === "own"
                      ? "border-b last:border-b-0 border-white/10"
                      : "border-b last:border-b-0 border-[var(--dl-border)]/60"
                  }
                >
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 align-top">
                      {renderInlineMarkdown(row[ci] || "", `td_${tblKey}_${ri}_${ci}`, inlineOpts)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 5. Heading #..######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeCls =
        level === 1
          ? "text-[16.5px] font-bold"
          : level === 2
          ? "text-[15.5px] font-bold"
          : "text-[14.5px] font-semibold";
      const hKey = blockKey++;
      blocks.push(
        <div key={`h_${hKey}`} className={`${sizeCls} leading-snug pt-0.5`}>
          {renderInlineMarkdown(headingMatch[2], `h_${hKey}`, inlineOpts)}
        </div>
      );
      i++;
      continue;
    }

    // 6. Blockquote (> ...)
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      const qKey = blockKey++;
      blocks.push(
        <blockquote
          key={`q_${qKey}`}
          className={`my-1 pl-2.5 py-0.5 border-l-2 text-[13.5px] leading-[1.5] ${
            tone === "own"
              ? "border-white/55 text-white/90"
              : "border-[var(--dl-accent)] text-[var(--dl-text-muted)]"
          }`}
        >
          {quoteLines.map((ql, qi) => (
            <React.Fragment key={qi}>
              {qi > 0 && <br />}
              {renderInlineMarkdown(ql, `q_${qKey}_${qi}`, inlineOpts)}
            </React.Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    // 7. Unordered list (- / * / •)
    if (/^(?:[-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^(?:[-*•])\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^(?:[-*•])\s+/, ""));
        i++;
      }
      const ulKey = blockKey++;
      blocks.push(
        <ul key={`ul_${ulKey}`} className="my-1 space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-start gap-2 leading-[1.48]">
              <span
                className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${
                  tone === "own" ? "bg-white/85" : "bg-[var(--dl-accent)]"
                }`}
              />
              <span className="min-w-0 flex-1">
                {renderInlineMarkdown(it, `ul_${ulKey}_${idx}`, inlineOpts)}
              </span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 8. Ordered list (1. )
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: Array<{ num: string; body: string }> = [];
      while (i < lines.length) {
        const om = lines[i].trim().match(/^(\d+)\.\s+(.+)$/);
        if (!om) break;
        items.push({ num: om[1], body: om[2] });
        i++;
      }
      const olKey = blockKey++;
      blocks.push(
        <ol key={`ol_${olKey}`} className="my-1 space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-start gap-1.5 leading-[1.48]">
              <span
                className={`font-mono text-[13px] font-semibold shrink-0 ${
                  tone === "own" ? "text-white/90" : "text-[var(--dl-accent)]"
                }`}
              >
                {it.num}.
              </span>
              <span className="min-w-0 flex-1">
                {renderInlineMarkdown(it.body, `ol_${olKey}_${idx}`, inlineOpts)}
              </span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 9. Standard paragraph (preserving soft line breaks \n until blank line or block starter)
    const paraLines: string[] = [rawLine];
    i++;
    while (i < lines.length) {
      const peek = lines[i];
      const peekTrim = peek.trim();
      if (
        !peekTrim ||
        peekTrim.startsWith("```") ||
        /^(-{3,}|\*{3,})$/.test(peekTrim) ||
        /^(#{1,6})\s+/.test(peekTrim) ||
        /^>\s?/.test(peekTrim) ||
        /^(?:[-*•])\s+/.test(peekTrim) ||
        /^\d+\.\s+/.test(peekTrim) ||
        (peek.includes("|") && i + 1 < lines.length && isGfmTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(peek);
      i++;
    }
    const pKey = blockKey++;
    blocks.push(
      <div
        key={`p_${pKey}`}
        className="leading-[1.48] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
      >
        {paraLines.map((pl, pi) => (
          <React.Fragment key={pi}>
            {pi > 0 && "\n"}
            {renderInlineMarkdown(pl, `p_${pKey}_${pi}`, inlineOpts)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-1 max-w-full min-w-0 break-words [overflow-wrap:anywhere] ${className}`.trim()}>
      {blocks}
    </div>
  );
}

export function ExternalLinkGuardSheet() {
  const pendingUrl = useNavStore((s) => s.pendingExternalUrl);
  const setPendingUrl = useNavStore((s) => s.setPendingExternalUrl);
  const showToast = useNavStore((s) => s.showToast);

  let targetDomain = "";
  if (pendingUrl) {
    try {
      targetDomain = new URL(pendingUrl).hostname;
    } catch {
      targetDomain = pendingUrl;
    }
  }

  return (
    <BottomSheet
      open={Boolean(pendingUrl)}
      onClose={() => setPendingUrl(null)}
      title="即将前往外部网站"
      subtitle="请注意核实外部域名安全性，谨防钓鱼风险"
    >
      {pendingUrl && (
        <div className="p-4 space-y-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
            <ShieldAlert size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[12px] text-[var(--dl-text-muted)]">目标外部域名</div>
              <div
                data-testid="external-link-domain"
                className="text-[15px] font-bold font-mono text-amber-600 dark:text-amber-300 break-all"
              >
                {targetDomain}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] font-mono text-[12px] text-[var(--dl-text-muted)] break-all max-h-28 overflow-y-auto">
            {pendingUrl}
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                nativeBridge.copyText(pendingUrl);
                setPendingUrl(null);
                showToast("链接已复制", "success");
              }}
              className="py-3 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[14px] flex items-center justify-center gap-1.5 active:opacity-80"
            >
              <Copy size={16} />
              <span>复制链接</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const url = pendingUrl;
                setPendingUrl(null);
                nativeBridge.openExternalUrl(url);
              }}
              className="py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 active:opacity-90"
            >
              <ExternalLink size={16} />
              <span>继续访问</span>
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
