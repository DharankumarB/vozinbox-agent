'use client';

import { useState } from 'react';

export function EmailBody({ text, html }: { text: string | null; html: string | null }) {
  const [showFormatted, setShowFormatted] = useState(false);

  if (!text && !html) {
    return <p className="text-sm text-mist-400">This message has no readable body.</p>;
  }

  const isolatedHtml = html
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif;color:#e5e7eb;background:#15171d;overflow-wrap:anywhere">${html}</body></html>`
    : '';

  return (
    <div className="space-y-3">
      {text ? (
        <div className="whitespace-pre-wrap break-anywhere text-sm leading-relaxed text-mist-200">{text}</div>
      ) : null}
      {html ? (
        <>
          <button
            type="button"
            className="text-xs text-violet-300 underline decoration-violet-300/40 underline-offset-4 hover:text-violet-200"
            onClick={() => setShowFormatted((value) => !value)}
            aria-expanded={showFormatted}
          >
            {showFormatted ? 'Hide formatted email' : 'View formatted email'}
          </button>
          {showFormatted ? (
            <iframe
              title="Formatted email content"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={isolatedHtml}
              className="min-h-72 w-full rounded-lg border border-white/[0.08] bg-[#15171d]"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
