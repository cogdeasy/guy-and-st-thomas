import { FlaskConical } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { OrdersWorklistPage } from './OrdersWorklistPage';
import { NewOrderPage } from './NewOrderPage';

export default defineFeature({
  id: 'orders',
  title: 'Diagnostic & Procedure Orders',
  description: 'Clinical order entry (CPOE) for bloods, imaging, ECG and microbiology with a live worklist.',
  category: 'Diagnostics',
  icon: FlaskConical,
  navPath: '/orders',
  routes: [
    { path: '/orders', component: OrdersWorklistPage },
    { path: '/orders/new', component: NewOrderPage },
  ],
});
