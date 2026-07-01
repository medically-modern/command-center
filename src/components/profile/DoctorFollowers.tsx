import { useEffect, useState } from "react";
import { findDoctorByNpi, type OrderFollower } from "@/lib/shared/doctorDb";
import { Mail } from "lucide-react";

/**
 * Order Followers (Corey 9) — reads the two order-follower name/email pairs from
 * the Doctor Database (by NPI) and surfaces them as clickable mailto links so a
 * rep can email the followers directly to chase clinicals. Read-only.
 */
export function DoctorFollowers({ doctorNpi }: { doctorNpi: string }) {
  const [followers, setFollowers] = useState<OrderFollower[]>([]);

  useEffect(() => {
    let cancelled = false;
    const npi = (doctorNpi || "").trim();
    if (!npi) { setFollowers([]); return; }
    findDoctorByNpi(npi)
      .then((rec) => { if (!cancelled) setFollowers(rec?.followers ?? []); })
      .catch(() => { if (!cancelled) setFollowers([]); });
    return () => { cancelled = true; };
  }, [doctorNpi]);

  const withEmail = followers.filter((f) => f.email?.trim());
  if (withEmail.length === 0) return null;

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Order Followers</p>
      <ul className="space-y-1">
        {withEmail.map((f, i) => (
          <li key={i} className="text-sm flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
            <span className="font-medium">{f.name || "Follower"}</span>
            <a href={`mailto:${f.email}`} className="text-emerald-700 hover:underline truncate">{f.email}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
