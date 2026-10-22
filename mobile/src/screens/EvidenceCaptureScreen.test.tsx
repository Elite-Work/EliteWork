import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import EvidenceCaptureScreen from './EvidenceCaptureScreen';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 12, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

interface TestFormData {
  get(name: string): unknown;
}

type ScreenProps = StackScreenProps<RootStackParamList, 'EvidenceCapture'>;

describe('EvidenceCaptureScreen (#279)', () => {
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
  const mockTradeId = 'trade-9876543210abcdef-test';

  const createProps = (tradeId = mockTradeId): ScreenProps =>
    ({
      navigation: {
        goBack: jest.fn(),
        navigate: jest.fn(),
      } as unknown as ScreenProps['navigation'],
      route: {
        params: { tradeId },
      } as unknown as ScreenProps['route'],
    } as ScreenProps);

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'jwt-auth-token-xyz',
    });
  });

  describe('Primary render states', () => {
    it('renders header, formatted trade reference, and default video capture UI', () => {
      const props = createProps();
      const { getByText, getByRole } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // Header and navigation
      expect(getByText('Upload Evidence')).toBeTruthy();
      expect(getByRole('header')).toBeTruthy();
      expect(getByText('← Back')).toBeTruthy();

      // Formatted trade reference (first 12 chars + ellipsis)
      const expectedTradeRef = `Trade: #${mockTradeId.slice(0, 12)}…`;
      expect(getByText(expectedTradeRef)).toBeTruthy();

      // Section titles and hints for default video mode
      expect(getByText('Evidence Type')).toBeTruthy();
      expect(getByText('Record Delivery Video')).toBeTruthy();
      expect(
        getByText(
          'Record a video showing the goods and their condition. The driver should be present.'
        )
      ).toBeTruthy();

      // Default media selector states
      const videoRadio = getByRole('radio', { name: 'Video evidence type' });
      const photoRadio = getByRole('radio', { name: 'Photo evidence type' });
      expect(videoRadio.props.accessibilityState).toEqual({ selected: true });
      expect(photoRadio.props.accessibilityState).toEqual({ selected: false });

      // Capture placeholder is shown
      expect(getByText('Tap to record')).toBeTruthy();
      expect(getByRole('button', { name: 'Tap to record a video' })).toBeTruthy();
    });

    it('does not render upload button or retake button in idle state', () => {
      const props = createProps();
      const { queryByText } = render(<EvidenceCaptureScreen {...props} />);

      expect(queryByText(/Upload Video/i)).toBeNull();
      expect(queryByText(/Upload Photo/i)).toBeNull();
      expect(queryByText(/Retake/i)).toBeNull();
      expect(queryByText(/Upload failed/i)).toBeNull();
    });
  });

  describe('Navigation', () => {
    it('navigates back when header back button is pressed', () => {
      const props = createProps();
      const { getByRole } = render(<EvidenceCaptureScreen {...props} />);

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Go back' }));
      });
      expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Media type selector', () => {
    it('switches to photo mode and updates guidance labels', () => {
      const props = createProps();
      const { getByRole, getByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // Switch to Photo
      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Photo evidence type' }));
      });

      const photoRadio = getByRole('radio', { name: 'Photo evidence type' });
      const videoRadio = getByRole('radio', { name: 'Video evidence type' });
      expect(photoRadio.props.accessibilityState).toEqual({ selected: true });
      expect(videoRadio.props.accessibilityState).toEqual({ selected: false });

      expect(getByText('Take Delivery Photo')).toBeTruthy();
      expect(
        getByText(
          'Take a clear photo of the goods showing any damage or discrepancy.'
        )
      ).toBeTruthy();
      expect(getByText('Tap to capture')).toBeTruthy();
      expect(getByRole('button', { name: 'Tap to capture a photo' })).toBeTruthy();
    });

    it('can switch back to video mode', () => {
      const props = createProps();
      const { getByRole, getByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Photo evidence type' }));
      });
      expect(getByText('Take Delivery Photo')).toBeTruthy();

      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Video evidence type' }));
      });
      expect(getByText('Record Delivery Video')).toBeTruthy();
      expect(getByText('Tap to record')).toBeTruthy();
    });

    it('resets captured media when switching media types', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole, queryByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // Simulate capturing video
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      expect(queryByText('Ready to upload')).toBeTruthy();

      // Switching to photo discards the captured video
      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Photo evidence type' }));
      });
      expect(queryByText('Ready to upload')).toBeNull();
      expect(queryByText(/Upload Video/i)).toBeNull();

      alertSpy.mockRestore();
    });
  });

  describe('Capture simulation and retake', () => {
    it('prompts user with camera simulation alert when capture area is pressed', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole } = render(<EvidenceCaptureScreen {...props} />);

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Record Video',
        'In a production build this opens the device camera. For now, a placeholder file is used.',
        expect.any(Array)
      );

      alertSpy.mockRestore();
    });

    it('prompts with Photo title when in photo mode', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole } = render(<EvidenceCaptureScreen {...props} />);

      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Photo evidence type' }));
      });
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to capture a photo' }));
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Take Photo',
        'In a production build this opens the device camera. For now, a placeholder file is used.',
        expect.any(Array)
      );

      alertSpy.mockRestore();
    });

    it('captures media when Simulate Capture is chosen in alert', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole, getByText, queryByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });

      const buttons = alertSpy.mock.calls[0][2];
      const simulateBtn = buttons?.find((b) => b.text === 'Simulate Capture');
      expect(simulateBtn).toBeDefined();

      act(() => {
        simulateBtn?.onPress?.();
      });

      // Shows captured state
      expect(getByText('Ready to upload')).toBeTruthy();
      expect(getByText(new RegExp(`evidence-${mockTradeId}-.*\\.mp4`))).toBeTruthy();
      expect(getByRole('button', { name: 'Retake' })).toBeTruthy();
      expect(getByRole('button', { name: 'Upload video' })).toBeTruthy();
      expect(queryByText('Tap to record')).toBeNull();

      alertSpy.mockRestore();
    });

    it('cancelling alert leaves screen in idle state without capturing', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole, queryByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });

      const buttons = alertSpy.mock.calls[0][2];
      const cancelBtn = buttons?.find((b) => b.text === 'Cancel');
      expect(cancelBtn?.style).toBe('cancel');

      // Cancel button has no onPress or does nothing
      act(() => {
        cancelBtn?.onPress?.();
      });

      expect(queryByText('Ready to upload')).toBeNull();
      expect(queryByText('Tap to record')).toBeTruthy();

      alertSpy.mockRestore();
    });

    it('discards captured media and resets UI when Retake is pressed', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      const props = createProps();
      const { getByRole, getByText, queryByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      expect(getByText('Ready to upload')).toBeTruthy();

      // Press Retake
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Retake' }));
      });

      expect(queryByText('Ready to upload')).toBeNull();
      expect(queryByText(/Upload video/i)).toBeNull();
      expect(queryByText(/Retake/i)).toBeNull();
      expect(getByText('Tap to record')).toBeTruthy();

      alertSpy.mockRestore();
    });
  });

  describe('Upload process', () => {
    it('displays loading state during upload and disables the button', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      let resolveUpload!: (value: unknown) => void;
      mockPost.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUpload = resolve;
        })
      );

      const props = createProps();
      const { getByRole, getByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      // Trigger upload (in-flight)
      const uploadBtn = getByRole('button', { name: 'Upload video' });
      act(() => {
        fireEvent.press(uploadBtn);
      });

      expect(getByText('Uploading…')).toBeTruthy();
      const uploadingBtn = getByRole('button', {
        name: 'Uploading, please wait',
      });
      expect(uploadingBtn.props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });

      // Complete upload
      await act(async () => {
        resolveUpload({ data: { success: true } });
      });

      alertSpy.mockRestore();
    });

    it('uploads captured evidence and displays success state upon completion', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockResolvedValueOnce({ data: { success: true } });

      const props = createProps();
      const { getByRole, getByText, findByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // 1. Capture simulated video
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      // 2. Press Upload
      const uploadBtn = getByRole('button', { name: 'Upload video' });
      await act(async () => {
        fireEvent.press(uploadBtn);
      });

      // 3. Verify API call arguments
      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url, formData, config] = mockPost.mock.calls[0];
      expect(url).toBe(`/trades/${mockTradeId}/evidence`);
      expect(formData).toBeInstanceOf(FormData);
      expect((formData as unknown as TestFormData).get('tradeId')).toBe(mockTradeId);
      expect((formData as unknown as TestFormData).get('mediaType')).toBe('video');
      expect(config?.headers).toEqual({
        'Content-Type': 'multipart/form-data',
        Authorization: 'Bearer jwt-auth-token-xyz',
      });

      // 4. Verify Success Card state
      expect(await findByText('Evidence Uploaded')).toBeTruthy();
      expect(
        getByText('Your video has been submitted. A mediator will review it shortly.')
      ).toBeTruthy();

      // 5. Navigate back to trade
      const backToTradeBtn = getByRole('button', { name: 'Back to trade' });
      act(() => {
        fireEvent.press(backToTradeBtn);
      });
      expect(props.navigation.navigate).toHaveBeenCalledWith('TradeDetail', {
        tradeId: mockTradeId,
      });

      alertSpy.mockRestore();
    });

    it('uploads photo evidence with image mime type and correct mediaType payload', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockResolvedValueOnce({ data: { success: true } });

      const props = createProps();
      const { getByRole, findByText, getByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // Switch to Photo mode
      act(() => {
        fireEvent.press(getByRole('radio', { name: 'Photo evidence type' }));
      });

      // Capture simulated photo
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to capture a photo' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      // Press Upload
      const uploadBtn = getByRole('button', { name: 'Upload photo' });
      await act(async () => {
        fireEvent.press(uploadBtn);
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [, formData] = mockPost.mock.calls[0];
      expect((formData as unknown as TestFormData).get('mediaType')).toBe('photo');

      expect(await findByText('Evidence Uploaded')).toBeTruthy();
      expect(
        getByText('Your photo has been submitted. A mediator will review it shortly.')
      ).toBeTruthy();

      alertSpy.mockRestore();
    });

    it('omits Authorization header when token is null in auth store', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      (useAuthStore as unknown as jest.Mock).mockReturnValue({
        token: null,
      });
      mockPost.mockResolvedValueOnce({ data: { success: true } });

      const props = createProps();
      const { getByRole, findByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      await act(async () => {
        fireEvent.press(getByRole('button', { name: 'Upload video' }));
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [, , config] = mockPost.mock.calls[0];
      expect(config?.headers).toEqual({
        'Content-Type': 'multipart/form-data',
      });
      expect(config?.headers?.Authorization).toBeUndefined();

      expect(await findByText('Evidence Uploaded')).toBeTruthy();

      alertSpy.mockRestore();
    });

    it('renders error banner with alert role and allows retry when upload fails with an Error', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockRejectedValueOnce(new Error('Payload too large'));

      const props = createProps();
      const { getByRole, findByText, queryByText, UNSAFE_getByProps } = render(
        <EvidenceCaptureScreen {...props} />
      );

      // Capture simulated video
      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      // Press Upload
      await act(async () => {
        fireEvent.press(getByRole('button', { name: 'Upload video' }));
      });

      // Error banner is rendered with alert role and live region
      expect(await findByText('Upload failed: Payload too large')).toBeTruthy();
      const errorBanner = UNSAFE_getByProps({ accessibilityRole: 'alert' });
      expect(errorBanner).toBeTruthy();
      expect(errorBanner.props.accessibilityLiveRegion).toBe('assertive');

      // Remains in capture view (not success card) and upload button is re-enabled
      expect(queryByText('Evidence Uploaded')).toBeNull();
      const retryUploadBtn = getByRole('button', { name: 'Upload video' });
      expect(retryUploadBtn.props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      });

      // Retry succeeds
      mockPost.mockResolvedValueOnce({ data: { ok: true } });
      await act(async () => {
        fireEvent.press(retryUploadBtn);
      });

      expect(await findByText('Evidence Uploaded')).toBeTruthy();

      alertSpy.mockRestore();
    });

    it('renders fallback error message when upload fails with a non-Error rejection', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockRejectedValueOnce('Unknown network disconnect');

      const props = createProps();
      const { getByRole, findByText } = render(
        <EvidenceCaptureScreen {...props} />
      );

      act(() => {
        fireEvent.press(getByRole('button', { name: 'Tap to record a video' }));
      });
      const simulateBtn = alertSpy.mock.calls[0][2]?.find(
        (b) => b.text === 'Simulate Capture'
      );
      act(() => {
        simulateBtn?.onPress?.();
      });

      await act(async () => {
        fireEvent.press(getByRole('button', { name: 'Upload video' }));
      });

      expect(await findByText('Upload failed: Upload failed')).toBeTruthy();

      alertSpy.mockRestore();
    });
  });
});
