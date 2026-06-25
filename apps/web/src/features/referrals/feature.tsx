import { Send } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { ReferralWorklistPage } from './ReferralWorklistPage';
import { ReferralDetailPage } from './ReferralDetailPage';

export default defineFeature({
  id: 'referrals',
  title: 'Referrals & RTT',
  description: 'Referral management with 18-week Referral-To-Treatment tracking and breach risk.',
  category: 'Operations',
  icon: Send,
  navPath: '/referrals',
  routes: [
    { path: '/referrals', component: ReferralWorklistPage },
    { path: '/referrals/:id', component: ReferralDetailPage },
  ],
});
