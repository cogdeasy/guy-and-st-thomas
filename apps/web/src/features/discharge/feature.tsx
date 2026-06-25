import { DoorOpen } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { DischargeWorklistPage } from './DischargeWorklistPage';
import { DischargeDetailPage } from './DischargeDetailPage';

export default defineFeature({
  id: 'discharge',
  title: 'Discharge & TTO',
  description: 'Discharge planning, to-take-out medications and GP letters.',
  category: 'Clinical',
  icon: DoorOpen,
  navPath: '/discharge',
  routes: [
    { path: '/discharge', component: DischargeWorklistPage },
    { path: '/discharge/:id', component: DischargeDetailPage },
  ],
});
