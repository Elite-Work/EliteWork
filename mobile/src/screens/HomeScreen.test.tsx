import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import HomeScreen from './HomeScreen';

const mockSubscription = {
  remove: jest.fn(),
};

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

describe('HomeScreen (#280)', () => {
  beforeEach(() => {
    mockSubscription.remove.mockClear();
    (
      Notifications.addNotificationResponseReceivedListener as jest.Mock
    ).mockReset();
    (
      Notifications.addNotificationResponseReceivedListener as jest.Mock
    ).mockReturnValue(mockSubscription);
  });

  describe('Notification handler configuration', () => {
    it('configures notification handler with alert, sound, and badge enabled', async () => {
      expect(Notifications.setNotificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          handleNotification: expect.any(Function),
        })
      );

      const handlerConfig = (
        Notifications.setNotificationHandler as jest.Mock
      ).mock.calls[0][0];
      const result = await handlerConfig.handleNotification();
      expect(result).toEqual({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      });
    });
  });

  describe('Primary render states', () => {
    it('renders the application title and subtitle', () => {
      const { getByText } = render(<HomeScreen />);
      expect(getByText('Amana Mobile')).toBeTruthy();
      expect(
        getByText('Trust as a Service for Agricultural Products')
      ).toBeTruthy();
    });

    it('renders the Getting Started section title and onboarding description', () => {
      const { getByText } = render(<HomeScreen />);
      expect(getByText('Getting Started')).toBeTruthy();
      expect(
        getByText(
          'This is your Amana mobile application. Connect your Stellar wallet to begin trading securely.'
        )
      ).toBeTruthy();
    });
  });

  describe('Key interactions and notification response lifecycle', () => {
    it('subscribes to notification responses on mount', () => {
      render(<HomeScreen />);
      expect(
        Notifications.addNotificationResponseReceivedListener
      ).toHaveBeenCalledTimes(1);
      expect(
        Notifications.addNotificationResponseReceivedListener
      ).toHaveBeenCalledWith(expect.any(Function));
    });

    it('logs incoming notification response when listener callback is invoked', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      render(<HomeScreen />);

      const listener = (
        Notifications.addNotificationResponseReceivedListener as jest.Mock
      ).mock.calls[0][0];

      const mockResponse = {
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: {
          request: {
            content: {
              title: 'Trade Update',
              body: 'Escrow payment received',
            },
          },
        },
      };

      listener(mockResponse);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Notification received:',
        mockResponse
      );
      consoleSpy.mockRestore();
    });

    it('unsubscribes from notification responses when unmounted', () => {
      const { unmount } = render(<HomeScreen />);
      expect(mockSubscription.remove).not.toHaveBeenCalled();

      unmount();
      expect(mockSubscription.remove).toHaveBeenCalledTimes(1);
    });
  });
});
