import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { SUMMARY_LENGTHS } from '@/lib/types/domain';
import { isValidTimezone } from '@/lib/analysis/dates';

const schema = z.object({
  profile: z
    .object({
      fullName: z.string().max(120).nullable().optional(),
      timezone: z.string().max(64).optional(),
    })
    .optional(),
  preferences: z
    .object({
      auto_analyze_new_emails: z.boolean().optional(),
      auto_suggest_tasks: z.boolean().optional(),
      deadline_detection_enabled: z.boolean().optional(),
      priority_detection_enabled: z.boolean().optional(),
      summary_length: z.enum(SUMMARY_LENGTHS).optional(),
      confidence_threshold: z.number().min(0).max(1).optional(),
      notify_important_email: z.boolean().optional(),
      notify_deadline: z.boolean().optional(),
      notify_task_suggestion: z.boolean().optional(),
      notify_meeting: z.boolean().optional(),
      notify_project: z.boolean().optional(),
      notify_information: z.boolean().optional(),
      sync_interval_minutes: z.number().int().min(5).max(1440).optional(),
      important_senders: z.array(z.string().email().max(254)).max(100).optional(),
      ignored_senders: z.array(z.string().email().max(254)).max(100).optional(),
    })
    .optional(),
});

export const PATCH = withUser(
  async ({ auth, request }) => {
    const body = await parseJson(request, schema);
    const store = await getStore();

    let profile = null;
    if (body.profile) {
      const patch: Record<string, unknown> = {};
      if (body.profile.fullName !== undefined) patch.full_name = body.profile.fullName;
      if (body.profile.timezone !== undefined) {
        if (!isValidTimezone(body.profile.timezone)) {
          return jsonOk({ updated: false, reason: 'invalid_timezone' });
        }
        patch.timezone = body.profile.timezone;
      }
      if (Object.keys(patch).length > 0) {
        profile = await store.updateProfile(auth.id, patch);
      }
    }

    let preferences = null;
    if (body.preferences && Object.keys(body.preferences).length > 0) {
      preferences = await store.updatePreferences(auth.id, body.preferences);
    }

    return jsonOk({ profile, preferences });
  },
  { rateLimit: 'profileMutation' },
);

export const runtime = 'nodejs';
