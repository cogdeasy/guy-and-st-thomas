import { Users } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { PatientListPage } from './PatientListPage';
import { PatientDetailPage } from './PatientDetailPage';

export default defineFeature({
  id: 'patients',
  title: 'Patient Administration',
  description: 'Master patient index, inpatient worklist, demographics and registration.',
  category: 'Patient',
  icon: Users,
  navPath: '/patients',
  order: 1,
  routes: [
    { path: '/patients', component: PatientListPage },
    { path: '/patients/:id', component: PatientDetailPage },
  ],
});
