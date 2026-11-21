import Link from 'next/link';

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      <Link href="/privacy" className="text-muted">Privacy notice</Link>
      <Link href="/terms" className="text-muted">Terms of use</Link>
      <Link href="/cookies" className="text-muted">Cookies</Link>
    </nav>
  );
}
