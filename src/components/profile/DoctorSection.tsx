import { useEffect, useState } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { phoneToState } from "@/lib/profile/areaCodeState";
import {
  findDoctorByNpi, saveDoctorNotes, saveDoctorFollowers, createDoctorItem,
  type OrderFollower,
} from "@/lib/shared/doctorDb";
import { toast } from "sonner";

/**
 * "Select Correct Provider" — .pf-styled to mirror the redesign prototype's
 * step 4. Doctor fields + a doctor card with the Parachute order-count confirm,
 * and Doctor Notes + Order Followers integrated INTO the card (read/write the
 * real Doctor DB by NPI). Parachute name-search fills the fields.
 */

const PARACHUTE_API = "https://parachute-doctor-lookup-production.up.railway.app";
const THRESHOLD = 15;

interface ParaDoctor {
  doctor_id: string; first_name: string; last_name: string; npi: string;
  credential: string | null; city: string; state: string;
  signature_count: number; doctor_contact: "parachute" | "fax";
}

const initials = (n: string) => (n || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "+";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  clinicLabels: { id: number; name: string }[];
  onClinicSelect: (id: number, name: string) => void;
}

export function DoctorSection({ patient: pt, onUpdate, clinicLabels, onClinicSelect }: Props) {
  // Doctor DB record (notes + followers) for the entered NPI.
  const [dbItemId, setDbItemId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [followers, setFollowers] = useState<OrderFollower[]>([]);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [adding, setAdding] = useState(false);

  // Parachute order-count (per NPI) + name search.
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [paraOpen, setParaOpen] = useState(false);
  const [paraTerm, setParaTerm] = useState(pt.doctorName || "");
  const [paraResults, setParaResults] = useState<ParaDoctor[]>([]);
  const [paraLoading, setParaLoading] = useState(false);

  const npi = (pt.doctorNpi || "").trim();

  // Load the Doctor DB record (notes + followers) when NPI changes.
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (!npi) { setDbItemId(null); setNotes(""); setFollowers([]); return; }
    findDoctorByNpi(npi).then((rec) => {
      if (cancelled) return;
      setDbItemId(rec?.itemId ?? null);
      setNotes(rec?.notes ?? "");
      setFollowers(rec?.followers ?? []);
    }).catch(() => { if (!cancelled) { setDbItemId(null); setNotes(""); setFollowers([]); } });
    return () => { cancelled = true; };
  }, [npi]);

  const confirmCount = async () => {
    if (!npi) { toast.error("Enter an NPI first"); return; }
    setCountLoading(true);
    try {
      const res = await fetch(`${PARACHUTE_API}/api/search?term=${encodeURIComponent(npi)}`);
      const body = await res.json();
      const match = (body?.results ?? []).find((d: ParaDoctor) => d.npi === npi) ?? body?.results?.[0];
      setCount(match ? match.signature_count : 0);
    } catch {
      toast.error("Parachute lookup failed");
    } finally { setCountLoading(false); }
  };

  const runParaSearch = async (term: string) => {
    const q = term.trim();
    if (q.length < 2) return;
    setParaLoading(true);
    try {
      const res = await fetch(`${PARACHUTE_API}/api/search?term=${encodeURIComponent(q)}`);
      const body = await res.json();
      setParaResults(body?.results ?? []);
    } catch {
      setParaResults([]);
    } finally { setParaLoading(false); }
  };

  const pickPara = (d: ParaDoctor) => {
    const method = d.doctor_contact === "parachute" ? "Parachute" : "Fax";
    onUpdate({ doctorName: `${d.first_name} ${d.last_name}`, doctorNpi: d.npi, clinicalsMethod: method });
    setParaOpen(false);
    toast.success(`Doctor filled: ${d.first_name} ${d.last_name} — NPI ${d.npi}`);
  };

  const saveInfo = async () => {
    if (!dbItemId) { toast.error("Add the provider to the database first"); return; }
    setSavingInfo(true);
    try {
      await saveDoctorNotes(dbItemId, notes);
      await saveDoctorFollowers(dbItemId, followers.filter((f) => f.name || f.email));
      toast.success("Records contact & order followers saved to Doctor DB");
      setEditingInfo(false);
    } catch (e) {
      toast.error("Failed to save to Doctor DB", { description: e instanceof Error ? e.message : String(e) });
    } finally { setSavingInfo(false); }
  };

  const addToDb = async () => {
    if (!pt.doctorName?.trim() || !npi) { toast.error("Doctor Name and NPI are required"); return; }
    setAdding(true);
    try {
      const id = await createDoctorItem({
        name: pt.doctorName.trim(), npi, address: pt.clinicAddress, phone: pt.doctorPhone,
        fax: pt.doctorFax, email: pt.doctorEmail, method: pt.clinicalsMethod,
        notes, followers: followers.filter((f) => f.name || f.email),
      });
      setDbItemId(id);
      toast.success(`${pt.doctorName} added to the Doctor Database`);
    } catch (e) {
      toast.error("Failed to add provider", { description: e instanceof Error ? e.message : String(e) });
    } finally { setAdding(false); }
  };

  const setFollower = (i: number, patch: Partial<OrderFollower>) => {
    setFollowers((prev) => {
      const next = [...prev];
      next[i] = { name: "", email: "", ...next[i], ...patch };
      return next;
    });
  };

  // Parachute results — patient-state matches first
  const phoneState = phoneToState(pt.doctorPhone);
  const sorted = [...paraResults].sort((a, b) => {
    const am = phoneState && a.state?.toUpperCase() === phoneState.state ? 1 : 0;
    const bm = phoneState && b.state?.toUpperCase() === phoneState.state ? 1 : 0;
    return bm - am || b.signature_count - a.signature_count;
  });

  return (
    <>
      <div className="fgrid">
        <div><div className="flabel">Doctor Name</div><input type="text" value={pt.doctorName} onChange={(e) => onUpdate({ doctorName: e.target.value })} /></div>
        <div><div className="flabel">Doctor NPI</div><input type="text" value={pt.doctorNpi} onChange={(e) => onUpdate({ doctorNpi: e.target.value })} /></div>
        <div><div className="flabel">Doctor Phone</div><input type="text" value={pt.doctorPhone} onChange={(e) => onUpdate({ doctorPhone: e.target.value })} /></div>
        <div><div className="flabel">Clinicals Method</div>
          <select value={pt.clinicalsMethod} onChange={(e) => onUpdate({ clinicalsMethod: e.target.value })}>
            <option value="" disabled hidden>Select…</option><option>Fax</option><option>Parachute</option><option>Email</option>
          </select>
        </div>
        <div><div className="flabel">Doctor Email</div><input type="text" value={pt.doctorEmail} onChange={(e) => onUpdate({ doctorEmail: e.target.value })} /></div>
        <div><div className="flabel">Doctor Fax (@rcfax) {pt.clinicalsMethod === "Fax" && !pt.doctorFax && <span className="req-star">*</span>}</div>
          <input type="text" className={pt.clinicalsMethod === "Fax" && !pt.doctorFax ? "need" : ""} value={pt.doctorFax} onChange={(e) => onUpdate({ doctorFax: e.target.value })} />
        </div>
        <div><div className="flabel">Clinic Name</div>
          <select value={pt.clinicName} onChange={(e) => { const l = clinicLabels.find((c) => c.name === e.target.value); if (l) onClinicSelect(l.id, l.name); }}>
            <option value="" disabled hidden>Select clinic…</option>
            {pt.clinicName && !clinicLabels.some((c) => c.name === pt.clinicName) && <option>{pt.clinicName}</option>}
            {clinicLabels.map((c) => <option key={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="full"><div className="flabel">Clinic Address</div>
          <AddressAutocomplete value={pt.clinicAddress} className="pf-input" onChange={(r) => onUpdate({ clinicAddress: r.address, clinicAddressLat: r.lat || null, clinicAddressLng: r.lng || null })} placeholder="Start typing clinic address…" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button className="para-tool" onClick={() => { setParaOpen((o) => !o); if (!paraOpen) runParaSearch(paraTerm); }}>{paraOpen ? "Hide Parachute" : "Check Parachute"}</button>
        <button className="btn primary sm" onClick={addToDb} disabled={adding}>{adding ? "Adding…" : "Add Doctor to Database"}</button>
      </div>

      {/* Parachute name search */}
      {paraOpen && (
        <div className="para-panel">
          <div className="para-head"><span>Parachute Lookup</span><button className="para-close" onClick={() => setParaOpen(false)}>✕</button></div>
          <div className="para-bar">
            <input value={paraTerm} onChange={(e) => { setParaTerm(e.target.value); }} onKeyDown={(e) => e.key === "Enter" && runParaSearch(paraTerm)} placeholder="Search doctor name or NPI…" />
            <button className="btn secondary sm" onClick={() => runParaSearch(paraTerm)}>Search</button>
          </div>
          <div className="para-list">
            {paraLoading ? <div className="res-note">Searching…</div> :
              sorted.length === 0 ? <div className="res-note">No Parachute results.</div> :
                sorted.map((d) => {
                  const chute = d.signature_count > THRESHOLD;
                  return (
                    <div key={d.doctor_id} className="para-row" onClick={() => pickPara(d)}>
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
                })}
          </div>
          <div className="para-foot"><span>&gt;{THRESHOLD} signed orders → contact via Parachute, otherwise fax</span></div>
        </div>
      )}

      {/* Doctor card — shown once a provider is entered */}
      {pt.doctorName?.trim() && npi && (
        <div className="doccard">
          <div className="doctop">
            <div className="di">{initials(pt.doctorName)}</div>
            <div style={{ flex: 1 }}>
              <div className="dn">{pt.doctorName} <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>· NPI {npi}</span></div>
              <div className="dm">{dbItemId ? "In Doctor Database" : "Not in database yet"}</div>
            </div>
          </div>

          {/* Parachute order-count confirm */}
          <div className="locwrap" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 14 }}>
            <div style={{ fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", marginBottom: 6 }}>Parachute lookup</div>
            {count === null ? (
              <button className="btn secondary sm" onClick={confirmCount} disabled={countLoading}>{countLoading ? "Checking…" : "Confirm Parachute Order Count"}</button>
            ) : (
              <div className={`cc-line ${count > THRESHOLD ? "ok" : "bad"}`}>
                <span className={`cc-ic ${count > THRESHOLD ? "ok" : "bad"}`}>{count > THRESHOLD ? "✓" : "✗"}</span>
                <span><b>{count} signed orders</b> on Parachute {count > THRESHOLD ? "→ contact via Parachute" : "→ Fax/Email"}</span>
              </div>
            )}
          </div>

          {/* Fax cross-check */}
          {pt.clinicalsMethod === "Fax" && !pt.doctorFax?.trim() && (
            <div className="locwrap" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 14 }}>
              <div className="err-banner"><div className="et">Method is Fax — no fax on file</div><div className="ed">Enter Doctor Fax above; it blocks send-off.</div></div>
            </div>
          )}

          {/* Doctor Notes + Order Followers — integrated, saved to Doctor DB */}
          <div style={{ padding: "16px" }}>
            {!editingInfo ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", marginBottom: 5 }}>Records Contact / Doctor Notes</div>
                  <div style={{ fontSize: ".88rem", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{notes || <span className="sugg-note">None on file.</span>}</div>
                </div>
                <div>
                  <div style={{ fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", marginBottom: 5 }}>Order Followers</div>
                  {followers.filter((f) => f.name || f.email).length === 0 ? <span className="sugg-note">None on file.</span> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {followers.filter((f) => f.name || f.email).map((f, i) => (
                        <li key={i} style={{ fontSize: ".88rem" }}>{f.name || "Follower"}{f.email && <> — <a href={`mailto:${f.email}`} style={{ color: "var(--mm-teal)", fontWeight: 700 }}>{f.email}</a></>}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="btn secondary sm" style={{ marginTop: 14 }} onClick={() => setEditingInfo(true)} disabled={!dbItemId} title={!dbItemId ? "Add the provider to the database first" : undefined}>Edit Notes &amp; Followers</button>
              </>
            ) : (
              <div className="fgrid">
                <div className="full"><div className="flabel">Records Contact / Doctor Notes</div><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <div><div className="flabel">Order follower 1 (name)</div><input type="text" value={followers[0]?.name ?? ""} onChange={(e) => setFollower(0, { name: e.target.value })} /></div>
                <div><div className="flabel">Follower 1 email</div><input type="text" value={followers[0]?.email ?? ""} onChange={(e) => setFollower(0, { email: e.target.value })} /></div>
                <div><div className="flabel">Order follower 2 (name)</div><input type="text" value={followers[1]?.name ?? ""} onChange={(e) => setFollower(1, { name: e.target.value })} /></div>
                <div><div className="flabel">Follower 2 email</div><input type="text" value={followers[1]?.email ?? ""} onChange={(e) => setFollower(1, { email: e.target.value })} /></div>
                <div className="full" style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="btn secondary sm" onClick={() => setEditingInfo(false)}>Cancel</button>
                  <button className="btn primary sm" onClick={saveInfo} disabled={savingInfo}>{savingInfo ? "Saving…" : "Save to Doctor DB"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
