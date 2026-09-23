import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import ErrorBoundary from "./components/common/ErrorBoundary.jsx";
import { SessionProvider } from "./components/auth/SessionProvider.jsx";
import { PRIVACY, TERMS } from "./content/pages.js";

/* Route-level code splitting: the landing page, the analyzer (PapaParse + the whole
   results dashboard) and the reading pages never load together. */
const Home    = lazy(() => import("./pages/Home"));
const Analyze = lazy(() => import("./pages/Analyze"));
const Methodology = lazy(() => import("./pages/Methodology"));
const About       = lazy(() => import("./pages/About"));
const History     = lazy(() => import("./pages/History"));
const TextPage    = lazy(() => import("./pages/TextPage"));
const NotFound    = lazy(() => import("./pages/NotFound"));

/* Painted in the app's own background so a chunk fetch never flashes an unstyled page. */
function RouteFallback() {
  return <div className="min-h-screen bg-paper" />;
}

function App() {
  return (
    <BrowserRouter>
      {/* Who is signed in and how much free AI is left — read by the header and the
          AI panels. Inside the router because signing in never navigates. */}
      <SessionProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"        element={<Home />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/about"   element={<About />} />
          <Route path="/history" element={<History />} />
          <Route path="/privacy" element={<TextPage page={PRIVACY} />} />
          <Route path="/terms"   element={<TextPage page={TERMS} />} />
          <Route path="/home"    element={<Navigate to="/" replace />} />
          <Route path="/search"  element={<Navigate to="/" replace />} />
          {/* Boundary sits INSIDE the route so a crash in the analyzer leaves the
              router mounted — the user can still navigate away. */}
          <Route
            path="/analyze"
            element={
              <ErrorBoundary>
                <Analyze />
              </ErrorBoundary>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </SessionProvider>
    </BrowserRouter>
  );
}

export default App;
