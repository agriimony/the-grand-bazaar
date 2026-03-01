'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function HigherWorldClient({ worldName = 'higher', apiPath = '/api/worlds/higher/npcs' }) {
  const router = useRouter();
  const size = 13;
  const center = Math.floor(size / 2);
  const [npcs, setNpcs] = useState([]);
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    let dead = false;
    async function load() {
      try {
        const join = apiPath.includes('?') ? '&' : '?';
        const r = await fetch(`${apiPath}${join}v=2`, { cache: 'no-store' });
        const d = await r.json();
        if (!dead && d?.ok && Array.isArray(d?.npcs)) setNpcs(d.npcs);
      } catch {}
    }
    load();
    return () => {
      dead = true;
    };
  }, [apiPath]);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 6000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onDown(e) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenu(null);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setMenu(null);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const npcsWithCurrentCast = useMemo(() => {
    return (npcs || []).map((n) => {
      const list = Array.isArray(n?.casts) ? n.casts : [];
      const idx = list.length ? tick % list.length : 0;
      const current = list[idx] || null;
      const publicOffer = list.find((c) => c?.isPublicSwapOffer) || null;
      return { ...n, currentCast: current, publicOfferCast: publicOffer };
    });
  }, [npcs, tick]);

  const byCell = useMemo(() => {
    const placed = new Map();
    if (!npcsWithCurrentCast.length) return placed;

    const users = npcsWithCurrentCast.map((n, idx) => ({
      ...n,
      _idx: idx,
      _key: String(n.fid || n.username || idx),
      _score: Number(n.topScore || n.currentCast?.engagementScore || 0),
    }));

    const castOwner = new Map();
    for (const u of users) {
      const list = Array.isArray(u.casts) ? u.casts : [];
      for (const c of list) castOwner.set(String(c.castHash), u._key);
    }

    const edges = new Map();
    const bump = (a, b, w = 1) => {
      if (!a || !b || a === b) return;
      const x = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(x, (edges.get(x) || 0) + w);
    };
    for (const u of users) {
      const list = Array.isArray(u.casts) ? u.casts : [];
      for (const c of list) {
        const parentOwner = castOwner.get(String(c.parentHash || ''));
        if (parentOwner) bump(u._key, parentOwner, 1);
      }
    }

    const nbr = new Map(users.map((u) => [u._key, []]));
    for (const [k, w] of edges.entries()) {
      const [a, b] = k.split('|');
      nbr.get(a)?.push({ to: b, w });
      nbr.get(b)?.push({ to: a, w });
    }

    const seen = new Set();
    const components = [];
    for (const u of users) {
      if (seen.has(u._key)) continue;
      const stack = [u._key];
      seen.add(u._key);
      const comp = [];
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const n of nbr.get(cur) || []) {
          if (seen.has(n.to)) continue;
          seen.add(n.to);
          stack.push(n.to);
        }
      }
      components.push(comp);
    }

    const keyToUser = new Map(users.map((u) => [u._key, u]));
    const maxScore = Math.max(1, ...users.map((u) => u._score));
    const baseRadius = Math.max(2, Math.floor(size / 2) - 1);

    const compSorted = components
      .map((comp) => ({
        keys: comp,
        score: comp.reduce((s, k) => s + (keyToUser.get(k)?._score || 0), 0),
      }))
      .sort((a, b) => b.score - a.score);

    const targets = [];
    for (let ci = 0; ci < compSorted.length; ci += 1) {
      const comp = compSorted[ci];
      const clusterAngle = (2 * Math.PI * ci) / Math.max(1, compSorted.length);
      const clusterScoreNorm = Math.min(1, comp.score / Math.max(1, comp.keys.length * maxScore));
      const clusterR = Math.max(1, Math.round(baseRadius * (1 - 0.55 * clusterScoreNorm)));
      const cx = center + Math.cos(clusterAngle) * clusterR;
      const cy = center + Math.sin(clusterAngle) * clusterR;

      const keys = [...comp.keys].sort((a, b) => {
        const aw = (nbr.get(a) || []).reduce((s, x) => s + x.w, 0);
        const bw = (nbr.get(b) || []).reduce((s, x) => s + x.w, 0);
        if (bw !== aw) return bw - aw;
        return (keyToUser.get(b)?._score || 0) - (keyToUser.get(a)?._score || 0);
      });

      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const u = keyToUser.get(k);
        if (!u) continue;
        const linkedWeight = (nbr.get(k) || []).reduce((s, x) => s + x.w, 0);
        const scoreNorm = Math.min(1, u._score / maxScore);
        const localR = Math.max(0.6, 2.4 - Math.min(1.8, linkedWeight * 0.25) - scoreNorm * 0.9);
        const localAngle = (2 * Math.PI * i) / Math.max(1, keys.length) + hashToUnit(`${k}:jitter`) * 0.35;
        const tx = cx + Math.cos(localAngle) * localR;
        const ty = cy + Math.sin(localAngle) * localR;
        targets.push({ u, tx, ty, scoreNorm });
      }
    }

    targets.sort((a, b) => b.scoreNorm - a.scoreNorm);

    for (const t of targets) {
      let x = Math.max(0, Math.min(size - 1, Math.round(t.tx)));
      let y = Math.max(0, Math.min(size - 1, Math.round(t.ty)));
      if (x === center && y === center) x = Math.min(size - 1, x + 1);

      let tries = 0;
      let r = 1;
      while ((x === center && y === center) || placed.has(`${x}-${y}`)) {
        const a = hashToUnit(`${t.u._key}:${tries}:a`) * 2 * Math.PI;
        const nx = Math.round(t.tx + Math.cos(a) * r);
        const ny = Math.round(t.ty + Math.sin(a) * r);
        x = Math.max(0, Math.min(size - 1, nx));
        y = Math.max(0, Math.min(size - 1, ny));
        tries += 1;
        if (tries % 8 === 0) r += 1;
        if (tries > size * size) break;
      }
      if (x === center && y === center) continue;
      placed.set(`${x}-${y}`, t.u);
    }

    return placed;
  }, [npcsWithCurrentCast]);

  const openNpcMenu = (e, npc) => {
    e.preventDefault();
    const name = String(npc?.displayName || npc?.username || 'user');
    setMenu({
      x: e.clientX,
      y: e.clientY,
      npc,
      name,
    });
  };

  const onTalk = () => {
    if (!menu?.npc) return;
    const link = menu.npc?.currentCast?.permalink || menu.npc?.currentCast?.castUrl;
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
    setMenu(null);
  };

  const onTrade = async () => {
    if (!menu?.npc) return;
    const offerHash = menu.npc?.publicOfferCast?.castHash;
    if (offerHash) {
      router.push(`/c/${offerHash}`);
      setMenu(null);
      return;
    }

    let wallet = String(menu.npc?.primaryWallet || '').trim();
    const fallback = String(menu.npc?.username || '').replace(/^@/, '');

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet) && fallback) {
      try {
        const r = await fetch(`/api/farcaster-name?q=${encodeURIComponent(fallback)}`, { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          const list = Array.isArray(d?.results) ? d.results : [];
          const exact = list.find((u) => String(u?.username || '').toLowerCase() === fallback.toLowerCase()) || list[0];
          const w = String(exact?.wallet || '').trim();
          if (/^0x[a-fA-F0-9]{40}$/.test(w)) wallet = w;
        }
      } catch {}
    }

    const cp = /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet : fallback;
    router.push(`/maker?counterparty=${encodeURIComponent(cp)}`);
    setMenu(null);
  };

  const cells = [];
  const labels = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x}-${y}`;
      const npc = byCell.get(key);
      const current = npc?.currentCast || null;
      const isCenter = x === center && y === center;
      if (!isCenter && npc && current?.text) {
        labels.push({
          key: `lbl-${key}`,
          x,
          y,
          text: trimText(current.text, 140),
        });
      }
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
            overflow: 'hidden',
          }}
        >
          {isCenter ? (
            '⛲'
          ) : npc ? (
            <>
              <button
                onClick={(e) => openNpcMenu(e, npc)}
                title={`@${npc.username}`}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={npc.pfp}
                  alt={npc.username}
                  style={{ width: '84%', height: '84%', borderRadius: '999px', objectFit: 'cover', border: '1px solid rgba(247,230,181,0.7)' }}
                />
              </button>
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
        position: 'relative',
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
          /{worldName} world
        </div>

        <section
          style={{
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
            background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
            borderRadius: 12,
            padding: 10,
            position: 'relative',
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
          <div style={{ position: 'absolute', inset: 10, pointerEvents: 'none', zIndex: 5 }}>
            {labels.map((l) => (
              <div
                key={l.key}
                style={{
                  position: 'absolute',
                  left: `${((l.x + 0.5) / size) * 100}%`,
                  top: `${(l.y / size) * 100}%`,
                  transform: 'translate(-50%, -102%)',
                  width: '14.5%',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  fontSize: 17,
                  lineHeight: 1.05,
                  color: '#fff8b2',
                  textAlign: 'center',
                  textShadow: '0 2px 0 #000, 0 0 10px rgba(0,0,0,1)',
                  filter: 'drop-shadow(0 2px 6px rgba(0,0,0,1))',
                }}
              >
                {l.text}
              </div>
            ))}
          </div>
        </section>
      </div>

      {menu ? (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : menu.x) - 220),
            top: Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : menu.y) - 120),
            width: 220,
            zIndex: 50,
            border: '2px solid #6d5a34',
            boxShadow: '0 0 0 1px #20180f inset, 0 12px 26px rgba(0,0,0,0.75)',
            background: 'linear-gradient(180deg, #3c3324 0%, #2d261b 100%)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '7px 9px', fontSize: 15, borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#f6e3ad' }}>
            Choose Option
          </div>
          <button onClick={onTalk} style={{ width: '100%', textAlign: 'left', background: 'transparent', color: '#d6f7d6', border: 'none', padding: '9px 11px', cursor: 'pointer', fontSize: 17 }}>
            Talk to {menu.name}
          </button>
          <button onClick={onTrade} style={{ width: '100%', textAlign: 'left', background: 'transparent', color: '#b7f0ff', border: 'none', padding: '9px 11px', cursor: 'pointer', fontSize: 17 }}>
            Trade with {menu.name}
          </button>
        </div>
      ) : null}
    </main>
  );
}
