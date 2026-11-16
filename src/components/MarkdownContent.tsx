import React from "react";
import { nativeBridge } from "@/native/bridge";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}_b_${idx++}`} className="font-semibold text-[var(--dl-text)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}_c_${idx++}`}
          className="px-1.5 py-0.5 rounded-md bg-[var(--dl-surface)] border border-[var(--dl-border)] font-mono text-[11.5px] text-[var(--dl-text)] break-all whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)$/);
      if (m) {
        const label = m[1];
        const rawHref = m[2];
        nodes.push(
          <button
            key={`${keyPrefix}_a_${idx++}`}
            type="button"
            onClick={() => {
              const target = rawHref.startsWith("/")
                ? `${nativeBridge.getSessionSnapshot().apiOrigin}${rawHref}`
                : rawHref;
              nativeBridge.openExternalUrl(target);
            }}
            className="inline text-left font-medium text-[var(--dl-accent)] underline underline-offset-2"
          >
            {label}
          </button>
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function MarkdownContent({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  let bulletItems: string[] = [];
  let orderedItems: string[] = [];
  let inCodeFence = false;
  let codeLines: string[] = [];

  const flushLists = (keySeed: number) => {
    if (bulletItems.length > 0) {
      const items = bulletItems;
      bulletItems = [];
      blocks.push(
        <ul key={`ul_${keySeed}`} className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`li_${idx}`}
              className="flex items-start gap-2 text-[13px] leading-[1.62] text-[var(--dl-text-muted)]"
            >
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[var(--dl-accent)] shrink-0" />
              <span className="min-w-0 flex-1">
                {renderInline(item, `ul_${keySeed}_${idx}`)}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    if (orderedItems.length > 0) {
      const items = orderedItems;
      orderedItems = [];
      blocks.push(
        <ol key={`ol_${keySeed}`} className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`oli_${idx}`}
              className="flex items-start gap-2 text-[13px] leading-[1.62] text-[var(--dl-text-muted)]"
            >
              <span className="font-mono text-[12px] font-semibold text-[var(--dl-accent)] shrink-0">
                {idx + 1}.
              </span>
              <span className="min-w-0 flex-1">
                {renderInline(item, `ol_${keySeed}_${idx}`)}
              </span>
            </li>
          ))}
        </ol>
      );
    }
  };

  lines.forEach((rawLine, i) => {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      flushLists(i);
      if (inCodeFence) {
        blocks.push(
          <pre
            key={`code_${i}`}
            className="max-w-full p-2.5 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] overflow-x-auto font-mono text-[11.5px] leading-relaxed text-[var(--dl-text)]"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeFence = false;
      } else {
        inCodeFence = true;
      }
      return;
    }

    if (inCodeFence) {
      codeLines.push(rawLine);
      return;
    }

    if (!trimmed) {
      flushLists(i);
      return;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushLists(i);
      blocks.push(<hr key={`hr_${i}`} className="border-[var(--dl-border)] my-1" />);
      return;
    }

    const bulletMatch = trimmed.match(/^(?:[-*•])\s+(.+)$/);
    if (bulletMatch) {
      if (orderedItems.length > 0) flushLists(i);
      bulletItems.push(bulletMatch[1]);
      return;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (bulletItems.length > 0) flushLists(i);
      orderedItems.push(orderedMatch[1]);
      return;
    }

    flushLists(i);

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls =
        level === 1
          ? "text-[15px] font-bold text-[var(--dl-text)] pt-1"
          : level === 2
          ? "text-[14px] font-bold text-[var(--dl-text)] pt-1"
          : "text-[13px] font-bold text-[var(--dl-text)] pt-0.5";
      blocks.push(
        <div key={`h_${i}`} className={cls}>
          {renderInline(headingMatch[2], `h_${i}`)}
        </div>
      );
      return;
    }

    const quoteMatch = trimmed.match(/^>\s*(.+)$/);
    if (quoteMatch) {
      blocks.push(
        <blockquote
          key={`q_${i}`}
          className="pl-3 border-l-2 border-[var(--dl-accent)] text-[12.5px] leading-relaxed text-[var(--dl-text-muted)]"
        >
          {renderInline(quoteMatch[1], `q_${i}`)}
        </blockquote>
      );
      return;
    }

    blocks.push(
      <p
        key={`p_${i}`}
        className="text-[13.5px] leading-[1.65] text-[var(--dl-text-muted)] break-words [overflow-wrap:anywhere]"
      >
        {renderInline(trimmed, `p_${i}`)}
      </p>
    );
  });

  if (inCodeFence && codeLines.length > 0) {
    blocks.push(
      <pre
        key="code_eof"
        className="max-w-full p-2.5 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] overflow-x-auto font-mono text-[11.5px] leading-relaxed text-[var(--dl-text)]"
      >
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }
  flushLists(lines.length);

  return (
    <div
      data-testid="markdown-content"
      className={`space-y-2 min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`.trim()}
    >
      {blocks}
    </div>
  );
}
