// The Onyx mark: a faceted onyx gemstone. Also used (as a static file) for
// the favicon in src/app/icon1.svg; keep the two in sync.
export function OnyxGem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#0B0C0F" />
      <g stroke="#0B0C0F" strokeWidth="1.2" strokeLinejoin="round">
        {/* crown */}
        <polygon points="12,25 21,13 27,25" fill="#7C8291" />
        <polygon points="21,13 43,13 37,25 27,25" fill="#D9DEE7" />
        <polygon points="43,13 52,25 37,25" fill="#A2A8B6" />
        {/* pavilion */}
        <polygon points="12,25 27,25 32,53" fill="#3A3E48" />
        <polygon points="27,25 37,25 32,53" fill="#5E6371" />
        <polygon points="37,25 52,25 32,53" fill="#2A2D35" />
      </g>
      {/* sparkle */}
      <path d="M50 8.5l1.3 3.2 3.2 1.3-3.2 1.3L50 17.5l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="#FFFFFF" />
    </svg>
  );
}
