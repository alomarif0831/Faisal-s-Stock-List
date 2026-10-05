/* eslint-disable @next/next/no-img-element -- images are served from our own DB route with immutable caching */

export function ProductImage({
  id,
  alt,
  className,
  fallbackLabel,
}: {
  id: string | undefined;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}) {
  if (!id) {
    return (
      <div className={`${className ?? ""} flex items-center justify-center text-sm font-medium text-muted`}>
        {fallbackLabel ?? "No photo"}
      </div>
    );
  }
  return <img src={`/api/images/${id}`} alt={alt} loading="lazy" className={className} />;
}
