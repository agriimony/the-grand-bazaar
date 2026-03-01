import Link from 'next/link';
import BazaarMvpClient from '../../components/BazaarMvpClient';
import AutoFitTitle from '../../components/AutoFitTitle';

export default function MakerPage({ searchParams }) {
  const counterparty = String(searchParams?.counterparty || '').replace(/^@/, '');

  return (
    <main className="bazaar-shell">
      <div style={{ width: '100%', maxWidth: 980, margin: '0 auto 8px' }}>
        <Link
          href="/higher"
          style={{
            display: 'inline-block',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(236, 200, 120, 0.5)',
            background: 'rgba(28, 22, 14, 0.75)',
            color: '#f4e3b8',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ← Back to /higher
        </Link>
      </div>
      <AutoFitTitle text="The Grand Bazaar" />
      <BazaarMvpClient startInMakerMode initialCounterparty={counterparty} />
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, opacity: 0.75 }}>
        For agents: <a href="/api/agent-manifest">agent-manifest</a> · <a href="/agents.txt">agents.txt</a>
      </div>
    </main>
  );
}
