import { Utensils } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { NutritionWorklistPage } from './NutritionWorklistPage';
import { FluidBalancePage } from './FluidBalancePage';

export default defineFeature({
  id: 'nutrition',
  title: 'Dietetics & Nutrition',
  description: 'MUST malnutrition screening, dietitian referral and 24-hour fluid balance.',
  category: 'Clinical',
  icon: Utensils,
  navPath: '/nutrition',
  routes: [
    { path: '/nutrition', component: NutritionWorklistPage },
    { path: '/nutrition/:patientId', component: FluidBalancePage },
  ],
});
