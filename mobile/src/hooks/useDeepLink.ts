import { useCallback, useEffect, useState } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';
import {
  parseDeepLink,
  requiresAuth,
  type DeepLinkTarget,
} from '../constants/links';

export type { DeepLinkTarget };

/**
 * Deep-link routing with auth-aware guards (issue #261).
 *
 * - A link that lands while authenticated navigates immediately.
 * - A link that needs auth while signed out is parked; `resumePendingDeepLink`
 *   replays it once a token appears (login-then-continue).
 * - Unrecognised / malformed links are dropped (parseDeepLink returns null).
 *
 * The pending target lives in a module-level slot so it survives the
 * WalletConnect -> TradeList remount that happens on login.
 */

let pendingTarget: DeepLinkTarget | null = null;
const listeners = new Set<() => void>();

function setPending(target: DeepLinkTarget | null): void {
  pendingTarget = target;
  listeners.forEach((l) => l());
}

interface UseDeepLinkReturn {
  pendingDeepLink: DeepLinkTarget | null;
  /** Parse a raw URL (cold-start or runtime) and route or park it. */
  handleUrl: (url: string | null | undefined, navigation?: NavigationContainerRef<RootStackParamList> | null) => void;
  /** Park an already-parsed target (kept for backwards compat + tests). */
  handleDeepLink: (target: DeepLinkTarget) => void;
  /** Replay a parked link once the user is authenticated. */
  resumePendingDeepLink: (navigation: NavigationContainerRef<RootStackParamList> | null) => void;
}

/** Widened navigate signature for union screen keys (see DeepLinkTarget). */
type NavigateFn = (
  screen: keyof RootStackParamList,
  params?: Record<string, string>,
) => void;

function navigate(
  navigation: NavigationContainerRef<RootStackParamList> | null | undefined,
  target: DeepLinkTarget,
): void {
  if (!navigation) return;
  // DeepLinkTarget holds a union of screen keys with loosely-typed params.
  // React Navigation's per-screen param generics cannot correlate the two,
  // so widen the ref once here instead of casting each argument to `never`.
  const nav = navigation as unknown as { navigate: NavigateFn };
  nav.navigate(target.screen, target.params);
}

export function useDeepLink(): UseDeepLinkReturn {
  const { token } = useAuthStore();
  const [pendingDeepLink, setPendingState] = useState<DeepLinkTarget | null>(pendingTarget);

  useEffect(() => {
    const sync = () => setPendingState(pendingTarget);
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const routeOrPark = useCallback(
    (target: DeepLinkTarget, navigation?: NavigationContainerRef<RootStackParamList> | null) => {
      if (requiresAuth(target) && !token) {
        setPending(target);
        return;
      }
      setPending(null);
      navigate(navigation, target);
    },
    [token],
  );

  const handleUrl = useCallback(
    (url: string | null | undefined, navigation?: NavigationContainerRef<RootStackParamList> | null) => {
      const target = parseDeepLink(url);
      if (!target) return; // malformed / unknown → ignore
      routeOrPark(target, navigation);
    },
    [routeOrPark],
  );

  const handleDeepLink = useCallback(
    (target: DeepLinkTarget) => {
      routeOrPark(target);
    },
    [routeOrPark],
  );

  const resumePendingDeepLink = useCallback(
    (navigation: NavigationContainerRef<RootStackParamList> | null) => {
      if (pendingTarget && token) {
        const target = pendingTarget;
        setPending(null);
        navigate(navigation, target);
      }
    },
    [token],
  );

  return { pendingDeepLink, handleUrl, handleDeepLink, resumePendingDeepLink };
}

/** Test helper. */
export function __clearPendingDeepLink(): void {
  setPending(null);
}
