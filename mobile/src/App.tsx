import { useEffect, useRef, useState } from 'react';
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
} from './services/notification.service';
import { triggerNotificationHaptic } from './services/haptics.service';
import type { RootStackParamList } from './types/navigation';
import { AppNavigator } from './navigation/AppNavigator';
import type { NotificationData } from './services/notification.service';

export default function App() {
  const { getToken, token } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

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

    const unsubscribe = setupNotificationListeners((data: NotificationData) => {
      if (data.tradeId && navigationRef.current) {
        navigationRef.current.navigate('TradeDetail', { tradeId: data.tradeId });
      } else if (data.screen && navigationRef.current) {
        // Notification payloads name a route dynamically, so the param type
        // cannot be statically guaranteed here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigationRef.current.navigate(data.screen as any);
      }
    });

    // Haptic tap alongside the foreground notification for trade state changes
    // (Issue #124). Fire-and-forget — haptics never block notification display.
    const unsubscribeForeground = setupForegroundNotificationHandler((notification) => {
      const data = notification.request.content.data as NotificationData | undefined;
      void triggerNotificationHaptic(data?.type);
    });

    return () => {
      unsubscribe();
      unsubscribeForeground();
    };
  }, [token]);

  if (!bootstrapped) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f0' }}>
        <ActivityIndicator size="large" color="#2d6a2d" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator isAuthenticated={!!token} />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
