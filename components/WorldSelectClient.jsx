'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';

const MAX_WORLD_PLAYERS = 37;

function WorldLink({ href, label, count }) {
  const safe = Math.max(0, Number(count || 0));
  const clamped = Math.min(MAX_WORLD_PLAYERS, safe);
  const full = safe >= MAX_WORLD_PLAYERS;
  return (
    <Link
      href={full ? '/worlds' : href}
      aria-disabled={full}
      onClick={full ? (e) => e.preventDefault() : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'center',
        padding: '12px 16px',
        borderRadius: 6,
        border: '2px solid #8f7a49',
        boxShadow: '0 0 0 1px #2a2216 inset',
        background: full
          ? 'linear-gradient(180deg, #8f8060 0%, #6a5c40 100%)'
          : 'linear-gradient(180deg, #a89160 0%, #7d6940 100%)',
        color: '#17120b',
        fontWeight: 800,
        fontSize: 24,
        textDecoration: 'none',
        opacity: full ? 0.8 : 1,
      }}
      title={full ? `${label} is full` : undefined}
    >
      {label}
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{`${clamped}/${MAX_WORLD_PLAYERS}`}</div>
    </Link>
  );
}

export default function WorldSelectClient() {
  const [counts, setCounts] = useState({ higher: 0, degen: 0 });
  const supabasePublicKey = useMemo(
    () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    []
  );

  useEffect(() => {
    const enabled =
      String(process.env.NEXT_PUBLIC_MULTIPLAYER_ENABLED || '').toLowerCase() === 'true' &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(supabasePublicKey);
    if (!enabled) return;

    const supabase = getSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, supabasePublicKey);
    if (!supabase) return;

    const mkChannel = (world) => {
      const ch = supabase.channel(`world:${world}`, { config: { presence: { key: `worlds_observer_${world}` } } });
      ch.on('presence', { event: 'sync' }, () => {
        let count = 0;
        try {
          const state = ch.presenceState() || {};
          count = Object.keys(state || {}).filter((k) => !String(k || '').startsWith('worlds_observer_')).length;
        } catch {}
        setCounts((prev) => ({ ...prev, [world]: count }));
      });
      ch.subscribe();
      return ch;
    };

    const higherCh = mkChannel('higher');
    const degenCh = mkChannel('degen');

    return () => {
      try { supabase.removeChannel(higherCh); } catch {}
      try { supabase.removeChannel(degenCh); } catch {}
    };
  }, [supabasePublicKey]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <WorldLink href="/higher" label="/higher" count={counts.higher} />
      <WorldLink href="/degen" label="/degen" count={counts.degen} />
    </div>
  );
}
