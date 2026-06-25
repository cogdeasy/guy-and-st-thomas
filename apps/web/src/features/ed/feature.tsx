import { Siren } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { EdBoardPage } from './EdBoardPage';

export default defineFeature({
  id: 'ed',
  title: 'Emergency Department Tracker',
  description: 'Live A&E whiteboard with Manchester triage, patient flow and the 4-hour standard.',
  category: 'Clinical',
  icon: Siren,
  navPath: '/ed',
  routes: [{ path: '/ed', component: EdBoardPage }],
});
