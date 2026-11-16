'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Summary = { inserted: number; updated: number; unchanged: number; skipped: number; addressConflicts: number };

/** Owner-only control to import or refresh the bundled England Boxing directory. */
export function DirectoryImport({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<Summary | null>(null);
  const { pending, formError, submit } = useSubmit<Summary>();

  async function run() {
    const data = await submit('POST', '/api/admin/directory/import');
    if (data) {
      setResult(data);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant={hasData ? 'secondary' : 'primary'} pending={pending} onClick={run}>
        {pending ? 'Importing…' : hasData ? 'Refresh from England Boxing file' : 'Import England Boxing directory'}
      </Button>
      {formError ? <Alert tone="danger" live>{formError}</Alert> : null}
      {result ? (
        <Alert tone="success" live>
          {result.inserted} added, {result.updated} updated, {result.unchanged} unchanged{result.skipped ? `, ${result.skipped} skipped` : ''}
          {result.addressConflicts ? `, ${result.addressConflicts} verified addresses kept` : ''}.
        </Alert>
      ) : null}
    </div>
  );
}
