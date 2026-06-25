import { Activity } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { ResultsInboxPage } from './ResultsInboxPage';
import { ResultReportPage } from './ResultReportPage';

export default defineFeature({
  id: 'results',
  title: 'Results & Reporting',
  description: 'Diagnostic results inbox, abnormal-result review and clinician sign-off.',
  category: 'Diagnostics',
  icon: Activity,
  navPath: '/results',
  routes: [
    { path: '/results', component: ResultsInboxPage },
    { path: '/results/:id', component: ResultReportPage },
  ],
});
