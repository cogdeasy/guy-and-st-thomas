import { ClipboardCheck } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { DrugRoundPage } from './DrugRoundPage';
import { MedHistoryPage } from './MedHistoryPage';

export default defineFeature({
  id: 'medadmin',
  title: 'Medication Administration',
  description:
    'Electronic drug round (eMAR): due/overdue worklist, administration and omission recording.',
  category: 'Medicines',
  icon: ClipboardCheck,
  navPath: '/medadmin',
  routes: [
    { path: '/medadmin', component: DrugRoundPage },
    { path: '/medadmin/patient/:patientId', component: MedHistoryPage },
  ],
});
