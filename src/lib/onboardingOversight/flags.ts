/**
 * Onboarding Oversight feature flags. Deliberately import-free so the global
 * header can read them without pulling the dashboard's config into the main bundle.
 * Spec: BUILD-SPEC Appendix A.
 */
export const OO_FLAGS = { showInNav: false, draftBanner: null as string | null };
