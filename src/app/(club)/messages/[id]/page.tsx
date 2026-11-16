import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { ArchiveConversationButton } from '@/components/messaging/conversation-buttons';
import { ReasonForm } from '@/components/messaging/report-form';
import { Thread } from '@/components/messaging/thread';
import { Badge, PageHeader } from '@/components/ui/card';
import { KIND_LABEL } from '@/lib/messaging';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getConversation } from '@/server/messaging/service';

export const metadata: Metadata = { title: 'Conversation' };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Messaging" />;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const thread = await getConversation(session, id.data);
  if (!thread) notFound();
  const c = thread.conversation;

  return (
    <>
      <Link href={c.archived ? '/messages?view=archived' : '/messages'} className="mb-4 inline-block text-sm font-semibold">
        ← Messages
      </Link>
      <PageHeader
        eyebrow={KIND_LABEL[c.kind]}
        title={c.otherClub.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {c.kind !== 'general' ? <span>{c.title}</span> : null}
            {c.otherClub.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
            {c.kind === 'proposal' && c.proposalId ? <Link href={`/proposals/${c.proposalId}`}>Open the proposal →</Link> : null}
            {c.otherClub.approved && c.otherClub.slug ? <Link href={`/clubs/ringportal/${c.otherClub.slug}`}>Club profile →</Link> : null}
          </span>
        }
        actions={<ArchiveConversationButton conversationId={c.id} archived={c.archived} />}
      />
      <Thread
        conversationId={c.id}
        initialMessages={thread.messages}
        hasEarlier={thread.hasEarlier}
        lastReadMessageId={thread.lastReadMessageId}
        otherClubName={c.otherClub.name}
        canSend={c.otherClub.approved}
      />
      <div className="mt-6">
        <ReasonForm
          endpoint={`/api/conversations/${c.id}/report`}
          field="reason"
          openLabel="Report this conversation"
          label="What is the problem?"
          hint="A RingPortal administrator will read this conversation to review your report. The other club is not told who reported it."
          submitLabel="Send report"
          doneText="Report sent. An administrator will review it."
        />
      </div>
    </>
  );
}
