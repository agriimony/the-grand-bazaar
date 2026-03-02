import BazaarMvpClient from '../../components/BazaarMvpClient';
import AutoFitTitle from '../../components/AutoFitTitle';

export default function MakerPage({ searchParams }) {
  const counterparty = String(searchParams?.counterparty || '').replace(/^@/, '');
  const channel = String(searchParams?.channel || '').replace(/^\//, '');

  return (
    <main className="bazaar-shell">
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient startInMakerMode initialCounterparty={counterparty} initialChannel={channel} />
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, opacity: 0.75 }}>
        For agents: <a href="/api/agent-manifest">agent-manifest</a> · <a href="/agents.txt">agents.txt</a>
      </div>
    </main>
  );
}
