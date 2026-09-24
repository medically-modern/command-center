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
 * …and, when the gateway switches it on (`COMMS_INBOX_UI`), a fourth rail FIRST
 * and the default: the **Inbox** — the Unresolved queue (COMMS_INBOX_PLAN.md).
 * Every inbound text, missed call and voicemail opens an item for the patient
 * until a person marks it resolved, saying how. ⚠️ Additive: with the switch
 * off nothing on this page changes, and the three rails stay exactly as they
 * were either way (plan §8).
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
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BellRing,
  Inbox,
  Loader2,
  MessageSquare,
  Phone,
  Printer,
  Search,
  User,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import TextInbox from "@/components/commsHub/TextInbox";
import NewTextPanel from "@/components/commsHub/NewTextPanel";
import PhonePanel, { type PhoneMode } from "@/components/commsHub/PhonePanel";
import FaxPanel, { FaxProviderDetail } from "@/components/commsHub/FaxPanel";
import VoicemailDetail from "@/components/commsHub/VoicemailDetail";
import { voicemailForCall, type PickedCall } from "@/lib/commsHub/callVoicemail";
import PatientDossierPanel from "@/components/commsHub/PatientDossierPanel";
import HubPatientPane, { HubPatientPaneHeader } from "@/components/commsHub/HubPatientPane";
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
  applyMessageReadOverrides,
  applyReadOverrides,
  pruneMessageReadOverrides,
  pruneReadOverrides,
  type Conversation,
  type ReadOverride,
} from "@/lib/commsHub/conversations";
import { buildFaxDirectory, type FaxDirectoryEntry } from "@/lib/commsHub/faxDirectory";
import { toOutboundRows, viewIsOutbound, type FaxView } from "@/lib/commsHub/faxFilter";
import { DoctorDbUnavailable, fetchDoctorDbByFax, fetchFaxMatches, type DossierPick } from "@/lib/commsHub/dossierApi";
import { contactKey } from "@/lib/contactState/contactState";
import { anchorIndex, useDossier, type DossierAnchor } from "@/hooks/commsHub/useDossier";
import { useDirectoryNames } from "@/hooks/commsHub/useDirectoryNames";
import {
  reloadFaxes,
  reloadTexts,
  useCallLog,
  useFaxList,
  useOutboundFaxes,
  useTextInbox,
  useVoicemails,
} from "@/hooks/commsHub/useHubData";
import InboxList from "@/components/commsInbox/InboxList";
import ItemTimeline, { ItemMoved } from "@/components/commsInbox/ItemTimeline";
import AddNumberCard from "@/components/commsInbox/AddNumberCard";
import type { StickyResolution } from "@/components/commsInbox/ResolveBar";
import {
  flushCommsOutbox,
  invalidateInbox,
  reportDial,
  useCommsConfig,
  useInboxBadge,
  useInboxItem,
  useInboxList,
  useItemKeyForNumber,
} from "@/hooks/commsInbox/useInbox";
import type { InboxQuery } from "@/lib/commsInbox/api";
import { inboxStateSig, isUnmatchedKey, type InboxItem, type InboxRow } from "@/lib/commsInbox/rules";
import { defaultNumber, fillNumbers } from "@/lib/commsInbox/timeline";
import { contactsFor } from "@/lib/patient/contacts";
import type { CallLogFilter, TextLogFilter } from "@/lib/commsHub/logFilters";
import { cn } from "@/lib/utils";

type HubTab = "inbox" | "phone" | "text" | "fax" | "calls" | "vms";

const TABS: { id: HubTab; label: string; Icon: typeof Phone }[] = [
  { id: "phone", label: "Phone", Icon: Phone },
  { id: "text", label: "Text", Icon: MessageSquare },
  { id: "fax", label: "Fax", Icon: Printer },
];

/**
 * The rails once the gateway switches the Inbox on — the mockup's order
 * (COMMS_INBOX_PLAN.md §1.2): **Inbox · Fax · Texts · Calls · VMs**. Phone
 * splits into its two logs, and every log row opens the same item detail as the
 * Inbox. Off, the rail is `TABS` exactly as it was.
 */
const INBOX_TABS: { id: HubTab; label: string; Icon: typeof Phone }[] = [
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "fax", label: "Fax", Icon: Printer },
  { id: "text", label: "Texts", Icon: MessageSquare },
  { id: "calls", label: "Calls", Icon: Phone },
  { id: "vms", label: "VMs", Icon: Voicemail },
];

/** A log rail — its rows open the item for their number once the Inbox is on. */
const isLogTab = (t: HubTab) => t === "text" || t === "calls" || t === "vms";

const INBOX_SEARCH_DEBOUNCE_MS = 300;

/**
 * @param embedded  Rendered INSIDE another page's chrome — System Management's
 *   Communications tab. It stops claiming the viewport height, since the host
 *   owns the layout, and drops the BACK BUTTON alone: the host's own header sits
 *   directly above with a back button that goes to the same place.
 *
 *   ⚠️ Everything else renders IDENTICALLY to the standalone page, navy bar
 *   included (Josh, 2026-09-10: "exactly the same"). The first cut restyled the
 *   header into a plain white strip and dropped the icon and the
 *   "Communications" title, leaving a dialer and a bell floating on white — and
 *   it read as a half-built screen, reported as \"there's no way to send a text
 *   in this view, it looks incomplete\". The composer was in fact present and
 *   reachable at every viewport (measured in a browser at 1024×640 through
 *   1440×900, embedded and standalone, pixel-identical); what was missing was
 *   the chrome that says the view is finished. Restyling a header is not a
 *   cheaper way to say "this is embedded" — it is a way to say "this is broken".
 *
 *   ⚠️ The host must render this CONDITIONALLY, not hidden behind CSS: every
 *   RingCentral poll in here is scoped to the mounted tab (§5.28, "only the OPEN
 *   tab polls"), so a hidden-but-mounted copy would poll the shared account
 *   from a screen nobody is looking at — INCIDENT_2026-08-20's shape.
 */
