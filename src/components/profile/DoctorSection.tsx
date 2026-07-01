import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { formatPhone } from "@/lib/profile/workflow";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { phoneToState } from "@/lib/profile/areaCodeState";
import { addressWarning } from "@/lib/profile/workflow";
import {
  searchDoctors, saveDoctorNotes, saveDoctorFollowers, saveDoctorLocation,
  createDoctorItem, MAX_FOLLOWERS, type DoctorRecord, type OrderFollower,
} from "@/lib/shared/doctorDb";
import { toast } from "sonner";

/**
 * "Select Correct Provider" — mirrors the redesign prototype's step 4, wired to
 * the real MM Doctor Database (board 18142847597):
 *   search by name OR NPI → the doctor's profiles (each DB item = one clinic
 *   location) render as a 2-wide grid → pick the location for THIS patient →
 *   confirm Parachute order count, edit/add locations, edit notes & followers.
 */

const PARACHUTE_API = "https://parachute-doctor-lookup-production.up.railway.app";
const THRESHOLD = 15;

interface ParaDoctor {
  doctor_id: string; first_name: string; last_name: string; npi: string;
  credential: string | null; city: string; state: string;
  signature_count: number; doctor_contact: "parachute" | "fax";
}

const initials = (n: string) => (n || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "+";
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  clinicLabels: { id: number; name: string }[];
  onClinicSelect: (id: number, name: string) => void;
}

interface LocForm {
  clinic: string; phone: string; address: string;
  addrLat: number | null; addrLng: number | null;
  fax: string; email: string; method: string; name: string; npi: string;
}
const emptyForm: LocForm = { clinic: "", phone: "", address: "", addrLat: null, addrLng: null, fax: "", email: "", method: "Fax", name: "", npi: "" };

