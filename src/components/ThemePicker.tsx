import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, LayoutGrid, Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { authRequired, signOut, getUser } from "@/lib/shared/auth";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { useAppearance } from "@/hooks/shell/useAppearance";
import type { Appearance } from "@/lib/shell/appearance";

const THEMES = [
  { id: "default", label: "Clinical Blue", swatch: "bg-blue-600" },
  { id: "slate",   label: "Slate",         swatch: "bg-slate-500" },
  { id: "emerald", label: "Emerald",       swatch: "bg-emerald-600" },
  { id: "violet",  label: "Violet",        swatch: "bg-violet-600" },
  { id: "rose",    label: "Rose",          swatch: "bg-rose-500" },
  { id: "amber",   label: "Amber",         swatch: "bg-amber-500" },
] as const;

/**
 * ⚠️ Appearance is a SEPARATE choice from the colour theme above, not a
 * seventh entry in it (§5.40): the themes shift the accent hue, this shifts how
 * light the surfaces are, and folding them together would make "dark" cost
 * somebody their Emerald.
 */
const APPEARANCES: { id: Appearance; label: string; Icon: typeof Sun }[] = [
  { id: "light",  label: "Light",  Icon: Sun },
  { id: "dark",   label: "Dark",   Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

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
export function ThemePickerButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", className)}
          title="Settings"
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

/**
 * The settings popover's body, shared by the sidebar and the floating button.
 *
 * ⚠️⚠️ **THE LAYOUT TOGGLE LIVES HERE BECAUSE THIS POPOVER EXISTS IN BOTH
 * LAYOUTS** (Josh, 2026-09-18: *"i saw it for a minute and then pressed show me
 * the original view and never was able to get back"*). It shipped in the global
 * header's gear menu ALONE — and "as today" removes the header, so switching
 * away deleted the only control that could switch back. A one-way door out of
 * the redesign, which is the exact dead end §5.10 · §5.20 · §5.31c · §5.32c
 * each record reversing, and it cost Josh the app for an afternoon.
 *
 * ⚠️ The gear menu keeps its copy — it is Brandon's own placement and it is
 * where somebody in the redesign looks. Both read and write the one
 * `useShellLayout` hook, so they cannot disagree; what matters is that at least
 * one of them renders in EVERY layout. Never leave this the only one either:
 * this popover is not on every page, so `?layout=` (lib/shell/layout.ts) is the
 * recovery route from a page that has neither.
 */
function ThemeList({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const [layout, setLayout] = useShellLayout();
  const { appearance, setAppearance } = useAppearance();
  return (
    <>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Layout
      </p>
      <button
        onClick={() => setLayout(layout === "redesign" ? "current" : "redesign")}
        className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-left transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
      >
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
        {layout === "redesign" ? "Switch to the layout as it was" : "Switch to the new layout"}
      </button>
      <div className="my-2 border-t border-border" />
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 px-1">
        Appearance
      </p>
      <div className="grid grid-cols-3 gap-1">
        {APPEARANCES.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setAppearance(id)}
            title={id === "system" ? "Follow this computer's setting" : `Always ${label.toLowerCase()}`}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] transition-colors",
              appearance === id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      <div className="my-2 border-t border-border" />
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
