'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Brain,
  Check,
  ExternalLink,
  LogOut,
  Plug,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { Profile, UserPreferences } from '@/lib/types/database';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { SUMMARY_LENGTHS, type SummaryLength } from '@/lib/types/domain';

type PreferencePatch = Partial<UserPreferences>;

const SUMMARY_LABELS: Record<SummaryLength, string> = {
  SHORT: 'Short — one line',
  NORMAL: 'Normal — a paragraph',
  DETAILED: 'Detailed — full context',
};

const TIMEZONES = [
  'UTC',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
];

export function SettingsView({
  profile,
  preferences,
  email,
  authSource,
  gmailConnected,
  aiConfigured,
  dataCounts,
}: {
  profile: Profile;
  preferences: UserPreferences;
  email: string | null;
  authSource: 'supabase' | 'local';
  gmailConnected: boolean;
  aiConfigured: boolean;
  dataCounts: { emails: number; tasks: number; notifications: number };
}) {
  const router = useRouter();
  const toast = useToast();

  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [prefs, setPrefs] = useState<UserPreferences>(preferences);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const timezoneOptions = useMemo(() => {
    const list = new Set(TIMEZONES);
    if (profile.timezone) list.add(profile.timezone);
    return [...list].sort();
  }, [profile.timezone]);

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as
      | { ok: true; data: { updated?: boolean; reason?: string; preferences: UserPreferences | null; profile: Profile | null } }
      | { ok: false; error: { message: string } };
    if (!payload.ok) throw new Error(payload.error.message);
    if (payload.data.updated === false && payload.data.reason === 'invalid_timezone') {
      throw new Error('That timezone is not recognised. Please choose one from the list.');
    }
    return payload.data;
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await patch({ profile: { fullName: fullName.trim() || null, timezone } });
      toast.push('Profile saved.', 'success');
      router.refresh();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Unable to save your profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const updatePreference = async (values: PreferencePatch, message: string) => {
    const previous = prefs;
    setPrefs((current) => ({ ...current, ...values }));
    setSavingPrefs(true);
    try {
      const data = await patch({ preferences: values });
      if (data.preferences) setPrefs(data.preferences);
      toast.push(message, 'success');
      router.refresh();
    } catch (error) {
      setPrefs(previous);
      toast.push(error instanceof Error ? error.message : 'Unable to save that setting.', 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const deleteData = async () => {
    setDeleting(true);
    try {
      const response = await fetch('/api/account/delete-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { deleted: Record<string, number> } }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return;
      }
      const tables = Object.keys(payload.data.deleted).length;
      toast.push(`Deleted VozInbox data across ${tables} tables. Your mailbox was not touched.`, 'success');
      setConfirmDelete(false);
      setConfirmation('');
      router.refresh();
    } catch {
      toast.push('Unable to complete the deletion. Please try again.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="space-y-5">
      {/* ── Account ─────────────────────────────────────────────────────────── */}
      <Section icon={<UserRound className="h-4 w-4" aria-hidden="true" />} title="Account" description="How VozInbox addresses you and when your day starts.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="settings-name">
              Full name
            </label>
            <input
              id="settings-name"
              className="field"
              value={fullName}
              maxLength={120}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="label" htmlFor="settings-email">
              Email address
            </label>
            <input id="settings-email" className="field" value={email ?? ''} readOnly disabled />
          </div>
          <div>
            <label className="label" htmlFor="settings-timezone">
              Timezone
            </label>
            <select
              id="settings-timezone"
              className="field"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-mist-500">
              Deadlines and “today” are interpreted in this timezone.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={saveProfile} loading={savingProfile}>
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Save profile
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out
          </Button>
          {authSource === 'local' ? (
            <span className="chip chip-neutral">Local development account</span>
          ) : null}
        </div>
      </Section>

      {/* ── Notifications ───────────────────────────────────────────────────── */}
      <Section icon={<Bell className="h-4 w-4" aria-hidden="true" />} title="Notifications" description="Choose which events are worth interrupting you for.">
        <div className="space-y-1">
          <ToggleRow
            label="Important email"
            hint="A new message that the agent classified as high or critical priority."
            checked={prefs.notify_important_email}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_important_email: value }, 'Notification preference saved.')}
          />
          <ToggleRow
            label="Deadline detected"
            hint="A message containing a deadline you need to act on."
            checked={prefs.notify_deadline}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_deadline: value }, 'Notification preference saved.')}
          />
          <ToggleRow
            label="Task suggestion"
            hint="The agent proposed a task and is waiting for your approval."
            checked={prefs.notify_task_suggestion}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_task_suggestion: value }, 'Notification preference saved.')}
          />
          <ToggleRow
            label="Meetings"
            hint="Calendar invitations and meeting requests."
            checked={prefs.notify_meeting}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_meeting: value }, 'Notification preference saved.')}
          />
          <ToggleRow
            label="Projects"
            hint="Project and team updates."
            checked={prefs.notify_project}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_project: value }, 'Notification preference saved.')}
          />
          <ToggleRow
            label="Information only"
            hint="Newsletters, receipts and other non-actionable mail — usually best left off."
            checked={prefs.notify_information}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ notify_information: value }, 'Notification preference saved.')}
          />
        </div>
      </Section>

      {/* ── AI & analysis ───────────────────────────────────────────────────── */}
      <Section icon={<Brain className="h-4 w-4" aria-hidden="true" />} title="AI & analysis" description="Control how aggressively the agent interprets your email.">
        {!aiConfigured ? (
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-medium/25 bg-medium/[0.07] p-3 text-[11px] leading-relaxed text-medium">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            No AI provider is configured, so messages are analysed by the deterministic rules engine. These
            settings apply as soon as AI_API_KEY is set.
          </p>
        ) : null}

        <div className="space-y-1">
          <ToggleRow
            label="Analyse new email automatically"
            hint="Run the agent pipeline as soon as a message is synced. When off, analysis is manual only."
            checked={prefs.auto_analyze_new_emails}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ auto_analyze_new_emails: value }, 'Analysis preference saved.')}
          />
          <ToggleRow
            label="Suggest tasks from email"
            hint="Propose tasks for you to approve. The agent never creates a task without your approval."
            checked={prefs.auto_suggest_tasks}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ auto_suggest_tasks: value }, 'Task preference saved.')}
          />
          <ToggleRow
            label="Deadline detection"
            hint="Look for dates and due times inside message text."
            checked={prefs.deadline_detection_enabled}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ deadline_detection_enabled: value }, 'Analysis preference saved.')}
          />
          <ToggleRow
            label="Priority detection"
            hint="Score each message by urgency and importance."
            checked={prefs.priority_detection_enabled}
            disabled={savingPrefs}
            onChange={(value) => updatePreference({ priority_detection_enabled: value }, 'Analysis preference saved.')}
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="settings-threshold">
              Confidence threshold
            </label>
            <input
              id="settings-threshold"
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={prefs.confidence_threshold}
              onChange={(event) =>
                setPrefs((current) => ({ ...current, confidence_threshold: Number(event.target.value) }))
              }
              onMouseUp={() =>
                updatePreference(
                  { confidence_threshold: prefs.confidence_threshold },
                  `Confidence threshold set to ${Math.round(prefs.confidence_threshold * 100)}%.`,
                )
              }
              onTouchEnd={() =>
                updatePreference(
                  { confidence_threshold: prefs.confidence_threshold },
                  `Confidence threshold set to ${Math.round(prefs.confidence_threshold * 100)}%.`,
                )
              }
              className="w-full accent-violet-500"
            />
            <p className="mt-1.5 text-[11px] text-mist-500">
              Currently {Math.round(prefs.confidence_threshold * 100)}% — anything the agent is less sure about is
              flagged for review instead of being reported as fact.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="settings-summary">
              Summary length
            </label>
            <select
              id="settings-summary"
              className="field"
              value={prefs.summary_length}
              onChange={(event) =>
                updatePreference(
                  { summary_length: event.target.value as SummaryLength },
                  'Summary length saved.',
                )
              }
            >
              {SUMMARY_LENGTHS.map((length) => (
                <option key={length} value={length}>
                  {SUMMARY_LABELS[length]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* ── Integrations ────────────────────────────────────────────────────── */}
      <Section icon={<Plug className="h-4 w-4" aria-hidden="true" />} title="Integrations" description="Which mailbox VozInbox reads, and how often.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
          <div>
            <p className="text-sm text-mist-100">Gmail — read-only</p>
            <p className="mt-0.5 text-[11px] text-mist-500">
              {gmailConnected
                ? 'A mailbox is connected. VozInbox never sends, deletes or modifies email.'
                : 'No mailbox connected yet.'}
            </p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/integrations">
              Manage
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="mt-4 max-w-xs">
          <label className="label" htmlFor="settings-interval">
            Automatic sync interval
          </label>
          <select
            id="settings-interval"
            className="field"
            value={prefs.sync_interval_minutes}
            onChange={(event) =>
              updatePreference(
                { sync_interval_minutes: Number(event.target.value) },
                'Sync interval saved.',
              )
            }
          >
            {[5, 10, 15, 30, 60, 240, 1440].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes < 60 ? `Every ${minutes} minutes` : minutes === 60 ? 'Hourly' : minutes === 1440 ? 'Daily' : `Every ${minutes / 60} hours`}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-mist-500">
            The scheduled sync respects this interval; “Sync now” always runs immediately.
          </p>
        </div>
      </Section>

      {/* ── Privacy & data ──────────────────────────────────────────────────── */}
      <Section icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} title="Privacy & data" description="What VozInbox stores, and how to remove it.">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Stored messages', value: dataCounts.emails },
            { label: 'Tasks', value: dataCounts.tasks },
            { label: 'Notifications', value: dataCounts.notifications },
          ].map((entry) => (
            <div key={entry.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <dt className="text-[11px] uppercase tracking-wide text-mist-500">{entry.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-mist-100">{entry.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 space-y-2 text-[11px] leading-relaxed text-mist-400">
          <p>
            Email bodies are used only to produce your analysis and to answer your own assistant questions. They
            are never used for training, and they are never sent anywhere except the AI provider you configure.
          </p>
          <p>
            Deleting VozInbox data removes the messages, analysis, tasks and notifications stored here and
            disconnects your mailbox. It does not delete anything from Gmail.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete VozInbox data
          </Button>
        </div>
      </Section>

      <p className="flex items-center gap-1.5 pb-2 text-[11px] text-mist-600">
        <Settings2 className="h-3 w-3" aria-hidden="true" />
        VozInbox Agent — every setting here changes what the agent does, not just how the app looks.
      </p>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          setConfirmation('');
        }}
        onConfirm={deleteData}
        title="Delete all VozInbox data?"
        message="This permanently removes your stored messages, analysis, tasks, notifications and audit history, and disconnects your mailbox. Your Gmail account is not affected. This cannot be undone."
        confirmLabel="Delete everything"
        destructive
        loading={deleting}
        confirmationWord="DELETE"
        confirmationValue={confirmation}
        onConfirmationValueChange={setConfirmation}
      />
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <header className="mb-4 flex items-start gap-2.5">
        <span className="mt-0.5 text-violet-300">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-mist-50">{title}</h2>
          <p className="mt-0.5 text-xs text-mist-400">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-white/[0.05] py-3 last:border-0')}>
      <div className="min-w-0">
        <p className="text-sm text-mist-100">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-mist-500">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {checked ? <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" /> : null}
        <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
      </div>
    </div>
  );
}
