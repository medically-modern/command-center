import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Suspense } from "react";
import { lazyWithReload } from "./lib/shared/chunkReload";
import Index from "./pages/Index";
import { FileViewerHost } from "./components/shared/FileViewerModal";
import IncomingCallHost from "./components/inboundCalls/IncomingCallHost";
import NewVersionBanner from "./components/shared/NewVersionBanner";
import ScheduledCallHost from "./components/scheduledCalls/ScheduledCallHost";
import { AppShell } from "./components/shell/AppShell";
import { HomeViewHost } from "./components/shell/HomeViewHost";
import { AbilityGate } from "./components/shell/AbilityGate";
import AuthGate from "./components/AuthGate";
import AccessProvider from "./components/AccessProvider";

// Masheke board roles (4)
const EvaluatePage = lazyWithReload(() => import("./pages/EvaluatePage"));
const SendRequestPage = lazyWithReload(() => import("./pages/SendRequestPage"));
const ConfirmReceiptPage = lazyWithReload(() => import("./pages/ConfirmReceiptPage"));
const ChaseClinicalsPage = lazyWithReload(() => import("./pages/ChaseClinicalsPage"));
const DoctorAppointmentsPage = lazyWithReload(() => import("./pages/DoctorAppointmentsPage"));

// Samantha board roles (3)
const BenefitsPage = lazyWithReload(() => import("./pages/ChaseBenefitsPage"));
const WelcomeCallPage = lazyWithReload(() => import("./pages/WelcomeCallPage"));
const ProfilePage = lazyWithReload(() => import("./pages/ProfilePage"));
// Its own page, not a ProfilePage variant — the intake redesign must not
// change the Verified Referrals send-off, and separate components is the
// only way to guarantee that.
const UnverifiedReferralsPage = lazyWithReload(() => import("./pages/UnverifiedReferralsPage"));
const CareCoordinatorPage = lazyWithReload(() => import("./pages/CareCoordinatorPage"));
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
// The Supabase copy of Profile Send Off, drawn like a monday board (§5.55).
const SupabaseBoardPage = lazyWithReload(() => import("./pages/SupabaseBoardPage"));

// Oversight (full-screen managers grid)
const OversightPage = lazyWithReload(() => import("./pages/OversightPage"));
const OperationsPage = lazyWithReload(() => import("./pages/OperationsPage"));
const StageManagerPage = lazyWithReload(() => import("./pages/StageManagerPage"));

// The classic Fax Inbox list — /fax-inbox/classic, no door, until Josh says
// (PIXEL_MATCH_PLAN.md Phase 5). The FAX bar's page is FaxBarPage below.
const FaxInboxClassicPage = lazyWithReload(() => import("./pages/FaxInboxClassicPage"));

const AssignedPatientsPage = lazyWithReload(() => import("./pages/AssignedPatientsPage"));

// Orders — the New Order Board + Cardinal SKU Tracker, read-only (§5.35)
const OrdersPage = lazyWithReload(() => import("./pages/OrdersPage"));
const PatientPage = lazyWithReload(() => import("./pages/PatientPage"));
// The Fax Inbox — Brandon's 50/50 screen (§5.52, Phase 5): the inbound faxes,
// the office a fax came from, and Update Clinicals in place. The FAX bar opens it.
const FaxBarPage = lazyWithReload(() => import("./pages/FaxBarPage"));

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

/** The combined fax bar's own door (§5.39c) → the Fax Inbox it became on
 *  2026-09-24, query preserved (?from=system-mgmt drives Back). */
const FaxRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/fax-inbox${location.search}`} replace />;
};

/** Old Scheduled Calls route → the Care Coordinator dashboard it became
 *  (2026-09-08), preserving query params for the same reason. */
const ScheduledCallsRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/care-coordinator${location.search}`} replace />;
};

