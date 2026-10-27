import type { ExpoConfig } from 'expo/config';

// Deep-link scheme + universal/app-link hosts. Keep in step with
// src/constants/links.ts and frontend/public/.well-known/* (issue #261).
const APP_SCHEME = 'amanavault';
const LINK_HOSTS = ['amanavault.app', 'www.amanavault.app'];

// Complete dynamic Expo config — `expo/config` in SDK 52 does not export
// `getDefaultConfig`, so every field is stated here explicitly (superset of
// the values previously mirrored in app.json).
const config: ExpoConfig = {
  name: 'Amana',
  slug: 'amana-mobile',
  version: '0.1.0',
  scheme: APP_SCHEME,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  entryPoint: './src/index.tsx',
  plugins: ['./plugins/with-kotlin-version.cjs'],
  ios: {
    supportsTabletMode: true,
    bundleIdentifier: 'com.amana.mobile',
    scheme: APP_SCHEME,
    associatedDomains: LINK_HOSTS.map((h) => `applinks:${h}`),
    infoPlist: {
      NSLocalNetworkUsageDescription: 'Amana uses local network to communicate with backend services',
      NSBonjourServiceTypes: ['_amana._tcp'],
    },
  },
  android: {
    package: 'com.amana.mobile',
    scheme: APP_SCHEME,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: LINK_HOSTS.flatMap((host) => [
          { scheme: 'https', host, pathPrefix: '/trades' },
          { scheme: 'https', host, pathPrefix: '/disputes' },
        ]),
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        data: [{ scheme: APP_SCHEME }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    permissions: ['android.permission.ACCESS_COARSE_LOCATION'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-secure-store',
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#ffffff',
        sounds: ['./assets/notification_sound.wav'],
      },
    ],
  ],
  extra: {
    eas: {
      projectId: 'amana-mobile-project-id',
    },
  },
};

export default config;
