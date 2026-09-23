import { HOME_VIEW_LABEL, withAbility, withAdmin, withHomeView } from "@/lib/shell/abilities";
/**
 * Per-email access control, persisted to the repo (public/data/access.json)
 * via the GitHub Contents API (same cross-device sync pattern as the rest), so it syncs
 * across devices.
 *
 * Model:
 *   managers   — emails that see the FULL Command Center (current UI).
 *   processors — email → { name, roles[] }: a tailored "profile". On sign-in
 *                they see ONLY those role bars, no side column.
 *   anyone NOT listed → NO ACCESS until a manager assigns them.
 *
 * Bootstrap: while access.json is empty (no managers, no processors) EVERYONE
 * is treated as a manager, so the first admin can sign in and configure it.
 * The Access admin page refuses to save a config that would lock the current
 * user out.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dataRepoName } from "./shared/dataRepo";
import { FILE_PROXY_URL } from "./shared/mondayAssets";

// Access config is read/written through the monday-file-proxy worker's /gh-state
// endpoint, which holds the GitHub token SERVER-SIDE — the browser no longer
// ships one. The worker allowlists repo + file, so this can only ever touch
// public/data/access.json in the two Command Center repos.
const BRANCH = "main";
const ACCESS_URL = `${FILE_PROXY_URL}/gh-state?repo=${dataRepoName()}&file=access`;
const POLL_INTERVAL = 10_000;

/** Per-role escalation scope a processor sees for a given role.
 *  "nonEscalated" = today's processor view (escalated hidden);
 *  "escalated"    = only escalated (today's manager view);
 *  "all"          = both. */
export type EscalationFilter = "all" | "nonEscalated" | "escalated";

/**
 * Per-role CROSS-SELL scope — Welcome Call only (Katie + Brandon, 2026-09-21:
 * Corey takes the cross-sell calls, somebody else takes the rest).
 *
 * ⚠️ This is a FILTER over the one queue, never an assignment. Per-patient
 * ownership was built once and removed in Aug 2026 (§5.13), and §5.30 records
 * the standing rule for a second person on a queue: "a FILTER over these same
 * lists — never routing". Concretely: a cross-sell patient is still sitting in
 * the ordinary Welcome Call queue for anyone else holding the role, so Corey
 * being out does not strand them in a bucket nobody looks at — and the role
 * count, the burndown, Oversight and both baseline generators stay whole, so
 * there is no §5.8 counting-contract change.
 *
 * ⚠️ These COMPOSE WITH the escalation scope rather than replacing it.
 * `viewFilterFromParams` recognises only the three escalation values, so both
 * of these fall through to "nonEscalated" there — which means an escalated
 * cross-sell patient is the manager's, exactly as any other escalated patient
 * is (§5.34), and every slice that does not know about cross-sell is untouched
 * by construction.
 */
export type CrossSellScope = "crossSell" | "nonCrossSell";

/** What `/access` stores per (person, role). */
export type RoleFilter = EscalationFilter | CrossSellScope;

export interface ProcessorProfile {
  name: string;
  roles: string[];
  /** Per-role filter. A role missing here defaults to "nonEscalated". */
  roleFilters?: Record<string, RoleFilter>;
  /** Per-role SOP order number (1,2,3…). Missing → falls back to config order. */
  roleOrder?: Record<string, number>;
  /**
   * Direct number RingCentral rings to reach this person on a click-to-call
   * (RingOut's `from` leg — desk line or cell).
   *
   * ⚠️ This is NOT the number the patient sees. Patients always see the MM
   * number, which RingOut sends as `callerId`. Left blank, click-to-call falls
   * back to the MM main number — calls still work, but the main line rings and
   * whoever picks up there gets bridged instead of this person.
   */
  phoneNumber?: string;
  /**
   * Which abilities this person has (§5.39c). ⚠️ **ABSENT MEANS ON**, and an
   * individual key absent means on too — see `abilities.ts`. Only an explicit
   * `false` takes something away, because every access.json written before this
   * shipped has no `perms` at all and reading that as "no abilities" would fail
   * the whole company closed on one deploy.
   */
  perms?: Partial<Record<Ability, boolean>>;
  /**
   * Which home view(s) this person gets (§5.39c). Missing or empty → `["bars"]`,
   * today's role bars, which is what everybody has now. Two or more puts a
   * toggle on top of the home screen.
   */
  homeView?: HomeView[];
}

