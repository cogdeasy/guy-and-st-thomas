import { ScanLine } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { RadiologyWorklistPage } from './RadiologyWorklistPage';
import { ImagingRequestDetailPage } from './ImagingRequestDetailPage';

export default defineFeature({
  id: 'radiology',
  title: 'Imaging / Radiology',
  description: 'Radiology request worklist and reporting across XR, CT, MRI and ultrasound.',
  category: 'Diagnostics',
  icon: ScanLine,
  navPath: '/radiology',
  routes: [
    { path: '/radiology', component: RadiologyWorklistPage },
    { path: '/radiology/:id', component: ImagingRequestDetailPage },
  ],
});
