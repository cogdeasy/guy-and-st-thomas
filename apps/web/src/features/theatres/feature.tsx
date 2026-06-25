import { Stethoscope } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { TheatreBoardPage } from './TheatreBoardPage';
import { TheatreListsPage } from './TheatreListsPage';
import { TheatreListDetailPage } from './TheatreListDetailPage';

export default defineFeature({
  id: 'theatres',
  title: 'Theatre Scheduling',
  description: 'Operating theatre lists, live theatre board and perioperative pathway coordination.',
  category: 'Scheduling',
  icon: Stethoscope,
  navPath: '/theatres',
  routes: [
    { path: '/theatres', component: TheatreBoardPage },
    { path: '/theatres/lists', component: TheatreListsPage },
    { path: '/theatres/lists/:id', component: TheatreListDetailPage },
  ],
});
