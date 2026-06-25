import { ListChecks } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { WaitingListPage } from './WaitingListPage';

export default defineFeature({
  id: 'waitinglist',
  title: 'Elective Waiting List',
  description: 'Elective surgical Patient Tracking List with 18-week RTT breach tracking and TCI scheduling.',
  category: 'Operations',
  icon: ListChecks,
  navPath: '/waitinglist',
  routes: [{ path: '/waitinglist', component: WaitingListPage }],
});
