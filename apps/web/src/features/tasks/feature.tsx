import { CheckSquare } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { TaskBoardPage } from './TaskBoardPage';

export default defineFeature({
  id: 'tasks',
  title: 'Clinical Task Management',
  description: 'Electronic ward-jobs list: triage, claim and complete clinical tasks by team.',
  category: 'Operations',
  icon: CheckSquare,
  navPath: '/tasks',
  routes: [{ path: '/tasks', component: TaskBoardPage }],
});
