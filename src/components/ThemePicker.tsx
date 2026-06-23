import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { authRequired, signOut, getUser } from "@/lib/shared/auth";

const THEMES = [
  { id: "default", label: "Clinical Blue", swatch: "bg-blue-600" },
  { id: "slate",   label: "Slate",         swatch: "bg-slate-500" },
  { id: "emerald", label: "Emerald",       swatch: "bg-emerald-600" },
  { id: "violet",  label: "Violet",        swatch: "bg-violet-600" },
  { id: "rose",    label: "Rose",          swatch: "bg-rose-500" },
  { id: "amber",   label: "Amber",         swatch: "bg-amber-500" },
] as const;

function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem("mm-theme") || "default");

  useEffect(() => {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    localStorage.setItem("mm-theme", theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}

/** Sidebar variant — lives in a SidebarFooter. */
export function SidebarThemePicker({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn(
            "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed ? "h-8 w-8" : "h-8 w-full justify-start gap-2 px-2",
          )}
          title="Theme"
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="text-xs">Theme</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-44 p-2" sideOffset={8}>
        <ThemeList theme={theme} setTheme={setTheme} />
      </PopoverContent>
    </Popover>
  );
}

/** Standalone variant — for pages without the SidebarProvider (e.g. Index). */
export function ThemePickerButton() {
  const { theme, setTheme } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Theme"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-44 p-2" sideOffset={8}>
        <ThemeList theme={theme} setTheme={setTheme} />
      </PopoverContent>
    </Popover>
  );
}

function ThemeList({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  return (
    <>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Theme
      </p>
      <div className="space-y-0.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs transition-colors text-left",
              theme === t.id
                ? "bg-accent text-accent-foreground font-medium"
                : "hover:bg-muted",
            )}
          >
            <span className={cn("h-3 w-3 rounded-full shrink-0 border border-black/10", t.swatch)} />
            {t.label}
          </button>
        ))}
      </div>
      {authRequired() && (
        <>
          <div className="my-2 border-t border-border" />
          {getUser()?.email && (
            <p className="text-[10px] text-muted-foreground px-1 mb-1 truncate" title={getUser()!.email}>
              {getUser()!.email}
            </p>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-left transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" /> Sign out
          </button>
        </>
      )}
    </>
  );
}
