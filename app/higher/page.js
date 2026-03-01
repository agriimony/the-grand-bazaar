export default function HigherWorldPage() {
  const size = 17;
  const cells = [];
  const center = Math.floor(size / 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const isCenter = x === center && y === center;
      cells.push(
        <div
          key={`${x}-${y}`}
          style={{
            aspectRatio: '1 / 1',
            border: '1px solid rgba(220, 189, 116, 0.25)',
            display: 'grid',
            placeItems: 'center',
            fontSize: isCenter ? 30 : 12,
            background: isCenter ? 'rgba(157, 201, 255, 0.18)' : 'rgba(31, 25, 16, 0.4)',
            boxShadow: isCenter ? '0 0 14px rgba(126, 192, 255, 0.45) inset' : 'none',
            color: isCenter ? '#dff2ff' : '#cbb68a',
          }}
        >
          {isCenter ? '⛲' : ''}
        </div>
      );
    }
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: 16,
        background: 'linear-gradient(180deg, #2d2519 0%, #1c160e 100%)',
        color: '#f7e6b5',
        fontFamily: 'var(--font-pixel), monospace',
      }}
    >
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div
          style={{
            marginBottom: 10,
            textAlign: 'center',
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset',
            background: 'linear-gradient(180deg, #6f6248 0%, #5a4e38 100%)',
            borderRadius: 8,
            padding: '10px 12px',
            letterSpacing: 1,
            fontWeight: 700,
          }}
        >
          /higher world
        </div>

        <section
          style={{
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
            background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
            borderRadius: 12,
            padding: 10,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${size}, 1fr)`,
              gap: 2,
            }}
          >
            {cells}
          </div>
        </section>
      </div>
    </main>
  );
}
