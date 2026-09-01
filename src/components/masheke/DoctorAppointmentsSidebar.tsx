/**
 * Doctor Appointments sidebar.
 *
 * A PROCESSOR sees exactly one section — **Reach out today**, the work.
 *
 * A MANAGER (`managerView`) additionally gets **Awaiting reply** (snoozed) and
 * **Scheduled** (booked a visit, so already back in Chase). Neither is work;
 * both are oversight, which is why a processor never sees them.
 *
 * A patient is in EXACTLY ONE section — apptSidebarSections dedupes, because a
 * deep-linked patient is injected into the main list even when they don't match
 * this stage and would otherwise appear twice.
 *
 * Escalated patients are hidden from the processor entirely — they're the
 * manager's, in Oversight → Medical Evaluation → Doctor Appointments. See
 * lib/masheke/sidebarList apptSidebarSections, which this renders verbatim.
 */
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarCheck2, ChevronRight, Loader2, MessageCircle, RefreshCw, User } from "lucide-react";
import type { Patient } from "@/lib/masheke/workflow";
import { cn } from "@/lib/utils";
import { apptSidebarSections } from "@/lib/masheke/sidebarList";
import { etToday } from "@/lib/masheke/etDate";
import { apptAttemptCount } from "@/lib/masheke/apptOutreach";
import { ContactStateMarks } from "@/components/shared/ContactStateMarks";

interface Props {
  patients: Patient[];
  /** Patients with a booked visit — they sit in Chase now. Manager view only;
   *  pass [] for a processor. */
  scheduledPatients?: Patient[];
  /** Manager view: adds the "Awaiting reply" and "Scheduled" folders. A
   *  processor's sidebar is "Reach out today" and nothing else (Josh,
   *  2026-08-03) — neither folder is work, both are oversight. */
  managerView?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

/** YYYY-MM-DD → M/D */
function shortDate(iso?: string): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : "";
}

function ApptRow({
  patient,
  isActive,
  collapsed,
  onSelect,
  snoozedUntil,
  appointmentOn,
}: {
  patient: Patient;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  snoozedUntil?: string;
  /** Set for the Scheduled folder — the booked visit date. */
  appointmentOn?: string;
}) {
  const attempts = apptAttemptCount(patient);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(patient.id)}
        className="flex items-start gap-2 py-2 h-auto"
      >
        <User className="h-4 w-4 shrink-0 mt-0.5" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{patient.name}</p>
            <p className="truncate text-[11px] text-muted-foreground leading-tight mt-0.5">
              {appointmentOn
                ? `Appointment ${shortDate(appointmentOn)}`
                : snoozedUntil
                  ? `Following up ${shortDate(snoozedUntil)} · ${attempts} of 3`
                  : `Attempt ${Math.min(attempts + 1, 3)} of 3`}
            </p>
          </div>
        )}
        <ContactStateMarks phone={patient.phone} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function DoctorAppointmentsSidebar({
  patients,
  scheduledPatients = [],
  managerView = false,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
}: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const today = etToday();
  const { dueNow, awaitingReply, scheduled } = apptSidebarSections(
    patients,
    today,
    managerView ? scheduledPatients : [],
    managerView,
  );
  // Open by default — a folder nobody opens is the same as hiding them.
  const [showAwaiting, setShowAwaiting] = useState(true);
  // Closed by default — these patients are handled; the folder is a way back to
  // them, not a work list.
  const [showScheduled, setShowScheduled] = useState(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Monday · Doctor Appts
              </p>
              <p className="text-sm font-semibold leading-tight">
                Patients ({dueNow.length + (managerView ? awaitingReply.length : 0)})
              </p>
            </div>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={loading}
              className="h-7 w-7 shrink-0"
              aria-label="Refresh patients"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" />
            {!collapsed && `Reach out today (${dueNow.length})`}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dueNow.length === 0 && !collapsed && (
                <p className="px-3 py-2 text-xs text-muted-foreground italic">
                  Nobody due right now.
                </p>
              )}
              {dueNow.map((p) => (
                <ApptRow
                  key={p.id}
                  patient={p}
                  isActive={p.id === selectedId}
                  collapsed={collapsed}
                  onSelect={onSelect}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {managerView && awaitingReply.length > 0 && (
          <SidebarGroup>
            <FolderHeader
              open={showAwaiting}
              onToggle={() => setShowAwaiting((o) => !o)}
              collapsed={collapsed}
              icon={<MessageCircle className="h-3.5 w-3.5 shrink-0" />}
              label={`Awaiting reply (${awaitingReply.length})`}
            />
            {showAwaiting && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {awaitingReply.map((p) => (
                    <ApptRow
                      key={p.id}
                      patient={p}
                      isActive={p.id === selectedId}
                      collapsed={collapsed}
                      onSelect={onSelect}
                      snoozedUntil={p.nextActionDate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {managerView && scheduled.length > 0 && (
          <SidebarGroup>
            <FolderHeader
              open={showScheduled}
              onToggle={() => setShowScheduled((o) => !o)}
              collapsed={collapsed}
              icon={<CalendarCheck2 className="h-3.5 w-3.5 shrink-0" />}
              label={`Scheduled (${scheduled.length})`}
            />
            {showScheduled && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {scheduled.map((p) => (
                    <ApptRow
                      key={p.id}
                      patient={p}
                      isActive={p.id === selectedId}
                      collapsed={collapsed}
                      onSelect={onSelect}
                      appointmentOn={p.appointmentDate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

/**
 * Collapsible folder header.
 *
 * The label keeps ONE colour through hover. An earlier version used
 * `hover:text-foreground`, which read as the text disappearing on hover against
 * the dark sidebar — the hovered colour was near-invisible there.
 */
function FolderHeader({
  open,
  onToggle,
  collapsed,
  icon,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
    >
      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
