import { useState, useMemo, useRef, useEffect } from "react";
import type { Patient } from "@/lib/profile/workflow";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { hasValidZip } from "@/lib/profile/workflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOCTOR_STATUS_INDEX, CLINICALS_METHOD_INDEX } from "@/lib/profile/mondayMapping";
import { AlertTriangle, Plus, Search } from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  clinicLabels: { id: number; name: string }[];
  onClinicSelect: (id: number, name: string) => void;
  onClinicCreate: (name: string) => void;
}

export function DoctorPanel({ patient, onUpdate, clinicLabels, onClinicSelect, onClinicCreate }: Props) {
  const [clinicSearch, setClinicSearch] = useState("");
  const [showClinicDropdown, setShowClinicDropdown] = useState(false);
  const [newClinicName, setNewClinicName] = useState("");
  const [showAddClinic, setShowAddClinic] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const zipValid = hasValidZip(patient.clinicAddress);

  const filteredClinics = useMemo(() => {
    if (!clinicSearch.trim()) return clinicLabels.slice(0, 20);
    const q = clinicSearch.toLowerCase();
    return clinicLabels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20);
  }, [clinicLabels, clinicSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowClinicDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleClinicPick = (clinic: { id: number; name: string }) => {
    onClinicSelect(clinic.id, clinic.name);
    setClinicSearch("");
    setShowClinicDropdown(false);
  };

  const handleAddClinic = () => {
    if (!newClinicName.trim()) return;
    onClinicCreate(newClinicName.trim());
    setNewClinicName("");
    setShowAddClinic(false);
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Doctor Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Doctor Status */}
          <div className="space-y-1.5">
            <Label>Doctor Status</Label>
            <Select
              value={patient.doctorStatus || undefined}
              onValueChange={(v) => onUpdate({ doctorStatus: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {Object.keys(DOCTOR_STATUS_INDEX).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Clinicals Method */}
          <div className="space-y-1.5">
            <Label>Clinicals Method</Label>
            <Select
              value={patient.clinicalsMethod || undefined}
              onValueChange={(v) => onUpdate({ clinicalsMethod: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {Object.keys(CLINICALS_METHOD_INDEX).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Doctor Name */}
          <div className="space-y-1.5">
            <Label>Doctor Name</Label>
            <Input
              value={patient.doctorName}
              onChange={(e) => onUpdate({ doctorName: e.target.value })}
              placeholder="Dr. Name"
            />
          </div>

          {/* Doctor NPI */}
          <div className="space-y-1.5">
            <Label>Doctor NPI</Label>
            <Input
              value={patient.doctorNpi}
              onChange={(e) => onUpdate({ doctorNpi: e.target.value })}
              placeholder="NPI number"
            />
          </div>

          {/* Doctor Phone */}
          <div className="space-y-1.5">
            <Label>Doctor Phone</Label>
            <Input
              value={patient.doctorPhone}
              onChange={(e) => onUpdate({ doctorPhone: e.target.value })}
              placeholder="Phone number"
            />
          </div>

          {/* Doctor Email */}
          <div className="space-y-1.5">
            <Label>Doctor Email</Label>
            <Input
              type="email"
              value={patient.doctorEmail}
              onChange={(e) => onUpdate({ doctorEmail: e.target.value })}
              placeholder="doctor@clinic.com"
            />
          </div>

          {/* Doctor Fax — required when clinicals method is Fax */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Doctor Fax (@rcfax)
              {patient.clinicalsMethod === "Fax" && !patient.doctorFax?.trim() && (
                <span className="text-red-500 text-xs">* required for fax</span>
              )}
            </Label>
            <Input
              type="email"
              value={patient.doctorFax}
              onChange={(e) => onUpdate({ doctorFax: e.target.value })}
              placeholder="fax@rcfax.com"
              className={
                patient.clinicalsMethod === "Fax"
                  ? patient.doctorFax?.trim()
                    ? "border-green-400 ring-1 ring-green-200"
                    : "border-red-400 ring-1 ring-red-200"
                  : ""
              }
            />
          </div>

          {/* Clinic Name — searchable combobox */}
          <div className="space-y-1.5 relative" ref={dropdownRef}>
            <Label className="flex items-center justify-between">
              <span>Clinic Name</span>
              <Button
                variant="ghost" size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setShowAddClinic(!showAddClinic)}
              >
                <Plus className="h-3 w-3" /> Add New
              </Button>
            </Label>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={clinicSearch || patient.clinicName}
                onChange={(e) => {
                  setClinicSearch(e.target.value);
                  setShowClinicDropdown(true);
                }}
                onFocus={() => setShowClinicDropdown(true)}
                placeholder="Search clinics…"
                className="pl-9"
              />
            </div>

            {showClinicDropdown && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                {filteredClinics.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No clinics found</p>
                ) : (
                  filteredClinics.map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onClick={() => handleClinicPick(c)}
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Add new clinic inline */}
            {showAddClinic && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={newClinicName}
                  onChange={(e) => setNewClinicName(e.target.value)}
                  placeholder="New clinic name…"
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddClinic()}
                />
                <Button size="sm" onClick={handleAddClinic} disabled={!newClinicName.trim()}>
                  Add
                </Button>
              </div>
            )}
          </div>

          {/* Clinic Address — with zip validation */}
          <div className="space-y-1.5 md:col-span-2">
            <Label className="flex items-center gap-2">
              Clinic Address
              {!zipValid && (
                <span className="text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Must include a 5-digit zip code
                </span>
              )}
            </Label>
            <AddressAutocomplete
              value={patient.clinicAddress}
              onChange={(r) => onUpdate({
                clinicAddress: r.address,
                clinicAddressLat: r.lat || null,
                clinicAddressLng: r.lng || null,
              })}
              placeholder="Start typing clinic address…"
              className={`flex h-9 w-full rounded-md border ${!zipValid ? "border-red-300" : "border-input"} bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
