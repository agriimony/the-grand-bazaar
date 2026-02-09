'use client';

import { useEffect, useRef } from 'react';

export default function AutoFitTitle({ text }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const el = textRef.current;
    if (!wrap || !el) return;

    const fit = () => {
      const max = 72;
      const min = 14;
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollWidth > wrap.clientWidth) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="app-title-wrap">
      <h1 ref={textRef} className="app-title">{text}</h1>
    </div>
  );
}
