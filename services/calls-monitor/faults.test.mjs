import { beforeAll, describe, expect, it } from "vitest";

/**
 * The fault rules are the whole point of the monitor: an alert that stays quiet
 * during a real outage is worse than no monitor, because it reads as an
 * all-clear. Each case below is a way inbound calling has failed or can fail.
 */
let faults;
let archiveFaults;
let inboxFaults;
beforeAll(async () => {
  // Stops index.mjs from running a live check on import.
  process.env.CALLS_MONITOR_TEST = "1";
  ({ faults, archiveFaults, inboxFaults } = await import("./index.mjs"));
});

const healthy = {
  configured: true,
  error: null,
  subscriptionId: "sub-1",
  subscriptionStatus: "Active",
  subscribers: 2,
  events: { seen: 40, rings: 6, unparsed: 0 },
};
const ctx = { handshake: true };

describe("faults", () => {
  it("stays quiet when everything is healthy", () => {
    expect(faults(healthy, ctx)).toEqual([]);
  });

  it("reports the gateway being unreachable", () => {
    expect(faults(null, ctx)[0]).toMatch(/did not respond/);
  });

  // The one that matters most: the id survives blacklisting unchanged, so
  // checking only for its presence would report health during a real outage.
  it("catches a blacklisted subscription even though the id is still there", () => {
    const f = faults({ ...healthy, subscriptionStatus: "Blacklisted" }, ctx);
    expect(f.join(" ")).toMatch(/Blacklisted.*not Active/);
  });

  it("catches a missing subscription", () => {
    expect(faults({ ...healthy, subscriptionId: null }, ctx).join(" ")).toMatch(/No RingCentral subscription/);
  });

  it("catches a webhook that stopped answering the handshake", () => {
    const f = faults(healthy, { ...ctx, handshake: false });
    expect(f.join(" ")).toMatch(/validation handshake/);
  });

  it("does not complain when the handshake was not probed", () => {
    expect(faults(healthy, { ...ctx, handshake: null })).toEqual([]);
  });

  // The envelope bug's signature: deliveries land, get acked, get discarded.
  it("catches every event being unparseable", () => {
    const f = faults({ ...healthy, events: { seen: 33, rings: 0, unparsed: 33 } }, ctx);
    expect(f.join(" ")).toMatch(/unparseable/);
  });

  it("does not cry about a quiet line with no events at all", () => {
    expect(faults({ ...healthy, events: { seen: 0, rings: 0, unparsed: 0 } }, ctx)).toEqual([]);
  });

  it("does not cry when some events parse", () => {
    expect(faults({ ...healthy, events: { seen: 10, rings: 2, unparsed: 3 } }, ctx)).toEqual([]);
  });

  it("reports a gateway that says it is unconfigured", () => {
    expect(faults({ ...healthy, configured: false }, ctx).join(" ")).toMatch(/not configured/);
  });

  it("passes a gateway error through verbatim", () => {
    const f = faults({ ...healthy, error: "CallControl permission is required" }, ctx);
    expect(f.join(" ")).toMatch(/CallControl permission is required/);
  });

  it("reports several problems at once rather than only the first", () => {
    const f = faults({ ...healthy, subscriptionStatus: "Suspended", configured: false }, ctx);
    expect(f.length).toBe(2);
  });
  /**
   * The 2026-08-20 page storm. A redeploy landed while RingCentral was
   * throttling the subscription API, so the fresh container's first reconcile
   * took a 429 and its `subscriptionId` stayed null — while RingCentral went on
   * delivering webhooks to that same container. Six alerts said "no calls will
   * arrive"; three real calls rang through, the last of them one minute before
   * an alert. A null id is the GATEWAY's memory, never RingCentral's record.
   */
  describe("a null subscription id it cannot account for", () => {
    const now = Date.parse("2026-08-20T18:10:00.000Z");
    const lostTrack = {
      ...healthy,
      subscriptionId: null,
      subscriptionStatus: null,
      error: "list subscriptions failed (429)",
    };
    const at = (msAgo) => new Date(now - msAgo).toISOString();

    it("does not claim an outage while webhooks are still arriving", () => {
      const f = faults(
        { ...lostTrack, events: { seen: 22, rings: 3, unparsed: 0, lastAt: at(60_000) } },
        { ...ctx, now },
      ).join(" ");
      expect(f).not.toMatch(/no calls will arrive/i);
      expect(f).toMatch(/STILL ARRIVING/);
      expect(f).toMatch(/1 min ago/);
    });

    // Still reported — a gateway out of sync with its own subscription is a
    // real fault. Only the verdict changes, never the fact that it speaks up.
    it("still reports it, and still passes the underlying error through", () => {
      const f = faults(
        { ...lostTrack, events: { seen: 22, rings: 3, unparsed: 0, lastAt: at(60_000) } },
        { ...ctx, now },
      );
      expect(f.length).toBe(2);
      expect(f.join(" ")).toMatch(/list subscriptions failed \(429\)/);
    });

    // No recent events proves nothing either way — that is just a quiet
    // afternoon — so this says "could not check", not "it is down".
    it("says it could not confirm when nothing has arrived lately", () => {
      const f = faults({ ...lostTrack, events: { seen: 0, rings: 0, unparsed: 0 } }, { ...ctx, now }).join(" ");
      expect(f).toMatch(/Could not confirm/);
      expect(f).not.toMatch(/no calls will arrive/i);
    });

    it("does not read a stale event as proof the subscription is alive", () => {
      const f = faults(
        { ...lostTrack, events: { seen: 22, rings: 3, unparsed: 0, lastAt: at(3 * 60 * 60_000) } },
        { ...ctx, now },
      ).join(" ");
      expect(f).toMatch(/Could not confirm/);
      expect(f).not.toMatch(/STILL ARRIVING/);
    });

    // The hard verdict is not softened away: with no id AND no reason offered,
    // there is nothing to explain it and the original sentence stands.
    it("keeps the blunt verdict when the gateway offers no reason", () => {
      const f = faults({ ...healthy, subscriptionId: null }, { ...ctx, now }).join(" ");
      expect(f).toMatch(/No RingCentral subscription exists — no calls will arrive/);
    });
  });
});