export function DoctorSection({ patient: pt, onUpdate, clinicLabels, onClinicSelect }: Props) {
  // ── Doctor DB search ──
  const [term, setTerm] = useState((pt.doctorNpi || pt.doctorName || "").trim());
  const [results, setResults] = useState<DoctorRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedNpi, setSelectedNpi] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const didInit = useRef(false);

  // ── Parachute order-count (per NPI) + name-search panel ──
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [paraOpen, setParaOpen] = useState(false);
  const [paraTerm, setParaTerm] = useState(pt.doctorName || "");
  const [paraResults, setParaResults] = useState<ParaDoctor[]>([]);
  const [paraLoading, setParaLoading] = useState(false);
  const [paraSel, setParaSel] = useState<string | null>(null);
  const [paraQuery, setParaQuery] = useState(""); // the term actually searched

  // ── Notes + followers (per selected profile) ──
  const [notes, setNotes] = useState("");
  const [followers, setFollowers] = useState<OrderFollower[]>([]);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  // ── Location add/edit form + manual add ──
  const [locMode, setLocMode] = useState<"edit" | "add" | "new-doctor" | null>(null);
  const [form, setForm] = useState<LocForm>(emptyForm);
  const [savingLoc, setSavingLoc] = useState(false);

  const runSearch = async (q: string) => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchDoctors(query));
    } catch {
      setResults([]);
    } finally { setSearching(false); }
  };

  // Debounced search as the rep types.
  useEffect(() => {
    if (locMode) return;
    const id = setTimeout(() => { runSearch(term); }, 300);
    return () => clearTimeout(id);
  }, [term, locMode]);

  // On first mount, if the patient already has a doctor, load their profiles.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const seed = (pt.doctorNpi || pt.doctorName || "").trim();
    if (!seed) return;
    searchDoctors(seed).then((recs) => {
      setResults(recs);
      const npi = (pt.doctorNpi || "").trim();
      if (npi && recs.some((r) => r.npi === npi)) setSelectedNpi(npi);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the results dropdown on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Distinct doctors for the dropdown (dedup by NPI, fall back to name).
  const doctorGroups = useMemo(() => {
    const map = new Map<string, DoctorRecord[]>();
    for (const r of results) {
      const key = r.npi || `name:${norm(r.name)}`;
      const arr = map.get(key) ?? [];
      arr.push(r); map.set(key, arr);
    }
    return [...map.values()];
  }, [results]);

  // Profiles (locations) for the currently-selected doctor.
  const profiles = useMemo(
    () => (selectedNpi ? results.filter((r) => r.npi === selectedNpi) : []),
    [results, selectedNpi],
  );
  const selectedDoctor = profiles[0] ?? null;

  const selectDoctor = (npi: string) => {
    setOpen(false);
    setSelectedNpi(npi);
    setSelectedItemId(null);
    setCount(null);
    setLocMode(null);
    // Guarantee we have every profile for this NPI (a name search may have
    // matched only some), then default the term to the doctor name.
    searchDoctors(npi).then((recs) => {
      if (recs.length) {
        setResults((prev) => {
          const others = prev.filter((r) => r.npi !== npi);
          return [...others, ...recs];
        });
        setTerm(recs[0].name);
      }
    }).catch(() => {});
  };

  const pickProfile = (rec: DoctorRecord) => {
    setSelectedItemId(rec.itemId);
    setNotes(rec.notes);
    setFollowers(rec.followers);
    onUpdate({
      doctorName: rec.name, doctorNpi: rec.npi,
      doctorPhone: rec.phone || pt.doctorPhone,
      clinicAddress: rec.address || pt.clinicAddress,
      clinicalsMethod: rec.method || pt.clinicalsMethod,
      doctorFax: rec.fax || pt.doctorFax,
      doctorEmail: rec.email || pt.doctorEmail,
    });
    const label = clinicLabels.find((c) => c.name === rec.clinic);
    if (label) onClinicSelect(label.id, label.name);
    else if (rec.clinic) onUpdate({ clinicName: rec.clinic });
    // Parachute count is per-NPI — keep it across location picks/edits.
  };

  const matchesReferral = (rec: DoctorRecord) =>
    (!!pt.clinicName && rec.clinic === pt.clinicName) ||
    (!!pt.clinicAddress && !!rec.address && norm(rec.address) === norm(pt.clinicAddress));

  // ── Parachute ──
  const confirmCount = async () => {
    const npi = selectedNpi || pt.doctorNpi;
    if (!npi) { toast.error("Select a provider first"); return; }
    setCountLoading(true);
    try {
      const res = await fetch(`${PARACHUTE_API}/api/search?term=${encodeURIComponent(npi)}`);
      const body = await res.json();
      const match = (body?.results ?? []).find((d: ParaDoctor) => d.npi === npi) ?? body?.results?.[0];
      setCount(match ? match.signature_count : 0);
    } catch { toast.error("Parachute lookup failed"); }
    finally { setCountLoading(false); }
  };

  const runParaSearch = async (q: string) => {
    const query = q.trim();
    if (query.length < 2) return;
    setParaLoading(true);
    try {
      const res = await fetch(`${PARACHUTE_API}/api/search?term=${encodeURIComponent(query)}`);
      const body = await res.json();
      setParaResults(body?.results ?? []);
      setParaQuery(query);
    } catch { setParaResults([]); setParaQuery(query); }
    finally { setParaLoading(false); }
  };

  const phoneState = phoneToState(pt.doctorPhone);
  // Area code from the doctor's phone → state; matching-state candidates are
  // grouped at the top (with the "matches phone area code" header), the rest
  // under "Other states" — same organization as the original panel.
  const paraStateMatches = phoneState ? paraResults.filter((d) => d.state?.toUpperCase() === phoneState.state) : [];
  const paraOthers = phoneState ? paraResults.filter((d) => d.state?.toUpperCase() !== phoneState.state) : paraResults;
  const renderParaRow = (d: ParaDoctor) => {
    const chute = d.signature_count > THRESHOLD;
    const sel = paraSel === d.npi;
    return (
      <div key={d.doctor_id} className="para-row" style={sel ? { background: "oklch(0.973 0.011 175)" } : undefined} onClick={() => setParaSel(sel ? null : d.npi)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: ".92rem" }}>{d.first_name} {d.last_name} <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>– {d.npi}</span></div>
          <div style={{ fontSize: ".8rem", color: "var(--muted-foreground)" }}>{d.credential ? d.credential + ", " : ""}{d.signature_count} signed order{d.signature_count === 1 ? "" : "s"}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: ".8rem", color: "var(--muted-foreground)", marginBottom: 4 }}>{d.city}, {d.state}</div>
          <span className={`method-pill ${chute ? "chute" : "fax"}`} style={{ marginTop: 0 }}>{chute ? "Parachute" : "Fax"}</span>
        </div>
      </div>
    );
  };
  const geoHead: CSSProperties = { padding: "6px 12px", fontSize: ".72rem", fontWeight: 800, color: "var(--mm-teal)", background: "oklch(0.973 0.011 175)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 };
  const geoMuted: CSSProperties = { padding: "6px 12px", fontSize: ".72rem", fontWeight: 700, color: "var(--muted-foreground)", background: "var(--muted)", borderBottom: "1px solid var(--border)" };

  // ── Notes / followers save ──
  const setFollower = (i: number, patch: Partial<OrderFollower>) => {
    setFollowers((prev) => { const n = [...prev]; n[i] = { name: "", email: "", ...n[i], ...patch }; return n; });
  };
  // Save notes + followers to the Doctor DB immediately. Doctor notes are a
  // plain text blob (no timestamp/stage stamping — that's only for the
  // patient's Step 5 notes).
  const saveInfo = async () => {
    if (!selectedItemId) { toast.error("Pick a location first"); return; }
    setSavingInfo(true);
    try {
      await Promise.all([
        saveDoctorNotes(selectedItemId, notes),
        saveDoctorFollowers(selectedItemId, followers.filter((f) => f.name || f.email)),
      ]);
      toast.success("Doctor notes & order followers saved to Doctor DB");
      setEditingInfo(false);
    } catch (e) {
      toast.error("Failed to save to Doctor DB", { description: e instanceof Error ? e.message : String(e) });
    } finally { setSavingInfo(false); }
  };

  // ── Location add / edit / new-doctor ──
  const openEditLoc = () => {
    const r = profiles.find((p) => p.itemId === selectedItemId);
    if (!r) { toast.error("Pick a location first"); return; }
    setForm({ clinic: r.clinic, phone: r.phone, address: r.address, addrLat: null, addrLng: null, fax: r.fax, email: r.email, method: r.method || "Fax", name: r.name, npi: r.npi });
    setLocMode("edit");
  };
  const openAddLoc = () => {
    const d = selectedDoctor;
    setForm({ ...emptyForm, name: d?.name ?? pt.doctorName, npi: d?.npi ?? pt.doctorNpi, method: "Fax" });
    setLocMode("add");
  };
  const openNewDoctor = () => {
    setForm({
      ...emptyForm, name: term || pt.doctorName, npi: pt.doctorNpi,
      phone: pt.doctorPhone, address: pt.clinicAddress, fax: pt.doctorFax,
      email: pt.doctorEmail, method: pt.clinicalsMethod || "Fax", clinic: pt.clinicName,
    });
    setLocMode("new-doctor");
  };

  const saveLoc = async () => {
    if (!form.name.trim() || !form.npi.trim()) { toast.error("Name and NPI are required"); return; }
    if (locMode !== "edit" && !form.address.trim()) { toast.error("Address is required"); return; }
    setSavingLoc(true);
    try {
      if (locMode === "edit" && selectedItemId) {
        await saveDoctorLocation(selectedItemId, {
          clinic: form.clinic, address: form.address, phone: form.phone,
          fax: form.fax, email: form.email, method: form.method,
        });
        toast.success("Location updated in the Doctor Database");
      } else {
        const id = await createDoctorItem({
          name: form.name.trim(), npi: form.npi.trim(), address: form.address,
          phone: form.phone, fax: form.fax, email: form.email, method: form.method,
        });
        toast.success(locMode === "add" ? "New location added under this doctor" : `${form.name} added to the Doctor Database`);
        setSelectedItemId(id);
      }
      // Reflect the chosen provider onto the patient record.
      onUpdate({
        doctorName: form.name.trim(), doctorNpi: form.npi.trim(),
        doctorPhone: form.phone || pt.doctorPhone,
        clinicAddress: form.address || pt.clinicAddress,
        clinicalsMethod: form.method || pt.clinicalsMethod,
        doctorFax: form.fax || pt.doctorFax,
        doctorEmail: form.email || pt.doctorEmail,
      });
      const label = clinicLabels.find((c) => c.name === form.clinic);
      if (label) onClinicSelect(label.id, label.name);
      else if (form.clinic) onUpdate({ clinicName: form.clinic });
      setLocMode(null);
      const recs = await searchDoctors(form.npi.trim());
      setResults((prev) => [...prev.filter((r) => r.npi !== form.npi.trim()), ...recs]);
      setSelectedNpi(form.npi.trim());
    } catch (e) {
      toast.error("Failed to save to Doctor DB", { description: e instanceof Error ? e.message : String(e) });
    } finally { setSavingLoc(false); }
  };

  const lab: CSSProperties = { fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" };

  return (
    <>
      {/* ── Search the doctor database ── */}
      <div className="searchwrap" ref={searchWrapRef}>
        <div className="flabel">Search the doctor database <span className="req-star">*</span></div>
        <div className="searchrow">
          <input
            type="text" value={term} autoComplete="off"
            onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Type a name or NPI…"
          />
          <button type="button" className="para-tool" title="Check Parachute Database — signed-order counts"
            onClick={() => { setParaOpen((o) => !o); if (!paraOpen) { setParaTerm(term || pt.doctorName); runParaSearch(term || pt.doctorName); } }}>
            <span>Parachute</span>
          </button>
        </div>
        {open && (
          <div className="results open">
            {searching ? (
              <div className="res-note">Searching…</div>
            ) : doctorGroups.length === 0 ? (
              <div className="res-note">
                No match in our database. <a href="#" style={{ color: "var(--mm-teal)", fontWeight: 700 }} onClick={(e) => { e.preventDefault(); setParaOpen(true); runParaSearch(term); }}>Check Parachute</a> or <a href="#" style={{ color: "var(--mm-teal)", fontWeight: 700 }} onClick={(e) => { e.preventDefault(); setOpen(false); openNewDoctor(); }}>add them directly</a>.
              </div>
            ) : doctorGroups.map((grp) => {
              const d = grp[0];
              return (
                <div key={d.npi || d.itemId} className="res" onClick={() => selectDoctor(d.npi || "")}>
                  <div className="ri">{initials(d.name)}</div>
                  <div>
                    <div className="rn">{d.name}</div>
                    <div className="rm">NPI {d.npi || "—"}</div>
                  </div>
                  <span className="loc-chip">{grp.length > 1 ? `${grp.length} locations` : (d.clinic || d.address || "1 location")}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!selectedNpi && !locMode && !paraOpen && (
        <div id="doc-actions" style={{ marginTop: 12 }}>
          <button className="btn primary sm" onClick={openNewDoctor}>Add Doctor to Database</button>
        </div>
      )}

      {/* ── Parachute name-search panel ── */}
      {paraOpen && (
        <div className="para-panel">
          <div className="para-head"><span>Parachute Lookup</span><button className="para-close" onClick={() => setParaOpen(false)}>✕</button></div>
          <div className="para-bar">
            <input value={paraTerm} onChange={(e) => setParaTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runParaSearch(paraTerm)} placeholder="Search doctor name or NPI…" />
            <button className="btn secondary sm" onClick={() => runParaSearch(paraTerm)}>Search</button>
          </div>
          <div className="para-list">
            {paraLoading ? <div className="res-note">Searching…</div> :
              paraResults.length === 0 ? (
                paraQuery
                  ? <div className="res-note">Nothing came up on Parachute for <b>“{paraQuery}”</b> — no doctor matched that name or NPI.</div>
                  : <div className="res-note">Type a name or NPI, then Search.</div>
              ) : (
                <>
                  {phoneState && paraStateMatches.length > 0 && (
                    <div style={geoHead}>📍 {phoneState.state} — matches phone area code ({phoneState.areaCode})</div>
                  )}
                  {phoneState && paraStateMatches.length === 0 && (
                    <div style={geoMuted}>No {phoneState.state} doctors (phone area code {phoneState.areaCode})</div>
                  )}
                  {paraStateMatches.map(renderParaRow)}
                  {phoneState && paraStateMatches.length > 0 && paraOthers.length > 0 && (
                    <div style={geoMuted}>Other states</div>
                  )}
                  {paraOthers.map(renderParaRow)}
                </>
              )}
          </div>
          <div className="para-foot" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary sm" onClick={() => {
              const cand = paraResults.find((d) => d.npi === paraSel);
              setParaOpen(false);
              setForm({
                ...emptyForm,
                name: cand ? `${cand.first_name} ${cand.last_name}` : (paraTerm || pt.doctorName),
                npi: cand?.npi ?? pt.doctorNpi,
                method: cand ? (cand.signature_count > THRESHOLD ? "Parachute" : "Fax") : "Fax",
                address: pt.clinicAddress, phone: pt.doctorPhone,
              });
              setLocMode("new-doctor");
            }}>Add Doctor to Database</button>
          </div>
        </div>
      )}

      {/* ── Location / add form ── */}
      {locMode && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginTop: 14, background: "oklch(0.985 0.003 247)" }}>
          <div className="flabel" style={{ marginBottom: 12 }}>
            {locMode === "edit" ? "Edit this location — saves in place to the Doctor DB"
              : locMode === "add" ? "New location — saved as another profile under the same NPI"
              : "Add a new provider to the Doctor Database"}
          </div>
          <div className="fgrid">
            {locMode === "new-doctor" && (
              <>
                <div><div className="flabel">Name <span className="req-star">*</span></div><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><div className="flabel">NPI <span className="req-star">*</span></div><input type="text" value={form.npi} onChange={(e) => setForm({ ...form, npi: e.target.value })} /></div>
              </>
            )}
            <div><div className="flabel">Clinic</div><input type="text" value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} /></div>
            <div><div className="flabel">Phone</div><input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="full"><div className="flabel">Address {locMode !== "edit" && <span className="req-star">*</span>}</div>
              <AddressAutocomplete value={form.address} className="pf-input" placeholder="Start typing address…"
                onChange={(r) => setForm({ ...form, address: r.address, addrLat: r.lat || null, addrLng: r.lng || null })} />
              {addressWarning(form.address) && <div className="fwarn">{addressWarning(form.address)}</div>}
            </div>
            <div><div className="flabel">Fax</div><input type="text" value={form.fax} onChange={(e) => setForm({ ...form, fax: e.target.value })} /></div>
            <div><div className="flabel">Email</div><input type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="full"><div className="flabel">Method</div>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option>Fax</option><option>Parachute</option><option>Email</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn secondary sm" onClick={() => setLocMode(null)}>Cancel</button>
            <button className="btn primary sm" onClick={saveLoc} disabled={savingLoc}>
              {savingLoc ? "Saving…" : locMode === "edit" ? "Save fix to Doctor DB" : locMode === "add" ? "Create new location" : "Add to Doctor DB"}
            </button>
          </div>
        </div>
      )}

      {/* ── Doctor card ── */}
      {selectedNpi && selectedDoctor && !locMode && (
        <div className="doccard">
          <div className="doctop">
            <div className="di">{initials(selectedDoctor.name)}</div>
            <div style={{ flex: 1 }}>
              <div className="dn">{selectedDoctor.name} <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>· NPI {selectedDoctor.npi}</span></div>
              <div className="dm">{profiles.length > 1 ? `${profiles.length} locations on file` : "In Doctor Database"}</div>
            </div>
          </div>

          {/* Parachute order-count confirm (per NPI) */}
          <div className="locwrap" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 14 }}>
            <div style={{ ...lab, marginBottom: 6 }}>Parachute lookup</div>
            {count === null ? (
              <button className="btn secondary sm" onClick={confirmCount} disabled={countLoading}>{countLoading ? "Checking…" : "Confirm Parachute Order Count"}</button>
            ) : (
              <div className={`cc-line ${count > THRESHOLD ? "ok" : "bad"}`}>
                <span className={`cc-ic ${count > THRESHOLD ? "ok" : "bad"}`}>{count > THRESHOLD ? "✓" : "✗"}</span>
                <span><b>{count} signed orders</b> on Parachute</span>
              </div>
            )}
          </div>

          {/* Pick the practice location — 2-wide grid of profiles */}
          <div className="locwrap">
            <div className="flabel">Pick the practice location for THIS patient <span className="req-star">*</span></div>
            <div className="loc-grid">
              {profiles.map((r) => (
                <div key={r.itemId} className={`loc ${selectedItemId === r.itemId ? "sel" : ""}`} onClick={() => pickProfile(r)}>
                  {matchesReferral(r) && <span className="badge-ref">matches referral</span>}
                  <div className="lc">{r.clinic || "Clinic —"}</div>
                  <div className="la">{r.address || "No address on file"}</div>
                  <div className="li">{r.phone ? formatPhone(r.phone) : "No phone"}{r.fax ? ` · ${r.method === "Email" ? "Email" : "Fax"} ${r.fax}` : ""}</div>
                  <div><span className={`method-pill ${r.method === "Parachute" ? "chute" : r.method === "Email" ? "mail" : "fax"}`}>Method: {r.method || "—"}</span></div>
                </div>
              ))}
            </div>
            <div className="loc-actions">
              <button className="btn secondary sm" onClick={openEditLoc} disabled={!selectedItemId}>Edit selected location</button>
              <button className="btn secondary sm" onClick={openAddLoc}>+ Add another location</button>
            </div>

            {/* Fax cross-check */}
            {pt.clinicalsMethod === "Fax" && !pt.doctorFax?.trim() && (
              <div className="err-banner" style={{ marginTop: 12 }}>
                <div className="et">Method is Fax — no fax on file</div>
                <div className="ed">Add a fax to the selected location (Edit selected location); it blocks send-off.</div>
              </div>
            )}
          </div>

          {/* Doctor Notes + Order Followers (per selected profile) — greyed
              out until a location card is picked, since they read/write that
              specific profile's Monday columns. */}
          <div style={{ margin: "16px 0", padding: "0 16px 16px" }}>
            {!selectedItemId && (
              <div style={{ color: "var(--amber)", fontWeight: 700, fontSize: ".84rem", marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: ".95rem" }}>⚠</span> Select a location above to view &amp; edit its notes and order followers.
              </div>
            )}
            <div style={{ opacity: selectedItemId ? 1 : 0.5, pointerEvents: selectedItemId ? "auto" : "none" }}>
            {!editingInfo ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ ...lab, marginBottom: 5 }}>Doctor Notes</div>
                  <div style={{ fontSize: ".88rem", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{notes || <span className="sugg-note">None on file.</span>}</div>
                </div>
                <div>
                  <div style={{ ...lab, marginBottom: 5 }}>Order Followers</div>
                  {followers.filter((f) => f.name || f.email).length === 0 ? <span className="sugg-note">None on file.</span> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {followers.filter((f) => f.name || f.email).map((f, i) => (
                        <li key={i} style={{ fontSize: ".88rem" }}>{f.name || "Follower"}{f.email && <> — <a href={`mailto:${f.email}`} style={{ color: "var(--mm-teal)", fontWeight: 700 }}>{f.email}</a></>}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="btn secondary sm" style={{ marginTop: 14 }} onClick={() => setEditingInfo(true)} disabled={!selectedItemId} title={!selectedItemId ? "Pick a location first" : undefined}>Edit Notes and Followers</button>
              </>
            ) : (
              <div className="fgrid">
                <div className="full"><div className="flabel">Doctor Notes</div><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                {Array.from({ length: MAX_FOLLOWERS }, (_, i) => (
                  <div key={i} className="full" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div><div className="flabel">Order follower {i + 1} (name — optional)</div><input type="text" value={followers[i]?.name ?? ""} onChange={(e) => setFollower(i, { name: e.target.value })} /></div>
                    <div><div className="flabel">Follower {i + 1} email</div><input type="text" value={followers[i]?.email ?? ""} onChange={(e) => setFollower(i, { email: e.target.value })} /></div>
                  </div>
                ))}
                <div className="full" style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="btn secondary sm" onClick={() => setEditingInfo(false)}>Cancel</button>
                  <button className="btn primary sm" onClick={saveInfo} disabled={savingInfo}>{savingInfo ? "Saving…" : "Save to Doctor DB"}</button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
