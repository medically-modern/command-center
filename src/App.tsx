import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";

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

// System Management
const SystemMgmtPage = lazy(() => import("./pages/SystemMgmtPage"));

// Final Profile Confirmation (pre-check before Monday automations)
const FinalConfirmPage = lazy(() => import("./pages/FinalConfirmPage"));

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster position="top-right" />
    <BrowserRouter basename={basename}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/evaluate" element={<EvaluatePage />} />
          <Route path="/send-request" element={<SendRequestPage />} />
          <Route path="/confirm-receipt" element={<ConfirmReceiptPage />} />
          <Route path="/chase-benefits" element={<ChaseClinicalsPage />} />
          <Route path="/benefits" element={<BenefitsPage />} />
          <Route path="/welcome-call" element={<WelcomeCallPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/submit-auth" element={<SubmitAuthPage />} />
          <Route path="/auth-outstanding" element={<AuthOutstandingPage />} />
          <Route path="/final-confirm" element={<FinalConfirmPage />} />
          <Route path="/system-mgmt" element={<SystemMgmtPage />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