/**
 * The abilities a person can be given (§5.39c), from Brandon's 2026-09-18
 * mockup. ⚠️ **They unlock buttons; they never hide information** — his own
 * wording, and the reason there is no "can see patients" ability here.
 */
export type Ability =
  /** Text and call patients from the patient screen. */
  | "comms"
  /** Adjust an open order — the backorder substitution pick (§5.35). */
  | "adjustOrders"
  /** The "Viewing: <person>" dropdown on the home screen. */
  | "viewOthers"
  /** Open Reports & Metrics. */
  | "reports"
  /** Open Stage Manager — move a patient between stages by hand. */
  | "stageManager"
  /** Open Inventory — the Cardinal SKU tracker. */
  | "inventory"
  /** Change the Subscription profile; without it that page is read-only. */
  | "editProfile";

export const ABILITIES: readonly Ability[] = [
  "comms",
  "adjustOrders",
  "viewOthers",
  "reports",
  "stageManager",
  "inventory",
  "editProfile",
] as const;

/** Which screen a person lands on (§5.39c). */
export type HomeView = "bars" | "coordinator" | "oversight";
export const HOME_VIEWS: readonly HomeView[] = ["bars", "coordinator", "oversight"] as const;

export interface AccessConfig {
  managers: string[];
  processors: Record<string, ProcessorProfile>;
  /**
   * Who answers the main line IN THE BROWSER (§5.13b) — and, since 2026-09-14,
   * the only people who are shown an incoming call at all. Assigned by a
   * manager, never self-service, and capped at MAX_CALL_ANSWERERS because
   * every browser here registers as the SAME RingCentral extension, which
   * allows five devices. Managers and processors alike; a manager is not
   * exempt from the cap.
   */
  callAnswerers: string[];
  /**
   * Who may open User management and change anyone else's bars, abilities and
   * home view (§5.39c).
   *
   * ⚠️ **EMPTY MEANS EVERY MANAGER IS AN ADMIN**, deliberately — the same
   * bootstrap reasoning as `noManagers` above. The first deploy reads an
   * access.json with no `admins` key at all, and a strict read would lock every
   * manager out of the page that sets it.
   */
  admins?: string[];
}

/**
 * RingCentral's per-extension SIP registration limit. A sixth device is
 * refused with `603 Too Many Contacts`. Five people is the most that can be
 * promised a ring; each browser a person opens takes a slot of its own, so the
 * admin page says so beside the count.
 */
export const MAX_CALL_ANSWERERS = 5;
export type Access =
  | { type: "manager" }
  | { type: "processor"; profile: ProcessorProfile }
  | { type: "none" };

export const EMPTY_ACCESS: AccessConfig = { managers: [], processors: {}, callAnswerers: [] };

function norm(e: string): string {
  return (e || "").trim().toLowerCase();
}

/** Is this person set up to answer (and be shown) incoming calls? */
export function canAnswerCalls(email: string, cfg: AccessConfig): boolean {
  const e = norm(email);
  return !!e && (cfg.callAnswerers || []).some((a) => norm(a) === e);
}

/**
 * The config with `email` added to / removed from the call answerers — or
 * `null` when adding would exceed the cap. Pure, so the cap is testable; the
 * hook's setter and the admin page both go through it, and RingCentral's own
 * refusal (§5.13b) stays the backstop for the cases this cannot see, such as
 * one person opening the app on three machines.
 */