const App = () => (
  <AuthGate>
  <AccessProvider>
  <QueryClientProvider client={queryClient}>
    {/* Top-CENTRE, and both halves of that are load-bearing (Brandon,
        2026-08-19). Bottom-right is where EVERY stage page puts its primary
        action — "Completed Evaluation", "Send to Monday", "Advance to MN" — so
        a toast landed squarely on the button a rep presses next: adding a note
        on Evaluate popped "Note saved to Monday" over Completed Evaluation and
        swallowed the click for four seconds. Top-RIGHT is equally out: it used
        to cover the file preview's Close button, which is why this was moved
        to the bottom in the first place. The header row is `justify-between`
        on every page — title left, actions right — and the file viewer's
        toolbar puts Close at the far right, so the top centre is the one strip
        of the viewport with nothing clickable under it. */}
    <Toaster position="top-center" />
    <FileViewerHost />
    {/* App-wide on purpose: a call arrives wherever you happen to be working,
        so this cannot live on the texting page. See IncomingCallHost.tsx. */}
    <IncomingCallHost />
    {/* A deploy never reaches an open tab; this asks the deployment whether a
        newer build is live and offers the reload (§5.54). App-wide, outside
        the router: it is about the document, not a page. */}
    <NewVersionBanner />
    <BrowserRouter basename={basename}>
      {/* The ten-minute warning before a booked intake call. App-wide for the
          same reason as IncomingCallHost — the rep is working elsewhere when it
          comes due — but gated to people who hold the role, and INSIDE the
          router because its toast navigates to the patient. */}
      <ScheduledCallHost />
      {/* Brandon's Sept-2026 redesign shell (§5.39): the global header with
          its four section tabs and the always-on patient search. INSIDE the
          router because the tabs, the search and the active-tab rule all read
          the location, and OUTSIDE Suspense so the header stays put while a
          lazy page loads rather than blinking away on every navigation. With
          the layout toggle off it renders its children and nothing else. */}
      <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* Brandon's per-person home view (§5.39c). With one view — which is
              every config today — this renders <Index /> and nothing else. */}
          <Route path="/" element={<HomeViewHost />} />
          <Route path="/evaluate" element={<EvaluatePage />} />
          <Route path="/send-request" element={<SendRequestPage />} />
          <Route path="/confirm-receipt" element={<ConfirmReceiptPage />} />
          {/* Chase Clinicals — two roles (June 2026): fax (+ email) and parachute */}
          <Route path="/chase-fax" element={<ChaseClinicalsPage method="fax" />} />
          <Route path="/chase-parachute" element={<ChaseClinicalsPage method="parachute" />} />
          <Route path="/chase-benefits" element={<ChaseBenefitsRedirect />} />
          {/* Doctor Appointments — patient outreach when the provider requires
              a new visit before sending clinicals (2026-08-03) */}
          <Route path="/doctor-appointments" element={<DoctorAppointmentsPage />} />
          <Route path="/benefits" element={<BenefitsPage />} />
          <Route path="/welcome-call" element={<WelcomeCallPage />} />
          {/* Profile Send Off — three roles (July 2026): verified, unverified
              and already-in-system referrals, split by Already In System then
              Referral Type/Source (lib/profile/referralSplit) */}
          <Route path="/profile" element={<ProfilePage variant="verified" />} />
          <Route path="/unverified-referrals" element={<UnverifiedReferralsPage variant="infoCollection" />} />
          {/* The second half of the intake split (§5.20) — same component, right
              pane rendered and already open. */}
          <Route path="/profile-cleanup" element={<UnverifiedReferralsPage variant="cleanup" />} />
          <Route path="/in-system-referrals" element={<ProfilePage variant="inSystem" />} />
          {/* Care Coordinator — "My Patients" (§5.30). The old /scheduled-calls
              URL is kept as a redirect: it is in the reminder toast's history and
              in bookmarks. */}
          <Route path="/care-coordinator" element={<CareCoordinatorPage />} />
          <Route path="/scheduled-calls" element={<ScheduledCallsRedirect />} />
          <Route path="/submit-auth" element={<SubmitAuthPage />} />
          <Route path="/auth-outstanding" element={<AuthOutstandingPage />} />
          <Route path="/dvs" element={<DvsPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
          <Route path="/update-clinicals" element={<UpdateClinicalsPage />} />
          <Route path="/final-confirm" element={<FinalConfirmPage />} />
          <Route path="/patient-questions" element={<PatientQuestionsPage />} />
          <Route path="/system-mgmt" element={<SystemMgmtPage />} />
          <Route path="/access" element={<AccessAdminPage />} />
          {/* Read-only: the Supabase copy of Profile Send Off in monday's look
              (§5.55 *The board page*). Door: System Management's tab bar. */}
          <Route path="/supabase-board" element={<SupabaseBoardPage />} />
          <Route path="/oversight" element={<OversightPage />} />
          {/* Reports & Metrics and Stage Manager as their own pages (§5.41) —
              Josh, 2026-09-21. Both were tabs of /system-mgmt, so a header tab
              landed on a screen wearing a second tab bar; /system-mgmt keeps
              both tabs, so neither door is closed. Gated at the ROUTE, because
              a gate on the tab is not a gate on the page (§5.39h). */}
          <Route
            path="/operations"
            element={
              <AbilityGate ability="reports">
                <OperationsPage />
              </AbilityGate>
            }
          />
          <Route
            path="/stage-manager"
            element={
              <AbilityGate ability="stageManager">
                <StageManagerPage />
              </AbilityGate>
            }
          />
          {/* The FAX bar's page — Brandon's 50/50 Fax Inbox with Update Clinicals
              in the right pane (pixel-match Phase 5). The classic list it
              replaced answers at /classic with no door (PIXEL_MATCH_PLAN.md). */}
          <Route path="/fax-inbox" element={<FaxBarPage />} />
          <Route path="/fax-inbox/classic" element={<FaxInboxClassicPage />} />
          {/* ⚠️ Gated on `comms` (§5.39g). The header tab is not enough on its
              own: the route still answers a typed URL, a bookmark and a Back,
              so an ability that stops at the tab is decoration. */}
          <Route
            path="/assigned-patients"
            element={
              <AbilityGate ability="comms">
                <AssignedPatientsPage />
              </AbilityGate>
            }
          />
          {/* Orders — observation of the New Order Board (§5.35). ?orderId= deep-links
              an order, ?view=stock opens the Cardinal SKU Tracker table. */}
          <Route path="/orders" element={<OrdersPage />} />
          {/* The patient screen (§5.39) — additive; every stage page is unchanged. */}
          <Route path="/patient/:itemId" element={<PatientPage />} />
          {/* Brandon's combined fax bar (§5.39c) was ADDED beside /fax-inbox on
              2026-09-18 and BECAME it on 2026-09-24 — one fax screen, as his
              audit asked. The route survives for bookmarks. */}
          <Route path="/fax" element={<FaxRedirect />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </Suspense>
      </AppShell>
    </BrowserRouter>
  </QueryClientProvider>
  </AccessProvider>
  </AuthGate>
);

export default App;
