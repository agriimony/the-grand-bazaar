'use client';

import { ethers } from 'ethers';

function tokenInitials(sym = '') {
  const s = String(sym || '').trim();
  if (!s) return '?';
  const alnum = s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (alnum.slice(0, 4) || '?');
}

function formatTokenIdLabel(v = '') {
  const s = String(v || '');
  return s.length > 12 ? `#${s.slice(0, 4)}…${s.slice(-4)}` : `#${s}`;
}

function shouldShowTokenId(kind, tokenId) {
  const k = String(kind || '').toLowerCase();
  if (k !== '0xd9b67a26') return false;
  return tokenId !== undefined && tokenId !== null && String(tokenId) !== '';
}

function tokenIconUrl(chainId, token) {
  const t = String(token || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return '';
  if (Number(chainId) !== 8453) return '';
  let checksum = t;
  try { checksum = ethers.getAddress(t); } catch {}
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksum}/logo.png`;
}

export default function TokenTile({
  amountNode,
  amountClassName,
  symbol,
  symbolClassName,
  showSymbol = true,
  imgUrl,
  tokenAddress,
  tokenKind,
  tokenId,
  tokenIdClassName,
  chainId = 8453,
  wrapClassName = '',
  iconClassName = 'rs-token-art',
  fallbackClassName = 'rs-token-art rs-token-fallback',
  insufficient = false,
  linkHref,
  disableLink = false,
}) {
  const resolvedImg = imgUrl || tokenIconUrl(chainId, tokenAddress || '') || '';
  const showId = shouldShowTokenId(tokenKind, tokenId);

  return (
    <div className={`rs-token-wrap ${wrapClassName}`.trim()}>
      {amountNode != null ? <div className={`rs-amount-overlay ${amountClassName || ''}`.trim()}>{amountNode}</div> : null}
      {showId ? <div className={`rs-tokenid-overlay ${tokenIdClassName || ''}`.trim()}>{formatTokenIdLabel(String(tokenId))}</div> : null}
      {showSymbol ? <div className={`rs-symbol-overlay ${symbolClassName || ''}`.trim()}>{symbol || 'NFT'}</div> : null}
      {insufficient ? <div className="rs-insufficient-mark">❗</div> : null}
      <a
        href={!disableLink && linkHref ? linkHref : undefined}
        target={!disableLink && linkHref ? '_blank' : undefined}
        rel={!disableLink && linkHref ? 'noreferrer' : undefined}
        className="rs-token-link"
        onClick={disableLink ? (e) => e.preventDefault() : undefined}
      >
        {resolvedImg ? (
          <>
            <img
              key={`tile-${resolvedImg || 'none'}-${symbol || ''}`}
              src={resolvedImg}
              alt={symbol || 'NFT'}
              className={iconClassName}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fb = e.currentTarget.nextElementSibling;
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div className={fallbackClassName} style={{ display: 'none' }}>{tokenInitials(symbol || 'NFT')}</div>
          </>
        ) : <div className={fallbackClassName}>{tokenInitials(symbol || 'NFT')}</div>}
      </a>
    </div>
  );
}
