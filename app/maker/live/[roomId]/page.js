import AutoFitTitle from '../../../../components/AutoFitTitle';
import LiveMakerClient from '../../../../components/LiveMakerClient';

export default function LiveMakerPage({ params, searchParams }) {
  const roomId = String(params?.roomId || '').trim();
  const roleRaw = String(searchParams?.role || '').trim().toLowerCase();
  const role = roleRaw === 'sender' ? 'sender' : 'signer';
  const channel = String(searchParams?.channel || '').replace(/^\//, '');
  const signerPlayerId = String(searchParams?.signerPlayerId || '').trim();
  const signerFname = String(searchParams?.signerFname || '').replace(/^@/, '').trim().toLowerCase();
  const signerSessionId = String(searchParams?.signerSessionId || '').trim();
  const senderPlayerId = String(searchParams?.senderPlayerId || '').trim();
  const senderFname = String(searchParams?.senderFname || '').replace(/^@/, '').trim().toLowerCase();
  const senderSessionId = String(searchParams?.senderSessionId || '').trim();
  const initialPeerPlayerId = role === 'sender' ? signerPlayerId : senderPlayerId;
  const initialPeerFname = role === 'sender' ? signerFname : senderFname;
  const initialPeerSessionId = role === 'sender' ? signerSessionId : senderSessionId;

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <LiveMakerClient
        roomId={roomId}
        initialRole={role}
        initialChannel={channel}
        initialSignerPlayerId={signerPlayerId}
        initialSignerFname={signerFname}
        initialPeerPlayerId={initialPeerPlayerId}
        initialPeerFname={initialPeerFname}
        initialPeerSessionId={initialPeerSessionId}
      />
    </main>
  );
}
