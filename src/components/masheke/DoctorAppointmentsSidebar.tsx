/**
 * Doctor Appointments sidebar.
 *
 * Two sections, and the second one is the point of difference from every other
 * masheke stage: **snoozed patients stay visible**, in an "Awaiting reply"
 * folder, open by default. The work here is texting and calling patients — if
 * someone replies on day two of a seven-day snooze, the rep needs to be able
 * to open them and put the appointment date in right then. Hiding them (the
 * behaviour everywhere else in the app) would leave that reply unread until
 * the snooze lapsed.
 *
 * Escalated patients are hidden — they're the manager's, in Oversight →
 * Manager Intervention → Appointments. See lib/masheke/sidebarList
 * apptSidebarSections, which this renders verbatim.
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

interface Props {
  patients: Patient[];
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
}: {
  patient: Patient;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  snoozedUntil?: string;
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
              {snoozedUntil
                ? `Following up ${shortDate(snoozedUntil)} · ${attempts} of 3`
                : `Attempt ${Math.min(attempts + 1, 3)} of 3`}
            </p>
          </div>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function DoctorAppointmentsSidebar({
  patients,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
}: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const today = etToday();
  const { dueNow, awaitingReply } = apptSidebarSections(patients, today);
  // Open by default — a folder nobody opens is the same as hiding them.
  const [showAwaiting, setShowAwaiting] = useState(true);

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
                Patients ({dueNow.length + awaitingReply.length})
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
                  Nobody due — check the follow-ups below.
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

        {awaitingReply.length > 0 && (
          <SidebarGroup>
            <button
              type="button"
              onClick={() => setShowAwaiting((o) => !o)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", showAwaiting && "rotate-90")}
              />
              <CalendarCheck2 className="h-3.5 w-3.5" />
              {!collapsed && `Awaiting reply (${awaitingReply.length})`}
            </button>
            {showAwaiting && (
              <SidebarGroupContent>
                {!collapsed && (
                  <p className="px-3 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                    Snoozed, but still here — open anyone who texts back to add their appointment date.
                  </p>
                )}
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
      </SidebarContent>
    </Sidebar>
  );
}
