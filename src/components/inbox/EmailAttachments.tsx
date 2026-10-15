'use client';

import { useState } from 'react';
import { Download, Eye, FileText, Minus, Plus, X } from 'lucide-react';
import type { DetectedAttachment } from '@/lib/types/domain';

export function EmailAttachments({
  emailId,
  attachments,
}: {
  emailId: string;
  attachments: DetectedAttachment[];
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const closePreview = () => {
    setPreviewIndex(null);
    setLoaded(false);
    setFailed(false);
    setPage(1);
    setZoom(100);
  };

  const previewUrl =
    previewIndex === null
      ? ''
      : `/api/emails/${encodeURIComponent(emailId)}/attachments/${previewIndex}`;

  return (
    <>
      <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-mist-500">Attachments</p>
        <ul className="space-y-2">
          {attachments.map((attachment, index) => {
            const isPdf =
              attachment.mime_type?.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(attachment.filename);
            const downloadUrl = `/api/emails/${encodeURIComponent(emailId)}/attachments/${index}?download=1`;
            return (
              <li
                key={`${attachment.filename}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/10 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2 text-xs text-mist-200">
                  <FileText className="h-4 w-4 shrink-0 text-mist-400" aria-hidden="true" />
                  <span className="min-w-0 break-all">{attachment.filename}</span>
                  <span className="shrink-0 text-mist-500">
                    {attachment.size_bytes
                      ? `${Math.max(1, Math.round(attachment.size_bytes / 1024))} KB`
                      : ''}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {isPdf ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => {
                        setPreviewIndex(index);
                        setPage(1);
                        setZoom(100);
                        setLoaded(false);
                        setFailed(false);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      View PDF
                    </button>
                  ) : null}
                  <a className="btn btn-secondary btn-xs" href={downloadUrl}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {previewIndex !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pdf-preview-title"
            className="flex h-[min(92dvh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] p-3">
              <h2 id="pdf-preview-title" className="min-w-0 truncate text-sm font-medium text-mist-100">
                {attachments[previewIndex]?.filename ?? 'PDF preview'}
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="Previous PDF page"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Prev
                </button>
                <label className="sr-only" htmlFor="pdf-page">PDF page</label>
                <input
                  id="pdf-page"
                  className="w-12 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-center text-xs text-mist-100"
                  type="number"
                  min={1}
                  value={page}
                  onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="Next PDF page"
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="Zoom out"
                  onClick={() => setZoom((value) => Math.max(50, value - 10))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-10 text-center text-[11px] text-mist-400">{zoom}%</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="Zoom in"
                  onClick={() => setZoom((value) => Math.min(200, value + 10))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <a className="btn btn-secondary btn-xs" href={`${previewUrl}?download=1`}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download
                </a>
                <button type="button" className="btn btn-ghost btn-xs" onClick={closePreview} aria-label="Close PDF preview">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="relative min-h-0 flex-1 bg-[#292b31]">
              {!loaded && !failed ? (
                <p className="absolute inset-x-0 top-3 z-10 text-center text-xs text-mist-300" role="status">
                  Loading PDF…
                </p>
              ) : null}
              {failed ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-mist-300">
                  <p>PDF preview failed to load.</p>
                  <a className="btn btn-secondary btn-sm" href={`${previewUrl}?download=1`}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download PDF
                  </a>
                </div>
              ) : (
                <iframe
                  key={`${previewIndex}-${page}-${zoom}`}
                  title={`PDF preview: ${attachments[previewIndex]?.filename ?? 'attachment'}`}
                  src={`${previewUrl}#toolbar=1&navpanes=1&page=${page}&zoom=${zoom}`}
                  className="h-full w-full border-0"
                  onLoad={() => setLoaded(true)}
                  onError={() => setFailed(true)}
                />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
