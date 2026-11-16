/** Splits a free-text social reference ("Facebook: … | Instagram: https://…") into parts with safe links. */
export type SocialPart = { network: string | null; text: string; href: string | null };

export function parseSocial(value: string | null | undefined): SocialPart[] {
  if (!value) return [];
  return value
    .split('|')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([A-Za-z ]{1,20}):\s*(.+)$/);
      const network = m ? m[1]!.trim() : null;
      const text = (m ? m[2]! : part).trim();
      let href: string | null = null;
      try {
        const u = new URL(text);
        if (u.protocol === 'https:' || u.protocol === 'http:') href = u.toString();
      } catch {
        /* not a URL: shown as plain text */
      }
      return { network, text: href ? text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : text, href };
    });
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}
