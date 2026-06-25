import { Cross } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { PharmacyQueuePage } from './PharmacyQueuePage';
import { PharmacyVerifyPage } from './PharmacyVerifyPage';

export default defineFeature({
  id: 'pharmacy',
  title: 'Pharmacy Verification & Stock',
  description: 'Clinical screening, verification and dispensing of inpatient prescriptions.',
  category: 'Medicines',
  icon: Cross,
  navPath: '/pharmacy',
  routes: [
    { path: '/pharmacy', component: PharmacyQueuePage },
    { path: '/pharmacy/:id', component: PharmacyVerifyPage },
  ],
});
