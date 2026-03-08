import AutoFitTitle from '../../../../components/AutoFitTitle';
import LiveMakerClient from '../../../../components/LiveMakerClient';

export default function LiveMakerPage({ params, searchParams }) {
  const roomId = String(params?.roomId || '').trim();
  const roleRaw = String(searchParams?.role || '').trim().toLowerCase();
  const role = roleRaw === 'sender' ? 'sender' : 'signer';
  const channel = String(searchParams?.channel || '').replace(/^\//, '');
  const signerPlayerId = String(searchParams?.signerPlayerId || '').trim();
  const signerFname = String(searchParams?.signerFname || '').replace(/^@/, '').trim().toLowerCase();

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <LiveMakerClient
        roomId={roomId}
        initialRole={role}
        initialChannel={channel}
        initialSignerPlayerId={signerPlayerId}
        initialSignerFname={signerFname}
      />
    </main>
  );
}
