/**
 * Base (en-NG) message catalog. This is the source of truth for user-facing
 * copy — see `frontend/docs/i18n.md` for how to add strings and contribute
 * translations. Keys are dot-namespaced by feature area.
 */
const messages = {
  common: {
    loading: "Loading…",
    retry: "Retry",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    continue: "Continue",
    back: "Back",
    close: "Close",
    somethingWentWrong: "Something went wrong",
  },
  wallet: {
    connect: "Connect wallet",
    connecting: "Connecting…",
    disconnect: "Disconnect",
    absentTitle: "Freighter not detected",
    absentBody: "Install the Freighter browser extension to connect your wallet.",
    absentCta: "Install Freighter",
    lockedTitle: "Freighter is locked",
    lockedBody: "Open the Freighter extension and enter your password to continue.",
    lockedCta: "Unlock Freighter",
    rejectedTitle: "Connection request declined",
    rejectedBody: "You dismissed the Freighter popup. Try again when you're ready.",
    rejectedCta: "Try again",
    wrongNetworkTitle: "Wrong network selected",
    wrongNetworkBody: "Switch Freighter to {expected} to use EliteWork.",
    wrongNetworkCta: "Switch to {expected}",
    timeoutTitle: "Freighter didn't respond",
    timeoutBody: "The extension took too long to answer. Reload and try again.",
    timeoutCta: "Try again",
  },
  trade: {
    createTitle: "Create trade",
    commodity: "Commodity",
    quantity: "Quantity",
    unit: "Unit",
    pricePerUnit: "Price per unit ({currency})",
    currency: "Currency",
    estimatedTotal: "Estimated total",
    sellerAddress: "Seller Stellar address",
    continueToNegotiation: "Continue to negotiation",
  },
} as const;

export default messages;
