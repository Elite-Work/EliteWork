import { appLogger } from "../middleware/logger";

/**
 * SMS fallback for trade lifecycle notifications, for rural pilot regions
 * with limited data connectivity where in-app/push notifications may not
 * be seen promptly (or at all). Uses Africa's Talking, which has strong
 * coverage across the pilot's target regions; the client is a thin `fetch`
 * wrapper (no SDK dependency) so it stays easy to swap providers later.
 *
 * Safe to call with no configuration: `isConfigured()` is false and `send`
 * becomes a no-op that logs instead of throwing, so environments without
 * SMS credentials (local dev, most of CI) are unaffected.
 */

const AFRICAS_TALKING_API_URL = "https://api.africastalking.com/version1/messaging";

export interface SmsSendResult {
  sent: boolean;
  /** Present when `sent` is false — why the message was not sent. */
  reason?: string;
}

function getConfig() {
  const apiKey = process.env.AFRICAS_TALKING_API_KEY;
  const username = process.env.AFRICAS_TALKING_USERNAME;
  const senderId = process.env.AFRICAS_TALKING_SENDER_ID; // optional — provider default if unset
  return { apiKey, username, senderId };
}

export function isSmsConfigured(): boolean {
  const { apiKey, username } = getConfig();
  return Boolean(apiKey && username);
}

/**
 * Sends a single SMS. Never throws — a failed/unconfigured send is
 * reported in the returned result so callers (the notification worker)
 * can log it without the whole job failing just because SMS is one of
 * several channels being attempted.
 */
export async function sendSms(phoneNumber: string, message: string): Promise<SmsSendResult> {
  const { apiKey, username, senderId } = getConfig();

  if (!apiKey || !username) {
    appLogger.debug({ phoneNumber }, "SMS not sent: Africa's Talking is not configured");
    return { sent: false, reason: "not_configured" };
  }

  try {
    const body = new URLSearchParams({
      username,
      to: phoneNumber,
      message,
      ...(senderId ? { from: senderId } : {}),
    });

    const response = await fetch(AFRICAS_TALKING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        apiKey,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      appLogger.warn({ phoneNumber, status: response.status, text }, "SMS send failed");
      return { sent: false, reason: `provider_error_${response.status}` };
    }

    const data = (await response.json().catch(() => null)) as
      | { SMSMessageData?: { Recipients?: Array<{ status: string; statusCode: number }> } }
      | null;
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    if (recipient && recipient.statusCode !== 101) {
      // 101 = "Success" per Africa's Talking's recipient status codes.
      appLogger.warn({ phoneNumber, status: recipient.status }, "SMS not delivered by provider");
      return { sent: false, reason: recipient.status };
    }

    return { sent: true };
  } catch (error) {
    appLogger.warn({ phoneNumber, error: error instanceof Error ? error.message : error }, "SMS send threw");
    return { sent: false, reason: "network_error" };
  }
}
