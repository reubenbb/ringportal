'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function LoginForm({ endpoint, next, forgotHref, onNext }: { endpoint: string; next: string; forgotHref: string; onNext?: Record<string, string> }) {
  const router = useRouter();
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok?: boolean; next?: string }>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = await submit('POST', endpoint, { email: form.get('email'), password: form.get('password') });
    if (!data) return;
    const target = data.next && onNext?.[data.next] ? onNext[data.next]! : next;
    router.replace(target);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate={false} className="flex flex-col gap-5">
      {formError ? (
        <Alert tone="danger" live>
          {formError}
        </Alert>
      ) : null}
      <Field label="Email" name="email" type="email" autoComplete="username" required maxLength={254} error={fieldErrors.email} onInput={() => clearField('email')} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
        error={fieldErrors.password}
        onInput={() => clearField('password')}
      />
      <div className="flex items-center justify-between">
        <Link href={forgotHref} className="text-sm font-semibold">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" pending={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
