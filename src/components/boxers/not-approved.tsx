import { Alert } from '@/components/ui/alert';

export function NotApprovedNotice({ feature }: { feature: string }) {
  return (
    <Alert tone="info" title="Available once your club is approved">
      {feature} opens to your club when RingPortal has verified your affiliation.
    </Alert>
  );
}
