import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from './stores/authStore';
import {
  registerForPushNotifications,
  storePushTokenOnBackend,
  setupNotificationListeners,
  setupForegroundNotificationHandler,
  checkNotificationPermissions,
  getInitialNotificationData,
  notificationDataToUrl,
} from './services/notification.service';
import { triggerNotificationHaptic } from './services/haptics.service';
import { useDeepLink } from './hooks/useDeepLink';
import type { RootStackParamList } from './types/navigation';
import { AppNavigator } from './navigation/AppNavigator';
import type { NotificationData } from './services/notification.service';
import { AppOfflineBanner } from './components/AppOfflineBanner';

export default function App() {
  const { getToken, token } = useAuthStore();
  const { handleUrl } = useDeepLink();
  const [bootstrapped, setBootstrapped] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

  /**
   * Route a notification tap to its target (#496). URL/path payloads go
   * through the shared deep-link parser so auth handling and unknown links
   * behave exactly like universal links; legacy payloads that only carry a
   * route name keep their old fallback.
   */
  const handleNotificationTap = useCallback(
    (data: NotificationData) => {
      const url = notificationDataToUrl(data);
      if (url) {
        handleUrl(url, navigationRef.current);
        return;
      }
      if (data.screen && navigationRef.current) {
        // Notification payloads name a route dynamically, so the param type
        // cannot be statically guaranteed here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigationRef.current.navigate(data.screen as any);
      }
    },
    [handleUrl],
  );

  useEffect(() => {
    if (!token) return;

    const setupNotifications = async () => {
      const hasPermission = await checkNotificationPermissions();
      if (!hasPermission) return;

      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        await storePushTokenOnBackend(pushToken, token);
      }
    };

    setupNotifications();
  }, [token]);

  // Tap handling is independent of the session: a link that needs auth while
  // signed out is parked by useDeepLink and replayed after login.
  useEffect(() => {
    const unsubscribe = setupNotificationListeners(handleNotificationTap);

    // A tap that launched the app never reaches the listener above; replay it
    // once the navigator/session is ready so TradeDetail opens on cold start.
    let cancelled = false;
    getInitialNotificationData().then((data) => {
      if (!cancelled && data) handleNotificationTap(data);
    });

    // Haptic tap alongside the foreground notification for trade state changes
    // (Issue #124). Fire-and-forget — haptics never block notification display.
    const unsubscribeForeground = setupForegroundNotificationHandler((notification) => {
      const data = notification.request.content.data as NotificationData | undefined;
      void triggerNotificationHaptic(data?.type);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeForeground();
    };
  }, [handleNotificationTap]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppOfflineBanner />
        {bootstrapped ? (
          <AppNavigator isAuthenticated={!!token} navigationRef={navigationRef} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f0' }}>
            <ActivityIndicator size="large" color="#2d6a2d" />
          </View>
        )}
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
