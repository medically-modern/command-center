import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";
import { FileViewerHost } from "./components/shared/FileViewerModal";
import AuthGate from "./components/AuthGate";
import AccessProvider from "./components/AccessProvider";

// Masheke board roles (4)
const EvaluatePage = lazy(() => import("./pages/EvaluatePage"));
const SendRequestPage = lazy(() => import("./pages/SendRequestPage"));
const ConfirmReceiptPage = lazy(() => import("./pages/ConfirmReceiptPage"));
const ChaseClinicalsPage = lazy(() => import("./pages/ChaseClinicalsPage"));

// Samantha board roles (3)
const BenefitsPage = lazy(() => import("./pages/ChaseBenefitsPage"));
const WelcomeCallPage = lazy(() => import("./pages/WelcomeCallPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SubmitAuthPage = lazy(() => import("./pages/SubmitAuthPage"));
const AuthOutstandingPage = lazy(() => import("./pages/AuthOutstandingPage"));

// Subscription Board
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage"));

// Update Clinicals (simplified clinicals upload view)
const UpdateClinicalsPage = lazy(() => import("./pages/UpdateClinicalsPage"));

// Final Profile Confirmation (pre-check before Monday automations)
const FinalConfirmPage = lazy(() => import("./pages/FinalConfirmPage"));

// Patient Questions (read-only inbox)
const PatientQuestionsPage = lazy(() => import("./pages/PatientQuestionsPage"));

// System Management
const SystemMgmtPage = lazy(() => import("./pages/SystemMgmtPage"));

// Access management (managers only)
const AccessAdminPage = lazy(() => import("./pages/AccessAdminPage"));

// Oversight (full-screen managers grid)
const OversightPage = lazy(() => import("./pages/OversightPage"));

// Fax Inbox (RingCentral inbound faxes)
const FaxInboxPage = lazy(() => import("./pages/FaxInboxPage"));

const queryClient = new QueryClient();

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-subtle">
    <div className="text-center space-y-3">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  </div>
);

const basename = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

/** Old combined Chase Clinicals route → fax role, preserving query params
 *  (?patientId=, ?manager=1, …) so existing deep links keep working. */
const ChaseBenefitsRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/chase-fax${location.search}`} replace />;
};

const App = () => (
  <AuthGate>
  <AccessProvider>
  <QueryClientProvider client={queryClient}>
    <Toaster position="top-right" />
    <FileViewerHost />
    <BrowserRouter basename={basename}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/evaluate" element={<EvaluatePage />} />
          <Route path="/send-request" element={<SendRequestPage />} />
          <Route path="/confirm-receipt" element={<ConfirmReceiptPage />} />
          {/* Chase Clinicals — two roles (June 2026): fax (+ email) and parachute */}
          <Route path="/chase-fax" element={<ChaseClinicalsPage method="fax" />} />
          <Route path="/chase-parachute" element={<ChaseClinicalsPage method="parachute" />} />
          <Route path="/chase-benefits" element={<ChaseBenefitsRedirect />} />
          <Route path="/benefits" element={<BenefitsPage />} />
          <Route path="/welcome-call" element={<WelcomeCallPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/submit-auth" element={<SubmitAuthPage />} />
          <Route path="/auth-outstanding" element={<AuthOutstandingPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
          <Route path="/update-clinicals" element={<UpdateClinicalsPage />} />
          <Route path="/final-confirm" element={<FinalConfirmPage />} />
          <Route path="/patient-questions" element={<PatientQuestionsPage />} />
          <Route path="/system-mgmt" element={<SystemMgmtPage />} />
          <Route path="/access" element={<AccessAdminPage />} />
          <Route path="/oversight" element={<OversightPage />} />
          <Route path="/fax-inbox" element={<FaxInboxPage />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </QueryClientProvider>
  </AccessProvider>
  </AuthGate>
);

export default App;
