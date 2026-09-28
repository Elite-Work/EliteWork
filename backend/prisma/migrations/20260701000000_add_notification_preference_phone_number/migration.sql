-- Adds an SMS-capable phone number to notification preferences, for the SMS
-- fallback channel (trade lifecycle notifications, for rural pilot regions
-- with limited data connectivity — see docs/adr for the design rationale).
ALTER TABLE "NotificationPreference" ADD COLUMN "phoneNumber" VARCHAR(20);
