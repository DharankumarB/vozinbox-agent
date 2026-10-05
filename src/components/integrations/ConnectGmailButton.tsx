'use client';

import { Mail } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

/**
 * Starts the Gmail OAuth flow.
 * When the deployment is not configured for OAuth the button explains why
 * rather than pretending to connect (§67).
 */
export function ConnectGmailButton({
  configured = true,
  label = 'Connect Gmail',
  className,
}: {
  configured?: boolean;
  label?: string;
  className?: string;
}) {
  const toast = useToast();

  if (!configured) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() =>
            toast.push(
              'Gmail cannot be connected yet: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY must be configured on the server.',
              'info',
            )
          }
          className="btn btn-secondary"
          aria-describedby="gmail-not-configured"
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          {label}
        </button>
        <p id="gmail-not-configured" className="mt-2 text-[11px] text-mist-500">
          Gmail OAuth is not configured on this deployment.
        </p>
      </div>
    );
  }

  return (
    <a href="/api/integrations/gmail/connect" className={`btn btn-primary ${className ?? ''}`}>
      <Mail className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}
