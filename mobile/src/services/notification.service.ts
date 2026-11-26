import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PUSH_TOKEN_KEY = "amana_push_token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationData {
  type?: "trade" | "dispute" | "general";
  tradeId?: string;
  disputeId?: string;
  /** Explicit route name fallback for older payloads. */
  screen?: string;
  /** Universal/custom-scheme URL carried by the push payload (#496). */
  url?: string;
  /** App-relative path, e.g. `/trades/123` (#496). */
  path?: string;
}

/**
 * Map a push payload to an app URL understood by `parseDeepLink` (#496).
 *
 * Backends vary in what they put on the notification: some send a full
 * universal link, some a path, some only IDs. Supporting all three keeps the
 * tap handler independent of whichever sender queued the message.
 */
export function notificationDataToUrl(
  data: NotificationData | null | undefined,
): string | null {
  if (!data) return null;

  if (typeof data.url === "string" && data.url.trim()) return data.url.trim();
  if (typeof data.path === "string" && data.path.trim()) return data.path.trim();
  if (typeof data.tradeId === "string" && data.tradeId.trim()) {
    return `/trades/${encodeURIComponent(data.tradeId.trim())}`;
  }
  if (typeof data.disputeId === "string" && data.disputeId.trim()) {
    return `/disputes/${encodeURIComponent(data.disputeId.trim())}`;
  }
  return null;
}

const handledInitialResponseIds = new Set<string>();

/**
 * Data for the notification that cold-started the app, if any (#496).
 *
 * `addNotificationResponseReceivedListener` only fires for taps while the app
 * is running; a tap that launches a killed app must be read from the last
 * response. Responses already consumed are skipped so a token refresh or
 * remount does not replay the navigation.
 */
export async function getInitialNotificationData(): Promise<NotificationData | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;

    const identifier = response.notification.request.identifier;
    if (identifier && handledInitialResponseIds.has(identifier)) return null;
    if (identifier) handledInitialResponseIds.add(identifier);

    return (response.notification.request.content.data as NotificationData) ?? null;
  } catch {
    return null;
  }
}

/** Test helper: clear the cold-start dedupe set. */
export function __resetInitialNotificationDedupe(): void {
  handledInitialResponseIds.clear();
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    const pushToken = token.data;

    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, pushToken);
    return pushToken;
  } catch {
    return null;
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function storePushTokenOnBackend(
  pushToken: string,
  authToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      "https://api.amana.io/user/push-token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ pushToken }),
      },
    );

    return response.ok;
  } catch {
    return false;
  }
}

export function setupNotificationListeners(
  onNotificationTap: (data: NotificationData) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as NotificationData;
      onNotificationTap(data);
    },
  );

  return () => subscription.remove();
}

export function setupForegroundNotificationHandler(
  onNotification: (notification: Notifications.Notification) => void,
): () => void {
  const subscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      onNotification(notification);
    },
  );

  return () => subscription.remove();
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: NotificationData,
): Promise<string> {
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: true,
    },
    trigger: null,
  });

  return identifier;
}

export async function checkNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}
