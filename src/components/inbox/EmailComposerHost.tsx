'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X, Sparkles, Send, LoaderCircle } from 'lucide-react';
import type { EmailAccount } from '@/lib/types/database';
import { useToast } from '@/components/ui/Toast';

type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward';
type ComposeRequest = { mode: ComposeMode; emailId?: string };
type AccountOption = Pick<EmailAccount, 'id' | 'email_address' | 'scopes'>;
type ApiError = { ok: false; error: { message: string } };
type ReplyContext = {
  accountId: string;
  accountEmail: string;
  senderEmail: string | null;
  recipients: string[];
  ccRecipients: string[];
  subject: string;
  body: string;
};

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const splitAddresses = (value: string) => value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean);

export function requestEmailCompose(mode: ComposeMode = 'new', emailId?: string) {
  window.dispatchEvent(new CustomEvent<ComposeRequest>('vozinbox:compose', { detail: { mode, emailId } }));
}

export function EmailComposerHost({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const [accountId, setAccountId] = useState('');
  const sendingLock = useRef(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [instructions, setInstructions] = useState('');
  const [suggestedDraft, setSuggestedDraft] = useState('');
  const [loadingContext, setLoadingContext] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<ComposeRequest>).detail;
      setRequest(detail);
      setSuggestedDraft('');
      setTo('');
      setCc('');
      setBcc('');
      setMessage('');
      setInstructions('');
      setSubject('');
      setAccountId(accounts.find((account) => account.scopes.includes(SEND_SCOPE))?.id ?? accounts[0]?.id ?? '');
    };
    window.addEventListener('vozinbox:compose', open);
    return () => window.removeEventListener('vozinbox:compose', open);
  }, [accounts]);

  useEffect(() => {
    if (!request?.emailId) return;
    let active = true;
    setLoadingContext(true);
    void fetch(`/api/emails/${encodeURIComponent(request.emailId)}/reply-context`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { ok: true; data: ReplyContext } | ApiError;
        if (!response.ok || !payload.ok) throw new Error(payload.ok ? 'Unable to load this email.' : payload.error.message);
        if (!active) return;
        const data = payload.data;
        setAccountId(data.accountId);
        const sender = data.senderEmail && data.senderEmail.toLowerCase() !== data.accountEmail.toLowerCase()
          ? [data.senderEmail]
          : [];
        const own = data.accountEmail.toLowerCase();
        if (request.mode === 'reply') {
          setTo(sender.join(', '));
          setSubject(/^re:/i.test(data.subject) ? data.subject : `Re: ${data.subject}`);
        } else if (request.mode === 'reply-all') {
          const recipients = [...sender, ...data.recipients].filter((address) => address.toLowerCase() !== own);
          const toAddresses = new Set(recipients.map((address) => address.toLowerCase()));
          setTo(recipients.join(', '));
          setCc(data.ccRecipients.filter((address) => address.toLowerCase() !== own && !toAddresses.has(address.toLowerCase())).join(', '));
          setSubject(/^re:/i.test(data.subject) ? data.subject : `Re: ${data.subject}`);
        } else {
          setSubject(/^fwd?:/i.test(data.subject) ? data.subject : `Fwd: ${data.subject}`);
          setMessage(`\n\n---------- Forwarded message ----------\n${data.body}`);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          toast.push(error instanceof Error ? error.message : 'Unable to load this email.', 'error');
          setRequest(null);
        }
      })
      .finally(() => {
        if (active) setLoadingContext(false);
      });
    return () => { active = false; };
  }, [request, toast]);

  if (!request) return null;
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const canSend = Boolean(selectedAccount?.scopes.includes(SEND_SCOPE));

  const generateDraft = async () => {
    if (!request.emailId) {
      toast.push('AI reply drafts are available when replying to an email.', 'info');
      return;
    }
    setDrafting(true);
    setSuggestedDraft('');
    try {
      const response = await fetch(`/api/emails/${encodeURIComponent(request.emailId)}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instructions }),
      });
      const payload = await response.json() as { ok: true; data: { draft: string } } | ApiError;
      if (!response.ok || !payload.ok) throw new Error(payload.ok ? 'Could not draft a reply.' : payload.error.message);
      if (message.trim()) setSuggestedDraft(payload.data.draft);
      else setMessage(payload.data.draft);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not draft a reply.', 'error');
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendingLock.current || !canSend) return;
    sendingLock.current = true;
    setSending(true);
    try {
      const response = await fetch('/api/integrations/gmail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId,
          mode: request.mode,
          ...(request.emailId ? { emailId: request.emailId } : {}),
          to: splitAddresses(to),
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject,
          body: message,
        }),
      });
      const payload = await response.json() as
        | { ok: true; data: { synced: boolean } }
        | ApiError;
      if (!response.ok || !payload.ok) throw new Error(payload.ok ? 'Gmail could not send this message.' : payload.error.message);
      toast.push(payload.data.synced ? 'Message sent.' : 'Gmail accepted the message; syncing it into your inbox is still pending.', payload.data.synced ? 'success' : 'info');
      setRequest(null);
      router.refresh();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Gmail could not confirm the send. Check your Sent folder before retrying.', 'error');
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  };

  const close = () => {
    if ((message.trim() || to.trim() || subject.trim()) && !window.confirm('Discard this message?')) return;
    setRequest(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation">
      <section className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/[0.1] bg-ink-900 p-5 shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="compose-title" className="text-sm font-semibold text-mist-100">
            {request.mode === 'new' ? 'New message' : request.mode === 'reply' ? 'Reply' : request.mode === 'reply-all' ? 'Reply all' : 'Forward'}
          </h2>
          <button type="button" onClick={close} className="rounded-lg p-2 text-mist-400 hover:bg-white/[0.06] hover:text-mist-100" aria-label="Close composer">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        {accounts.length === 0 ? (
          <p className="py-5 text-sm text-mist-400">
            Connect a Gmail account before composing.
            {' '}<Link href="/integrations" onClick={() => setRequest(null)} className="text-violet-300 hover:text-violet-200">Open Integrations</Link>
          </p>
        ) : loadingContext ? <p className="py-5 text-sm text-mist-400">Loading email context…</p> : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs text-mist-400">From
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded-lg border border-white/[0.1] bg-ink-950 px-3 py-2 text-sm text-mist-100">
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.email_address}{account.scopes.includes(SEND_SCOPE) ? '' : ' — update permissions to send'}</option>)}
              </select>
            </label>
            {([['To', to, setTo], ['Cc', cc, setCc], ['Bcc', bcc, setBcc]] as const).map(([label, value, setter]) => (
              <label key={label} className="flex items-center gap-3 border-b border-white/[0.06] py-1 text-xs text-mist-500">
                <span className="w-9">{label}</span>
                <input value={value} onChange={(event) => setter(event.target.value)} className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-mist-100 outline-none" placeholder="Separate addresses with commas" />
              </label>
            ))}
            <label className="flex items-center gap-3 border-b border-white/[0.06] py-1 text-xs text-mist-500">
              <span className="w-9">Subject</span>
              <input required maxLength={998} value={subject} onChange={(event) => setSubject(event.target.value)} className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-mist-100 outline-none" />
            </label>
            {request.emailId ? (
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <label className="block text-xs text-mist-400">Optional drafting guidance
                  <input value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-md border border-white/[0.08] bg-ink-950 px-2.5 py-2 text-sm text-mist-100 outline-none focus:border-violet-400/40" placeholder="Tone or details to include" />
                </label>
                <button type="button" disabled={drafting} onClick={generateDraft} className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200 disabled:opacity-50">
                  {drafting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {drafting ? 'Drafting…' : 'Draft with AI'}
                </button>
              </div>
            ) : null}
            {suggestedDraft ? (
              <div className="rounded-lg border border-violet-400/20 bg-violet-500/[0.05] p-3">
                <p className="mb-2 text-xs font-medium text-violet-200">AI draft suggestion — your message is unchanged</p>
                <p className="whitespace-pre-wrap text-xs text-mist-300">{suggestedDraft}</p>
                <button type="button" onClick={() => { setMessage(suggestedDraft); setSuggestedDraft(''); }} className="mt-2 text-xs font-medium text-violet-300 hover:text-violet-200">Replace message with suggestion</button>
              </div>
            ) : null}
            <label className="block text-xs text-mist-400">Message
              <textarea required maxLength={500_000} value={message} onChange={(event) => setMessage(event.target.value)} rows={9} className="mt-1 w-full resize-y rounded-lg border border-white/[0.08] bg-ink-950 p-3 text-sm leading-relaxed text-mist-100 outline-none focus:border-violet-400/40" />
            </label>
            {request.mode === 'forward' ? <p className="text-[11px] text-medium">Forwarded attachments are not included. Add any files you need separately in Gmail.</p> : null}
            {!canSend ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-medium/20 bg-medium/[0.06] p-3">
                <p className="text-xs text-medium">Approve Gmail’s send permission to send from this account.</p>
                {selectedAccount ? (
                  <Link
                    href={`/api/integrations/gmail/connect?accountId=${encodeURIComponent(selectedAccount.id)}`}
                    className="text-xs font-medium text-violet-300 hover:text-violet-200"
                  >
                    Update Gmail permissions
                  </Link>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-xs text-mist-300 hover:bg-white/[0.05]">Discard</button>
              <button type="submit" disabled={sending || !canSend || loadingContext} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">
                {sending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