export function withCallAnswerer(cfg: AccessConfig, email: string, on: boolean): AccessConfig | null {
  const e = norm(email);
  if (!e) return cfg;
  const cur = (cfg.callAnswerers || []).map(norm);
  const has = cur.includes(e);
  if (on === has) return cfg;
  if (on) {
    if (cur.length >= MAX_CALL_ANSWERERS) return null;
    return { ...cfg, callAnswerers: [...cur, e] };
  }
  return { ...cfg, callAnswerers: cur.filter((a) => a !== e) };
}

/** The config with every trace of `email` removed — manager flag, processor
 *  profile AND the call-answerer slot, so removing a person frees their slot. */
export function configWithoutEmail(cfg: AccessConfig, email: string): AccessConfig {
  const e = norm(email);
  const processors = { ...cfg.processors };
  const pk = Object.keys(processors).find((k) => norm(k) === e);
  if (pk) delete processors[pk];
  // ⚠️ Spread first: this used to rebuild the config from three keys and so
  // dropped `admins` for EVERYONE whenever anybody was removed.
  return {
    ...cfg,
    managers: cfg.managers.filter((m) => norm(m) !== e),
    processors,
    callAnswerers: (cfg.callAnswerers || []).filter((a) => norm(a) !== e),
    ...(cfg.admins ? { admins: cfg.admins.filter((a) => norm(a) !== e) } : {}),
  };
}

/** Bootstrap window: until at least one MANAGER exists, everyone is treated as
 *  a manager — so the first admin can sign in and configure, and adding
 *  processors alone can never lock the admin out. */
function noManagers(cfg: AccessConfig): boolean {
  return !cfg.managers || cfg.managers.length === 0;
}

/** Resolve what a given email is allowed to see. */
export function resolveAccess(email: string, cfg: AccessConfig): Access {
  const e = norm(email);
  if (noManagers(cfg)) return { type: "manager" }; // bootstrap — first admin sets things up
  if ((cfg.managers || []).some((m) => norm(m) === e)) return { type: "manager" };
  const procKey = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  if (procKey) return { type: "processor", profile: cfg.processors[procKey] };
  return { type: "none" };
}

/** What access.json held at `sha`. The pair is only ever set TOGETHER, from one
 *  read or one successful write, because every save is built on it: GitHub
 *  accepts a PUT only while `sha` is still the file's current one, so a save
 *  that lands is a save whose `data` really was the file it replaced. */
interface AccessFile {
  data: AccessConfig;
  sha: string | null;
}

/**
 * ⚠️ Decides nothing — the caller decides whether this read is one to believe.
 * GitHub's contents API can answer a GET with the PREVIOUS version for several
 * seconds after a PUT; a poll that stored that stale sha made the next save
 * 409, and the edit silently failed (§5.39j).
 */
