import {
  Activity,
  Bell,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Plug,
  Settings,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. */
  primaryMobile?: boolean;
  description: string;
}

/** Main navigation (§4). */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, primaryMobile: true, description: "What needs your attention" },
  { href: '/inbox', label: 'Inbox', icon: Inbox, primaryMobile: true, description: 'Analysed messages' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, primaryMobile: true, description: 'Suggested and tracked work' },
  { href: '/assistant', label: 'Assistant', icon: Sparkles, primaryMobile: true, description: 'Ask about your inbox' },
  { href: '/notifications', label: 'Notifications', icon: Bell, primaryMobile: true, description: 'Alerts and reminders' },
  { href: '/activity', label: 'Agent Activity', icon: Activity, description: 'What the agent did, and when' },
  { href: '/integrations', label: 'Integrations', icon: Plug, description: 'Connect your mailbox' },
  { href: '/settings', label: 'Settings', icon: Settings, description: 'AI, notifications, privacy' },
  { href: '/profile', label: 'Profile', icon: UserRound, description: 'Account details' },
];
