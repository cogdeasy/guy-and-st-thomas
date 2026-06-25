import { ShieldAlert } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { IpcBoardPage } from './IpcBoardPage';

export default defineFeature({
  id: 'infection',
  title: 'Infection Prevention & Control',
  description: 'IPC surveillance board, isolation flags and organism breakdown across the trust.',
  category: 'Operations',
  icon: ShieldAlert,
  navPath: '/infection',
  routes: [{ path: '/infection', component: IpcBoardPage }],
});
