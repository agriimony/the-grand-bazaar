import { redirect } from 'next/navigation';

export default function CastHashPage({ params }) {
  const castHash = params?.castHash || '';
  redirect(`/?castHash=${encodeURIComponent(castHash)}`);
}
