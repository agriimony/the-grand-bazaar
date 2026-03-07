import AutoFitTitle from '../../../../components/AutoFitTitle';
import LiveMakerClient from '../../../../components/LiveMakerClient';

export default function LiveMakerPage({ params, searchParams }) {
  const roomId = String(params?.roomId || '').trim();
  const roleRaw = String(searchParams?.role || '').trim().toLowerCase();
  const role = roleRaw === 'sender' ? 'sender' : 'signer';
  const channel = String(searchParams?.channel || '').replace(/^\//, '');

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <LiveMakerClient roomId={roomId} initialRole={role} initialChannel={channel} />
    </main>
  );
}
