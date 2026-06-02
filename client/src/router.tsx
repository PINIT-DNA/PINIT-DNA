import { createBrowserRouter } from 'react-router-dom';
import { DashboardLayout }  from './layouts/DashboardLayout';
import { DashboardPage }    from './pages/DashboardPage';
import { GeneratePage }     from './pages/GeneratePage';
import { ComparePage }      from './pages/ComparePage';
import { VaultPage }        from './pages/VaultPage';
import { DnaRecordsPage }   from './pages/DnaRecordsPage';
import { ReportsPage }      from './pages/ReportsPage';
import { CertificatesPage } from './pages/CertificatesPage';
import { NotFoundPage }     from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DashboardLayout />,
    children: [
      { index: true,              element: <DashboardPage />    },
      { path: 'generate',         element: <GeneratePage />     },
      { path: 'compare',          element: <ComparePage />      },
      { path: 'vault',            element: <VaultPage />        },
      { path: 'dna-records',      element: <DnaRecordsPage />   },
      { path: 'reports',          element: <ReportsPage />      },
      { path: 'certificates',     element: <CertificatesPage /> },
      { path: '*',                element: <NotFoundPage />     },
    ],
  },
]);
