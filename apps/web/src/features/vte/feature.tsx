import { ShieldCheck } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { VteWorklistPage } from './VteWorklistPage';
import { VteAssessmentPage } from './VteAssessmentPage';

export default defineFeature({
  id: 'vte',
  title: 'VTE Risk Assessment',
  description: 'NICE-mandated venous thromboembolism risk assessment and 24h compliance tracking.',
  category: 'Clinical',
  icon: ShieldCheck,
  navPath: '/vte',
  routes: [
    { path: '/vte', component: VteWorklistPage },
    { path: '/vte/:encounterId', component: VteAssessmentPage },
  ],
});
