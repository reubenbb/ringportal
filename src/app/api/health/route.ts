import { NextResponse } from 'next/server';

/** Liveness only. Exposes no configuration, version or dependency detail. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
