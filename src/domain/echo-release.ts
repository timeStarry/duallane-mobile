export type EchoReleaseItem = { title: string; description: string; location: string };
export type EchoReleaseSection = { title: string; items: EchoReleaseItem[] };
export type EchoReleaseView = {
  version: string;
  title: string;
  summary: string;
  releasedAt: string;
  sections: EchoReleaseSection[];
};

export function echoReleaseView(payload: Record<string, unknown>, fallbackTitle: string): EchoReleaseView {
  return {
    version: stringValue(payload.version),
    title: stringValue(payload.title) || fallbackTitle,
    summary: stringValue(payload.summary),
    releasedAt: formatReleaseDate(stringValue(payload.releasedAt)),
    sections: arrayOfObjects(payload.sections).map(section => ({
      title: stringValue(section.title),
      items: arrayOfObjects(section.items).map(item => ({
        title: stringValue(item.title),
        description: stringValue(item.description),
        location: stringValue(item.location),
      })),
    })),
  };
}

export function echoKindLabel(cardType: string) {
  if (cardType.includes('solicitation')) return '需求征集';
  if (cardType.includes('list')) return '需求列表';
  if (cardType.includes('request')) return '需求反馈';
  if (cardType === 'echo.release') return '版本更新';
  return '';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayOfObjects(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function formatReleaseDate(value: string) {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
