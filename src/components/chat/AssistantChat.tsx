'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CornerDownLeft, Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolTrace {
  name: string;
  summary: string;
}

const STORAGE_KEY = 'vozinbox.assistant.thread';

const SUGGESTIONS = [
  'What needs my attention today?',
  'Which emails have deadlines this week?',
  'What did I miss while I was away?',
  'Any invoices or payments waiting on me?',
  'Which messages changed after I last looked?',
];

export function AssistantChat({
  aiConfigured,
  greetingName,
}: {
  aiConfigured: boolean;
  greetingName: string;
}) {
  const toast = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [tools, setTools] = useState<ToolTrace[]>([]);
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the conversation across navigations inside the tab only — nothing
  // is persisted server-side, so no stale assistant claims survive a reload.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) setTurns(JSON.parse(raw) as Turn[]);
    } catch {
      /* ignore unreadable storage */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-24)));
    } catch {
      /* storage may be unavailable in private mode */
    }
  }, [turns, restored]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || busy) return;

    const nextTurns: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(nextTurns);
    setInput('');
    setBusy(true);
    setDegraded(false);
    setTools([]);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextTurns.slice(-12) }),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { reply: string; tools: ToolTrace[]; degraded?: boolean } }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        setTurns((current) => [
          ...current,
          { role: 'assistant', content: 'I could not answer that just now. Please try again in a moment.' },
        ]);
        return;
      }

      setTurns((current) => [...current, { role: 'assistant', content: payload.data.reply }]);
      setTools(payload.data.tools ?? []);
      setDegraded(Boolean(payload.data.degraded));
    } catch {
      toast.push('Unable to reach the assistant. Check your connection and try again.', 'error');
      setTurns((current) => [
        ...current,
        { role: 'assistant', content: 'I could not reach the AI provider. Your inbox data is unchanged.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel flex h-[min(70vh,720px)] flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-500/10">
            <Sparkles className="h-4 w-4 text-violet-300" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-mist-50">Agent assistant</p>
            <p className="text-[11px] text-mist-500">Answers come only from your stored inbox analysis.</p>
          </div>
        </div>
        {turns.length > 0 ? (
          <Button variant="ghost" size="xs" onClick={() => setTurns([])}>
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
            New conversation
          </Button>
        ) : null}
      </header>

      <div ref={scrollRef} className="scroll-area flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {turns.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-mist-300">
              Hi {greetingName}. Ask me anything about your inbox — I read your analysed email and answer with
              dates, senders and deadlines taken from the actual messages. If something was never stated, I will
              say so rather than guess.
            </p>
            {!aiConfigured ? (
              <p className="flex items-start gap-2 rounded-xl border border-medium/25 bg-medium/[0.07] p-3 text-[11px] leading-relaxed text-medium">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                No AI provider is configured, so the assistant cannot run yet. Set AI_API_KEY in your
                environment to enable conversational answers. Everything else keeps working.
              </p>
            ) : null}
            <div>
              <p className="label">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    disabled={!aiConfigured || busy}
                    className="chip chip-neutral text-left transition-colors hover:border-violet-400/30 hover:text-violet-100 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {turns.map((turn, index) => (
              <li
                key={`${turn.role}-${index}`}
                className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-anywhere',
                    turn.role === 'user'
                      ? 'bg-violet-600/20 text-mist-50 ring-1 ring-inset ring-violet-400/25'
                      : 'bg-white/[0.03] text-mist-200 ring-1 ring-inset ring-white/[0.06]',
                  )}
                >
                  {turn.content}
                </div>
              </li>
            ))}
            {busy ? (
              <li className="flex items-center gap-2 text-xs text-mist-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Reading your inbox…
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {degraded ? (
        <p className="border-t border-medium/20 bg-medium/[0.06] px-5 py-2 text-[11px] text-medium">
          This answer was produced without the AI provider. Treat it as a fallback notice, not an analysis.
        </p>
      ) : null}

      {tools.length > 0 ? (
        <details className="border-t border-white/[0.06] px-5 py-2.5 text-[11px] text-mist-500">
          <summary className="cursor-pointer select-none hover:text-mist-300">
            How this answer was produced ({tools.length} data {tools.length === 1 ? 'lookup' : 'lookups'})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className="flex gap-2">
                <code className="shrink-0 font-mono text-[10px] text-violet-300">{tool.name}</code>
                <span>{tool.summary}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-white/[0.06] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          Ask the assistant about your inbox
        </label>
        <textarea
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          disabled={!aiConfigured}
          placeholder={aiConfigured ? 'Ask about deadlines, senders, invoices, priorities…' : 'AI provider not configured'}
          className="field max-h-32 min-h-[42px] flex-1 resize-y py-2.5"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={!aiConfigured || input.trim().length === 0}>
          <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Send
        </Button>
      </form>
    </div>
  );
}
