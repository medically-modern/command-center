/**
 * Communications Hub — every way a patient reaches the MM line, in one place,
 * with their Command Center profile beside it.
 *
 * Three tabs on the left rail, mirroring the RingCentral app a rep already has
 * open (Josh, 2026-09-01: "the rc ui is fine, what we need to add is command
 * center integration so a rep can see the full context without having to go
 * back and forth"):
 *
 *   Phone — recent calls, with a Missed filter, and voicemail with transcripts
 *   Text  — the conversation list, with an Unread filter and read/unread
 *   Fax   — inbound faxes, joined to the sending office and ITS patients
 *
 * Whatever is selected in any of the three resolves to one phone number, and
 * that number drives the third pane: the patient's profile path and notes
 * (`PatientDossierPanel`). That pane is the reason the hub exists — a missed
 * call is a phone number until you know whose it is and where they are stuck.
 *
 * ⚠️ You can still text a number that is on no board (Josh, 2026-08-04). The
 * patient record is a convenience for FINDING someone, never a precondition for
 * reaching them, so the dossier pane says "not on any board" and the composer
 * stays live.
 *
 * ⚠️ Every RingCentral read on this page goes through `hooks/commsHub/rcStore`,
 * which carries the INCIDENT_2026-08-20 guards: one shared load per list, a
 * stable snapshot identity, a TTL, and no polling at all for a tab nobody has
 * opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BellRing,
  MessageSquare,
  Phone,
  Printer,
  Search,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import CallOverlay from "@/components/assignedPatients/CallOverlay";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import TextInbox from "@/components/commsHub/TextInbox";
import PhonePanel, { type PhoneMode } from "@/components/commsHub/PhonePanel";
import FaxPanel, { FaxProviderDetail } from "@/components/commsHub/FaxPanel";
import VoicemailDetail from "@/components/commsHub/VoicemailDetail";
import PatientDossierPanel from "@/components/commsHub/PatientDossierPanel";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { searchPatientsByName, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import {
  fetchFaxBlobUrl,
  setMessageRead,
  toE164,
  type InboundFax,
  type VoicemailRecord,
} from "@/lib/fax/ringcentralApi";
import {
  applyFaxReadOverrides,
  applyReadOverrides,
  pruneFaxReadOverrides,
  pruneReadOverrides,
  type Conversation,
  type ReadOverride,
} from "@/lib/commsHub/conversations";
import { buildFaxDirectory, type FaxDirectoryEntry } from "@/lib/commsHub/faxDirectory";
import { DoctorDbUnavailable, fetchDoctorDbByFax, fetchFaxMatches } from "@/lib/commsHub/dossierApi";
import { contactKey } from "@/lib/contactState/contactState";
import { useDossier } from "@/hooks/commsHub/useDossier";
import { useDirectoryNames } from "@/hooks/commsHub/useDirectoryNames";
import {
  reloadFaxes,
  reloadTexts,
  useCallLog,
  useFaxList,
  useTextInbox,
  useVoicemails,
} from "@/hooks/commsHub/useHubData";
import { cn } from "@/lib/utils";

type HubTab = "phone" | "text" | "fax";

const TABS: { id: HubTab; label: string; Icon: typeof Phone }[] = [
  { id: "phone", label: "Phone", Icon: Phone },
  { id: "text", label: "Text", Icon: MessageSquare },
  { id: "fax", label: "Fax", Icon: Printer },
];

export default function AssignedPatientsPage() {
  // Back is HISTORY-FIRST via the shared hook (CLAUDE.md §9) — do not swap it
  // for a hardcoded route.
  const { goBack } = useBackNavigation();

  const [tab, setTab] = useState<HubTab>("text");
  const [dialInput, setDialInput] = useState("");
  const [ringSettings, setRingSettings] = useState(false);

  // Per-tab list state, kept separate so switching tabs doesn't clear what the
  // rep had typed or selected in the other two.
  const [textQuery, setTextQuery] = useState("");
  const [textUnreadOnly, setTextUnreadOnly] = useState(false);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  /**
   * A number the rep explicitly chose to open that has no conversation yet —
   * a typed number, or a name hit from the boards.
   *
   * ⚠️ Set ONLY by a click. It used to be derived from the search box, which
   * meant clearing the box after opening a thread closed the thread: the rep
   * searched a name, started reading, tidied the search field, and the pane
   * emptied under them.
   */
  const [directNumber, setDirectNumber] = useState<string>("");
  const [nameHits, setNameHits] = useState<PatientRef[]>([]);

  const [phoneMode, setPhoneMode] = useState<PhoneMode>("calls");
  const [phoneQuery, setPhoneQuery] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [selectedCallPhone, setSelectedCallPhone] = useState("");
  const [selectedVoicemail, setSelectedVoicemail] = useState<VoicemailRecord | null>(null);

  const [faxQuery, setFaxQuery] = useState("");
  const [faxUnreadOnly, setFaxUnreadOnly] = useState(false);
  const [selectedFax, setSelectedFax] = useState<InboundFax | null>(null);
  /**
   * Local fax read/unread clicks, covering the seconds between the PUT and the
   * next poll — the same job `readOverrides` does for texts. Keyed by message
   * id, and dropped as soon as RingCentral's own answer agrees, so it can never
   * mask a state the RingCentral desktop app is showing differently.
   */
  const [faxReadOverrides, setFaxReadOverrides] = useState<Map<number, boolean>>(new Map());
  const [faxEntry, setFaxEntry] = useState<FaxDirectoryEntry | null>(null);
  const [faxEntryLoading, setFaxEntryLoading] = useState(false);
  const [faxEntryError, setFaxEntryError] = useState<string | null>(null);
  /** The Doctor Database read failed, so "not in the directory" is a thing we
   *  cannot claim — see `openFax`. */
  const [doctorDbFailed, setDoctorDbFailed] = useState(false);

  /**
   * Local read/unread clicks, covering the seconds between the PUT and the next
   * poll — and NOTHING longer. Each entry records the inbound message it was a
   * judgement about, so a newer message from the patient retires it and
   * RingCentral's own answer takes over again (`overrideStillApplies`).
   */
  const [readOverrides, setReadOverrides] = useState<Map<string, ReadOverride>>(new Map());
  /** Which fax lookup is current — see `openFax`. */
  const faxRequestRef = useRef(0);

  const { call: activeCall, error: callError, dismissError, dial, hangup, toggleMute } = useWebPhone();

  // Only the OPEN tab polls RingCentral.
  const texts = useTextInbox(tab === "text");
  const calls = useCallLog(tab === "phone");
  const voicemails = useVoicemails(tab === "phone");
  const faxes = useFaxList(tab === "fax");

  const conversations = useMemo(
    () => applyReadOverrides(texts.data ?? [], readOverrides),
    [texts.data, readOverrides],
  );

  /**
   * The numbers the OPEN tab is showing, so a tab nobody is looking at costs
   * nothing. RingCentral names most offices; our boards name the patients, and
   * `useDirectoryNames` resolves the whole list in a couple of batched requests
   * rather than one per row (the §5.28 rule, and why it is safe here).
   */
  const visibleKeys = useMemo(() => {
    if (tab === "text") return conversations.map((c) => c.key);
    if (tab === "phone") {
      return [
        ...(calls.data ?? []).map((r) =>
          contactKey((String(r.direction) === "Outbound" ? r.to : r.from)?.phoneNumber),
        ),
        ...(voicemails.data ?? []).map((v) => contactKey(v.fromNumber)),
      ];
    }
    return [];
  }, [tab, conversations, calls.data, voicemails.data]);

  const directoryNames = useDirectoryNames(visibleKeys, tab !== "fax");

  /** Set an override, dropping any that the latest poll has retired. Pruning
   *  here rather than in an effect keeps it bounded and loop-free: it only ever
   *  runs on a click. */
  const setOverride = useCallback(
    (c: Conversation, unread: boolean) =>
      setReadOverrides((m) => {
        const next = new Map(pruneReadOverrides(conversations, m));
        next.set(c.key, { unread, basedOnInboundId: c.newestInboundId });
        return next;
      }),
    [conversations],
  );

  const clearOverride = useCallback(
    (key: string) =>
      setReadOverrides((m) => {
        if (!m.has(key)) return m;
        const next = new Map(m);
        next.delete(key);
        return next;
      }),
    [],
  );

  /** The one number the dossier pane follows, whichever tab is open. */
  const selectedPhone = useMemo(() => {
    if (tab === "text") return selectedConv?.phone || directNumber || "";
    if (tab === "phone") return phoneMode === "voicemail" ? selectedVoicemail?.fromNumber || "" : selectedCallPhone;
    return "";
  }, [tab, selectedConv, directNumber, phoneMode, selectedVoicemail, selectedCallPhone]);

  const dossier = useDossier(selectedPhone);

  /**
   * The dossier's live record, in the shape `ConversationThread` wants.
   *
   * Worth threading through rather than passing null: it names the patient in
   * the thread header, and it carries `mondayItemId` onto the send, which is
   * what ties an outbound text to the board item it was about. A number with
   * no live record stays null and the thread shows the number, which is the
   * correct answer for somebody who isn't on a board.
   */
  const threadPatient: PatientRef | null = useMemo(() => {
    const a = dossier.dossier?.active;
    if (!a) return null;
    return {
      itemId: a.itemId,
      name: a.name || dossier.dossier?.name || "",
      phone: a.phone || selectedPhone,
      boardId: String(a.boardId),
      boardName: a.boardName,
    };
  }, [dossier.dossier, selectedPhone]);

  /** A full number in the search box, offered as "start a conversation".
   *  Derived, so it can never overwrite what the rep has open. */
  const typedNumber = useMemo(() => toE164(textQuery.trim()), [textQuery]);

  // A typed name searches the boards, so a rep can start a conversation with
  // somebody who has never texted us. Debounced — the search fans out across
  // every pipeline board.
  useEffect(() => {
    const q = textQuery.trim();
    if (q.length < 2 || /^[\d\s()+-]+$/.test(q)) {
      setNameHits([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      void searchPatientsByName(q)
        .then((r) => alive && setNameHits(r.filter((p) => p.phone)))
        .catch(() => alive && setNameHits([]));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [textQuery]);

  /** Opening a conversation marks it read — in the UI immediately, in
   *  RingCentral in the background. A failed PUT is reported but does not undo
   *  the local state: the rep HAS read it. */
  const openConversation = useCallback(
    (c: Conversation) => {
      setSelectedConv(c);
      // Reading a thread also retires a stale "mark as unread" on it, even when
      // RingCentral has nothing to write — otherwise a conversation the rep
      // flagged and then read stays badged with no way to clear it.
      if (!c.unreadIds.length) {
        clearOverride(c.key);
        return;
      }
      setOverride(c, false);
      void Promise.all(c.unreadIds.map((id) => setMessageRead(id, true)))
        .then(() => reloadTexts())
        .catch((e: unknown) => {
          // ⚠️ Drop the override too. Leaving it installed hides the thread
          // from the Unread filter while RingCentral still holds it unread —
          // the exact masking `basedOnInboundId` exists to bound, reintroduced
          // by the one path that failed to clean up after itself.
          clearOverride(c.key);
          toast.error(`Couldn't mark read in RingCentral: ${e instanceof Error ? e.message : String(e)}`);
        });
    },
    [clearOverride, setOverride],
  );

  const markUnread = useCallback(
    (c: Conversation) => {
      if (!c.newestInboundId) return;
      setOverride(c, true);
      void setMessageRead(c.newestInboundId, false)
        .then(() => reloadTexts())
        .catch((e: unknown) => {
          // A failed write must not leave the row claiming a state RingCentral
          // does not hold — the RC desktop app would disagree with it.
          clearOverride(c.key);
          toast.error(`Couldn't mark unread: ${e instanceof Error ? e.message : String(e)}`);
        });
    },
    [clearOverride, setOverride],
  );

  const markRead = useCallback(
    (c: Conversation) => {
      // Nothing for RingCentral to write, but the row may be badged by our own
      // "mark as unread" — dropping that override IS the fix, and without this
      // branch such a row could never be cleared.
      if (!c.unreadIds.length) {
        clearOverride(c.key);
        return;
      }
      setOverride(c, false);
      void Promise.all(c.unreadIds.map((id) => setMessageRead(id, true)))
        .then(() => reloadTexts())
        .catch((e: unknown) => {
          clearOverride(c.key);
          toast.error(`Couldn't mark read: ${e instanceof Error ? e.message : String(e)}`);
        });
    },
    [clearOverride, setOverride],
  );

  /** The fax list with the rep's own read/unread clicks applied. The rule is
   *  `applyFaxReadOverrides`, beside the conversation one it mirrors, so the two
   *  halves of the same mechanism are tested together rather than diverging. */
  const faxList = useMemo(
    () => applyFaxReadOverrides(faxes.data ?? [], faxReadOverrides),
    [faxes.data, faxReadOverrides],
  );

  /** Record a click, dropping any override RingCentral has caught up with.
   *  Pruning on the click rather than in an effect keeps it bounded and
   *  loop-free — the same shape `setOverride` uses for texts. */
  const setFaxOverride = useCallback(
    (id: number, read: boolean) =>
      setFaxReadOverrides((m) => new Map(pruneFaxReadOverrides(faxes.data ?? [], m)).set(id, read)),
    [faxes.data],
  );

  const clearFaxOverride = useCallback(
    (id: number) =>
      setFaxReadOverrides((m) => {
        if (!m.has(id)) return m;
        const next = new Map(m);
        next.delete(id);
        return next;
      }),
    [],
  );

  /**
   * Right-click → Mark as read / unread (Josh, 2026-09-02). Writes
   * RingCentral's own `readStatus`, exactly as the Text tab does — this list is
   * also the RingCentral desktop app's, so a local-only flag would disagree
   * with what a rep sees there within a day.
   */
  const setFaxRead = useCallback(
    (f: InboundFax, read: boolean) => {
      setFaxOverride(f.id, read);
      void setMessageRead(f.id, read)
        .then(() => reloadFaxes())
        .catch((e: unknown) => {
          // A failed write must not leave the row claiming a state RingCentral
          // does not hold — the RC desktop app would disagree with it.
          clearFaxOverride(f.id);
          toast.error(
            `Couldn't mark the fax ${read ? "read" : "unread"}: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    },
    [setFaxOverride, clearFaxOverride],
  );

  /** Selecting a fax joins its number to a provider and their patients. Bound
   *  to the fax that was open when the lookup started, so clicking down the
   *  list can't paint one office's patients under another's header. */
  const openFax = useCallback((f: InboundFax) => {
    setSelectedFax(f);
    setFaxEntry(null);
    setFaxEntryError(null);
    setDoctorDbFailed(false);
    setFaxEntryLoading(true);
    // ⚠️ A REF, not a local flag. This is a callback, not an effect, so there
    // is no cleanup to flip a local `cancelled` — a rep clicking down the list
    // would land an earlier office's patients under a later fax's header, with
    // nothing erroring. Each click claims the ref; a resolved lookup that no
    // longer holds it drops its result on the floor.
    const token = ++faxRequestRef.current;
    const current = () => faxRequestRef.current === token;
    // Two sources, in parallel: the patient boards (who of ours this office
    // looks after) and the MM Doctor Database (who they ARE). The second is
    // 2,290 offices against the patient boards' much smaller doctor slice, so
    // without it a fax from a real, known practice reported "we have never
    // heard of this number" (Josh, 2026-09-02).
    void Promise.all([
      fetchFaxMatches(f.fromNumber),
      // ⚠️ Caught SEPARATELY, and the failure is remembered rather than folded
      // into "no match". The pane tells a rep to go and add this number to a
      // doctor record; saying that because Monday 503'd would have them create
      // a duplicate for an office we already hold.
      fetchDoctorDbByFax(f.fromNumber).then(
        (docs) => ({ docs, failed: false }),
        (e: unknown) => {
          if (e instanceof DoctorDbUnavailable) return { docs: [], failed: true };
          throw e;
        },
      ),
    ])
      .then(([rows, db]) => {
        if (!current()) return;
        setFaxEntry(buildFaxDirectory(f.fromNumber, rows, db.docs));
        setDoctorDbFailed(db.failed);
      })
      .catch((e: unknown) => current() && setFaxEntryError(e instanceof Error ? e.message : String(e)))
      .finally(() => current() && setFaxEntryLoading(false));
    if (!f.read) {
      // Show it read straight away — the same override the context menu writes,
      // or the row springs back to unread until the next poll lands. Going
      // through `setFaxOverride` rather than setting the map directly is what
      // keeps this path pruning too: opening faxes all day would otherwise grow
      // the map with entries RingCentral had long since caught up with.
      setFaxOverride(f.id, true);
      void setMessageRead(f.id, true).then(() => reloadFaxes()).catch(() => {
        /* a failed read-flag must not block reading the fax */
        clearFaxOverride(f.id);
      });
    }
  }, [setFaxOverride, clearFaxOverride]);

  const dialTarget = useMemo(() => toE164(dialInput), [dialInput]);

  /**
   * Open a fax page in the viewer.
   *
   * ⚠️ **Fetch the BYTES first, then hand the viewer a `blob:` URL** — the same
   * thing FaxInboxPage does, and the reason it works there. A RingCentral
   * attachment URI is NOT a Monday asset: passing it straight to
   * `openFileViewer` sends it down `fetchAssetBytes`, which tries a direct CORS
   * fetch (no RC bearer token, so it fails) and then the worker's `/asset`
   * proxy, which allowlists MONDAY hosts and refuses. `fetchFaxBlobUrl` goes
   * through the gateway's `/rc/fetch`, which is the only path that carries the
   * RingCentral credential.
   */
  const [faxOpening, setFaxOpening] = useState(false);
  /**
   * The blob URL currently handed to the viewer.
   *
   * ⚠️ `FileViewerModal` revokes only the blobs it creates ITSELF, never one a
   * caller passes in — so without this, every fax opened leaks a multi-MB blob
   * for the life of the tab, and a rep works through a lot of faxes. Revoking
   * the PREVIOUS one on each open (and on unmount) bounds it to one live blob
   * without touching the shared modal's contract.
   */
  const faxBlobRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (faxBlobRef.current) URL.revokeObjectURL(faxBlobRef.current);
    },
    [],
  );

  const viewFax = useCallback(async (f: InboundFax) => {
    if (!f.attachmentUri) {
      toast.error("This fax has no document attached.");
      return;
    }
    setFaxOpening(true);
    try {
      const url = await fetchFaxBlobUrl(f.attachmentUri);
      // Safe here and not earlier: the viewer has moved on to the new document
      // by the time the next open resolves.
      if (faxBlobRef.current) URL.revokeObjectURL(faxBlobRef.current);
      faxBlobRef.current = url;
      openFileViewer({ url, name: `Fax from ${f.fromName || f.fromNumber}` });
    } catch (e) {
      toast.error(`Couldn't open the fax: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFaxOpening(false);
    }
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gradient-subtle">
      <header className="shrink-0 border-b border-sidebar-border bg-gradient-navy text-navy-foreground">
        <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
          <button onClick={goBack} className="rounded-md p-1.5 transition-colors hover:bg-white/10" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-elevate">
            <MessageSquare className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="truncate text-xl font-bold">Communications</h1>
          </div>

          <div className="mx-auto flex items-center gap-2 rounded-xl bg-white/10 p-1.5 ring-1 ring-white/20">
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
              <input
                value={dialInput}
                onChange={(e) => setDialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dialTarget) void dial(dialTarget);
                }}
                placeholder="Call any number…"
                aria-label="Call any number"
                className="w-56 rounded-lg bg-white py-2 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <button
              onClick={() => dialTarget && void dial(dialTarget)}
              disabled={!dialTarget || !!activeCall}
              title={dialTarget ? `Call ${fmtPhone(dialTarget)}` : "Enter a full phone number"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-500"
            >
              <Phone className="h-4 w-4" /> Call
            </button>
          </div>

          <button
            onClick={() => setRingSettings(true)}
            title="Which calls ring me"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
          >
            <BellRing className="h-4 w-4" />
          </button>
        </div>
      </header>

      {callError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span className="flex-1">{callError}</span>
          <button onClick={dismissError} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Tab rail ──────────────────────────────────────── */}
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            const badge =
              id === "text"
                ? conversations.filter((c) => c.unread > 0).length
                : id === "fax"
                  ? faxList.filter((f) => !f.read).length
                  : (voicemails.data ?? []).filter((v) => !v.read).length;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
                {badge > 0 && (
                  <span className="absolute right-1.5 top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── List pane ─────────────────────────────────────── */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
          {tab === "text" && (
            <>
              <TextInbox
                conversations={conversations}
                loading={texts.loading}
                error={texts.error}
                onReload={texts.reload}
                selectedKey={selectedConv?.key ?? (directNumber ? contactKey(directNumber) : null)}
                onSelect={openConversation}
                onMarkUnread={markUnread}
                onMarkRead={markRead}
                query={textQuery}
                onQuery={setTextQuery}
                unreadOnly={textUnreadOnly}
                onUnreadOnly={setTextUnreadOnly}
                names={directoryNames}
              />
              {/* Reaching someone must never depend on them having texted
                  first, so a typed number and any name match are offered
                  underneath the conversations. */}
              {(typedNumber || nameHits.length > 0) && (
                <div className="shrink-0 border-t border-border bg-muted/30">
                  <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Start a conversation
                  </p>
                  {typedNumber && (
                    <button
                      onClick={() => {
                        setSelectedConv(null);
                        setDirectNumber(typedNumber);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">{fmtPhone(typedNumber)}</span>
                    </button>
                  )}
                  {nameHits.slice(0, 5).map((p) => (
                    <button
                      key={p.itemId}
                      onClick={() => {
                        setSelectedConv(null);
                        setDirectNumber(p.phone);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                    >
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {fmtPhone(p.phone)} · {p.boardName}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "phone" && (
            <PhonePanel
              mode={phoneMode}
              onMode={setPhoneMode}
              calls={calls.data}
              voicemails={voicemails.data}
              loading={calls.loading || voicemails.loading}
              error={calls.error || voicemails.error}
              onReload={() => {
                calls.reload();
                voicemails.reload();
              }}
              selectedKey={
                phoneMode === "voicemail"
                  ? selectedVoicemail
                    ? contactKey(selectedVoicemail.fromNumber)
                    : null
                  : selectedCallPhone
                    ? contactKey(selectedCallPhone)
                    : null
              }
              onSelect={(phone) => {
                if (phoneMode === "voicemail") {
                  const vm = (voicemails.data ?? []).find((v) => contactKey(v.fromNumber) === contactKey(phone));
                  setSelectedVoicemail(vm ?? null);
                } else {
                  setSelectedCallPhone(phone);
                }
              }}
              query={phoneQuery}
              onQuery={setPhoneQuery}
              missedOnly={missedOnly}
              onMissedOnly={setMissedOnly}
              names={directoryNames}
            />
          )}

          {tab === "fax" && (
            <FaxPanel
              faxes={faxList}
              loading={faxes.loading}
              error={faxes.error}
              onReload={faxes.reload}
              selectedId={selectedFax?.id ?? null}
              onSelect={openFax}
              query={faxQuery}
              onQuery={setFaxQuery}
              unreadOnly={faxUnreadOnly}
              onUnreadOnly={setFaxUnreadOnly}
              onSetRead={setFaxRead}
            />
          )}
        </aside>

        {/* ── Detail pane ───────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col border-r border-border">
          {tab === "text" &&
            (selectedPhone ? (
              <ConversationThread
                key={selectedPhone}
                phone={selectedPhone}
                patient={threadPatient}
                onCall={() => void dial(selectedPhone)}
                calling={activeCall?.phone === selectedPhone}
              />
            ) : (
              <HubIdle title="Text details" hint="Pick a conversation on the left, or search for a patient." />
            ))}

          {tab === "phone" &&
            (phoneMode === "voicemail" ? (
              selectedVoicemail ? (
                <VoicemailDetail voicemail={selectedVoicemail} />
              ) : (
                <HubIdle title="Voicemail" hint="Pick a message to hear it and read the transcript." />
              )
            ) : selectedCallPhone ? (
              <ConversationThread
                key={selectedCallPhone}
                phone={selectedCallPhone}
                patient={threadPatient}
                onCall={() => void dial(selectedCallPhone)}
                calling={activeCall?.phone === selectedCallPhone}
              />
            ) : (
              <HubIdle title="Call details" hint="Pick a call to see the patient and text them back." />
            ))}

          {tab === "fax" &&
            (selectedFax ? (
              <FaxProviderDetail
                fax={selectedFax}
                entry={faxEntry}
                loading={faxEntryLoading}
                error={faxEntryError}
                onOpenFax={() => void viewFax(selectedFax)}
                opening={faxOpening}
                doctorDbFailed={doctorDbFailed}
              />
            ) : (
              <HubIdle title="Fax details" hint="Pick a fax to see the sending office and their patients." />
            ))}
        </section>

        {/* ── Command Center profile widget ─────────────────── */}
        {/* 30% wider than the original clamp(18rem,28%,26rem) (Josh, 2026-09-01) — the
            pane now carries the per-stage call detail, not just notes. */}
        <aside className="hidden w-[clamp(23.5rem,36%,34rem)] shrink-0 flex-col border-l border-border bg-card lg:flex">
          <div className="shrink-0 border-b border-border px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Command Center profile
            </p>
          </div>
          {tab === "fax" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Printer className="h-7 w-7 text-muted-foreground/50" />
              <p className="max-w-[26ch] text-xs text-muted-foreground">
                {/* A fax belongs to an OFFICE, not a patient — its patients are
                    listed in the middle pane, where there is room for all of
                    them. */}
                Faxes are matched to a doctor's office. Their patients are listed in the middle.
              </p>
            </div>
          ) : (
            <PatientDossierPanel
              dossier={dossier.dossier}
              loading={dossier.loading}
              error={dossier.error}
              phone={selectedPhone || null}
            />
          )}
        </aside>
      </div>

      <RingPreferencesDialog open={ringSettings} onOpenChange={setRingSettings} />

      {activeCall && (
        <CallOverlay
          call={activeCall}
          name={dossier.dossier?.name || ""}
          onHangup={() => void hangup()}
          onToggleMute={() => toggleMute()}
        />
      )}
    </div>
  );
}

function HubIdle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <Search className="mb-1 h-6 w-6 text-muted-foreground/40" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
