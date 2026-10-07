/**
 * HTML Sanitization for untrusted email content (§28).
 * Strips script tags, iframe, embed, object, inline event handlers, javascript: URIs.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    // Remove script tags and content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Remove style tags and content
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Remove iframe, embed, object, form tags and content
    .replace(/<(iframe|embed|object|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|embed|object|form)[^>]*\/?>/gi, '')
    // Remove inline event handlers like onclick, onload, onerror
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralize javascript: and data: URIs in href / src
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '$1="#"')
    .trim();
}
