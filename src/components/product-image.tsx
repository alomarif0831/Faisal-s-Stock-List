/* eslint-disable @next/next/no-img-element -- images are served from our own DB route with immutable caching */

// Simple outline icons for listings posted without a photo.
const ICONS: Record<string, React.ReactNode> = {
  Phones: <rect x="7" y="2.5" width="10" height="19" rx="2.5" />,
  Tablets: <rect x="4.5" y="3" width="15" height="18" rx="2" />,
  Laptops: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  Watches: (
    <>
      <rect x="7" y="6.5" width="10" height="11" rx="3" />
      <path d="M9 6.5 9.5 3h5l.5 3.5M9 17.5l.5 3.5h5l.5-3.5" />
    </>
  ),
  Audio: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z" />,
  Gaming: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
      <path d="M7 10v4M5 12h4M15.5 11h.01M17.5 13h.01" />
    </>
  ),
};
const DEFAULT_ICON = (
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9 12h6" />
  </>
);

export function ProductImage({
  id,
  alt,
  className,
  fallbackLabel,
  category,
}: {
  id: string | undefined;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  category?: string;
}) {
  if (!id) {
    return (
      <div className={`${className ?? ""} flex flex-col items-center justify-center gap-2 text-muted`}>
        <svg
          viewBox="0 0 24 24"
          className="size-12 opacity-60"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {(category && ICONS[category]) ?? DEFAULT_ICON}
        </svg>
        {fallbackLabel && <span className="text-sm font-medium text-foreground/70">{fallbackLabel}</span>}
        <span className="text-[11px]">No photo posted</span>
      </div>
    );
  }
  return <img src={`/api/images/${id}`} alt={alt} loading="lazy" className={className} />;
}
