import { Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { Dashboard } from './Dashboard';
import { features } from './registry';
import { EmptyState } from '@trustos/ui';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {features.flatMap((feature) =>
          feature.routes.map((route) => {
            const Component = route.component;
            return <Route key={`${feature.id}:${route.path}`} path={route.path} element={<Component />} />;
          }),
        )}
        <Route
          path="*"
          element={<EmptyState title="Page not found" description="This route is not registered." />}
        />
      </Routes>
    </Layout>
  );
}