/**
 * The call-recording archive. Same discipline as `faults` above, and one extra
 * reason to get it right: a missed inbound-call outage costs a call somebody
 * can ring back, and a missed archive outage costs recordings RingCentral has
 * already deleted by the time anyone notices.
 */
describe("archiveFaults", () => {
  const ok = {
    ok: true,
    storeConfigured: true,
    stored: 5000,
    pending: 0,
    failed: 0,
    gone: 120,
    bytes: 4.2e9,
    reason: null,
  };

  it("stays quiet when the archive is keeping up", () => {
    expect(archiveFaults(ok)).toEqual([]);
  });

  // ⚠️ A backfill looks EXACTLY like a backlog. Paging for one is how a monitor
  // teaches everybody to swipe it away, and the next alert is a real one.
  it("stays quiet during a backfill — a pending queue is not a fault", () => {
    expect(archiveFaults({ ...ok, pending: 4200 })).toEqual([]);
  });

  // ⚠️ Flipping the kill switch during an incident must not start a second
  // alert stream on top of whatever is already going wrong. The gateway keeps
  // answering the route when switched off precisely so this can tell them apart.
  it("stays quiet when the archive is switched off on purpose", () => {
    expect(archiveFaults({ ok: true, enabled: false, reason: "switched off" })).toEqual([]);
    // ...and does not mistake "off" for "no bucket", which IS a fault.
    expect(archiveFaults({ ok: false, enabled: false, storeConfigured: false })).toEqual([]);
  });

  it("speaks up when the archive reports itself not ok, and passes on WHY", () => {
    const f = archiveFaults({ ...ok, ok: false, reason: "last successful run was 31h ago" });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/not being archived/i);
    expect(f[0]).toMatch(/31h ago/);
  });

  it("names the counts, so the push says how bad it is without a second lookup", () => {
    const f = archiveFaults({ ...ok, ok: false, reason: "x", stored: 10, pending: 9, failed: 3 });
    expect(f[0]).toMatch(/10 stored, 9 pending, 3 failed/);
  });

  // The silent misconfiguration: the job is deployed, the gateway is healthy,
  // and nothing has ever been saved because no bucket was wired up.
  it("calls out a missing object store specifically, and stops there", () => {
    const f = archiveFaults({ ...ok, ok: false, storeConfigured: false });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/no object store configured/i);
    expect(f[0]).toMatch(/CALL_ARCHIVE_/);
  });

  // ⚠️ Declaring an outage we have not established is the mirror image of the
  // silence this monitor exists to break (§5.13).
  it("says it could not CHECK when health is unreachable — never that the archive is broken", () => {
    const f = archiveFaults(null);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/could not reach/i);
    expect(f[0]).toMatch(/says nothing about the archive itself/i);
    expect(f[0]).not.toMatch(/not being archived/i);
  });

  it("tolerates a health payload that reports no reason", () => {
    expect(archiveFaults({ ...ok, ok: false, reason: null })[0]).toMatch(/reason not reported/);
  });

  /**
   * ⚠️ ONE rule, TWO archives. Recordings and voicemail have the same failure
   * modes, the same verdict source (`archiveHealth` on the gateway) and the
   * same "a backlog is not a fault" discipline, so a second copy of
   * archiveFaults would be two chances to get the one thing wrong that matters.
   * Only the WORDS differ — because a push that does not say WHICH archive it
   * is about is one somebody reads as whichever they recognise, and these two
   * have very different remedies.
   */
  describe("the voicemail archive rides the same rule under its own name", () => {
    const vmLabels = { noun: "voicemail-archive", notArchived: "Voicemail is not being archived" };

    it("says voicemail, not call recordings", () => {
      const f = archiveFaults({ ...ok, ok: false, reason: "last successful run was 9h ago" }, vmLabels);
      expect(f).toHaveLength(1);
      expect(f[0]).toMatch(/^Voicemail is not being archived/);
      expect(f[0]).not.toMatch(/call recordings/i);
      expect(f[0]).toMatch(/9h ago/);
    });

    it("names the voicemail archive when it cannot be reached", () => {
      expect(archiveFaults(null, vmLabels)[0]).toMatch(/voicemail-archive health check/);
    });

    // ⚠️ Both archives share ONE bucket and one set of credentials, so the
    // remedy really is the CALL_ARCHIVE_* variables even here. Saying anything
    // else would send somebody looking for variables that do not exist.
    it("still points at the shared CALL_ARCHIVE_* variables for a missing bucket", () => {
      const f = archiveFaults({ ...ok, ok: false, storeConfigured: false }, vmLabels);
      expect(f[0]).toMatch(/voicemail-archive/);
      expect(f[0]).toMatch(/CALL_ARCHIVE_/);
    });

    it("keeps every quiet case quiet under the new labels too", () => {
      expect(archiveFaults(ok, vmLabels)).toEqual([]);
      expect(archiveFaults({ ...ok, pending: 300 }, vmLabels)).toEqual([]);
      expect(archiveFaults({ ok: true, enabled: false }, vmLabels)).toEqual([]);
    });
  });

  describe("and so does the MMS media archive", () => {
    const mmsLabels = { noun: "MMS-media-archive", notArchived: "Patient photos are not being archived" };

    it("says photos, not recordings and not voicemail", () => {
      // ⚠️ A push that does not say WHICH archive it is about is one somebody
      // reads as whichever they recognise — which, with three of them on one
      // bucket, is how a real outage gets swiped away as the one already known.
      const f = archiveFaults({ ...ok, ok: false, reason: "the last complete run was 9h ago" }, mmsLabels);
      expect(f).toHaveLength(1);
      expect(f[0]).toMatch(/^Patient photos are not being archived/);
      expect(f[0]).not.toMatch(/call recordings|voicemail/i);
      expect(f[0]).toMatch(/9h ago/);
    });

    it("names the MMS archive when it cannot be reached", () => {
      expect(archiveFaults(null, mmsLabels)[0]).toMatch(/MMS-media-archive health check/);
    });

    it("still points at the shared CALL_ARCHIVE_* variables for a missing bucket", () => {
      const f = archiveFaults({ ...ok, ok: false, storeConfigured: false }, mmsLabels);
      expect(f[0]).toMatch(/MMS-media-archive/);
      expect(f[0]).toMatch(/CALL_ARCHIVE_/);
    });

    it("keeps every quiet case quiet, a backlog included", () => {
      // A backfill looks exactly like a backlog, and this archive starts with
      // one: every photo sms_archive already holds is enqueued on the first run.
      expect(archiveFaults(ok, mmsLabels)).toEqual([]);
      expect(archiveFaults({ ...ok, pending: 4000 }, mmsLabels)).toEqual([]);
      expect(archiveFaults({ ok: true, enabled: false }, mmsLabels)).toEqual([]);
    });
  });
});

