import { createBrowserRouter } from 'react-router-dom';
import { DashboardLayout }        from './layouts/DashboardLayout';
import { DashboardPage }          from './pages/DashboardPage';
import { GeneratePage }           from './pages/GeneratePage';
import { ComparePage }            from './pages/ComparePage';
import { VaultPage }              from './pages/VaultPage';
import { DnaRecordsPage }         from './pages/DNARecordsPage';
import { ReportsPage }            from './pages/ReportsPage';
import { CertificatesPage }       from './pages/CertificatesPage';
import { TimelinePage }           from './pages/TimelinePage';
import { ForensicDiffPage }      from './pages/ForensicDiffPage';
import { SearchPage }            from './pages/SearchPage';
import { MonitoringPage }        from './pages/MonitoringPage';
import { VerifyCertificatePage }  from './pages/VerifyCertificatePage';
import { VaultIntegrityPage }       from './pages/VaultIntegrityPage';
import { DuplicateAttemptsPage }   from './pages/DuplicateAttemptsPage';
import { UnmaskRequestsPage }      from './pages/UnmaskRequestsPage';
import { SecurityCenterPage }       from './pages/SecurityCenterPage';
import { ForwardChainPage }         from './pages/ForwardChainPage';
import { IntelligenceReportPage }   from './pages/IntelligenceReportPage';
import { LinkTreePage }             from './pages/LinkTreePage';
import { ForensicDashboardPage }   from './pages/ForensicDashboardPage';
import { NotFoundPage }             from './pages/NotFoundPage';
import { ProfilePage }              from './pages/ProfilePage';
import { LinkIntelligencePage }     from './pages/LinkIntelligencePage';
import { AccessIntelligencePage }  from './pages/AccessIntelligencePage';
import { VerifyLeakedFilePage }    from './pages/VerifyLeakedFilePage';
import { ShareViewerPage }          from './pages/ShareViewerPage';
import { PinitGateway, RegisterGateway } from './pages/auth/PinitGateway';
import { RequireAuth }              from './components/auth/RequireAuth';
import { IS_NATIVE_APP }            from './native/platform';
import { NativeShell }              from './native/NativeShell';
import { HomeScreen }               from './native/screens/HomeScreen';
import { DnaScreen }                from './native/screens/DnaScreen';
import { ForensicsScreen }          from './native/screens/ForensicsScreen';
import { ProfileScreen }            from './native/screens/ProfileScreen';

export const router = createBrowserRouter([
  // ── PINIT HOID auth (public) ──────────────────────────────────────────────
  // /login is the launch gateway: returning users get the Login flow,
  // first-time devices are redirected to the Registration flow.
  { path: '/login',    element: <PinitGateway />    },
  { path: '/register', element: <RegisterGateway /> },

  // ── Public share viewer (no dashboard layout, no auth) ────────────────────
  {
    path: '/s/:token',
    element: <ShareViewerPage />,
  },

  // ── Dashboard (protected) ─────────────────────────────────────────────────
  // APK → native shell (bottom tabs + new screens); web → existing dashboard.
  {
    path: '/',
    element: <RequireAuth>{IS_NATIVE_APP ? <NativeShell /> : <DashboardLayout />}</RequireAuth>,
    children: [
      { index: true,                   element: IS_NATIVE_APP ? <HomeScreen /> : <DashboardPage /> },
      // Native tabs → custom designed screens, fully wired to real features
      ...(IS_NATIVE_APP ? [
        { path: 'app/dna',       element: <DnaScreen /> },
        { path: 'app/vault',     element: <VaultPage /> },
        { path: 'app/forensics', element: <ForensicsScreen /> },
        { path: 'app/profile',   element: <ProfileScreen /> },
      ] : []),
      { path: 'generate',              element: <GeneratePage />            },
      { path: 'compare',               element: <ComparePage />             },
      { path: 'vault',                 element: <VaultPage />               },
      { path: 'vault-integrity',       element: <VaultIntegrityPage />      },
      { path: 'dna-records',           element: <DnaRecordsPage />          },
      { path: 'reports',               element: <ReportsPage />             },
      { path: 'timeline',              element: <TimelinePage />            },
      { path: 'forensic-diff',         element: <ForensicDiffPage />        },
      { path: 'search',                element: <SearchPage />              },
      { path: 'monitoring',            element: <MonitoringPage />          },
      { path: 'duplicate-attempts',   element: <DuplicateAttemptsPage />   },
      { path: 'unmask-requests',      element: <UnmaskRequestsPage />      },
      { path: 'security-center',      element: <SecurityCenterPage />      },
      { path: 'chain/:dnaRecordId',   element: <ForwardChainPage />        },
      { path: 'intelligence/:vaultId', element: <IntelligenceReportPage /> },
      { path: 'link-tree/:parentToken', element: <LinkTreePage /> },
      { path: 'forensic-dashboard',    element: <ForensicDashboardPage /> },
      { path: 'profile',               element: <ProfilePage /> },
      { path: 'access-intelligence',     element: <AccessIntelligencePage /> },
      { path: 'verify-leaked',           element: <VerifyLeakedFilePage /> },
      { path: 'link/:token',            element: <LinkIntelligencePage /> },
      { path: 'certificates',          element: <CertificatesPage />        },
      { path: 'verify-certificate',    element: <VerifyCertificatePage />   },
      { path: '*',                     element: <NotFoundPage />            },
    ],
  },
]);
