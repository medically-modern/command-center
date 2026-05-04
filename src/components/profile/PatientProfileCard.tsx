import type { Patient } from "@/lib/profile/workflow";
import { formatPhone, normalizeDob, hasValidZip } from "@/lib/profile/workflow";
import { AddressAutocomplete } from "@/components/profile/AddressAutocomplete";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UpdatesSheet } from "@/components/profile/UpdatesSheet";
import { CalendarDays, User, Phone, Mail, Heart, MapPin, AlertCircle } from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
}

export function PatientProfileCard({ patient, onUpdate }: Props) {
  const alreadyInSystem = patient.alreadyInSystem?.toLowerCase();

  const handlePhoneChange = (value: string) => {
    onUpdate({ ptPhone: formatPhone(value) });
  };

  const handleDobBlur = () => {
    const normalized = normalizeDob(patient.dob);
    if (normalized !== patient.dob) {
      onUpdate({ dob: normalized });
    }
  };

  return (
    <div className="rounded-xl bg-card border shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Patient Profile</p>
        <div className="flex items-center gap-2">
          <UpdatesSheet itemId={patient.id} patientName={patient.name} />
          {patient.alreadyInSystem && (
            <Badge
              variant="outline"
              className={
                alreadyInSystem === "yes"
                  ? "border-red-400 bg-red-50 text-red-700"
                  : "border-green-400 bg-green-50 text-green-700"
              }
            >
              <AlertCircle className="h-3 w-3 mr-1" />
              {alreadyInSystem === "yes" ? "Already In System" : "New Patient"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Name */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5" /> Name
          </Label>
          <Input
            value={patient.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Patient name"
            className="h-9"
          />
        </div>

        {/* DOB — plain text input, MM/DD/YYYY. Auto-pads month and day on blur. */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> DOB
          </Label>
          <Input
            value={patient.dob}
            onChange={(e) => onUpdate({ dob: e.target.value })}
            onBlur={handleDobBlur}
            placeholder="MM/DD/YYYY"
            inputMode="numeric"
            className="h-9"
          />
        </div>

        {/* Phone */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5" /> Phone
          </Label>
          <Input
            value={patient.ptPhone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="(xxx) xxx-xxxx"
            className="h-9"
          />
        </div>

        {/* Email */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" /> Email
          </Label>
          <Input
            type="email"
            value={patient.email}
            onChange={(e) => onUpdate({ email: e.target.value })}
            placeholder="patient@email.com"
            className="h-9"
          />
        </div>

        {/* Gender */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Heart className="h-3.5 w-3.5" /> Gender
          </Label>
          <Select
            value={patient.gender || "_blank"}
            onValueChange={(v) => onUpdate({ gender: v === "_blank" ? "" : v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_blank">—</SelectItem>
              <SelectItem value="Male">Male</SelectItem>
              <SelectItem value="Female">Female</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Patient Address — Google Places autocomplete; ZIP+4 stripped to 5-digit */}
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Address
          </Label>
          <AddressAutocomplete
            value={patient.patientAddress}
            onChange={(r) => onUpdate({
              patientAddress: r.address,
              patientAddressLat: r.lat || null,
              patientAddressLng: r.lng || null,
            })}
            placeholder="Start typing address…"
          />
          {patient.patientAddress && !hasValidZip(patient.patientAddress) && (
            <p className="text-xs text-amber-600">Address must include a 5-digit zip code (no -xxxx).</p>
          )}
        </div>
      </div>
    </div>
  );
}
