'use client';

import { Forward, Reply, ReplyAll } from 'lucide-react';
import { requestEmailCompose } from './EmailComposerHost';

export function EmailReplyActions({ emailId }: { emailId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => requestEmailCompose('reply', emailId)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-2 text-xs text-mist-300 hover:bg-white/[0.05] hover:text-mist-100">
        <Reply className="h-3.5 w-3.5" aria-hidden="true" /> Reply
      </button>
      <button type="button" onClick={() => requestEmailCompose('reply-all', emailId)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-2 text-xs text-mist-300 hover:bg-white/[0.05] hover:text-mist-100">
        <ReplyAll className="h-3.5 w-3.5" aria-hidden="true" /> Reply all
      </button>
      <button type="button" onClick={() => requestEmailCompose('forward', emailId)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-2 text-xs text-mist-300 hover:bg-white/[0.05] hover:text-mist-100">
        <Forward className="h-3.5 w-3.5" aria-hidden="true" /> Forward
      </button>
    </div>
  );
}
