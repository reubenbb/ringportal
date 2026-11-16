import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { BrowserNotificationsToggle } from '@/components/messaging/conversation-buttons';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { KIND_LABEL, formatMessageTime } from '@/lib/messaging';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listConversations } from '@/server/messaging/service';

export const metadata: Metadata = { title: 'Messages' };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ view?: string; cursor?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Messaging" />;
  const sp = await searchParams;
  const archived = sp.view === 'archived';
  const { items, nextCursor } = await listConversations(session, { archived, cursor: sp.cursor });

  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${active ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        eyebrow="Club to club"
        title="Messages"
        description="Conversations with other verified clubs. Only your club and the other club can read them."
        actions={<BrowserNotificationsToggle />}
      />
      <nav aria-label="Message folders" className="mb-4 flex gap-1">
        {tab('/messages', 'Inbox', !archived)}
        {tab('/messages?view=archived', 'Archived', archived)}
      </nav>
      <Card>
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">
            <p className="font-semibold text-ink">{archived ? 'No archived conversations' : 'No messages yet'}</p>
            {archived ? null : (
              <p className="mt-1">
                Start one from a club’s profile in the <Link href="/clubs">Club directory</Link>, or from a bout proposal.
              </p>
            )}
          </div>
        ) : (
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/messages/${c.id}`} className="flex gap-3 px-5 py-3.5 text-ink no-underline hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`truncate ${c.unread ? 'font-bold' : 'font-semibold'}`}>{c.otherClub.name}</span>
                      <Badge tone={c.kind === 'proposal' ? 'gold' : c.kind === 'boxer' ? 'blue' : 'neutral'}>{KIND_LABEL[c.kind]}</Badge>
                      {c.otherClub.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
                    </div>
                    {c.kind !== 'general' ? <p className="truncate text-xs text-muted">{c.title}</p> : null}
                    {c.lastMessage ? (
                      <p className={`mt-0.5 truncate text-sm ${c.unread ? 'text-ink' : 'text-muted'}`}>
                        {c.lastMessage.fromMe ? 'You: ' : ''}
                        {c.lastMessage.body}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.lastMessageAt ? <time dateTime={c.lastMessageAt} className="text-xs text-muted">{formatMessageTime(c.lastMessageAt)}</time> : null}
                    {c.unread ? (
                      <span className="min-w-6 rounded-full bg-electric px-1.5 text-center text-xs leading-5 font-bold text-white">
                        {c.unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {nextCursor ? (
        <p className="mt-4 text-right text-sm">
          <Link href={`/messages?${new URLSearchParams({ ...(archived ? { view: 'archived' } : {}), cursor: nextCursor })}`}>Older conversations →</Link>
        </p>
      ) : null}
    </>
  );
}
