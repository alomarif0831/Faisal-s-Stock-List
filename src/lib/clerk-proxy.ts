// Shared by the proxy (server) and the root layout (ClerkProvider) so both
// sides agree on whether Clerk is reached through /__clerk.
export const CLERK_PROXY_PATH = "/__clerk";

export function clerkProxyEnabled(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  // A custom domain with Clerk's DNS records set up doesn't need the proxy.
  if (process.env.NEXT_PUBLIC_CLERK_DOMAIN || process.env.CLERK_DISABLE_PROXY === "true") return false;
  return key.startsWith("pk_live_");
}
