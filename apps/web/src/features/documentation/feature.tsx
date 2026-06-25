import { FileText } from 'lucide-react';
import { defineFeature } from '../../app/types';
import { DocumentationListPage } from './DocumentationListPage';
import { PatientNotesPage } from './PatientNotesPage';

export default defineFeature({
  id: 'documentation',
  title: 'Clinical Documentation',
  description: 'Ward-round and admission notes, patient timelines and a trust-wide recent-notes feed.',
  category: 'Clinical',
  icon: FileText,
  navPath: '/documentation',
  routes: [
    { path: '/documentation', component: DocumentationListPage },
    { path: '/documentation/:patientId', component: PatientNotesPage },
  ],
});
