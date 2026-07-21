import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Suspense } from "react";
import { lazyWithReload } from "./lib/shared/chunkReload";
import Index from "./pages/Index";
import { FileViewerHost } from "./components/shared/FileViewerModal";
import AuthGate from "./components/AuthGate";
import AccessProvider from "./components/AccessProvider";

// Masheke board roles (4)
const EvaluatePage = lazyWithReload(() => import("./pages/EvaluatePage"));
const SendRequestPage = lazyWithReload(() => import("./pages/SendRequestPage"));
const ConfirmReceiptPage = lazyWithReload(() => import("./pages/ConfirmReceiptPage"));
const ChaseClinicalsPage = lazyWithReload(() => import("./pages/ChaseClinicalsPage"));

// Samantha board roles (3)
const BenefitsPage = lazyWithReload(() => import("./pages/ChaseBenefitsPage"));
const WelcomeCallPage = lazyWithReload(() => import("./pages/WelcomeCallPage"));
const ProfilePage = lazyWithReload(() => import("./pages/ProfilePage"));
const SubmitAuthPage = lazyWithReload(() => import("./pages/SubmitAuthPage"));
const AuthOutstandingPage = lazyWithReload(() => import("./pages/AuthOutstandingPage"));
const DvsPage = lazyWithReload(() => import("./pages/DvsPage"));

// Subscription Board
const SubscriptionPage = lazyWithReload(() => import("./pages/SubscriptionPage"));

// Update Clinicals (simplified clinicals upload view)
const UpdateClinicalsPage = lazyWithReload(() => import("./pages/UpdateClinicalsPage"));

// Final Profile Confirmation (pre-check before Monday automations)
const FinalConfirmPage = lazyWithReload(() => import("./pages/FinalConfirmPage"));

// Patient Questions (read-only inbox)
const PatientQuestionsPage = lazyWithReload(() => import("./pages/PatientQuestionsPage"));

// System Management
const SystemMgmtPage = lazyWithReload(() => import("./pages/SystemMgmtPage"));

// Access management (managers only)
const AccessAdminPage = lazyWithReload(() => import("./pages/AccessAdminPage"));

// Oversight (full-screen managers grid)
const OversightPage = lazyWithReload(() => import("./pages/OversightPage"));

// Fax Inbox (RingCentral inbound faxes)
const FaxInboxPage = lazyWithReload(() => import("./pages/FaxInboxPage"));

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
    {/* Bottom-right: top-right toasts covered the file preview's close button. */}
    <Toaster position="bottom-right" />
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
          {/* Profile Send Off — two roles (July 2026): verified and unverified
              referrals, split by Referral Type/Source (lib/profile/referralSplit) */}
          <Route path="/profile" element={<ProfilePage variant="verified" />} />
          <Route path="/unverified-referrals" element={<ProfilePage variant="unverified" />} />
          <Route path="/submit-auth" element={<SubmitAuthPage />} />
          <Route path="/auth-outstanding" element={<AuthOutstandingPage />} />
          <Route path="/dvs" element={<DvsPage />} />
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
