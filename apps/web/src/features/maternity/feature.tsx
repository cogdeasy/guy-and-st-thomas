import { Baby } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { MaternityBoardPage } from './MaternityBoardPage';
import { MaternityRecordPage } from './MaternityRecordPage';

export default defineFeature({
  id: 'maternity',
  title: 'Maternity & Obstetrics',
  description: 'Antenatal clinic, live labour-ward board and birth records across the maternity pathway.',
  category: 'Clinical',
  icon: Baby,
  navPath: '/maternity',
  routes: [
    { path: '/maternity', component: MaternityBoardPage },
    { path: '/maternity/:patientId', component: MaternityRecordPage },
  ],
});
