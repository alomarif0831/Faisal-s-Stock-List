// Shared by the proxy (server) and the root layout (ClerkProvider) so both
// sides agree on whether Clerk is reached through /__clerk.
export const CLERK_PROXY_PATH = "/__clerk";

// We decide per request (below) and pass proxyUrl explicitly, so Clerk's own
// env-based auto-proxy must stay off: it keys off Vercel's production URL,
// not the domain the visitor is actually on.
process.env.CLERK_DISABLE_AUTO_PROXY ??= "true";

/**
 * Production Clerk keys normally talk to clerk.<your-domain>, which needs
 * Clerk's DNS records. A *.vercel.app address can't have those, so there
 * Clerk is reached through /__clerk on this app instead. On a custom domain
 * (e.g. onyxstocklist.com) with Clerk's DNS records, the proxy must be OFF,
 * or Clerk rejects the requests and sign-in never loads.
 *
 * CLERK_USE_PROXY=true forces the proxy on (a custom domain set up in
 * Clerk's "proxy" mode); CLERK_DISABLE_PROXY=true forces it off.
 */
export function clerkProxyEnabled(host: string | null | undefined): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (!key.startsWith("pk_live_")) return false;
  if (process.env.CLERK_DISABLE_PROXY === "true") return false;
  if (process.env.CLERK_USE_PROXY === "true") return true;
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  return hostname.endsWith(".vercel.app");
}
