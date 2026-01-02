import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { Layout } from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import Replies from '@/pages/Replies';
import Analytics from '@/pages/Analytics';
import Limits from '@/pages/Limits';
import Friends from '@/pages/Friends';
import Docs from '@/pages/Docs';
import EODReport from '@/pages/EODReport';
import FineTune from '@/pages/FineTune';
import Character from '@/pages/Character';
import CharacterWizard from '@/pages/CharacterWizard';
import Login from '@/pages/Login';

const queryClient = new QueryClient();

// Access the key from environment variables (Vite style)
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Publishable Key");
}

function ClerkProviderWithRoutes() {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <Routes>
        <Route path="/login/*" element={<Login />} />
        <Route
          path="/"
          element={
            <>
              <SignedIn>
                <Layout />
              </SignedIn>
              <SignedOut>
                <RedirectToSignIn />
              </SignedOut>
            </>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="replies" element={<Replies />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="friends" element={<Friends />} />
          <Route path="limits" element={<Limits />} />
          <Route path="docs" element={<Docs />} />
          <Route path="reports" element={<EODReport />} />
          <Route path="finetune" element={<FineTune />} />
          <Route path="character" element={<Character />} />
          <Route path="wizard" element={<CharacterWizard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ClerkProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ClerkProviderWithRoutes />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
