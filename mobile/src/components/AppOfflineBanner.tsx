import { useNetInfo } from '@react-native-community/netinfo';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfflineBanner } from './OfflineBanner';

const OFFLINE_BANNER_ENABLED = process.env.EXPO_PUBLIC_DISABLE_OFFLINE_BANNER !== 'true';

export function AppOfflineBanner() {
  const { isConnected, isInternetReachable } = useNetInfo();

  if (!OFFLINE_BANNER_ENABLED || (isConnected !== false && isInternetReachable !== false)) {
    return null;
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ paddingHorizontal: 16 }}>
      <OfflineBanner message="You're offline. Some actions won't work until the device reconnects." />
    </SafeAreaView>
  );
}
