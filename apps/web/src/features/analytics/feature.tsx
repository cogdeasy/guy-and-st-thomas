import { BarChart3 } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { AnalyticsDashboardPage } from './AnalyticsDashboardPage';

export default defineFeature({
  id: 'analytics',
  title: 'Operational Analytics',
  description: 'Executive dashboard: bed occupancy, patient flow, ED performance and deterioration.',
  category: 'Analytics',
  icon: BarChart3,
  navPath: '/analytics',
  routes: [{ path: '/analytics', component: AnalyticsDashboardPage }],
});