async function fetchAccess(): Promise<AccessFile> {
  const res = await fetch(`${ACCESS_URL}&t=${Date.now()}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    return { data: { ...EMPTY_ACCESS }, sha: null };
  }
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const json = await res.json();
  const parsed = JSON.parse(atob(json.content));
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return {
    data: {
      // ⚠️⚠️ **EVERY TOP-LEVEL KEY THE FILE CARRIES, named below or not.** A save
      // writes back the config it read, so a key this read dropped was deleted
      // from the file by the next save from this browser — including the merge
      // after a conflict, which is the one write that exists to keep other
      // people's changes. The keys below are NORMALISED on top of that; a key
      // this build has never heard of is carried through untouched.
      ...raw,
      managers: raw.managers ?? [],
      processors: raw.processors ?? {},
      // Absent on a file written before 2026-09-14 (and on prod until its own
      // admin sets one): nobody is assigned, nobody is rung. Never inferred.
      callAnswerers: Array.isArray(raw.callAnswerers) ? raw.callAnswerers : [],
      // ⚠️⚠️ **A TOP-LEVEL KEY THE APP READS HAS TO BE NORMALISED HERE.** `admins`
      // shipped (2026-09-18) when this read was a strict whitelist: the toggle
      // wrote the file correctly and the list vanished a few seconds later, with
      // nothing erroring — a setting that will not stick and does not say why.
      // The spread above now keeps an unnamed key in the FILE, but the app still
      // only sees a key typed and read here. `perms` and `homeView` ride INSIDE
      // `processors`, so they need nothing.
      admins: Array.isArray(raw.admins) ? raw.admins.filter((a: unknown) => typeof a === "string") : undefined,
    },
    sha: json.sha,
  };
}

function putAccess(data: AccessConfig, sha: string | null): Promise<Response> {
  return fetch(ACCESS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Update access config",
      content: btoa(JSON.stringify(data, null, 2)),
      ...(sha ? { sha } : {}),
      branch: BRANCH,
    }),
  });
}

/** GitHub refusing a PUT because the file moved on: 409 for a sha that is no
 *  longer current, 422 for no sha on a file that exists. */
const isShaConflict = (status: number) => status === 409 || status === 422;

/** Re-reads after a conflict. The first is immediate, the rest back off,
 *  because the re-read itself can come back stale for a moment after a PUT. */
const MAX_CONFLICT_RETRIES = 3;

/** Do these two configs serialise to the same file? */
function sameConfig(a: AccessConfig, b: AccessConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One admin action as a pure `config → config` function.
 *
 * ⚠️⚠️ **IT MAY BE RE-RUN ON A NEWER CONFIG THAN THE ONE IT WAS CLICKED ON** —
 * that is how a save merges with another admin's (see `useAccess`). So it must
 * say what the admin MEANT, "turn X on", never "flip X": re-run as a toggle on
 * top of another admin's identical click, it would undo both.
 *   · the same object back → nothing to change, it is already so
 *   · `null` → refused on this config (e.g. the answering slots are full)
 */
type AccessEdit = (cfg: AccessConfig) => AccessConfig | null;

interface PendingEdit {
  seq: number;
  apply: AccessEdit;
  /** What to tell the admin when a merge refuses it, given the config it was
   *  refused on. */
  refusal?: (cfg: AccessConfig) => string;
}

const REFUSED_FALLBACK =
  "Another admin changed access at the same time, so one of your changes no longer applied. Check it and try again.";

/** Run edits, in order, on top of `base`. A refused one changes nothing and
 *  leaves the sentence that says why. */
function replayEdits(base: AccessConfig, edits: readonly PendingEdit[]): { config: AccessConfig; refusals: string[] } {
  let config = base;
  const refusals: string[] = [];
  for (const edit of edits) {
    const next = edit.apply(config);
    if (next) config = next;
    else refusals.push(edit.refusal?.(config) ?? REFUSED_FALLBACK);
  }
  return { config, refusals };
}

/** Somebody on the /access page at all — a manager, a processor, or both. */
function isPerson(cfg: AccessConfig, email: string): boolean {
  const e = norm(email);
  return (cfg.managers || []).some((m) => norm(m) === e) || Object.keys(cfg.processors || {}).some((k) => norm(k) === e);
}

/** Set (never toggle — see `AccessEdit`) one role on a person, creating their
 *  processor profile when there is none, so a pure manager can be given roles
 *  and become dual. Removing a role also prunes its filter/order so stale
 *  settings don't linger. */
function withProcessorRole(cfg: AccessConfig, email: string, roleId: string, on: boolean): AccessConfig {
  const e = norm(email);
  const pk = Object.keys(cfg.processors).find((k) => norm(k) === e) || e;
  const cur = cfg.processors[pk] ?? { name: e.split("@")[0], roles: [] };
  if (cur.roles.includes(roleId) === on) return cfg;
  const next: ProcessorProfile = { ...cur, roles: on ? [...cur.roles, roleId] : cur.roles.filter((r) => r !== roleId) };
  if (!on) {
    if (cur.roleFilters) { const rf = { ...cur.roleFilters }; delete rf[roleId]; next.roleFilters = rf; }
    if (cur.roleOrder) { const ro = { ...cur.roleOrder }; delete ro[roleId]; next.roleOrder = ro; }
  }
  return { ...cfg, processors: { ...cfg.processors, [pk]: next } };
}

/**
 * How long after our own last save a poll result is ignored. GitHub can serve
 * the previous version of the file for a while after a write, and applying it
 * put a just-ticked chip back to how it was — the "click it, it flips back,
 * click it again" report (Josh, 2026-09-23).
 */
const WRITE_QUIET_MS = 30_000;

export function useAccess() {
  const [config, setConfig] = useState<AccessConfig>({ ...EMPTY_ACCESS });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  /* ⚠️⚠️ **LOCAL EDITS MUST WIN OVER THE POLL** (§5.39j). The 10s poll used to
     `setConfig` whatever GitHub answered, so a poll that had STARTED before a
     click — or that read the file before GitHub served the new version —
     overwrote the click. The chip lit up, went back, and the admin clicked it
     again. Three guards: a poll is dropped if any edit happened while it was in
     flight (`editGen`), while a save is still pending (`pendingSaves`), or
     inside `WRITE_QUIET_MS` of our own last save (`lastWriteAt`). */
  const configRef = useRef<AccessConfig>(config);
  const editGen = useRef(0);
  const pendingSaves = useRef(0);
  const lastWriteAt = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  /* ⚠️⚠️ **A SHA CONFLICT IS A MERGE, NEVER A RE-SEND.** A 409 used to be
     retried by re-reading only the SHA and PUTting this browser's whole config
     again, so whatever another admin had saved in between — a role, an
     ability, a manager, an answering slot — was overwritten, and it vanished
     from both screens with nothing erroring (Greptile on
     medically-modern/command-center-test PR #58).
     So a save carries its EDITS, not a config. `file` is what access.json held
     at `file.sha`; `pending` is every edit made here that the file is not yet
     known to hold; and what is on screen is always `pending` re-run on `file`.
     A save writes exactly that. On a conflict it re-reads the file, re-runs
     `pending` on what is there now — the screen shows the merge straight away —
     and writes again. The sha is what makes it safe: GitHub accepts the PUT only
     while the file still is `file`, so a write that lands merged everything. */
  const fileRef = useRef<AccessFile>({ data: config, sha: null });
  const pendingRef = useRef<PendingEdit[]>([]);
  const nextSeq = useRef(1);

  useEffect(() => {
    let mounted = true;
    const load = async (initial: boolean) => {
      const gen = editGen.current;
      try {
        const file = await fetchAccess();
        if (!mounted) return;
        const stale =
          !initial &&
          (gen !== editGen.current ||
            pendingSaves.current > 0 ||
            Date.now() - lastWriteAt.current < WRITE_QUIET_MS);
        if (stale) return;
        fileRef.current = file;
        // A poll lands only when no save is pending, so an edit still listed is
        // one whose save FAILED (and said so): the file is the truth, as it
        // always was. The first load keeps them — they were made before it
        // answered, and their save will merge them onto this file.
        if (!initial) pendingRef.current = [];
        configRef.current = replayEdits(file.data, pendingRef.current).config;
        setConfig(configRef.current);
      } catch (e) {
        if (initial) console.error("Failed to load access config:", e);
      } finally {
        if (initial && mounted) setLoading(false);
      }
    };
    void load(true);
    pollRef.current = setInterval(() => void load(false), POLL_INTERVAL);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /** Write every pending edit onto the file, merging on a conflict. */
  const flush = useCallback(async () => {
    for (let attempt = 0; ; attempt++) {
      const edits = pendingRef.current.slice();
      if (edits.length === 0) return; // an earlier save already wrote them
      const file = fileRef.current;
      const { config: body, refusals } = replayEdits(file.data, edits);
      // ⚠️ Written even when the merge left nothing of ours to add (another
      // admin made the same change, or ours was refused): the sha is how GitHub
      // confirms `file` really is the file, and every decision above was made
      // against it. A re-read can be stale; skipping the write would trust it.
      // An unchanged file keeps its blob sha, so nobody else's save is upset.
      const res = await putAccess(body, file.sha);
      if (res.ok) {
        // A write that landed is never reported as failed over its receipt.
        const json = await res.json().catch(() => ({}));
        fileRef.current = { data: body, sha: json.content?.sha ?? file.sha };
        // Edits made while this save was out stay pending, for the next one.
        const upTo = edits[edits.length - 1].seq;
        pendingRef.current = pendingRef.current.filter((e) => e.seq > upTo);
        // Refused on the file that was actually written, not a guess: say so
        // rather than let a ticked chip quietly untick.
        for (const msg of new Set(refusals)) toast.error(msg);
        return;
      }
      if (!isShaConflict(res.status) || attempt >= MAX_CONFLICT_RETRIES) {
        throw new Error(`Access save failed: ${res.status}`);
      }
      // The file moved on. Re-read it and re-run every pending edit on it —
      // including any made while this save was out — then write that.
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      const latest = await fetchAccess();
      // ⚠️ A file that has vanished is not an empty config to merge onto:
      // re-create it from ours rather than write our few edits over nothing.
      fileRef.current = latest.sha === null ? { data: file.data, sha: null } : latest;
      configRef.current = replayEdits(fileRef.current.data, pendingRef.current).config;
      setConfig(configRef.current);
    }
  }, []);

  /* ⚠️ The save is a SIDE EFFECT and lives outside the state updater — React
     may run an updater twice (StrictMode), which sent every change twice.
     Saves are SERIALISED and each writes the LATEST config, so two quick clicks
     can never land out of order and have the older one overwrite the newer. */
  const mutate = useCallback((apply: AccessEdit, refusal?: (cfg: AccessConfig) => string) => {
    const prev = configRef.current;
    const next = apply(prev);
    // Refused, or nothing to change. Neither is recorded: a click that changed
    // nothing here must not be replayed over another admin's save later.
    if (!next || next === prev || sameConfig(next, prev)) return;
    configRef.current = next;
    pendingRef.current.push({ seq: nextSeq.current++, apply, refusal });
    editGen.current += 1;
    lastWriteAt.current = Date.now();
    setConfig(next);
    pendingSaves.current += 1;
    saveChain.current = saveChain.current
      .then(() => flush())
      .catch((e) => {
        console.error("Failed to save access:", e);
        toast.error("Couldn't save that access change. Refresh the page and try again.");
      })
      .finally(() => {
        pendingSaves.current -= 1;
        lastWriteAt.current = Date.now();
      });
  }, [flush]);

  /**
   * An edit to somebody already on the page.
   *
   * ⚠️⚠️ **REMOVAL WINS.** Several of the writers below CREATE a processor
   * entry when there is none (a role, an ability, a home view, a demotion), so
   * re-run on a file where another admin has since REMOVED the person, they
   * would bring that person back — with an entry, which `resolveAccess` reads
   * as permission to sign in. Removing somebody is a decision about access;
   * a chip ticked a second earlier by an admin who had not seen it must not
   * quietly undo it. So the merge refuses the edit, and says why.
   */
  const editPerson = useCallback((email: string, apply: AccessEdit, refused?: string) => {
    const e = norm(email);
    if (!e) return;
    mutate(
      (cfg) => (isPerson(cfg, e) ? apply(cfg) : null),
      (cfg) =>
        isPerson(cfg, e)
          ? refused ?? REFUSED_FALLBACK
          : `${e} was removed by another admin at the same time, so your change to them wasn't saved.`,
    );
  }, [mutate]);

  /** Add to managers WITHOUT touching any processor profile — a person can be
   *  both (manager view on login, still listed/assigned as a processor). */
  const addManager = useCallback((email: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const managers = prev.managers.some((m) => norm(m) === e) ? prev.managers : [...prev.managers, e];
      return { ...prev, managers };
    });
  }, [mutate]);

  /**
   * Toggle the manager flag on/off without disturbing the processor profile.
   *
   * ⚠️⚠️ **DEMOTING SOMEBODY WITH NO PROCESSOR ENTRY USED TO DELETE THEM**
   * (Josh, 2026-09-19: *"i removed corey as a manager and his profile
   * disappeared"*). The People list on `/access` is the UNION of `managers[]`
   * and `processors{}`, so a pure manager — somebody added with "Add as
   * Manager" and never given bars — existed in that one array and nowhere
   * else. Unticking Manager dropped the only record of them: their card
   * vanished, `resolveAccess` returned `{type:"none"}`, and they were signed
   * out of the whole app by a checkbox that says nothing about access.
   *
   * So a demotion now leaves a processor entry behind (no roles, no abilities
   * touched). That is what "not a manager" means here — an ordinary person with
   * nothing assigned yet — and it keeps them on the page, editable, one click
   * from being given bars. **Removing somebody is the Remove button**, which
   * still wipes every trace (`configWithoutEmail`); a demotion is not a delete.
   */
  const setManager = useCallback((email: string, isManager: boolean) => {
    const e = norm(email);
    if (!e) return;
    editPerson(e, (prev) => {
      const has = prev.managers.some((m) => norm(m) === e);
      let managers = prev.managers;
      if (isManager && !has) managers = [...prev.managers, e];
      else if (!isManager && has) managers = prev.managers.filter((m) => norm(m) !== e);
      if (isManager) return { ...prev, managers };
      // ⚠️ Fill the gap the demotion would leave, and ONLY that gap: somebody
      // who already has a processor entry keeps it exactly as it is.
      const hasProfile = Object.keys(prev.processors || {}).some((k) => norm(k) === e);
      if (hasProfile) return { ...prev, managers };
      return {
        ...prev,
        managers,
        processors: { ...prev.processors, [e]: { name: e.split("@")[0], roles: [] } },
      };
    });
  }, [editPerson]);

  const removeEmail = useCallback((email: string) => {
    mutate((prev) => configWithoutEmail(prev, email));
  }, [mutate]);

  /**
   * Give (or take back) a person's browser-answering slot. Returns false —
   * and writes nothing — when the five are already taken. Checked against the
   * config on screen for the answer, and again against the FILE when a
   * conflicting save is merged, so two managers editing at once cannot land a
   * sixth between them: the one whose save lands second is refused, and told.
   */
  const setCallAnswerer = useCallback((email: string, on: boolean): boolean => {
    if (!withCallAnswerer(configRef.current, email, on)) return false;
    editPerson(
      email,
      (prev) => withCallAnswerer(prev, email, on),
      on
        ? `Another admin filled the last of the ${MAX_CALL_ANSWERERS} browser-answering slots at the same time, so ${norm(email)} wasn't added.`
        : undefined,
    );
    return true;
  }, [editPerson]);

  /** Add a processor profile WITHOUT removing a manager flag — supports dual. */
  const addProcessor = useCallback((email: string, name: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e) || e;
      return {
        ...prev,
        processors: { ...prev.processors, [pk]: prev.processors[pk] ?? { name: name || e, roles: [] } },
      };
    });
  }, [mutate]);

  const setProcessorName = useCallback((email: string, name: string) => {
    const e = norm(email);
    editPerson(e, (prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      return { ...prev, processors: { ...prev.processors, [pk]: { ...prev.processors[pk], name } } };
    });
  }, [editPerson]);

  /** Toggle a role on/off. Creates the processor profile if missing (so a pure
   *  manager can be given roles and become dual). Removing a role also prunes
   *  its filter/order so stale settings don't linger.
   *  ⚠️ The toggle is resolved HERE, against the config on screen, into "on" or
   *  "off" — the saved edit is a SET (see `AccessEdit`), so a merge re-running
   *  it on top of another admin's identical click leaves the role as both meant. */
  const toggleProcessorRole = useCallback((email: string, roleId: string) => {
    const e = norm(email);
    if (!e) return;
    const cur = configRef.current.processors;
    const pk = Object.keys(cur).find((k) => norm(k) === e);
    const on = !(pk && cur[pk].roles.includes(roleId));
    editPerson(e, (prev) => withProcessorRole(prev, e, roleId, on));
  }, [editPerson]);

  /** Set (or clear, when blank) the number RingCentral rings to reach this
   *  person on a click-to-call. See ProcessorProfile.phoneNumber. */
  const setProcessorPhone = useCallback((email: string, phone: string) => {
    const e = norm(email);
    editPerson(e, (prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const next: ProcessorProfile = { ...cur };
      const trimmed = (phone || "").trim();
      if (trimmed) next.phoneNumber = trimmed;
      else delete next.phoneNumber;
      return { ...prev, processors: { ...prev.processors, [pk]: next } };
    });
  }, [editPerson]);

  /** Set the escalation filter for one of a processor's roles. */
  const setRoleFilter = useCallback((email: string, roleId: string, filter: RoleFilter) => {
    const e = norm(email);
    editPerson(e, (prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const roleFilters = { ...(cur.roleFilters ?? {}), [roleId]: filter };
      return { ...prev, processors: { ...prev.processors, [pk]: { ...cur, roleFilters } } };
    });
  }, [editPerson]);

  /** Set (or clear, when null/NaN) the SOP order number for one role. */
  const setRoleOrder = useCallback((email: string, roleId: string, order: number | null) => {
    const e = norm(email);
    editPerson(e, (prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const roleOrder = { ...(cur.roleOrder ?? {}) };
      if (order == null || Number.isNaN(order)) delete roleOrder[roleId];
      else roleOrder[roleId] = order;
      return { ...prev, processors: { ...prev.processors, [pk]: { ...cur, roleOrder } } };
    });
  }, [editPerson]);

  /* ── Brandon's abilities model (§5.39c) ─────────────────────────────────
     All three write through the pure helpers in `lib/shell/abilities`, which
     own the defaults-ON rule and the "everyone keeps at least one view" refusal.
     ⚠️ A helper returning null means the change was REFUSED (no such processor,
     or it would have removed somebody's last home view). `mutate` records
     nothing for it, and a merge that meets the refusal says so rather than
     writing `prev` back as though it succeeded. */
  const setAbility = useCallback((email: string, ability: Ability, on: boolean) => {
    editPerson(email, (prev) => withAbility(prev, email, ability, on));
  }, [editPerson]);

  const setHomeView = useCallback((email: string, view: HomeView, on: boolean) => {
    editPerson(
      email,
      (prev) => withHomeView(prev, email, view, on),
      on
        ? undefined
        : `${HOME_VIEW_LABEL[view]} stayed on for ${norm(email)} — another admin changed their home views at the same time, and turning it off would have left them none.`,
    );
  }, [editPerson]);

  const setAdmin = useCallback((email: string, on: boolean) => {
    editPerson(email, (prev) => withAdmin(prev, email, on));
  }, [editPerson]);

  return {
    config,
    loading,
    addManager,
    setManager,
    removeEmail,
    addProcessor,
    setProcessorName,
    setProcessorPhone,
    toggleProcessorRole,
    setRoleFilter,
    setRoleOrder,
    setCallAnswerer,
    setAbility,
    setHomeView,
    setAdmin,
  };
}
