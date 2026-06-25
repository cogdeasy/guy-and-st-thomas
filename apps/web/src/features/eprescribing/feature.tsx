import { Pill } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { EPrescribingWorklistPage } from './EPrescribingWorklistPage';
import { DrugChartPage } from './DrugChartPage';

export default defineFeature({
  id: 'eprescribing',
  title: 'E-Prescribing',
  description: 'Inpatient electronic prescribing — the digital drug chart with live allergy checking.',
  category: 'Medicines',
  icon: Pill,
  navPath: '/eprescribing',
  routes: [
    { path: '/eprescribing', component: EPrescribingWorklistPage },
    { path: '/eprescribing/:patientId', component: DrugChartPage },
  ],
});
