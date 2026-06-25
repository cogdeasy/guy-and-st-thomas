import { TestTube } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { LabWorklistPage } from './LabWorklistPage';
import { SpecimenDetailPage } from './SpecimenDetailPage';

export default defineFeature({
  id: 'pathology',
  title: 'Pathology / Laboratory',
  description: 'Laboratory specimen tracking, lab worklist and turnaround-time metrics.',
  category: 'Diagnostics',
  icon: TestTube,
  navPath: '/pathology',
  routes: [
    { path: '/pathology', component: LabWorklistPage },
    { path: '/pathology/:id', component: SpecimenDetailPage },
  ],
});
