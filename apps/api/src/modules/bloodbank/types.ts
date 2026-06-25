import { z } from 'zod';

/** Blood components this service issues. */
export const BLOOD_COMPONENTS = ['red-cells', 'platelets', 'ffp'] as const;
export type BloodComponent = (typeof BLOOD_COMPONENTS)[number];

/** ABO/Rh groups tracked in stock and on each order. */
export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** Lifecycle of a transfusion order: request → crossmatch → issue → transfuse. */
export const TRANSFUSION_STATUSES = ['requested', 'crossmatched', 'issued', 'transfused'] as const;
export type TransfusionStatus = (typeof TRANSFUSION_STATUSES)[number];

export const TRANSFUSION_PRIORITIES = ['routine', 'urgent', 'asap', 'stat'] as const;
export type TransfusionPriority = (typeof TRANSFUSION_PRIORITIES)[number];

export const COMPONENT_LABELS: Record<BloodComponent, string> = {
  'red-cells': 'Red cells',
  platelets: 'Platelets',
  ffp: 'Fresh frozen plasma',
};

/** A request to transfuse a blood product into a patient. Custom collection. */
export interface TransfusionOrder {
  id: string;
  patient: { reference: string; display?: string };
  encounter?: { reference: string };
  bloodGroup: BloodGroup;
  component: BloodComponent;
  units: number;
  indication: string;
  priority: TransfusionPriority;
  status: TransfusionStatus;
  groupAndSave: boolean;
  requestedAt: string;
  crossmatchedAt?: string;
  issuedAt?: string;
  transfusedAt?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Available units of a component for a given ABO/Rh group. Custom collection. */
export interface BloodStock {
  id: string;
  component: BloodComponent;
  group: BloodGroup;
  units: number;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export const TRANSFUSION_ORDER_COLLECTION = 'TransfusionOrder';
export const BLOOD_STOCK_COLLECTION = 'BloodStock';

/** Body accepted by POST /api/bloodbank/order. */
export const CreateOrderBody = z.object({
  patientId: z.string().min(1),
  component: z.enum(BLOOD_COMPONENTS),
  bloodGroup: z.enum(BLOOD_GROUPS),
  units: z.number().int().min(1).max(10),
  indication: z.string().min(3),
  priority: z.enum(TRANSFUSION_PRIORITIES).default('routine'),
  groupAndSave: z.boolean().default(true),
});
export type CreateOrderBody = z.infer<typeof CreateOrderBody>;
