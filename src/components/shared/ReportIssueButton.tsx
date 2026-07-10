/**
 * ReportIssueButton — tiny "computer with an exclamation point" icon that sits
 * at the far right of every role page header. Clicking it opens a small
 * popover asking whether the user wants to report a technical issue or make a
 * UI functionality request, with a link out to the request form.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExternalLink } from "lucide-react";

const REQUEST_FORM_URL = "https://medically-modern.github.io/josh-tec-requests/";

/** Lucide's Monitor outline with an exclamation mark drawn on the screen. */
const MonitorAlertIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    {/* exclamation point on the screen */}
    <path d="M12 6.5v4" />
    <path d="M12 13.5h.01" />
  </svg>
);

export const ReportIssueButton = () => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        title="Report a technical issue or request a UI change"
        aria-label="Report a technical issue or request a UI change"
        className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-navy-foreground/50 hover:text-navy-foreground hover:bg-white/10 transition-colors"
      >
        <MonitorAlertIcon className="h-[18px] w-[18px]" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 text-sm">
      <p className="font-semibold text-foreground">Something not working right?</p>
      <p className="mt-1.5 text-muted-foreground">
        If you'd like to report a technical issue, or you have a functionality
        request for the UI, we want to hear about it.
      </p>
      <a
        href={REQUEST_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
      >
        Click here to open the request form
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </PopoverContent>
  </Popover>
);
