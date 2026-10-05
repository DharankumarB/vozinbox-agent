'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MailOpen, Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

/** Email-level actions that are safe and reversible (§23). */
export function EmailActionsBar({ emailId, isRead }: { emailId: string; isRead: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'read' | 'analyse' | null>(null);

  const toggleRead = async () => {
    setBusy('read');
    try {
      const response = await fetch(`/api/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead: !isRead }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to update this email.', 'error');
        return;
      }
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const analyse = async () => {
    setBusy('analyse');
    try {
      const response = await fetch(`/api/emails/${emailId}/analyze`, { method: 'POST' });
      const payload = (await response.json()) as
        | { ok: true; data: { status: string } }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return;
      }
      toast.push(
        payload.data.status === 'FAILED'
          ? 'Analysis failed. The previous result has been kept.'
          : payload.data.status === 'NEEDS_REVIEW'
            ? 'Analysis complete — some details need your review.'
            : 'Analysis complete.',
        payload.data.status === 'FAILED' ? 'error' : 'success',
      );
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={toggleRead} loading={busy === 'read'}>
        {isRead ? (
          <>
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Mark unread
          </>
        ) : (
          <>
            <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Mark read
          </>
        )}
      </Button>
      <Button variant="secondary" size="sm" onClick={analyse} loading={busy === 'analyse'}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Analyse now
      </Button>
    </div>
  );
}
