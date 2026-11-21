'use client';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { TextArea } from '@/components/ui/text-area';
import type { ClubProfile } from '@/server/clubs/profile';

export function ClubProfileForm({ initial }: { initial: ClubProfile }) {
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ ok: boolean }>();
  const [saved, setSaved] = useState(false);
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setSaved(false);
    const data = await submit('PUT', '/api/club/profile', Object.fromEntries(new FormData(ev.currentTarget).entries()));
    if (data) setSaved(true);
  }
  const c = (n: string) => () => {
    clearField(n);
    setSaved(false);
  };
  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5">
      {formError ? <Alert tone="danger" live>{formError}</Alert> : null}
      {saved ? <Alert tone="success" live>Profile saved.</Alert> : null}
      <TextArea label="About the club" name="about" rows={4} maxLength={1500} defaultValue={initial.about ?? ''} hint="For example: training times, the squad, the kind of bouts you are looking for." error={e.about} onChange={c('about')} />
      <Field label="Training venue" name="trainingVenue" maxLength={200} defaultValue={initial.trainingVenue ?? ''} hint="Venue name and town." error={e.trainingVenue} onInput={c('trainingVenue')} />
      <Field label="Club website" name="website" type="url" maxLength={200} placeholder="https://" defaultValue={initial.website ?? ''} error={e.website} onInput={c('website')} />
      <Field label="Club contact email" name="contactEmail" type="email" maxLength={254} defaultValue={initial.contactEmail ?? ''} hint="Use a club address, not a personal one. Other clubs can always message you through RingPortal." error={e.contactEmail} onInput={c('contactEmail')} />
      <div><Button type="submit" pending={pending}>Save profile</Button></div>
    </form>
  );
}
