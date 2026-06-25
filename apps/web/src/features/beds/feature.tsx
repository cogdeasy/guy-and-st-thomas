import { BedDouble } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { BedBoardPage } from './BedBoardPage';
import { BedRequestsPage } from './BedRequestsPage';

export default defineFeature({
  id: 'beds',
  title: 'Bed Management',
  description: 'Live ward bed-state board, capacity and admission/transfer flow across all sites.',
  category: 'Operations',
  icon: BedDouble,
  navPath: '/beds',
  order: 1,
  routes: [
    { path: '/beds', component: BedBoardPage },
    { path: '/beds/requests', component: BedRequestsPage },
  ],
});
