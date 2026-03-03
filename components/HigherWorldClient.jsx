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
  const size = 15;
  const center = Math.floor(size / 2);
  const [npcs, setNpcs] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [menu, setMenu] = useState(null);
  const [zoom, setZoom] = useState(1);
  const menuRef = useRef(null);
  const worldScrollRef = useRef(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, left: 0, top: 0 });
  const zoomRef = useRef(1);
  const pinchRef = useRef({ startDist: 0, startZoom: 1, midX: 0, midY: 0, active: false });

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
    const t = setInterval(() => setNowMs(Date.now()), 500);
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

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = worldScrollRef.current;
    if (!el) return;
    const centerWorld = () => {
      const left = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      const top = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
      el.scrollTo({ left, top, behavior: 'auto' });
    };
    centerWorld();
    window.addEventListener('resize', centerWorld);
    return () => window.removeEventListener('resize', centerWorld);
  }, []);

  const clampZoom = (z) => Math.max(0.65, Math.min(2.2, z));

  const applyZoomAtPoint = (nextZoom, clientX, clientY) => {
    const el = worldScrollRef.current;
    const prevZoom = zoomRef.current;
    const z = clampZoom(nextZoom);
    if (!el || !Number.isFinite(z) || Math.abs(z - prevZoom) < 0.001) return;

    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const worldX = el.scrollLeft + px;
    const worldY = el.scrollTop + py;
    const ratio = z / prevZoom;

    zoomRef.current = z;
    setZoom(z);

    requestAnimationFrame(() => {
      const left = worldX * ratio - px;
      const top = worldY * ratio - py;
      el.scrollLeft = Math.max(0, left);
      el.scrollTop = Math.max(0, top);
    });
  };

  const npcsWithCurrentCast = useMemo(() => {
    const allCasts = (npcs || [])
      .flatMap((n) => (Array.isArray(n?.casts) ? n.casts : []))
      .map((c) => Number(c?.graphIndex))
      .filter((v) => Number.isFinite(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER)
      .sort((a, b) => a - b);

    const maxGraphIndex = allCasts.length ? allCasts[allCasts.length - 1] : 0;
    const eventMs = 2600;
    const loopPauseMs = 3200;
    const linearSpanMs = (maxGraphIndex + 1) * eventMs;
    const loopMs = linearSpanMs + loopPauseMs;
    const t = loopMs > 0 ? nowMs % loopMs : 0;
    const globalCursor = t >= linearSpanMs ? maxGraphIndex : Math.floor(t / eventMs);

    return (npcs || []).map((n) => {
      const list = (Array.isArray(n?.casts) ? n.casts : [])
        .filter((c) => Number.isFinite(Number(c?.graphIndex)) && Number(c?.graphIndex) >= 0 && Number(c?.graphIndex) < Number.MAX_SAFE_INTEGER)
        .sort((a, b) => Number(a.graphIndex) - Number(b.graphIndex));

      const publicOffer = list.find((c) => c?.isPublicSwapOffer) || null;
      if (!list.length) return { ...n, currentCast: null, lastCastShown: null, publicOfferCast: publicOffer };

      // Global ordering projection: latest cast for this user that has appeared in global sequence.
      let shownCast = null;
      for (let i = 0; i < list.length; i += 1) {
        const gi = Number(list[i].graphIndex);
        if (gi <= globalCursor) shownCast = list[i];
        else break;
      }
      if (!shownCast) shownCast = list[0];

      // Keep independent per-tile blink/blank rhythm on top of globally-selected cast.
      const key = String(n?.fid || n?.username || 'npc');
      const castDurationMs = 3200 + Math.floor(hashToUnit(`${key}:dur`) * 2800); // 3.2s..6s
      const blankDurationMs = Math.floor(castDurationMs * 0.5);
      const tileCycle = castDurationMs + blankDurationMs;
      const tileOffset = Math.floor(hashToUnit(`${key}:phase`) * tileCycle);
      const tilePhase = (nowMs + tileOffset) % tileCycle;
      const showText = tilePhase < castDurationMs;

      return {
        ...n,
        currentCast: showText ? shownCast : null,
        lastCastShown: shownCast,
        publicOfferCast: publicOffer,
      };
    });
  }, [npcs, nowMs]);

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
      let x = Math.max(1, Math.min(size - 2, Math.round(t.tx)));
      let y = Math.max(1, Math.min(size - 2, Math.round(t.ty)));
      if (x === center && y === center) x = Math.min(size - 2, x + 1);

      let tries = 0;
      let r = 1;
      while ((x === center && y === center) || placed.has(`${x}-${y}`)) {
        const a = hashToUnit(`${t.u._key}:${tries}:a`) * 2 * Math.PI;
        const nx = Math.round(t.tx + Math.cos(a) * r);
        const ny = Math.round(t.ty + Math.sin(a) * r);
        x = Math.max(1, Math.min(size - 2, nx));
        y = Math.max(1, Math.min(size - 2, ny));
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

  const onWorldMouseDown = (e) => {
    const el = worldScrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  };

  const onWorldMouseMove = (e) => {
    const el = worldScrollRef.current;
    const st = dragRef.current;
    if (!el || !st.active) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    el.scrollLeft = st.left - dx;
    el.scrollTop = st.top - dy;
  };

  const onWorldMouseUp = () => {
    const el = worldScrollRef.current;
    dragRef.current.active = false;
    if (!el) return;
    el.style.cursor = 'grab';
    el.style.userSelect = '';
  };

  const onWorldWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
    }
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    applyZoomAtPoint(zoomRef.current * factor, e.clientX, e.clientY);
  };

  const onWorldTouchStart = (e) => {
    if (e.touches.length !== 2) {
      pinchRef.current.active = false;
      return;
    }
    const [a, b] = e.touches;
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    pinchRef.current = {
      startDist: Math.hypot(dx, dy),
      startZoom: zoomRef.current,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
      active: false,
    };
  };

  const onWorldTouchMove = (e) => {
    if (e.touches.length !== 2) {
      pinchRef.current.active = false;
      return;
    }
    const [a, b] = e.touches;
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    const dist = Math.hypot(dx, dy);
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const base = pinchRef.current.startDist || dist;
    const delta = Math.abs(dist - base);

    if (!pinchRef.current.active && delta < 8) return;
    pinchRef.current.active = true;

    e.preventDefault();
    const startZoom = pinchRef.current.startZoom || zoomRef.current;
    const next = startZoom * (dist / Math.max(1, base));
    applyZoomAtPoint(next, midX, midY);
    pinchRef.current.midX = midX;
    pinchRef.current.midY = midY;
  };

  const onTalk = () => {
    if (!menu?.npc) return;
    const firstCast = Array.isArray(menu.npc?.casts) ? (menu.npc.casts[0] || null) : null;
    const c = menu.npc?.currentCast || menu.npc?.lastCastShown || firstCast;
    const link = c?.permalink || c?.castUrl;
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

    const fname = String(menu.npc?.username || '').replace(/^@/, '').trim();
    if (!fname) {
      setMenu(null);
      return;
    }

    router.push(`/maker?counterparty=${encodeURIComponent(fname)}&channel=${encodeURIComponent(worldName)}`);
    setMenu(null);
  };

  const tileSize = 58;
  const boardSidePx = Math.round(size * tileSize * zoom);
  const boardSide = `${boardSidePx}px`;
  const frameWidth = `min(calc(${boardSide} + 20px), calc(100vw - 32px))`;
  const frameHeight = `min(calc(${boardSide} + 20px), calc(100dvh - 96px))`;
  const trees = ['🌲', '🌳', '🌴'];
  const cells = [];
  const labels = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x}-${y}`;
      const npc = byCell.get(key);
      const current = npc?.currentCast || null;
      const isCenter = x === center && y === center;
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const tree = trees[Math.floor(hashToUnit(`tree:${key}`) * trees.length) % trees.length];
      if (!isCenter && !isBorder && npc && current?.text) {
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
          ) : isBorder ? (
            <span style={{ fontSize: 22, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))' }}>{tree}</span>
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
      <div style={{ width: frameWidth, margin: '0 auto' }}>
        <div
          style={{
            marginBottom: 10,
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset',
            background: 'linear-gradient(180deg, #6f6248 0%, #5a4e38 100%)',
            borderRadius: 8,
            padding: '8px 10px',
            letterSpacing: 1,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            onClick={() => router.push('/worlds')}
            style={{
              border: '1px solid rgba(236,200,120,0.55)',
              background: 'rgba(28,22,14,0.75)',
              color: '#f4e3b8',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 14,
              cursor: 'pointer',
              width: 82,
            }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>/{worldName}</div>
          <div style={{ width: 82 }} aria-hidden />
        </div>

        <section
          ref={worldScrollRef}
          className="rs-hide-scrollbar"
          onMouseDown={onWorldMouseDown}
          onMouseMove={onWorldMouseMove}
          onMouseUp={onWorldMouseUp}
          onMouseLeave={onWorldMouseUp}
          onWheel={onWorldWheel}
          onTouchStart={onWorldTouchStart}
          onTouchMove={onWorldTouchMove}
          onTouchEnd={() => { pinchRef.current.active = false; onWorldMouseUp(); }}
          onTouchCancel={() => { pinchRef.current.active = false; onWorldMouseUp(); }}
          style={{
            border: '2px solid #7f6a3b',
            boxShadow: '0 0 0 2px #221b11 inset, 0 0 0 4px #9a8247 inset, 0 16px 40px rgba(0,0,0,0.65)',
            background: 'linear-gradient(180deg, rgba(74,66,49,0.95) 0%, rgba(59,51,38,0.95) 55%, rgba(48,41,31,0.95) 100%)',
            borderRadius: 12,
            padding: 10,
            overflow: 'auto',
            height: frameHeight,
            boxSizing: 'border-box',
            cursor: 'grab',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            touchAction: 'pan-x pan-y',
          }}
        >
          <div
            style={{
              width: boardSide,
              height: boardSide,
              minWidth: boardSide,
              minHeight: boardSide,
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${size}, 1fr)`,
                gap: 2,
                width: '100%',
                height: '100%',
              }}
            >
              {cells}
            </div>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
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
          <button
            onClick={onTalk}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              color: '#d6f7d6',
              border: 'none',
              padding: '9px 11px',
              cursor: 'pointer',
              fontSize: 17,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={`Talk to ${menu.name}`}
          >
            {`Talk to ${menu.name}`}
          </button>
          <button
            onClick={onTrade}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              color: '#b7f0ff',
              border: 'none',
              padding: '9px 11px',
              cursor: 'pointer',
              fontSize: 17,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={`Trade with ${menu.name}`}
          >
            {`Trade with ${menu.name}`}
          </button>
        </div>
      ) : null}
    </main>
  );
}
