import { request } from "./client";

export interface PilotRegisterRequest {
  name: string;
  adminWallet: string;
  contactEmail: string;
  region: string;
  description?: string;
  estimatedMembers?: number;
}

export interface PilotRegisterResponse {
  id: string;
  name: string;
  adminWallet: string;
  contactEmail: string;
  region: string;
  description?: string;
  estimatedMembers?: number;
  trialPeriod: boolean;
  isTrialPeriod: boolean;
  trialDays: number;
  trialEndsAt: string;
  status: string;
  createdAt: string;
}

export const cooperativesApi = {
  pilotRegister: (data: PilotRegisterRequest) =>
    request<PilotRegisterResponse>("/cooperatives/pilot-register", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify(data),
    }),
};
