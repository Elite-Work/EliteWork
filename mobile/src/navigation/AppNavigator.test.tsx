import { render, waitFor } from '@testing-library/react-native';
import { AppNavigator } from './AppNavigator';
import * as useDeepLinkHook from '../hooks/useDeepLink';

// Mock React Navigation
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  useFocusEffect: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children }: any) => children,
    Screen: ({ name, component: Component }: any) => <Component name={name} />,
  }),
}));

// Mock screens
jest.mock('../screens/WalletConnectScreen', () => 'WalletConnectScreen');
jest.mock('../screens/TradeListScreen', () => 'TradeListScreen');
jest.mock('../screens/TradeDetailScreen', () => 'TradeDetailScreen');
jest.mock('../screens/DisputeDetailScreen', () => 'DisputeDetailScreen');
jest.mock('../screens/CreateTradeScreen', () => 'CreateTradeScreen');
jest.mock('../screens/EvidenceCaptureScreen', () => 'EvidenceCaptureScreen');
jest.mock('../screens/VaultDashboard', () => 'VaultDashboard');
jest.mock('../screens/AdminStreamsOverviewScreen', () => 'AdminStreamsOverviewScreen');
jest.mock('../screens/AdminTradesBatchScreen', () => 'AdminTradesBatchScreen');
jest.mock('../screens/AdminContractScreen', () => 'AdminContractScreen');
jest.mock('../screens/AdminFeaturesScreen', () => 'AdminFeaturesScreen');
jest.mock('../screens/AdminActionSuccessScreen', () => 'AdminActionSuccessScreen');

// Mock useDeepLink
jest.mock('../hooks/useDeepLink', () => ({
  useDeepLink: jest.fn(),
}));

describe('AppNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render with authenticated user', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      handleUrl: jest.fn(),
      resumePendingDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { toJSON } = render(<AppNavigator isAuthenticated={true} />);

    expect(toJSON()).toBeTruthy();
  });

  it('should render with unauthenticated user', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      handleUrl: jest.fn(),
      resumePendingDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { toJSON } = render(<AppNavigator isAuthenticated={false} />);

    expect(toJSON()).toBeTruthy();
  });

  it('should handle trade deep link', async () => {
    const handleUrlMock = jest.fn();
    const resumePendingDeepLinkMock = jest.fn();
    const pendingDeepLink = {
      screen: 'TradeDetail',
      params: { id: 'trade-123' },
    };

    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink,
      handleDeepLink: jest.fn(),
      handleUrl: handleUrlMock,
      resumePendingDeepLink: resumePendingDeepLinkMock,
      navigateToDeepLink: jest.fn(),
    });

    render(<AppNavigator isAuthenticated={true} />);

    // Since #261 the component no longer resolves deep links itself: the hook
    // owns parsing and routing, and AppNavigator only feeds it raw URLs and
    // replays a parked link once the user is authenticated. handleUrl is
    // invoked from a Linking.getInitialURL().then(...) chain, so await it.
    await waitFor(() => expect(handleUrlMock).toHaveBeenCalled());
    expect(resumePendingDeepLinkMock).toHaveBeenCalled();
  });

  it('should handle dispute deep link', async () => {
    const handleUrlMock = jest.fn();
    const resumePendingDeepLinkMock = jest.fn();
    const pendingDeepLink = {
      screen: 'DisputeDetail',
      params: { id: 'dispute-456' },
    };

    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink,
      handleDeepLink: jest.fn(),
      handleUrl: handleUrlMock,
      resumePendingDeepLink: resumePendingDeepLinkMock,
      navigateToDeepLink: jest.fn(),
    });

    render(<AppNavigator isAuthenticated={true} />);

    await waitFor(() => expect(handleUrlMock).toHaveBeenCalled());
    expect(resumePendingDeepLinkMock).toHaveBeenCalled();
  });

  it('should render all screens in stack', () => {
    (useDeepLinkHook.useDeepLink as jest.Mock).mockReturnValue({
      pendingDeepLink: null,
      handleDeepLink: jest.fn(),
      handleUrl: jest.fn(),
      resumePendingDeepLink: jest.fn(),
      navigateToDeepLink: jest.fn(),
    });

    const { UNSAFE_getByType } = render(<AppNavigator isAuthenticated={true} />);

    // Each route must be registered with its component. The screens are mocked
    // to string identifiers, so assert on the rendered component type. (A plain
    // getByText cannot work here: these are host elements, not RN <Text> nodes.)
    expect(UNSAFE_getByType('TradeListScreen' as never)).toBeTruthy();
    expect(UNSAFE_getByType('TradeDetailScreen' as never)).toBeTruthy();
    expect(UNSAFE_getByType('DisputeDetailScreen' as never)).toBeTruthy();
  });
});