describe("inboxFaults — the Communications inbox", () => {
  const ok = { ok: true, enabled: true, stale: false, truncated: false, reason: null, warnings: [] };

  it("is quiet when the gateway says the inbox is healthy", () => {
    expect(inboxFaults(ok)).toEqual([]);
  });

  it("⚠️ never pages on WARNINGS — a note waiting to be copied to Monday is safe where it is", () => {
    expect(inboxFaults({ ...ok, warnings: ["3 note(s) waiting to be copied to Monday, the oldest 30h"] })).toEqual([]);
  });

  it("switched off on purpose is not a fault", () => {
    expect(inboxFaults({ ok: true, enabled: false, reason: "switched off" })).toEqual([]);
  });

  // ⚠️ Switched ON but unable to run (no messaging pool, no pepper) is not "off
  // on purpose": somebody asked for the inbox and is not getting it.
  it("⚠️ pages when the inbox is switched ON but not running", () => {
    const f = inboxFaults({ ok: false, enabled: false, reason: "the Communications inbox is not configured (messaging Postgres or PHONE_HMAC_PEPPER missing)" });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/switched on but not running/);
    expect(f[0]).toMatch(/PHONE_HMAC_PEPPER/);
  });

  it("an archive switched off is a WARNING from the gateway, so it never pages", () => {
    expect(inboxFaults({ ...ok, feedsOff: ["calls"], warnings: ["new calls are not reaching the inbox — that archive is switched off"] })).toEqual([]);
  });

  it("pages when the capture tick has stopped, and says why", () => {
    const f = inboxFaults({ ...ok, ok: false, reason: "the last complete capture tick was 14 minutes ago" });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/not seeing new texts and calls/);
    expect(f[0]).toMatch(/14 minutes ago/);
  });

  it("⚠️ unreachable is 'could not check', never 'the inbox is broken'", () => {
    const f = inboxFaults(null);
    expect(f[0]).toMatch(/Could not reach the Communications inbox health check/);
    expect(f[0]).toMatch(/says nothing about the inbox itself/);
  });

  it("a not-ok with no reason says so rather than inventing one", () => {
    expect(inboxFaults({ ...ok, ok: false, reason: null })[0]).toMatch(/reason not reported/);
  });
});
