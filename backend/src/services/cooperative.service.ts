import crypto from "crypto";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { PilotRegisterInput } from "../schemas/cooperative.schemas";

export interface PilotCooperativeRecord {
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
  status: "PENDING" | "ACTIVE";
  createdAt: string;
  updatedAt: string;
}

export class CooperativeService {
  private static pilotRegistrations: Map<string, PilotCooperativeRecord> = new Map();

  async registerPilotCooperative(input: PilotRegisterInput): Promise<PilotCooperativeRecord> {
    if (!input.name || input.name.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Cooperative name is required", 400);
    }
    if (!input.adminWallet || input.adminWallet.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Admin wallet address is required", 400);
    }
    if (!input.contactEmail || !input.contactEmail.includes("@")) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Valid contact email is required", 400);
    }
    if (!input.region || input.region.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Region is required", 400);
    }

    const id = `coop-pilot-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10)}`;
    const now = new Date();
    const trialDays = 90;
    const trialEnds = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const record: PilotCooperativeRecord = {
      id,
      name: input.name.trim(),
      adminWallet: input.adminWallet.trim().toLowerCase(),
      contactEmail: input.contactEmail.trim().toLowerCase(),
      region: input.region.trim(),
      description: input.description?.trim(),
      estimatedMembers: input.estimatedMembers,
      trialPeriod: true,
      isTrialPeriod: true,
      trialDays,
      trialEndsAt: trialEnds.toISOString(),
      status: "ACTIVE",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    CooperativeService.pilotRegistrations.set(id, record);
    return record;
  }

  async getPilotCooperative(id: string): Promise<PilotCooperativeRecord | null> {
    return CooperativeService.pilotRegistrations.get(id) ?? null;
  }

  async listPilotCooperatives(): Promise<PilotCooperativeRecord[]> {
    return Array.from(CooperativeService.pilotRegistrations.values());
  }

  static clearPilotRegistrations(): void {
    CooperativeService.pilotRegistrations.clear();
  }
}

export const cooperativeService = new CooperativeService();
