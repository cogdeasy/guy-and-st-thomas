import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type FeatureCategory =
  | 'Clinical'
  | 'Diagnostics'
  | 'Medicines'
  | 'Operations'
  | 'Scheduling'
  | 'Patient'
  | 'Administration'
  | 'Analytics';

export interface FeatureRoute {
  /** Absolute path, e.g. "/patients" or "/patients/:id". */
  path: string;
  component: ComponentType;
}

/**
 * A self-contained frontend feature. Drop a folder under
 * `src/features/<id>/` whose `feature.tsx` default-exports one of these and it
 * is auto-discovered (via import.meta.glob), added to the nav, and routed.
 * Features MUST NOT edit any shared/central file.
 */
export interface FeatureModule {
  id: string;
  title: string;
  description: string;
  category: FeatureCategory;
  icon: LucideIcon;
  /** Primary nav destination (must match one of the routes' path). */
  navPath: string;
  routes: FeatureRoute[];
  /** Lower sorts first within a category. */
  order?: number;
}

export function defineFeature(feature: FeatureModule): FeatureModule {
  return feature;
}
