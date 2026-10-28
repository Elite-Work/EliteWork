import { by } from 'detox';

const INPUT_TEST_IDS: Record<string, string> = {
  'e.g. 500': 'trade-quantity-input',
  'e.g. 450': 'trade-price-input',
  'G...': 'trade-seller-input',
  '7': 'trade-delivery-days-input',
  'e.g. Goods arrived damaged, quantity mismatch…': 'trade-dispute-reason-input',
};

/** Detox 20 exposes input hints as attributes, but not as a `by.placeholder` matcher. */
export function inputByPlaceholder(placeholder: string) {
  const testID = INPUT_TEST_IDS[placeholder];
  if (!testID) {
    throw new Error(`No E2E testID mapped for input placeholder: ${placeholder}`);
  }
  return by.id(testID);
}
