import React from 'react';
import { render } from '@testing-library/react-native';
import { NetInfoStateType, useNetInfo } from '@react-native-community/netinfo';

import { AppOfflineBanner } from './AppOfflineBanner';

jest.mock('@react-native-community/netinfo', () => ({
  NetInfoStateType: { unknown: 'unknown', none: 'none' },
  useNetInfo: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));

const mockNetInfo = jest.mocked(useNetInfo);

it('shows the banner on the first offline render and removes it on reconnect', () => {
  mockNetInfo.mockReturnValue({ type: NetInfoStateType.unknown, isConnected: null, isInternetReachable: null, details: null });
  const { queryByTestId, getByTestId, rerender } = render(<AppOfflineBanner />);
  expect(queryByTestId('offline-banner')).toBeNull();

  mockNetInfo.mockReturnValue({ type: NetInfoStateType.none, isConnected: false, isInternetReachable: false, details: null });
  rerender(<AppOfflineBanner />);
  expect(getByTestId('offline-banner')).toBeTruthy();
  rerender(<AppOfflineBanner />);
  expect(getByTestId('offline-banner')).toBeTruthy();

  mockNetInfo.mockReturnValue({ type: NetInfoStateType.unknown, isConnected: true, isInternetReachable: true, details: null });
  rerender(<AppOfflineBanner />);
  expect(queryByTestId('offline-banner')).toBeNull();
});
