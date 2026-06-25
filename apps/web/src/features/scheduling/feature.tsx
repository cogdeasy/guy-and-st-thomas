import { CalendarDays } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { ClinicDayPage } from './ClinicDayPage';
import { ClinicDetailPage } from './ClinicDetailPage';

export default defineFeature({
  id: 'scheduling',
  title: 'Outpatient Appointments & Clinics',
  description: 'Clinic day view, slot booking, attendance tracking and DNA/utilisation analytics.',
  category: 'Scheduling',
  icon: CalendarDays,
  navPath: '/scheduling',
  order: 1,
  routes: [
    { path: '/scheduling', component: ClinicDayPage },
    { path: '/scheduling/clinics/:id', component: ClinicDetailPage },
  ],
});
