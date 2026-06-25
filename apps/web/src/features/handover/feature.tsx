import { ClipboardList } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { HandoverBoardPage } from './HandoverBoardPage';

export default defineFeature({
  id: 'handover',
  title: 'Clinical Handover (SBAR)',
  description: 'Prioritised SBAR shift handover board for admitted patients, ranked by NEWS2.',
  category: 'Clinical',
  icon: ClipboardList,
  navPath: '/handover',
  routes: [{ path: '/handover', component: HandoverBoardPage }],
});