export default function AssignedPatientsPage({ embedded = false }: { embedded?: boolean } = {}) {
  // Back is HISTORY-FIRST via the shared hook (CLAUDE.md §9) — do not swap it
  // for a hardcoded route.
  const { goBack } = useBackNavigation();

  /**
   * Is the Inbox switched on (`COMMS_INBOX_UI` on the gateway)? Off — and while
   * the switch is being read — this page is exactly what it was before the
   * inbox existed.
   */
  const commsConfig = useCommsConfig();
  const inboxOn = commsConfig.ui;
  const [tab, setTabState] = useState<HubTab>("text");
  /** The rep chose a tab: the Inbox arriving as the default must not undo it. */
  const tabPicked = useRef(false);
  const setTab = useCallback((t: HubTab) => {
    tabPicked.current = true;
    setTabState(t);
  }, []);
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
  /** The explicit "New text" pane. Its own query, so opening it doesn't wipe
   *  whatever the rep had typed into the conversation search. */
  const [composing, setComposing] = useState(false);
  const [composeQuery, setComposeQuery] = useState("");
  const [searchingNames, setSearchingNames] = useState(false);
  /**
   * The patient a rep picked BY NAME, so the profile pane opens on them.
   *
   * ⚠️ On a line two patients share, the number alone is not enough: searching
   * "Sue Hartley" and clicking her opened John, who shares `(304) 697-7788` and
   * wins the default ordering. Cleared whenever the rep navigates by number
   * instead — a conversation, a call or a typed number carries no such choice.
   */
  const [directPerson, setDirectPerson] = useState<string>("");

  const [phoneMode, setPhoneMode] = useState<PhoneMode>("calls");
  const [phoneQuery, setPhoneQuery] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  /** The logs' own filters once the Inbox is on (Josh's D4) — kept apart from
   *  the Unread / Missed flags, which the switched-off hub still uses. */
  const [textLog, setTextLog] = useState<TextLogFilter>("all");
  const [callLog, setCallLog] = useState<CallLogFilter>("all");

  /**
   * The rail follows the switch. On: the Inbox is the default (unless the rep
   * already chose a rail), and a rep on Phone lands on the log it was showing.
   * Off: the Inbox and the two split logs fold back into Text and Phone.
   * Read through refs, so the switch — not every click — is what runs this.
   */
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const phoneModeRef = useRef(phoneMode);
  phoneModeRef.current = phoneMode;
  useEffect(() => {
    const t = tabRef.current;
    if (inboxOn) {
      if (!tabPicked.current) setTabState("inbox");
      else if (t === "phone") setTabState(phoneModeRef.current === "voicemail" ? "vms" : "calls");
      return;
    }
    if (t === "inbox") setTabState("text");
    else if (t === "calls" || t === "vms") {
      setPhoneMode(t === "vms" ? "voicemail" : "calls");
      setTabState("phone");
    }
  }, [inboxOn]);
  /**
   * The call row a rep picked, not just its number: `voicemailForCall` joins on
   * the call's own start time and on whether the log says it reached voicemail
   * (§5.28), and a phone string carries neither.
   */
  const [selectedCall, setSelectedCall] = useState<PickedCall | null>(null);
  const selectedCallPhone = selectedCall?.phone ?? "";
  const [selectedVoicemail, setSelectedVoicemail] = useState<VoicemailRecord | null>(null);
  /**
   * Local heard/unheard clicks on the voicemail list, covering the seconds
   * between the PUT and the next poll. The SAME rule the fax list uses
   * (`applyMessageReadOverrides`), because a voicemail row IS the message —
   * see the note on `MessageReadRow`.
   */
  const [voicemailReadOverrides, setVoicemailReadOverrides] = useState<Map<number, boolean>>(new Map());

  const [faxQuery, setFaxQuery] = useState("");
  /** Which slice of the fax history is shown — mirrors RingCentral's own menu
   *  (Josh, 2026-09-02). Sent/Failed read the OUTBOUND list, which is fetched
   *  only while one of them is chosen. */
  const [faxView, setFaxView] = useState<FaxView>("all");
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

  /**
   * Every Call on this page reports who dialed (COMMS_INBOX_PLAN.md §4.6) — the
   * call log cannot say, because the whole team is one RingCentral extension
   * (§5.13b). Best-effort and only while the inbox module is on; a dial is
   * never held up by it.
   */
  const dialNumber = useCallback(
    (phone: string) => {
      reportDial(phone);
      return dial(phone);
    },
    [dial],
  );

  /* ── The Inbox (COMMS_INBOX_PLAN.md §1–§6) ────────────────────────────── */

  /**
   * `?inbox=over` is the SLA card's *Open breaches* link (Reports & Metrics,
   * Josh's D8). Read ONCE, into the Inbox's own view state, then taken off the
   * address bar: left there it would contradict the rep the moment they change
   * view, and a reload would drag them back to *Over 24h*. With the Inbox
   * switched off it lands on nothing — the hub is exactly what it was — and it
   * is still removed, so it cannot resurface when the switch comes on.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const inboxViewParam = searchParams.get("inbox");
  const [inboxQuery, setInboxQuery] = useState<Omit<InboxQuery, "q" | "sticky">>(() => ({
    view: inboxViewParam === "over" || inboxViewParam === "all" ? inboxViewParam : "open",
    type: "",
    stage: "",
    sort: "wait",
  }));
  useEffect(() => {
    if (inboxViewParam === null) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("inbox");
        return next;
      },
      { replace: true },
    );
  }, [inboxViewParam, setSearchParams]);
  const [inboxSearch, setInboxSearch] = useState("");
  const [inboxQ, setInboxQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setInboxQ(inboxSearch), INBOX_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [inboxSearch]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Which of the patient's numbers the rep is replying on — "" = the default. */
  const [activeHmac, setActiveHmac] = useState("");
  /** A patient found for an UNMATCHED item, before anything is written. */
  const [inboxFindPick, setInboxFindPick] = useState<DossierPick | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);

  /**
   * The number a LOG rail's selection points at — a conversation, a call, a
   * voicemail. Once the Inbox is on, that row opens the item the number files
   * under (plan §1.2: *"Any log row opens the same item detail as the Inbox"*).
   */
  const logPhone = useMemo(() => {
    if (tab === "text") return selectedConv?.phone || directNumber || "";
    if (tab === "calls") return selectedCallPhone;
    if (tab === "vms") return selectedVoicemail?.fromNumber || "";
    return "";
  }, [tab, selectedConv, directNumber, selectedCallPhone, selectedVoicemail]);
  const logRail = inboxOn && isLogTab(tab);
  const logItemKey = useItemKeyForNumber(logRail ? logPhone : "");
  /** The item on screen, whichever rail opened it. */
  const openKey = tab === "inbox" ? (inboxOn ? selectedKey : null) : logRail ? logItemKey.key : null;
  useEffect(() => {
    setActiveHmac("");
    setInboxFindPick(null);
  }, [openKey]);

  /**
   * The item just resolved. It stays in the list, greyed with its ✓, until the
   * rep opens another item — that is where Undo lives (plan §1.1 rule 7).
   *
   * ⚠️⚠️ **Releasing it is when its note is copied to Monday** (plan §5.4, Josh's
   * D5). Monday notes are append-only, so the copy waits until Undo is no
   * longer offered: an Undo before then leaves nothing on the patient's record.
   */
  const [sticky, setSticky] = useState<StickyResolution | null>(null);
  const stickyRef = useRef<StickyResolution | null>(null);
  stickyRef.current = sticky;
  const releaseSticky = useCallback(() => {
    const s = stickyRef.current;
    if (!s) return;
    stickyRef.current = null;
    setSticky(null);
    // THIS one is copied now; anything else waits out its Undo window, because
    // another tab may still be offering Undo on it (`flushCommsOutbox`).
    void flushCommsOutbox(s.resolutionId);
  }, []);
  const openItem = useCallback(
    (key: string | null) => {
      if (stickyRef.current && stickyRef.current.key !== key) releaseSticky();
      setSelectedKey(key);
    },
    [releaseSticky],
  );
  // Moving on releases it wherever it happens: another item in any rail, or a
  // rail with nothing open. Re-opening the SAME item — from a log row, say —
  // keeps its Undo.
  // ⚠️ …which needs the log row's key to have ARRIVED. While it is being looked
  // up the open key reads null for a moment, and treating that as "moved on"
  // released the note — copying it to Monday and taking its Undo away — on the
  // way to re-opening the very same item (2026-09-23 review).
  const logKeyPending = logRail && logItemKey.loading;
  useEffect(() => {
    if (logKeyPending) return;
    if (stickyRef.current && stickyRef.current.key !== openKey) releaseSticky();
  }, [openKey, logKeyPending, releaseSticky]);
  // Opening Communications catches up anything a closed tab left uncopied, and
  // leaving the page copies whatever this one still holds.
  useEffect(() => {
    if (!commsConfig.enabled) return;
    void flushCommsOutbox();
    return () => {
      void flushCommsOutbox(stickyRef.current?.resolutionId);
    };
  }, [commsConfig.enabled]);

  const inboxActiveTab = inboxOn && tab === "inbox";
  const inboxList = useInboxList({ ...inboxQuery, q: inboxQ, sticky: sticky?.key ?? "" }, inboxActiveTab);
  const inboxBadge = useInboxBadge(inboxOn);
  const inboxItem = useInboxItem(openKey);
  const item = inboxItem.item;
  const reloadItem = inboxItem.reload;

  /**
   * The open item follows its list row: when the row changes (a new message, a
   * resolution by somebody else, a Left voicemail) the item and its live thread
   * are read again. The list polls; the item never polls on its own.
   */
  const selectedRow = useMemo(
    () => inboxList.data?.rows.find((r) => r.key === selectedKey) ?? null,
    [inboxList.data, selectedKey],
  );
  const rowSig = selectedRow ? inboxStateSig(selectedRow) : "";
  /**
   * ⚠️ Compared with what the OPEN ITEM says, not with the row's previous
   * value. The old comparison stored "" whenever the row left the list — the
   * Unresolved view drops a row somebody else resolves — so when a new text
   * reopened it and it came BACK, the change was read as a first sighting and
   * the open item kept showing it resolved (2026-09-23 review). Only a row
   * change triggers this, and the item's own reload does not, so it cannot
   * loop; an item still loading is compared once it lands.
   */
  const itemSigRef = useRef("");
  itemSigRef.current = item && item.key === selectedKey ? inboxStateSig(item.state) : "";
  useEffect(() => {
    const loaded = itemSigRef.current;
    if (!rowSig || !loaded || loaded === rowSig) return;
    reloadItem();
    setRefreshSeq((n) => n + 1);
  }, [rowSig, reloadItem]);

  const inboxChanged = useCallback(() => {
    invalidateInbox();
    reloadItem();
    setRefreshSeq((n) => n + 1);
  }, [reloadItem]);

  /** The number the profile pane looks the patient up by — the gateway's own. */
  const inboxLookupNumber = useMemo(() => (item ? defaultNumber(item.numbers, item.timeline) : null), [item]);
  /**
   * How the profile pane finds the patient for an item:
   *  · a matched item whose number the gateway could not read → by the record
   *    itself (its board and item);
   *  · an UNMATCHED item the rep has found somebody for → that pick;
   *  · otherwise by the number, which is what shows the household switcher
   *    for a line two patients share (plan §4.4, §7 job 1).
   */
  const inboxPick: DossierPick | null = useMemo(() => {
    if (!item) return null;
    if (isUnmatchedKey(item.key)) return inboxFindPick;
    if (item.itemId && item.boardId && !inboxLookupNumber?.e164) {
      return { itemId: item.itemId, boardId: item.boardId, name: item.name, phone: "" };
    }
    return null;
  }, [item, inboxFindPick, inboxLookupNumber]);

  // Only the OPEN tab polls RingCentral.
  const texts = useTextInbox(tab === "text");
  const calls = useCallLog(tab === "phone" || tab === "calls");
  // The Calls rail reads voicemail too: a call that left one marks it heard
  // when opened, exactly as on the Phone tab (§5.28).
  const voicemails = useVoicemails(tab === "phone" || tab === "calls" || tab === "vms");
  const faxes = useFaxList(tab === "fax");
  // ⚠️ Loaded only while a Sent/Failed view is chosen — the default view is
  // inbound, and this would otherwise be requests nobody asked for.
  const outboundFaxes = useOutboundFaxes(tab === "fax" && viewIsOutbound(faxView));
  const outboundRows = useMemo(
    () => (outboundFaxes.data ? toOutboundRows(outboundFaxes.data) : null),
    [outboundFaxes.data],
  );

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
    if (tab === "phone" || tab === "calls" || tab === "vms") {
      return [
        ...(tab === "vms" ? [] : calls.data ?? []).map((r) =>
          contactKey((String(r.direction) === "Outbound" ? r.to : r.from)?.phoneNumber),
        ),
        ...(tab === "calls" ? [] : voicemails.data ?? []).map((v) => contactKey(v.fromNumber)),
      ];
    }
    return [];
  }, [tab, conversations, calls.data, voicemails.data]);

  const { names: directoryNames, progress: namingProgress } = useDirectoryNames(visibleKeys, tab !== "fax");

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
    if (tab === "inbox") return inboxLookupNumber?.e164 || "";
    if (isLogTab(tab)) return logPhone;
    if (tab === "phone") return phoneMode === "voicemail" ? selectedVoicemail?.fromNumber || "" : selectedCallPhone;
    return "";
  }, [tab, inboxLookupNumber, logPhone, phoneMode, selectedVoicemail, selectedCallPhone]);

  /**
   * A patient the rep found through the profile pane's own search, because the
   * number on the line is on no board (§5.28). Bound to the number it was
   * chosen for: moving to another conversation, call or voicemail drops it, or
   * the next caller would inherit somebody else's profile — and the composer
   * and outbound-text attribution read from that profile.
   */
  const [dossierPick, setDossierPick] = useState<DossierPick | null>(null);
  useEffect(() => setDossierPick(null), [selectedPhone]);

  /**
   * The patient an OPEN inbox item is filed under — whichever rail opened it.
   * The profile pane asks the number first (that is what brings the household
   * switcher) and falls back to this record when the number does not find it:
   * a caregiver's alternate line, a number a rep linked, a number since
   * changed. Without it those items read "isn't on any pipeline board" for a
   * patient the inbox had already named (2026-09-23 review).
   */
  const inboxAnchor: DossierAnchor | null = useMemo(() => {
    if (!item || isUnmatchedKey(item.key) || !item.itemId || !item.boardId) return null;
    return { boardId: item.boardId, itemId: item.itemId, name: item.name };
  }, [item]);

  const dossier = useDossier(
    selectedPhone,
    tab === "inbox" ? item?.name || "" : dossierPick?.name || directPerson,
    tab === "inbox" ? inboxPick : dossierPick,
    tab === "inbox" || logRail ? inboxAnchor : null,
  );

  /**
   * Where a resolve note is copied (plan §5.2). Normally the item's own patient,
   * which is the gateway's default, so this is null. On a line two patients
   * share, the rep may have switched the profile to the OTHER one — and the
   * note is about the person they were looking at, so it is filed to them
   * rather than to whoever the number happens to be listed under (2026-09-23
   * review). Never for an unmatched item: that note is never copied.
   */
  const inboxNoteTarget = useMemo(() => {
    const d = dossier.dossier;
    if (!d || !inboxAnchor) return null;
    if (anchorIndex([d], inboxAnchor) >= 0) return null;
    const rec = d.active ?? d.items[0];
    return rec ? { boardId: Number(rec.boardId), itemId: String(rec.itemId) } : null;
  }, [dossier.dossier, inboxAnchor]);

  /**
   * The item's numbers, with any the gateway couldn't read filled in from THIS
   * patient's own records (a unique last four only — `fillNumbers`). Never for
   * an unmatched item: the profile pane there is somebody the rep is only
   * considering.
   */
  const inboxCandidates = useMemo(() => {
    if (!item) return [];
    // A log row's own number IS this item's — it is how the item was found —
    // so it fills in even for an unmatched one.
    const phones = logRail && logPhone ? [logPhone] : [];
    const d = dossier.dossier;
    if ((tab === "inbox" || logRail) && d && !isUnmatchedKey(item.key)) {
      phones.push(...d.items.map((i) => i.phone).filter(Boolean));
      const alt = contactsFor(d.items, d.active?.itemId)?.alternatePhoneRaw;
      if (alt) phones.push(alt);
    }
    return phones;
  }, [tab, logRail, logPhone, dossier.dossier, item]);
  const inboxNumbers = useMemo(() => (item ? fillNumbers(item.numbers, inboxCandidates) : []), [item, inboxCandidates]);
  const inboxActive = useMemo(() => {
    if (!item) return null;
    const chosen = inboxNumbers.find((n) => n.hmac === activeHmac && !!n.e164);
    if (chosen) return chosen;
    // Opened from a log row: reply on the number the rep clicked — a caregiver's
    // alternate line is not the patient's primary.
    if (logRail && logPhone) {
      const clicked = inboxNumbers.find((n) => !!n.e164 && contactKey(n.e164) === contactKey(logPhone));
      if (clicked) return clicked;
    }
    return defaultNumber(inboxNumbers, item.timeline);
  }, [item, inboxNumbers, activeHmac, logRail, logPhone]);
  /**
   * Can Text for the inbox composer. ⚠️ It is the PRIMARY line's answer
   * (§5.31d) — it says nothing about the patient's other number, so it applies
   * only when that is the number being texted. Blank is unknown, never a No.
   */
  const inboxCanText = useMemo(() => {
    const d = dossier.dossier;
    if (!d || !item || isUnmatchedKey(item.key) || !inboxActive?.e164) return undefined;
    if (contactKey(d.active?.phone || d.phone) !== contactKey(inboxActive.e164)) return undefined;
    return contactsFor(d.items, d.active?.itemId)?.canText;
  }, [dossier.dossier, item, inboxActive]);
  /** An outbound text is tied to the patient's live record — never, for an
   *  unmatched item, to somebody the rep is only considering. */
  const inboxMondayItemId =
    item && !isUnmatchedKey(item.key) ? dossier.dossier?.active?.itemId ?? item.itemId ?? null : null;

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
  const composeNumber = useMemo(() => toE164(composeQuery.trim()), [composeQuery]);

  /** Open a thread with whoever was picked, and leave compose. `name` is empty
   *  for a typed number — nobody was chosen, so the profile pane must not be
   *  told to open on anyone in particular. */
  const startConversation = useCallback((phone: string, name: string) => {
    setSelectedConv(null);
    setDirectNumber(phone);
    setDirectPerson(name);
    setComposing(false);
    setComposeQuery("");
  }, []);

  // A typed name searches the boards, so a rep can start a conversation with
  // somebody who has never texted us. Debounced — the search fans out across
  // every pipeline board.
  /** Whichever box is live — the compose pane's, or the conversation search.
   *  One effect rather than two, so the debounce and the cancel rules can't
   *  drift apart. */
  const nameQuery = composing ? composeQuery : textQuery;
  useEffect(() => {
    const q = nameQuery.trim();
    if (q.length < 2 || /^[\d\s()+-]+$/.test(q)) {
      setNameHits([]);
      setSearchingNames(false);
      return;
    }
    let alive = true;
    setSearchingNames(true);
    const id = setTimeout(() => {
      void searchPatientsByName(q)
        .then((r) => alive && setNameHits(r.filter((p) => p.phone)))
        .catch(() => alive && setNameHits([]))
        .finally(() => alive && setSearchingNames(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [nameQuery]);

  /** Opening a conversation marks it read — in the UI immediately, in
   *  RingCentral in the background. A failed PUT is reported but does not undo
   *  the local state: the rep HAS read it. */
  const openConversation = useCallback(
    (c: Conversation) => {
      setSelectedConv(c);
      // Navigating by number, not by person — drop any earlier name choice or
      // it would follow the rep onto an unrelated conversation.
      setDirectPerson("");
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
   *  `applyMessageReadOverrides`, beside the conversation one it mirrors, so the two
   *  halves of the same mechanism are tested together rather than diverging. */
  const faxList = useMemo(
    () => applyMessageReadOverrides(faxes.data ?? [], faxReadOverrides),
    [faxes.data, faxReadOverrides],
  );

  /** Record a click, dropping any override RingCentral has caught up with.
   *  Pruning on the click rather than in an effect keeps it bounded and
   *  loop-free — the same shape `setOverride` uses for texts. */
  const setFaxOverride = useCallback(
    (id: number, read: boolean) =>
      setFaxReadOverrides((m) => new Map(pruneMessageReadOverrides(faxes.data ?? [], m)).set(id, read)),
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

  /** The voicemail list with the rep's own heard/unheard clicks applied — the
   *  same rule as the fax list, so the two halves of one mechanism cannot
   *  drift (`applyMessageReadOverrides`). */
  const voicemailList = useMemo(
    () => applyMessageReadOverrides(voicemails.data ?? [], voicemailReadOverrides),
    [voicemails.data, voicemailReadOverrides],
  );

  /**
   * Mark a voicemail heard / unheard — the right-click menu, and opening one.
   *
   * Writes RingCentral's own `readStatus` (`setMessageRead` → PUT
   * `message-store/{id}`), exactly as the Text and Fax tabs do. ⚠️ That is what
   * makes it a SYSTEM-WIDE change rather than this browser's opinion: the whole
   * team shares one RingCentral extension (§5.13b), so there is exactly one
   * `readStatus` per message and every other rep — and the RingCentral desktop
   * app — sees it on their next poll. The override map below is only the
   * seconds before THIS browser's own poll catches up.
   *
   * Opening marks it heard and the menu puts it back (Josh, 2026-09-15:
   * *"opening it marks it read, right clicking and marking it unread puts it
   * back on unread"*) — the same contract the fax list has had since §5.28.
   */
  const setVoicemailRead = useCallback(
    (v: VoicemailRecord, read: boolean) => {
      setVoicemailReadOverrides((m) =>
        new Map(pruneMessageReadOverrides(voicemails.data ?? [], m)).set(v.id, read),
      );
      void setMessageRead(v.id, read)
        .then(() => voicemails.reload())
        .catch((e: unknown) => {
          // A failed write must not leave the row claiming a state RingCentral
          // does not hold — the RC desktop app would disagree with it.
          setVoicemailReadOverrides((m) => {
            if (!m.has(v.id)) return m;
            const next = new Map(m);
            next.delete(v.id);
            return next;
          });
          toast.error(
            `Couldn't mark the voicemail ${read ? "heard" : "unheard"}: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    },
    [voicemails],
  );

  /**
   * Voicemails this session has already marked heard BY OPENING them from a
   * call row.
   *
   * ⚠️ Without it the auto-open below fights the menu: marking one unread flips
   * `voicemailList`, which re-runs the effect, which marks it heard again —
   * a right-click that visibly undoes itself. Opening auto-marks once per
   * message; after that the rep's own judgement stands.
   */
  const autoHeard = useRef<Set<number>>(new Set());

  /**
   * The voicemail a picked CALL left, when it left one. Nothing joins the call
   * log to the message store, so this is a number-and-time match — see
   * `lib/commsHub/callVoicemail`, including why it can be trusted only to fail
   * closed.
   */
  const callVoicemail = useMemo(
    () => voicemailForCall(selectedCall, voicemailList),
    [selectedCall, voicemailList],
  );

  /**
   * A call row that opened a voicemail marks it heard, exactly as clicking the
   * message in the Voicemail list does — seeing it IS opening it.
   *
   * ⚠️ An effect rather than part of the click handler, because the voicemail
   * is DERIVED from the picked call (`voicemailForCall`), so at click time we
   * do not yet know there is one. Guarded by `autoHeard` so it can only ever
   * fire once per message.
   */
  useEffect(() => {
    const v = callVoicemail;
    if (!v || v.read || autoHeard.current.has(v.id)) return;
    autoHeard.current.add(v.id);
    setVoicemailRead(v, true);
  }, [callVoicemail, setVoicemailRead]);

  /** A voicemail row — on the Phone tab and on the VMs log alike. */
  const openVoicemailRow = (phone: string) => {
    setDirectPerson("");
    const vm = voicemailList.find((v) => contactKey(v.fromNumber) === contactKey(phone));
    setSelectedVoicemail(vm ?? null);
    // Opening it IS hearing it (Josh, 2026-09-15) — the same contract the fax
    // list has. Only on a real click, so a right-click → unread on the row a rep
    // is already looking at stays unread until they open it again.
    if (vm && !vm.read) setVoicemailRead(vm, true);
  };

  /** A call row — on the Phone tab and on the Calls log alike. */
  const openCallRow = (call: PickedCall) => {
    setDirectPerson("");
    setSelectedCall(call);
  };

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

  /**
   * The item detail, whichever rail opened it — ONE rendering, so the Inbox and
   * a log row can never show the same item two ways.
   */
  const itemTimeline = (it: InboxItem) => (
    <ItemTimeline
      key={it.key}
      item={it}
      numbers={inboxNumbers}
      active={inboxActive}
      onActive={setActiveHmac}
      onCall={(phone) => void dialNumber(phone)}
      calling={!!inboxActive?.e164 && activeCall?.phone === inboxActive.e164}
      mondayItemId={inboxMondayItemId}
      canText={inboxCanText}
      noteTarget={inboxNoteTarget}
      sticky={sticky}
      onResolved={(r, note) => {
        setSticky({ ...r, key: it.key, note });
        invalidateInbox();
        reloadItem();
      }}
      onUndone={() => {
        stickyRef.current = null;
        setSticky(null);
        inboxChanged();
      }}
      onChanged={inboxChanged}
      refreshSeq={refreshSeq}
    />
  );

  /** What a log row showed before the Inbox existed — the fallback when the
   *  Inbox can't be read, so a log never dead-ends. */
  const legacyLogDetail = () =>
    tab === "vms" ? (
      selectedVoicemail ? <VoicemailDetail voicemail={selectedVoicemail} /> : null
    ) : (
      <>
        {tab === "calls" && callVoicemail && <VoicemailDetail voicemail={callVoicemail} fill={false} />}
        <ConversationThread
          key={logPhone}
          phone={logPhone}
          patient={threadPatient}
          onCall={() => void dialNumber(logPhone)}
          calling={activeCall?.phone === logPhone}
        />
      </>
    );

  return (
    <div className={cn(
      "flex flex-col",
      // Standalone owns the viewport; embedded fills whatever the host gave it.
      embedded ? "min-h-0 flex-1" : "h-screen bg-gradient-subtle",
    )}>
      <header className="shrink-0 border-b border-sidebar-border bg-gradient-navy text-navy-foreground">
        <div className="flex items-center gap-3 px-4 sm:px-6 py-4">
          {/* The one embedded difference: the host's header already has a Back
              that goes to the same place, so two of them stack 45px apart. */}
          {!embedded && (
            <button onClick={goBack} className="rounded-md p-1.5 transition-colors hover:bg-white/10" title="Back">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
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
                  if (e.key === "Enter" && dialTarget) void dialNumber(dialTarget);
                }}
                placeholder="Call any number…"
                aria-label="Call any number"
                className="w-56 rounded-lg bg-white dark:bg-card py-2 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <button
              onClick={() => dialTarget && void dialNumber(dialTarget)}
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
          {(inboxOn ? INBOX_TABS : TABS).map(({ id, label, Icon }) => {
            const active = tab === id;
            const badge =
              id === "inbox"
                ? // The unresolved count, from the same gateway snapshot as the
                  // list's tabs and the header badge — never an unread count.
                  inboxBadge?.open ?? 0
                : id === "fax"
                  ? faxList.filter((f) => !f.read).length
                  : // ⚠️ With the Inbox on, the logs carry no count: Unresolved
                    // is the one "needs attention" number (Josh's D4). Fax keeps
                    // its unread — a fax never opens an item.
                    inboxOn
                    ? 0
                    : id === "text"
                      ? conversations.filter((c) => c.unread > 0).length
                      : voicemailList.filter((v) => !v.read).length;
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
        <aside
          className={cn(
            "flex w-80 shrink-0 flex-col border-r border-border bg-card",
            // Brandon's grid once the Inbox is on (`.comms.ibcomms`, on EVERY
            // rail): the list is 400px, 340 at ≤1300 and 320 at ≤1100. The
            // Inbox row carries a name, a stage pill and a wait on one line.
            // Off, the list is exactly what it was.
            inboxOn && "min-[1101px]:w-[340px] min-[1301px]:w-[25rem]",
          )}
        >
          {tab === "inbox" && (
            <InboxList
              data={inboxList.data}
              stale={inboxList.stale}
              loading={inboxList.loading}
              error={inboxList.error}
              onReload={inboxList.reload}
              query={{ ...inboxQuery, sticky: sticky?.key ?? "" }}
              onQuery={(patch) => setInboxQuery((q) => ({ ...q, ...patch }))}
              search={inboxSearch}
              onSearch={setInboxSearch}
              selectedKey={selectedKey}
              stickyKey={sticky?.key ?? ""}
              onSelect={(row: InboxRow) => openItem(row.key)}
            />
          )}

          {tab === "text" && composing && (
            <NewTextPanel
              query={composeQuery}
              onQuery={setComposeQuery}
              typedNumber={composeNumber}
              hits={nameHits}
              searching={searchingNames}
              onPick={startConversation}
              onClose={() => {
                setComposing(false);
                setComposeQuery("");
              }}
            />
          )}

          {tab === "text" && !composing && (
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
                naming={namingProgress}
                onCompose={() => setComposing(true)}
                logFilter={inboxOn ? textLog : undefined}
                onLogFilter={inboxOn ? setTextLog : undefined}
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
                        setDirectPerson("");
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
                        setDirectPerson(p.name);
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
              voicemails={voicemailList}
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
              onSelect={openVoicemailRow}
              onSelectCall={openCallRow}
              onSetVoicemailRead={setVoicemailRead}
              query={phoneQuery}
              onQuery={setPhoneQuery}
              missedOnly={missedOnly}
              onMissedOnly={setMissedOnly}
              names={directoryNames}
              naming={namingProgress}
            />
          )}

          {/* The Calls and VMs LOGS, once the Inbox is on — Phone's two halves
              as their own rails, with the log filters (Josh's D4). Same panel,
              same rows, same downloads and heard/unheard; a row opens the
              item. */}
          {(tab === "calls" || tab === "vms") && (
            <PhonePanel
              mode={tab === "calls" ? "calls" : "voicemail"}
              onMode={() => {}}
              log={{ callFilter: callLog, onCallFilter: setCallLog }}
              calls={calls.data}
              voicemails={voicemailList}
              loading={tab === "calls" ? calls.loading : voicemails.loading}
              error={tab === "calls" ? calls.error : voicemails.error}
              onReload={tab === "calls" ? calls.reload : voicemails.reload}
              selectedKey={
                tab === "vms"
                  ? selectedVoicemail
                    ? contactKey(selectedVoicemail.fromNumber)
                    : null
                  : selectedCallPhone
                    ? contactKey(selectedCallPhone)
                    : null
              }
              onSelect={openVoicemailRow}
              onSelectCall={openCallRow}
              onSetVoicemailRead={setVoicemailRead}
              query={phoneQuery}
              onQuery={setPhoneQuery}
              missedOnly={missedOnly}
              onMissedOnly={setMissedOnly}
              names={directoryNames}
              naming={namingProgress}
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
              view={faxView}
              onView={setFaxView}
              outbound={outboundRows}
              outboundLoading={outboundFaxes.loading}
              onSetRead={setFaxRead}
            />
          )}
        </aside>

        {/* ── Detail pane ───────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col border-r border-border">
          {tab === "inbox" &&
            (!selectedKey ? (
              <HubIdle
                title="Inbox"
                hint="Every inbound text, missed call and voicemail lands here until someone marks it resolved."
              />
            ) : inboxItem.moved ? (
              <ItemMoved moved={inboxItem.moved} onOpen={(k) => openItem(k)} />
            ) : !item ? (
              inboxItem.error ? (
                <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {inboxItem.error}{" "}
                  <button onClick={reloadItem} className="underline">
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                </div>
              )
            ) : (
              itemTimeline(item)
            ))}

          {/* A LOG rail with the Inbox on: the row opens its number's item —
              the same timeline, composer and resolve bar as the Inbox. If the
              Inbox can't be read, the rep still gets the thread they clicked,
              exactly as before the Inbox existed: a log must never dead-end. */}
          {logRail &&
            (!logPhone ? (
              <HubIdle
                title={tab === "calls" ? "Calls" : tab === "vms" ? "Voicemails" : "Texts"}
                hint={
                  tab === "calls"
                    ? "Every call, inbound and outbound. Pick one to see the whole conversation with that person."
                    : tab === "vms"
                      ? "Pick a message to hear it with the whole conversation around it."
                      : "Pick a conversation to see the whole thread — texts, calls and voicemails together."
                }
              />
            ) : inboxItem.moved ? (
              <ItemMoved moved={inboxItem.moved} onOpen={() => logItemKey.reload()} />
            ) : logItemKey.error || inboxItem.error ? (
              <>
                <div className="shrink-0 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  The Inbox couldn&apos;t open this, so here is the thread on its own.{" "}
                  <span className="opacity-75">{logItemKey.error || inboxItem.error}</span>{" "}
                  <button onClick={() => (logItemKey.error ? logItemKey.reload() : reloadItem())} className="underline">
                    Try again
                  </button>
                </div>
                {legacyLogDetail()}
              </>
            ) : !item ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening…
              </div>
            ) : (
              itemTimeline(item)
            ))}

          {tab === "text" &&
            !logRail &&
            (selectedPhone ? (
              <ConversationThread
                key={selectedPhone}
                phone={selectedPhone}
                patient={threadPatient}
                onCall={() => void dialNumber(selectedPhone)}
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
              /* A call that left a voicemail opens the message AND the thread
                 under it (Josh, 2026-09-15) — the rep hears what they wanted
                 and replies without leaving the row. `callVoicemail` is null
                 for every other call, so this is the old layout exactly. */
              <>
                {callVoicemail && <VoicemailDetail voicemail={callVoicemail} fill={false} />}
                <ConversationThread
                  key={selectedCallPhone}
                  phone={selectedCallPhone}
                  patient={threadPatient}
                  onCall={() => void dialNumber(selectedCallPhone)}
                  calling={activeCall?.phone === selectedCallPhone}
                />
              </>
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
        {/* Off: 30% wider than the original clamp(18rem,28%,26rem) (Josh,
            2026-09-01) — the pane carries the per-stage call detail, not just
            notes — and exactly that, unchanged.
            On: Brandon's grid (Josh, 2026-09-23: "make the right profile view
            bigger to match his spec"). His `.comms.ibcomms` gives the thread and
            the profile the width left after the list in EQUAL halves (`1fr
            1fr`), which is what `flex-1` beside the thread's `flex-1` does.
            ⚠️ With today's clamp as a FLOOR: his halves are wider than the
            clamp only from ~1536px up (1920: 544 → 728px) and a little
            narrower below it (1440: 518 → 488), so the floor is what keeps
            "bigger" true at every width — identical to his where his is
            bigger, today's width where it is not. ⚠️ He hides the profile at
            ≤1100px; this keeps it from 1024 (lg) as before, because the pane
            carries the notes box, the household switcher and the
            unknown-number flow (plan §7), which the thread cannot. */}
        <aside
          className={cn(
            "hidden flex-col border-l border-border bg-card lg:flex",
            inboxOn ? "min-w-[clamp(23.5rem,36%,34rem)] flex-1" : "w-[clamp(23.5rem,36%,34rem)] shrink-0",
          )}
          data-hub-profile-pane
        >
          {/* With the Inbox on, the pane is the patient screen itself
              (COMMS_INBOX_PLAN.md §7) under the mockup's header; off, it is the
              profile pane exactly as it was. */}
          {inboxOn ? (
            <HubPatientPaneHeader
              dossier={tab === "fax" || (tab === "inbox" && !item) ? null : dossier.dossier}
            />
          ) : (
            <div className="shrink-0 border-b border-border px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Command Center profile
              </p>
            </div>
          )}
          {tab === "inbox" ? (
            !item ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <User className="h-7 w-7 text-muted-foreground/50" />
                <p className="max-w-[26ch] text-xs text-muted-foreground">Open an item to see the patient profile.</p>
              </div>
            ) : inboxPick && dossier.loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking them up…
              </div>
            ) : (
              <>
                {/* An unmatched number, once the rep has found who it is: the
                    three ways out, over the profile they would be writing to. */}
                {isUnmatchedKey(item.key) && inboxFindPick && dossier.dossier && inboxActive?.e164 && (
                  <AddNumberCard
                    key={`${item.key}:${inboxFindPick.itemId}`}
                    itemKey={item.key}
                    number={inboxActive.e164}
                    dossier={dossier.dossier}
                    onLinked={(k) => openItem(k)}
                    onPickAgain={() => setInboxFindPick(null)}
                  />
                )}
                <HubPatientPane
                  dossier={dossier.dossier}
                  people={dossier.people}
                  selected={dossier.selected}
                  onSelectPerson={dossier.selectPerson}
                  loading={dossier.loading}
                  error={dossier.error}
                  phone={inboxActive?.e164 || dossier.dossier?.phone || null}
                  picked={isUnmatchedKey(item.key) ? inboxFindPick : null}
                  onClearPick={isUnmatchedKey(item.key) ? () => setInboxFindPick(null) : undefined}
                  onPick={
                    isUnmatchedKey(item.key)
                      ? (row) => setInboxFindPick({ itemId: row.id, boardId: row.boardId, name: row.name, phone: row.phone })
                      : undefined
                  }
                  onReload={dossier.reload}
                />
              </>
            )
          ) : tab === "fax" ? (
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
            <>
              {/* A log row for a number on no board, once the rep has found who
                  it is through the pane's own search: the same three ways out as
                  the Inbox's (plan §6). Nothing is written until a button is
                  pressed; without the Inbox this card never appears and the
                  search stays find-without-writing, as it always was (§5.28). */}
              {logRail && item && isUnmatchedKey(item.key) && dossierPick && dossier.dossier && inboxActive?.e164 && (
                <AddNumberCard
                  key={`${item.key}:${dossierPick.itemId}`}
                  itemKey={item.key}
                  number={inboxActive.e164}
                  dossier={dossier.dossier}
                  onLinked={() => logItemKey.reload()}
                  onPickAgain={() => setDossierPick(null)}
                />
              )}
              {inboxOn ? (
                <HubPatientPane
                  dossier={dossier.dossier}
                  people={dossier.people}
                  selected={dossier.selected}
                  onSelectPerson={dossier.selectPerson}
                  loading={dossier.loading}
                  error={dossier.error}
                  phone={selectedPhone || null}
                  picked={dossierPick}
                  onClearPick={() => setDossierPick(null)}
                  onPick={(row) =>
                    setDossierPick({ itemId: row.id, boardId: row.boardId, name: row.name, phone: row.phone })
                  }
                  onReload={dossier.reload}
                />
              ) : (
                <PatientDossierPanel
                  dossier={dossier.dossier}
                  people={dossier.people}
                  selected={dossier.selected}
                  onSelectPerson={dossier.selectPerson}
                  loading={dossier.loading}
                  error={dossier.error}
                  phone={selectedPhone || null}
                  picked={dossierPick}
                  onClearPick={() => setDossierPick(null)}
                  onPick={(row) =>
                    setDossierPick({ itemId: row.id, boardId: row.boardId, name: row.name, phone: row.phone })
                  }
                />
              )}
            </>
          )}
        </aside>
      </div>

      <RingPreferencesDialog open={ringSettings} onOpenChange={setRingSettings} />

      {/* The live-call overlay is mounted app-wide by IncomingCallHost — an
          answered inbound call needs it on every page, and two overlays for one
          call is worse than none (§5.13b). */}
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
