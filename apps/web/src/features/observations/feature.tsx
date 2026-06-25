import { LineChart } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { ObservationsListPage } from './ObservationsListPage';
import { ObservationsChartPage } from './ObservationsChartPage';

export default defineFeature({
  id: 'observations',
  title: 'Vital Signs & NEWS2',
  description: 'Bedside vital-signs charting, NEWS2 trends and trust-wide deterioration worklist.',
  category: 'Clinical',
  icon: LineChart,
  navPath: '/observations',
  routes: [
    { path: '/observations', component: ObservationsListPage },
    { path: '/observations/:patientId', component: ObservationsChartPage },
  ],
});
