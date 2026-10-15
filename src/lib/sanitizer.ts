/**
 * HTML Sanitization for untrusted email content (§28).
 * Strips script tags, iframe, embed, object, inline event handlers, javascript: URIs.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|embed|object|form|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|embed|object|form|svg|math|template|noscript)\b[^>]*\/?>/gi, '')
    .replace(/<\/?(base|meta|link|applet|frame|frameset)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(srcdoc|srcset|ping|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|file):[\s\S]*?\2/gi,
      ' $1="#"',
    )
    .replace(/\s+(href|src)\s*=\s*(["'])\s*data:(?!image\/(?:png|jpe?g|gif|webp);base64,)[\s\S]*?\2/gi, ' $1="#"')
    .trim();
}
