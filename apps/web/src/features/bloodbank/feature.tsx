import { Droplet } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { BloodBankPage } from './BloodBankPage';
import { TransfusionOrderPage } from './TransfusionOrderPage';

export default defineFeature({
  id: 'bloodbank',
  title: 'Blood Bank & Transfusion',
  description: 'Transfusion worklist, crossmatch-to-transfuse pathway and live blood stock.',
  category: 'Clinical',
  icon: Droplet,
  navPath: '/bloodbank',
  routes: [
    { path: '/bloodbank', component: BloodBankPage },
    { path: '/bloodbank/:id', component: TransfusionOrderPage },
  ],
});
