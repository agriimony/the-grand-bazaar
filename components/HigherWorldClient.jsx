'use client';

import { useEffect, useMemo, useState } from 'react';

function hashToUnit(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967295;
}

function trimText(s, max = 62) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export default function HigherWorldClient() {
  const size = 17;
  const center = Math.floor(size / 2);
  const [npcs, setNpcs] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    async function load() {
      try {
        const r = await fetch('/api/worlds/higher/npcs', { cache: 'no-store' });
        const d = await r.json();
        if (!dead && d?.ok && Array.isArray(d?.npcs)) setNpcs(d.npcs);
      } catch {}
    }
    load();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 6000);
    return () => clearInterval(t);
  }, []);

  const npcsWithCurrentCast = useMemo(() => {
    return (npcs || []).map((n) => {
      const list = Array.isArray(n?.casts) ? n.casts : [];
      const idx = list.length ? tick % list.length : 0;
      return { ...n, currentCast: list[idx] || null };
    });
  }, [npcs, tick]);

  const byCell = useMemo(() => {
    const map = new Map();
    for (const n of npcsWithCurrentCast) {
      const seed = String(n.fid || n.username || n.currentCast?.castHash || 'npc');
      // Scatter around center, avoid center tile itself.
      let x = Math.floor(hashToUnit(seed + 'x') * size);
      let y = Math.floor(hashToUnit(seed + 'y') * size);
      if (x === center && y === center) x = (x + 1) % size;
      let tries = 0;
      while (map.has(`${x}-${y}`) && tries < size * size) {
        x = (x + 2) % size;
        y = (y + 3) % size;
        if (x === center && y === center) x = (x + 1) % size;
        tries += 1;
      }
      map.set(`${x}-${y}`, n);
    }
    return map;
  }, [npcsWithCurrentCast]);

  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x}-${y}`;
      const npc = byCell.get(key);
      const current = npc?.currentCast || null;
      const isCenter = x === center && y === center;
      cells.push(
        <div
          key={key}
          style={{
            aspectRatio: '1 / 1',
            border: '1px solid rgba(220, 189, 116, 0.25)',
            display: 'grid',
            placeItems: 'center',
            fontSize: isCenter ? 30 : 12,
            background: isCenter ? 'rgba(157, 201, 255, 0.18)' : 'rgba(31, 25, 16, 0.4)',
            boxShadow: isCenter ? '0 0 14px rgba(126, 192, 255, 0.45) inset' : 'none',
            color: isCenter ? '#dff2ff' : '#cbb68a',
            position: 'relative',
            overflow: 'visible',
          }}
        >
          {isCenter ? (
            '⛲'
          ) : npc ? (
            <>
              {current?.text ? (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translate(-50%, -2px)',
                    maxWidth: '180%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: 10,
                    lineHeight: 1,
                    color: '#fff8b2',
                    textAlign: 'center',
                    textShadow: '0 1px 0 #000, 0 0 6px rgba(0,0,0,0.9)',
                    pointerEvents: 'none',
                    zIndex: 3,
                    padding: '0 2px',
                  }}
                >
                  {trimText(current.text, 42)}
                </div>
              ) : null}
              <a
                href={current?.castUrl || '#'}
                target="_blank"
                rel="noreferrer"
                title={`@${npc.username}`}
                style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}
              >
                <img
                  src={npc.pfp}
                  alt={npc.username}
                  style={{ width: '84%', height: '84%', borderRadius: '999px', objectFit: 'cover', border: '1px solid rgba(247,230,181,0.7)' }}
                />
              </a>
            </>
          ) : null}
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
