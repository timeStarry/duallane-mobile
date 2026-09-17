export function prepareWorkspaceMarkdown(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n');
  if (hasUnclosedFence(normalized) || containsUnsupportedMarkdown(normalized) || normalized.split('\n').some(line => /^ {4}/.test(line))) {
    return { source: normalized, plain: true };
  }
  return { source: normalized, plain: false };
}

function hasUnclosedFence(source: string) {
  let open = false;
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line)) open = !open;
  }
  return open;
}

function containsUnsupportedMarkdown(source: string) {
  return /<\s*\/?[A-Za-z]/.test(source);
}

export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

export function extractHttpUrls(text: string) {
  return text.match(/https?:\/\/[^\s]+/g)?.map(part => part.replace(/[),.;!?]+$/, '')).filter(safeHttpUrl) ?? [];
}
