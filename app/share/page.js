import { redirect } from 'next/navigation';

export default function SharePage({ searchParams }) {
  const castHash = String(searchParams?.castHash || searchParams?.hash || '').trim();
  if (castHash) {
    redirect(`/c/${encodeURIComponent(castHash)}`);
  }
  redirect('/');
}
