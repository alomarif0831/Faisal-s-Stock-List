"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Rendered where the SERVER thought the visitor was signed out. If the
 * browser actually has a session (typical on iPhone: Safari pauses Clerk's
 * background token refresh, the user taps a link, and the server receives
 * an expired token), refresh the token and re-render the page so it shows
 * the signed-in version.
 */
export function SessionResync() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || done.current) return;
    done.current = true;
    getToken({ skipCache: true })
      .catch(() => null)
      .finally(() => router.refresh());
  }, [isLoaded, isSignedIn, getToken, router]);

  return null;
}

/**
 * On /sign-in and /sign-up: someone who is already signed in (e.g. sent
 * here by a page that saw an expired token) goes straight back to where
 * they were headed instead of being asked to sign in again.
 */
export function SignedInBounce() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const done = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || done.current) return;
    done.current = true;
    const target = params.get("redirect_url") ?? "/";
    // only same-site paths
    const safe = target.startsWith("/") && !target.startsWith("//") ? target : "/";
    getToken({ skipCache: true })
      .catch(() => null)
      .finally(() => {
        router.replace(safe);
        router.refresh();
      });
  }, [isLoaded, isSignedIn, getToken, router, params]);

  return null;
}
