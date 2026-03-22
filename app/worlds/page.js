import WorldSelectClient from '../../components/WorldSelectClient';

export default function WorldsPage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'linear-gradient(180deg, #2d2519 0%, #1c160e 100%)',
        color: '#f7e6b5',
        fontFamily: 'var(--font-pixel), monospace',
      }}
    >
      <div
        style={{
          width: 'min(94vw, 620px)',
          border: '2px solid #7f6a3b',
          boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
          background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            background: 'linear-gradient(180deg, #6f6248 0%, #5a4e38 100%)',
            borderBottom: '2px solid #8f7a4b',
            textAlign: 'center',
            fontSize: 18,
            letterSpacing: 1,
          }}
        >
          WORLD SELECT
        </div>
        <div style={{ padding: 18 }}>
          <p style={{ margin: '0 0 12px', textAlign: 'center' }}>Choose a world</p>
          <WorldSelectClient />
        </div>
      </div>
    </main>
  );
}
