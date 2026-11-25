import { z } from "zod";

export const pilotRegisterSchema = z.object({
  name: z.string().min(1, "Cooperative name is required").max(100),
  adminWallet: z.string().min(1, "Admin wallet address is required"),
  contactEmail: z.string().email("Valid contact email is required"),
  region: z.string().min(1, "Region is required"),
  description: z.string().optional(),
  estimatedMembers: z.number().int().positive().optional(),
});

export type PilotRegisterInput = z.infer<typeof pilotRegisterSchema>;
