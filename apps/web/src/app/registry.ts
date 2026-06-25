import type { FeatureModule } from './types';

/**
 * Auto-discovers every feature module. Adding a folder under
 * `src/features/<id>/feature.tsx` that default-exports a FeatureModule wires it
 * into the nav and router with zero edits to any shared file.
 */
const modules = import.meta.glob<{ default: FeatureModule }>('../features/*/feature.tsx', {
  eager: true,
});

export const features: FeatureModule[] = Object.values(modules)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

export const featuresByCategory = features.reduce<Record<string, FeatureModule[]>>((acc, f) => {
  (acc[f.category] ??= []).push(f);
  return acc;
}, {});

export const CATEGORY_ORDER = [
  'Clinical',
  'Diagnostics',
  'Medicines',
  'Scheduling',
  'Operations',
  'Patient',
  'Analytics',
  'Administration',
];
