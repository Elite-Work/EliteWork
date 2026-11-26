/**
 * DisputeDetailScreen.test.tsx — #278
 *
 * Covers primary render states (reference label, dispute id, placeholder message,
 * accessibility attributes) and key interactions (Back navigation).
 */
import { fireEvent, render } from '@testing-library/react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import DisputeDetailScreen from './DisputeDetailScreen';
import type { RootStackParamList } from '../types/navigation';

type ScreenProps = StackScreenProps<RootStackParamList, 'DisputeDetail'>;

describe('DisputeDetailScreen (#278)', () => {
  function renderScreen(id = 'dispute-123') {
    const navigation = {
      goBack: jest.fn(),
      navigate: jest.fn(),
    } as unknown as ScreenProps['navigation'];
    const route = {
      key: 'DisputeDetail-1',
      name: 'DisputeDetail',
      params: { id },
    } as ScreenProps['route'];

    return {
      navigation,
      ...render(<DisputeDetailScreen navigation={navigation} route={route} />),
    };
  }

  describe('Primary render states', () => {
    it('renders the dispute header, reference label, and route dispute id', () => {
      const { getByText } = renderScreen('disp-abc-999');

      expect(getByText('Dispute')).toBeTruthy();
      expect(getByText('Reference')).toBeTruthy();
      expect(getByText('disp-abc-999')).toBeTruthy();
    });

    it('renders the unavailable-details placeholder message', () => {
      const { getByText } = renderScreen();

      expect(
        getByText(
          'Dispute details are not available yet. The backend has no single-dispute read endpoint, so there is nothing to display here.',
        ),
      ).toBeTruthy();
    });

    it('renders the Back button with expected accessibility metadata', () => {
      const { getByRole, getByText } = renderScreen();

      const backButton = getByRole('button', { name: 'Go back' });
      expect(backButton).toBeTruthy();
      expect(getByText('Back')).toBeTruthy();
    });
  });

  describe('Key interactions', () => {
    it('calls navigation.goBack() when the Back button is pressed', () => {
      const { getByRole, navigation } = renderScreen();

      fireEvent.press(getByRole('button', { name: 'Go back' }));

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });
});
