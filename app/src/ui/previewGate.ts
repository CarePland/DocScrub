/**
 * previewGate.ts — Supabase account gate (2026-08-06).
 *
 * This replaces the temporary shared preview password through the exact seam
 * the old gate documented: app.ts is still imported only after account access
 * is established, and the reviewer workspace remains browser-local. Supabase
 * stores only account, organization, membership, invitation, entitlement-ready,
 * and future recovery metadata; source documents, extracted text, candidates,
 * replacements, decisions, generated documents, and audit contents remain
 * outside the cloud boundary described in ADR-003.
 */

import { readAuthRedirectState, authRedirectUrl, clearAuthRedirectUrl } from "../account/authRedirect.js";
import {
  canManageMembers,
  isOrganizationRole,
  normalizeInvitationEmail,
  pendingOrganizationMemberErrors,
  usedPendingOrganizationMemberRows,
  type OrganizationRole,
  type PendingOrganizationMemberInput,
} from "../account/membership.js";
import { clearLocalSessionOwnerId, setLocalSessionOwnerId } from "../account/localSessionOwner.js";
import { supabase } from "../lib/supabase.js";

type AccountProfile = {
  address: string | null;
  avatar_url: string | null;
  city: string | null;
  company: string | null;
  company_id: string | null;
  country: string | null;
  default_organization_id: string | null;
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  id: string;
  is_internal_admin: boolean | null;
  job_title: string | null;
  last_name: string | null;
  onboarding_completed_at: string | null;
  organization_name: string | null;
  phone: string | null;
  postal_code: string | null;
  state_province: string | null;
};

type OrganizationMemberRow = {
  organization_id: string;
  role: OrganizationRole;
  organizations: { id: string; name: string; organization_type: string } | { id: string; name: string; organization_type: string }[] | null;
};

type InvitationRow = {
  email: string;
  expires_at: string;
  id: string;
  role: OrganizationRole;
  status: string;
};

type AdminTab = "metrics" | "users" | "organizations" | "setup";

type AdminUsageSummary = {
  activeUsersThisMonth?: number;
  activeUsersThisWeek?: number;
  activeUsersToday?: number;
  averageDecisionsPerCompletedDocument?: number | null;
  averageCompletionSeconds?: number | null;
  averageDocumentsPerActiveUser?: number | null;
  completionRate?: number | null;
  documentsCompleted?: number;
  documentsStarted?: number;
  documentsThisMonth?: number;
  documentsThisWeek?: number;
  documentsToday?: number;
  exportCount?: number;
  mostRecentActivity?: string | null;
  overallDecisionsAvoidedPercentage?: number | null;
  totalDecisionsAvoided?: number;
  totalDecisionsMade?: number;
  totalOrganizations?: number;
  totalPagesProcessed?: number;
  totalRegisteredUsers?: number;
  usersWhoProcessedDocument?: number;
};

type AdminUsageUserRow = {
  active_days?: number;
  average_completion_seconds?: number | null;
  change_decisions?: number;
  display_name?: string;
  documents_completed?: number;
  documents_incomplete?: number;
  documents_started?: number;
  email?: string | null;
  export_count?: number;
  first_document_at?: string | null;
  ignore_decisions?: number;
  is_internal_admin?: boolean;
  keep_decisions?: number;
  most_recent_document_at?: string | null;
  onboarding_completed_at?: string | null;
  redact_decisions?: number;
  total_decisions_avoided?: number;
  total_decisions_made?: number;
  total_occurrences?: number;
  total_pages?: number;
  total_review_items?: number;
  user_id: string;
};

type AdminUsageOrganizationRow = {
  active_member_count?: number;
  active_users?: number;
  average_completion_seconds?: number | null;
  documents_completed?: number;
  documents_started?: number;
  export_count?: number;
  most_recent_activity?: string | null;
  name?: string;
  organization_id: string;
  total_decisions_avoided?: number;
  total_decisions_made?: number;
  total_pages_processed?: number;
};

type AdminUsageMetricsResponse = {
  organizations?: AdminUsageOrganizationRow[];
  summary?: AdminUsageSummary;
  users?: AdminUsageUserRow[];
};

const LOAD_RETRY_KEY = "docscrub-auth-load-retried";

let currentProfile: AccountProfile | null = null;
let currentMemberships: OrganizationMemberRow[] = [];
let selectedOrganizationId = "";
let invitationToken: string | null = null;
let authGateMode: "signIn" | "signUp" = "signIn";
let currentAuthEmail: string | null = null;
let adminTab: AdminTab = "metrics";
let adminScope: { organizationId?: string; userId?: string } = {};

function startApplication(gate: HTMLElement | null): void {
  import("./app.js")
    .then(() => {
      try {
        sessionStorage.removeItem(LOAD_RETRY_KEY);
      } catch {
        /* marker is best-effort */
      }
      document.body.classList.remove("preview-locked");
      if (gate) gate.hidden = true;
      wireAccountMenu();
    })
    .catch(() => {
      let alreadyRetried = true;
      try {
        alreadyRetried = sessionStorage.getItem(LOAD_RETRY_KEY) === "yes";
        if (!alreadyRetried) sessionStorage.setItem(LOAD_RETRY_KEY, "yes");
      } catch {
        /* storage unavailable: avoid reload loops */
      }
      if (!alreadyRetried) {
        window.location.reload();
        return;
      }
      showGateError(gate, "Could not load the application. Hard-refresh this page and try again.");
    });
}

function showGateError(gate: HTMLElement | null, message: string): void {
  if (!gate) return;
  document.body.classList.add("preview-locked");
  gate.hidden = false;
  const errorLine = gate.querySelector<HTMLElement>(".preview-gate-error");
  if (errorLine) {
    errorLine.textContent = message;
    errorLine.hidden = false;
  }
}

function showRecoverableGateError(gate: HTMLElement | null, error: unknown): void {
  clearAuthRedirectUrl();
  showGate(gate);
  const errorLine = gate?.querySelector<HTMLElement>(".preview-gate-error") ?? null;
  showInlineGateMessage(errorLine, getErrorMessage(error));
}

async function restoreRedirectSession(): Promise<void> {
  const redirect = readAuthRedirectState(window.location);
  invitationToken = redirect.invitationToken;

  if (redirect.errorDescription) {
    throw new Error(redirect.errorDescription);
  }

  if (redirect.hashAccessToken && redirect.hashRefreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: redirect.hashAccessToken,
      refresh_token: redirect.hashRefreshToken,
    });
    if (error) throw error;
  } else if (redirect.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(redirect.code);
    if (error) throw error;
  }
}

async function loadAccountState(): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Please sign in to continue.");
  setLocalSessionOwnerId(user.id);
  currentAuthEmail = user.email ?? null;

  if (invitationToken) {
    const { error } = await supabase.rpc("accept_organization_invitation", {
      p_token: invitationToken,
    });
    if (error) throw error;
    clearInvitationTokenFromUrl();
    invitationToken = null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,display_name,first_name,last_name,organization_name,company_id,company,job_title,phone,address,city,state_province,postal_code,country,avatar_url,default_organization_id,onboarding_completed_at,is_internal_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  currentProfile =
    (profile as AccountProfile | null) ?? {
      address: null,
      avatar_url: null,
      city: null,
      company: null,
      company_id: null,
      country: null,
      default_organization_id: null,
      display_name: user.user_metadata?.full_name ?? null,
      email: user.email ?? null,
      first_name: user.user_metadata?.given_name ?? null,
      id: user.id,
      is_internal_admin: false,
      job_title: null,
      last_name: user.user_metadata?.family_name ?? null,
      onboarding_completed_at: null,
      organization_name: null,
      phone: null,
      postal_code: null,
      state_province: null,
    };

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id,role,organizations(id,name,organization_type)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (membershipError) throw membershipError;

  currentMemberships = (memberships ?? []) as unknown as OrganizationMemberRow[];
  selectedOrganizationId =
    currentProfile.default_organization_id ??
    currentMemberships[0]?.organization_id ??
    "";
}

async function bootstrap(gate: HTMLElement | null): Promise<void> {
  await restoreRedirectSession();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    showGate(gate);
    return;
  }

  await loadAccountState();
  clearAuthRedirectUrl();
  continueAfterAccountLoad(gate);
}

function continueAfterAccountLoad(gate: HTMLElement | null): void {
  if (shouldShowOnboarding()) {
    showSetupWizard(() => startApplication(gate));
    return;
  }
  startApplication(gate);
}

function showGate(gate: HTMLElement | null): void {
  if (!gate) return;

  document.body.classList.add("preview-locked");
  gate.hidden = false;

  const form = gate.querySelector<HTMLFormElement>(".preview-gate-form");
  const emailInput = gate.querySelector<HTMLInputElement>(".preview-email");
  const passwordInput = gate.querySelector<HTMLInputElement>(".preview-password");
  const passwordField = gate.querySelector<HTMLElement>(".preview-password-field");
  const googleButton = gate.querySelector<HTMLButtonElement>(".preview-google");
  const badge = gate.querySelector<HTMLElement>(".preview-badge");
  const divider = gate.querySelector<HTMLElement>(".preview-auth-divider");
  const modeButton = gate.querySelector<HTMLButtonElement>(".preview-account-mode");
  const modeText = gate.querySelector<HTMLElement>(".preview-account-switch-text");
  const submitButton = gate.querySelector<HTMLButtonElement>(".preview-submit");
  const errorLine = gate.querySelector<HTMLElement>(".preview-gate-error");
  const statusLine = gate.querySelector<HTMLElement>(".preview-gate-status");

  const renderMode = () => {
    const signUp = authGateMode === "signUp";
    if (passwordField) passwordField.hidden = signUp;
    if (passwordInput) passwordInput.required = !signUp;
    if (googleButton) googleButton.hidden = signUp;
    if (badge) badge.textContent = signUp ? "Sign up" : "Sign in";
    if (divider) {
      divider.hidden = signUp;
      divider.textContent = "Or sign in with email";
    }
    if (submitButton) submitButton.textContent = signUp ? "Send me a signup link" : "Sign In";
    if (modeText) modeText.textContent = signUp ? "Have an account?" : "No Account?";
    if (modeButton) modeButton.textContent = signUp ? "Sign in" : "Create an account";
    if (errorLine) errorLine.hidden = true;
    if (statusLine) statusLine.hidden = true;
  };

  modeButton?.addEventListener("click", () => {
    authGateMode = authGateMode === "signIn" ? "signUp" : "signIn";
    renderMode();
    emailInput?.focus();
  });

  renderMode();

  googleButton?.addEventListener("click", async () => {
    try {
      setGateBusy(gate, true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authRedirectUrl(invitationToken) },
      });
      if (error) throw error;
    } catch (error) {
      showInlineGateMessage(errorLine, getErrorMessage(error));
      setGateBusy(gate, false);
    }
  });

  if (form && emailInput && passwordInput) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = normalizeInvitationEmail(emailInput.value);
      if (!email) {
        showInlineGateMessage(errorLine, "Enter your email address.");
        return;
      }

      try {
        setGateBusy(gate, true);
        if (authGateMode === "signUp") {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
              emailRedirectTo: authRedirectUrl(invitationToken),
              shouldCreateUser: true,
            },
          });
          if (error) throw error;
          if (statusLine) {
            statusLine.textContent = "Check your email for a signup link.";
            statusLine.hidden = false;
          }
          return;
        }

        if (!passwordInput.value) {
          showInlineGateMessage(errorLine, "Enter your password.");
          return;
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: passwordInput.value,
        });
        if (error) throw error;
        await loadAccountState();
        clearAuthRedirectUrl();
        continueAfterAccountLoad(gate);
      } catch (error) {
        showInlineGateMessage(errorLine, getErrorMessage(error));
      } finally {
        setGateBusy(gate, false);
      }
    });
  }

}

function setGateBusy(gate: HTMLElement | null, busy: boolean): void {
  if (!gate) return;
  for (const element of Array.from(gate.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input"))) {
    element.disabled = busy;
  }
}

let setupWizardStep = 0;
let setupWizardOnComplete: (() => void) | null = null;
let setupWizardExpanded = false;
let setupWizardPreviewOnly = false;
let setupWizardCompleting = false;

function showSetupWizard(
  onComplete: (() => void) | null = null,
  options: { previewOnly?: boolean } = {}
): void {
  const wizard = document.querySelector<HTMLElement>(".setup-wizard");
  if (!wizard) return;
  setupWizardStep = 0;
  setupWizardOnComplete = onComplete;
  setupWizardExpanded = false;
  setupWizardPreviewOnly = options.previewOnly === true;
  setupWizardCompleting = false;
  populateSetupProfileForm(wizard);
  renderSetupWizard(wizard);
  wizard.hidden = false;
  wizard.querySelector<HTMLButtonElement>(".setup-wizard-next")?.focus();
  wireSetupWizard(wizard);
}

let setupWizardWired = false;

function wireSetupWizard(wizard: HTMLElement): void {
  if (setupWizardWired) return;
  setupWizardWired = true;

  const closeButtons = wizard.querySelectorAll<HTMLButtonElement>(".setup-wizard-close,.setup-wizard-secondary");
  const backButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-back");
  const nextButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-next");
  const skipButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-skip");
  const startButtons = wizard.querySelectorAll<HTMLButtonElement>("[data-setup-start]");
  const readyInviteButton = wizard.querySelector<HTMLButtonElement>(".setup-ready-invite");
  const addInviteButton = wizard.querySelector<HTMLButtonElement>(".setup-invite-add");
  const pills = wizard.querySelectorAll<HTMLElement>(".setup-wizard-pill");

  closeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      wizard.hidden = true;
    });
  });

  backButton?.addEventListener("click", () => {
    if (setupWizardCompleting) return;
    if (setupWizardStep === 3 && setupWizardExpanded) {
      setupWizardExpanded = false;
      setupWizardStep = 2;
    } else {
      setupWizardStep = Math.max(0, setupWizardStep - 1);
    }
    renderSetupWizard(wizard);
  });

  nextButton?.addEventListener("click", () => {
    if (setupWizardCompleting) return;
    void advanceSetupWizard(wizard);
  });

  skipButton?.addEventListener("click", () => {
    if (setupWizardCompleting) return;
    setupWizardStep = 4;
    renderSetupWizard(wizard);
  });

  startButtons.forEach((button) => button.addEventListener("click", () => {
    void completeSetupWizard(wizard);
  }));

  readyInviteButton?.addEventListener("click", () => {
    if (readyInviteButton.disabled || setupWizardCompleting) return;
    setupWizardExpanded = true;
    setupWizardStep = 3;
    renderSetupWizard(wizard);
  });

  addInviteButton?.addEventListener("click", () => {
    if (setupWizardCompleting) return;
    addInviteRow(wizard);
  });

  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (setupWizardCompleting) return;
      const step = Number(pill.dataset.setupStep ?? "0");
      if (Number.isFinite(step)) {
        const maxStep = setupWizardExpanded ? 4 : 2;
        if (setupWizardExpanded && step === 2) return;
        setupWizardStep = Math.min(maxStep, Math.max(0, step));
        renderSetupWizard(wizard);
      }
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !wizard.hidden && !setupWizardCompleting) wizard.hidden = true;
  });
}

function renderSetupWizard(wizard: HTMLElement): void {
  const panels = wizard.querySelectorAll<HTMLElement>(".setup-wizard-step");
  const pills = wizard.querySelectorAll<HTMLElement>(".setup-wizard-pill");
  const backButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-back");
  const secondaryButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-secondary");
  const nextButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-next");
  const skipButton = wizard.querySelector<HTMLButtonElement>(".setup-wizard-skip");
  const footer = wizard.querySelector<HTMLElement>(".setup-wizard-footer");

  panels.forEach((panel) => {
    panel.hidden = panel.dataset.setupPanel !== String(setupWizardStep);
  });
  pills.forEach((pill) => {
    if (pill.dataset.setupExtended !== undefined) {
      const shouldShow = setupWizardExpanded;
      const wasHidden = pill.hidden;
      pill.hidden = !shouldShow;
      if (shouldShow && wasHidden) {
        pill.classList.add("setup-wizard-pill-new");
        window.setTimeout(() => pill.classList.remove("setup-wizard-pill-new"), 260);
      }
    }
    if (pill.dataset.setupStep === "2") {
      pill.hidden = setupWizardExpanded;
    }
    const active = pill.dataset.setupStep === String(setupWizardStep);
    pill.classList.toggle("setup-wizard-pill-active", active);
    pill.setAttribute("aria-current", active ? "step" : "false");
  });

  if (backButton) backButton.disabled = setupWizardStep === 0;
  if (secondaryButton) secondaryButton.hidden = true;
  if (skipButton) skipButton.hidden = setupWizardStep !== 3;
  if (nextButton) {
    nextButton.hidden = setupWizardStep === 4;
    nextButton.textContent = "Continue";
  }
  if (footer) footer.hidden = setupWizardStep === 2 || setupWizardStep === 4;
  setSetupWizardBusy(wizard, setupWizardCompleting);
}

async function advanceSetupWizard(wizard: HTMLElement): Promise<void> {
  if (setupWizardStep === 1) {
    await saveSetupProfileForm(wizard);
  }

  if (setupWizardStep === 1 && setupWizardExpanded) {
    setupWizardStep = 3;
    renderSetupWizard(wizard);
    return;
  }

  if (setupWizardStep === 2) {
    await completeSetupWizard(wizard);
    return;
  }

  if (setupWizardStep === 3) {
    const saved = await savePendingOrganizationMembers(wizard);
    if (!saved) return;
  }

  if (setupWizardStep >= 4) {
    await completeSetupWizard(wizard);
    return;
  }

  setupWizardStep += 1;
  renderSetupWizard(wizard);
}

async function completeSetupWizard(wizard: HTMLElement): Promise<void> {
  if (setupWizardCompleting) return;
  setupWizardCompleting = true;
  setSetupWizardBusy(wizard, true);
  if (!setupWizardPreviewOnly) {
    try {
      await markOnboardingComplete();
      await loadAccountState();
    } catch (error) {
      setupWizardCompleting = false;
      setSetupWizardBusy(wizard, false);
      showSetupWizardError(wizard, getErrorMessage(error));
      return;
    }
  }
  wizard.hidden = true;
  const onComplete = setupWizardOnComplete;
  setupWizardOnComplete = null;
  setupWizardPreviewOnly = false;
  setupWizardCompleting = false;
  onComplete?.();
}

function setSetupWizardBusy(wizard: HTMLElement, busy: boolean): void {
  for (const element of Array.from(wizard.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("button,input,textarea,select"))) {
    if (busy) {
      element.dataset.setupPreviousDisabled = element.disabled ? "true" : "false";
      element.disabled = true;
    } else if (element.dataset.setupPreviousDisabled !== undefined) {
      element.disabled = element.dataset.setupPreviousDisabled === "true";
      delete element.dataset.setupPreviousDisabled;
    }
  }
}

function showSetupWizardError(wizard: HTMLElement, message: string): void {
  const panel = wizard.querySelector<HTMLElement>(`[data-setup-panel="${setupWizardStep}"]`);
  if (!panel) return;
  let error = panel.querySelector<HTMLElement>(".setup-wizard-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "preview-gate-error setup-wizard-error";
    panel.appendChild(error);
  }
  error.textContent = message;
  error.hidden = false;
}

function populateSetupProfileForm(wizard: HTMLElement): void {
  const displayName = currentProfile?.display_name ?? "";
  const [firstName, ...lastNameParts] = displayName.trim().split(/\s+/).filter(Boolean);
  const organizationName = activeOrganizationName();

  setInputValue(wizard, ".setup-profile-first-name", currentProfile?.first_name ?? firstName ?? "");
  setInputValue(wizard, ".setup-profile-last-name", currentProfile?.last_name ?? lastNameParts.join(" "));
  setInputValue(wizard, ".setup-profile-email", currentAuthEmail ?? currentProfile?.email ?? "");
  setInputValue(wizard, ".setup-profile-organization", currentProfile?.organization_name ?? organizationName);
  setInputValue(wizard, ".setup-profile-company", currentProfile?.company ?? "");
  setInputValue(wizard, ".setup-profile-job-title", currentProfile?.job_title ?? "");
  setInputValue(wizard, ".setup-profile-phone", currentProfile?.phone ?? "");
  setInputValue(wizard, ".setup-profile-address", currentProfile?.address ?? "");
  setInputValue(wizard, ".setup-profile-city", currentProfile?.city ?? "");
  setInputValue(wizard, ".setup-profile-state-province", currentProfile?.state_province ?? "");
  setInputValue(wizard, ".setup-profile-postal-code", currentProfile?.postal_code ?? "");
  setInputValue(wizard, ".setup-profile-country", currentProfile?.country ?? "");

  const emailInput = wizard.querySelector<HTMLInputElement>(".setup-profile-email");
  if (emailInput) {
    emailInput.readOnly = Boolean(currentAuthEmail);
    emailInput.disabled = Boolean(currentAuthEmail);
  }
}

async function saveSetupProfileForm(wizard: HTMLElement): Promise<void> {
  if (!currentProfile) return;
  if (setupWizardPreviewOnly) return;

  const firstName = getInputValue(wizard, ".setup-profile-first-name");
  const lastName = getInputValue(wizard, ".setup-profile-last-name");
  const email = normalizeInvitationEmail(getInputValue(wizard, ".setup-profile-email"));
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  const profileUpdate: {
    address: string | null;
    city: string | null;
    company: string | null;
    country: string | null;
    display_name: string | null;
    first_name: string | null;
    job_title: string | null;
    last_name: string | null;
    organization_name: string | null;
    phone: string | null;
    postal_code: string | null;
    state_province: string | null;
  } = {
    address: nullableInputValue(wizard, ".setup-profile-address"),
    city: nullableInputValue(wizard, ".setup-profile-city"),
    company: nullableInputValue(wizard, ".setup-profile-company"),
    country: nullableInputValue(wizard, ".setup-profile-country"),
    display_name: displayName,
    first_name: firstName || null,
    job_title: nullableInputValue(wizard, ".setup-profile-job-title"),
    last_name: lastName || null,
    organization_name: nullableInputValue(wizard, ".setup-profile-organization"),
    phone: nullableInputValue(wizard, ".setup-profile-phone"),
    postal_code: nullableInputValue(wizard, ".setup-profile-postal-code"),
    state_province: nullableInputValue(wizard, ".setup-profile-state-province"),
  };

  const { data, error } = await supabase.rpc("update_own_profile", {
    p_address: profileUpdate.address,
    p_city: profileUpdate.city,
    p_company: profileUpdate.company,
    p_country: profileUpdate.country,
    p_email: currentAuthEmail ? null : email || null,
    p_first_name: profileUpdate.first_name,
    p_job_title: profileUpdate.job_title,
    p_last_name: profileUpdate.last_name,
    p_organization_name: profileUpdate.organization_name,
    p_phone: profileUpdate.phone,
    p_postal_code: profileUpdate.postal_code,
    p_state_province: profileUpdate.state_province,
  });
  if (error) throw error;
  const result = data as { company_id?: string | null } | null;

  currentProfile = {
    ...currentProfile,
    address: profileUpdate.address,
    city: profileUpdate.city,
    company: profileUpdate.company,
    company_id: result?.company_id ?? null,
    country: profileUpdate.country,
    display_name: profileUpdate.display_name,
    email: currentAuthEmail ? currentProfile.email : email || currentProfile.email,
    first_name: profileUpdate.first_name,
    job_title: profileUpdate.job_title,
    last_name: profileUpdate.last_name,
    organization_name: profileUpdate.organization_name,
    phone: profileUpdate.phone,
    postal_code: profileUpdate.postal_code,
    state_province: profileUpdate.state_province,
  };
}

function setInputValue(root: ParentNode, selector: string, value: string): void {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (input) input.value = value;
}

function getInputValue(root: ParentNode, selector: string): string {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value.trim() ?? "";
}

function nullableInputValue(root: ParentNode, selector: string): string | null {
  return getInputValue(root, selector) || null;
}

function activeOrganizationName(): string {
  const activeMembership =
    currentMemberships.find((membership) => membership.organization_id === selectedOrganizationId) ??
    currentMemberships[0];
  const activeOrganization = firstRelation(activeMembership?.organizations ?? null);
  return activeOrganization?.name ?? "";
}

function activeOrganizationId(): string {
  const activeMembership =
    currentMemberships.find((membership) => membership.organization_id === selectedOrganizationId) ??
    currentMemberships[0];
  return activeMembership?.organization_id ?? "";
}

function addInviteRow(wizard: HTMLElement): void {
  const table = wizard.querySelector<HTMLElement>(".setup-invite-table");
  const addButton = wizard.querySelector<HTMLButtonElement>(".setup-invite-add");
  if (!table || !addButton) return;

  const row = document.createElement("div");
  row.className = "setup-invite-row";
  row.dataset.inviteRow = "";

  const name = document.createElement("input");
  name.className = "setup-invite-name";
  name.type = "text";
  name.autocomplete = "name";
  name.setAttribute("aria-label", "Name");

  const email = document.createElement("input");
  email.className = "setup-invite-email";
  email.type = "email";
  email.autocomplete = "email";
  email.setAttribute("aria-label", "Email");

  row.append(name, email);
  table.insertBefore(row, addButton);
  name.focus();
}

function readPendingOrganizationMemberRows(wizard: HTMLElement): PendingOrganizationMemberInput[] {
  return Array.from(wizard.querySelectorAll<HTMLElement>("[data-invite-row]")).map((row) => ({
    displayName: row.querySelector<HTMLInputElement>(".setup-invite-name")?.value ?? "",
    email: row.querySelector<HTMLInputElement>(".setup-invite-email")?.value ?? "",
  }));
}

async function savePendingOrganizationMembers(wizard: HTMLElement): Promise<boolean> {
  if (setupWizardPreviewOnly) return true;

  const errorLine = wizard.querySelector<HTMLElement>(".setup-invite-error");
  if (errorLine) errorLine.hidden = true;

  const rows = usedPendingOrganizationMemberRows(readPendingOrganizationMemberRows(wizard));
  const errors = pendingOrganizationMemberErrors(rows);
  if (errors.length > 0) {
    if (errorLine) {
      errorLine.textContent = errors[0] ?? "Check teammate details.";
      errorLine.hidden = false;
    }
    return false;
  }

  if (rows.length === 0) return true;

  const organizationId = activeOrganizationId();
  if (!organizationId && !setupWizardOnComplete) return true;
  if (!organizationId) {
    if (errorLine) {
      errorLine.textContent = "No organization is available for invitations.";
      errorLine.hidden = false;
    }
    return false;
  }

  const { error } = await supabase.rpc("create_organization_pending_members", {
    p_organization_id: organizationId,
    p_members: rows.map((row) => ({
      display_name: row.displayName ?? "",
      email: row.email,
    })),
  });

  if (error) {
    if (errorLine) {
      errorLine.textContent = getErrorMessage(error);
      errorLine.hidden = false;
    }
    return false;
  }

  return true;
}

function shouldShowOnboarding(): boolean {
  return Boolean(currentProfile?.id) && !currentProfile?.onboarding_completed_at;
}

/**
 * A ZERO-ROW UPDATE IS A FAILURE HERE, NOT A SUCCESS (2026-08-06, from AG's
 * report: "every time I refresh I get the wizard. still.").
 *
 * This used to check only `error`. PostgREST does not treat an UPDATE that
 * matches no rows as an error -- it returns success with nothing changed --
 * so for any user whose `profiles` row did not exist (every account created
 * before 202608060001's AFTER INSERT trigger existed; see
 * 202608060004_backfill_existing_accounts.sql), completing the wizard wrote
 * nothing, reported nothing, and the wizard returned on every refresh
 * forever. The failure was invisible at every layer: no console error, no
 * rejected promise, no UI message.
 *
 * `.select()` makes the write assert itself -- the statement now returns the
 * rows it touched, so "touched none" becomes a value this function can see
 * and refuse. The backfill migration is the actual fix for the missing rows;
 * this is the guard that stops the NEXT instance of this class of bug from
 * being silent, whatever its cause (an RLS policy change, a renamed column,
 * a user deleted mid-session).
 */
async function markOnboardingComplete(): Promise<void> {
  if (!currentProfile?.id) return;
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: completedAt })
    .eq("id", currentProfile.id)
    .select("id");
  if (error) {
    throw error;
  }
  if (!data || data.length === 0) {
    // Deliberately a thrown error rather than a silent return: the caller
    // (completeSetupWizard) surfaces this in the wizard and keeps the reviewer
    // there, which is correct -- onboarding genuinely did not complete, and
    // dropping them into the app would misreport that it had.
    throw new Error(
      "Could not save your setup — your account profile is missing. Please sign out and back in; if this persists, contact support."
    );
  }
  currentProfile = { ...currentProfile, onboarding_completed_at: completedAt };
}

function showInlineGateMessage(line: HTMLElement | null, message: string): void {
  if (!line) return;
  line.textContent = message;
  line.hidden = false;
}

function clearInvitationTokenFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite_token");
  url.searchParams.delete("invitation_token");
  window.history.replaceState({}, document.title, url.toString());
}

function wireAccountMenu(): void {
  const accountButton = document.querySelector<HTMLButtonElement>(".app-settings-account");
  // .app-admin-button (the standalone header button) was removed from
  // index.html on 2026-08-06 -- it duplicated the menu item below behind
  // the same flag. The lookup is deliberately NOT deleted: this runs once,
  // querySelector returning null is already the handled case throughout
  // this function, and keeping it means a stale cached index.html cannot
  // leave a live-looking Admin button wired to nothing.
  const adminHeaderButton = document.querySelector<HTMLButtonElement>(".app-admin-button");
  const adminMenuButton = document.querySelector<HTMLButtonElement>(".app-settings-admin");
  const signOutButton = document.querySelector<HTMLButtonElement>(".app-settings-sign-out");
  const panel = document.querySelector<HTMLElement>(".account-panel");
  const adminPanel = document.querySelector<HTMLElement>(".admin-panel");
  const closeButton = document.querySelector<HTMLButtonElement>(".account-panel-close");
  const adminCloseButton = document.querySelector<HTMLButtonElement>(".admin-panel-close");
  // ADMIN VISIBILITY. Both controls default to `hidden` in the markup and
  // are revealed only for an internal admin, so a profile that fails to
  // load leaves Admin hidden rather than exposed -- the safe direction.
  //
  // THIS IS PRESENTATION, NOT AUTHORIZATION, and the distinction matters:
  // anyone can unset `hidden` in devtools. What actually protects the
  // admin data is Supabase row-level security on is_internal_admin. If a
  // future admin capability is ever added that RLS does not cover, hiding
  // the menu item is not what makes it safe.
  const showAdmin = currentProfile?.is_internal_admin === true;

  if (adminHeaderButton) adminHeaderButton.hidden = !showAdmin;
  if (adminMenuButton) adminMenuButton.hidden = !showAdmin;

  accountButton?.addEventListener("click", () => {
    if (panel) {
      void renderAccountPanel(panel);
      panel.hidden = false;
    }
  });
  const openAdminPanel = () => {
    if (adminPanel) {
      adminPanel.hidden = false;
      void renderAdminPanel(adminPanel);
    }
  };
  adminHeaderButton?.addEventListener("click", openAdminPanel);
  adminMenuButton?.addEventListener("click", openAdminPanel);
  closeButton?.addEventListener("click", () => {
    if (panel) panel.hidden = true;
  });
  adminCloseButton?.addEventListener("click", () => {
    if (adminPanel) adminPanel.hidden = true;
  });
  signOutButton?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    clearLocalSessionOwnerId();
    window.location.reload();
  });
}

async function renderAccountPanel(panel: HTMLElement): Promise<void> {
  await loadAccountState();
  const activeMembership =
    currentMemberships.find((membership) => membership.organization_id === selectedOrganizationId) ??
    currentMemberships[0];
  const canInvite = canManageMembers(activeMembership?.role);
  const activeOrganization = firstRelation(activeMembership?.organizations ?? null);
  const orgName = activeOrganization?.name ?? "Personal organization";

  panel.querySelector<HTMLElement>(".account-panel-email")!.textContent =
    currentProfile?.email ?? "Signed in";
  panel.querySelector<HTMLElement>(".account-panel-org-name")!.textContent = orgName;
  panel.querySelector<HTMLElement>(".account-panel-role")!.textContent =
    activeMembership?.role ?? "member";

  const inviteForm = panel.querySelector<HTMLFormElement>(".account-invite-form");
  const inviteRole = panel.querySelector<HTMLSelectElement>(".account-invite-role");
  const inviteEmail = panel.querySelector<HTMLInputElement>(".account-invite-email");
  const inviteOutput = panel.querySelector<HTMLElement>(".account-invite-output");
  if (inviteForm) inviteForm.hidden = !canInvite;
  if (inviteOutput) inviteOutput.textContent = canInvite ? "" : "Owners and admins can invite teammates.";

  inviteForm?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (!activeMembership || !inviteEmail || !inviteRole || !inviteOutput) return;
      void sendInvitation(activeMembership.organization_id, inviteEmail.value, inviteRole.value, inviteOutput);
    },
    { once: true }
  );

  await renderMembers(panel, activeMembership?.organization_id ?? "");
}

async function renderMembers(panel: HTMLElement, organizationId: string): Promise<void> {
  const membersEl = panel.querySelector<HTMLElement>(".account-members");
  const invitationsEl = panel.querySelector<HTMLElement>(".account-invitations");
  if (!membersEl || !invitationsEl || !organizationId) return;

  const { data: members, error: membersError } = await supabase
    .from("organization_members")
    .select("role,profiles(email,display_name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (membersError) throw membersError;

  membersEl.textContent = "";
  for (const row of members ?? []) {
    const profile = firstRelation(
      (row as unknown as { profiles: { email: string | null; display_name: string | null } | { email: string | null; display_name: string | null }[] | null }).profiles
    );
    membersEl.appendChild(
      accountLine(profile?.display_name || profile?.email || "Member", (row as { role: string }).role)
    );
  }

  const { data: invitations } = await supabase
    .from("organization_invitations")
    .select("id,email,role,status,expires_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  invitationsEl.textContent = "";
  for (const invitation of ((invitations ?? []) as InvitationRow[])) {
    invitationsEl.appendChild(
      accountLine(invitation.email, `${invitation.role} invitation, expires ${new Date(invitation.expires_at).toLocaleDateString()}`)
    );
  }
}

function accountLine(label: string, detail: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "account-line";
  const strong = document.createElement("strong");
  strong.textContent = label;
  const span = document.createElement("span");
  span.textContent = detail;
  row.append(strong, span);
  return row;
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function sendInvitation(
  organizationId: string,
  rawEmail: string,
  rawRole: string,
  output: HTMLElement
): Promise<void> {
  const email = normalizeInvitationEmail(rawEmail);
  const role = isOrganizationRole(rawRole) ? rawRole : "member";
  output.textContent = "";

  const { data, error } = await supabase.rpc("invite_organization_member", {
    p_email: email,
    p_organization_id: organizationId,
    p_redirect_origin: window.location.origin + window.location.pathname,
    p_role: role,
  });

  if (error) {
    output.textContent = getErrorMessage(error);
    return;
  }

  const result = data as { invitation_url?: string } | null;
  output.textContent = result?.invitation_url
    ? `Invitation created. Share this link: ${result.invitation_url}`
    : "Invitation created.";
}

async function renderAdminPanel(panel: HTMLElement): Promise<void> {
  const status = panel.querySelector<HTMLElement>(".admin-status");
  const content = panel.querySelector<HTMLElement>(".admin-content");
  const navButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>(".admin-nav-button"));
  const refreshButton = panel.querySelector<HTMLButtonElement>(".admin-refresh");
  const startInput = panel.querySelector<HTMLInputElement>(".admin-range-start");
  const endInput = panel.querySelector<HTMLInputElement>(".admin-range-end");

  for (const button of navButtons) {
    const tab = button.dataset.adminTab as AdminTab | undefined;
    button.classList.toggle("admin-nav-button-active", tab === adminTab);
    button.onclick = () => {
      if (!tab) return;
      adminTab = tab;
      adminScope = {};
      void renderAdminPanel(panel);
    };
  }
  if (refreshButton) refreshButton.onclick = () => void renderAdminPanel(panel);
  if (!status || !content) return;

  status.textContent = "Loading metrics...";
  status.className = "admin-status";
  content.textContent = "";

  const { data, error } = await supabase.rpc("admin_usage_metrics", {
    p_organization_id: adminScope.organizationId ?? null,
    p_range_end: dateInputEnd(endInput?.value ?? ""),
    p_range_start: dateInputStart(startInput?.value ?? ""),
    p_scope: adminScope.userId ? "user" : adminScope.organizationId ? "organization" : "system",
    p_user_id: adminScope.userId ?? null,
  });

  if (error) {
    status.textContent = getErrorMessage(error);
    status.className = "admin-status admin-status-error";
    return;
  }

  const metrics = (data ?? {}) as AdminUsageMetricsResponse;
  status.textContent = adminScopeLabel(metrics);

  if (adminTab === "users") renderAdminUsers(content, metrics.users ?? [], panel);
  else if (adminTab === "organizations") renderAdminOrganizations(content, metrics.organizations ?? [], panel);
  else if (adminTab === "setup") renderAdminSetup(content, panel);
  else renderAdminMetrics(content, metrics);
}

function renderAdminMetrics(content: HTMLElement, metrics: AdminUsageMetricsResponse): void {
  const summary = metrics.summary ?? {};
  content.appendChild(
    adminSummaryGrid([
      ["Registered users", summary.totalRegisteredUsers],
      ["Processed document", summary.usersWhoProcessedDocument],
      ["Documents started", summary.documentsStarted],
      ["Documents completed", summary.documentsCompleted],
      ["Completion rate", percentValue(summary.completionRate)],
      ["Avg completion", durationValue(summary.averageCompletionSeconds)],
      ["Pages", summary.totalPagesProcessed],
      ["Decisions made", summary.totalDecisionsMade],
      ["Decisions avoided", summary.totalDecisionsAvoided],
      ["Avoided", percentValue(summary.overallDecisionsAvoidedPercentage)],
      ["Exports", summary.exportCount],
      ["Active today", summary.activeUsersToday],
      ["Docs this month", summary.documentsThisMonth],
    ])
  );

  content.appendChild(
    adminTable(
      ["Period", "Documents", "Active users"],
      [
        ["Today", numberValue(summary.documentsToday), numberValue(summary.activeUsersToday)],
        ["This week", numberValue(summary.documentsThisWeek), numberValue(summary.activeUsersThisWeek)],
        ["This month", numberValue(summary.documentsThisMonth), numberValue(summary.activeUsersThisMonth)],
      ]
    )
  );
}

function renderAdminUsers(content: HTMLElement, users: AdminUsageUserRow[], panel: HTMLElement): void {
  if (users.length === 0) {
    content.appendChild(emptyAdminMessage("No users found for this filter."));
    return;
  }
  content.appendChild(
    adminTable(
      ["User", "Email", "Started", "Completed", "Incomplete", "Avoided", "Avg time", "Exports", "Recent"],
      users.map((user) => [
        linkButton(user.display_name || "User", () => {
          adminTab = "metrics";
          adminScope = { userId: user.user_id };
          void renderAdminPanel(panel);
        }),
        user.email ?? unavailable(),
        numberValue(user.documents_started),
        numberValue(user.documents_completed),
        numberValue(user.documents_incomplete),
        percentFromCounts(user.total_decisions_avoided, user.total_decisions_made),
        durationValue(user.average_completion_seconds),
        numberValue(user.export_count),
        dateValue(user.most_recent_document_at),
      ])
    )
  );
}

function renderAdminOrganizations(content: HTMLElement, organizations: AdminUsageOrganizationRow[], panel: HTMLElement): void {
  if (organizations.length === 0) {
    content.appendChild(emptyAdminMessage("No organizations found for this filter."));
    return;
  }
  content.appendChild(
    adminTable(
      ["Organization", "Members", "Active users", "Started", "Completed", "Avoided", "Avg time", "Exports", "Recent"],
      organizations.map((organization) => [
        linkButton(organization.name || "Organization", () => {
          adminTab = "metrics";
          adminScope = { organizationId: organization.organization_id };
          void renderAdminPanel(panel);
        }),
        numberValue(organization.active_member_count),
        numberValue(organization.active_users),
        numberValue(organization.documents_started),
        numberValue(organization.documents_completed),
        percentFromCounts(organization.total_decisions_avoided, organization.total_decisions_made),
        durationValue(organization.average_completion_seconds),
        numberValue(organization.export_count),
        dateValue(organization.most_recent_activity),
      ])
    )
  );
}

function renderAdminSetup(content: HTMLElement, panel: HTMLElement): void {
  content.appendChild(
    adminSummaryGrid([
      ["Supabase", "Configured in env"],
      ["Auth", "Google/email"],
      ["Admin role", "profiles.is_internal_admin"],
      ["Metrics", "Aggregate only"],
    ])
  );
  const button = document.createElement("button");
  button.className = "primary-action admin-panel-action";
  button.type = "button";
  button.textContent = "Preview Account Setup";
  button.addEventListener("click", () => {
    panel.hidden = true;
    showSetupWizard(null, { previewOnly: true });
  });
  content.appendChild(button);
}

function adminSummaryGrid(cards: Array<[string, string | number | null | undefined]>): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "admin-summary-grid";
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "admin-metric-card";
    const labelEl = document.createElement("span");
    labelEl.className = "admin-metric-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "admin-metric-value";
    valueEl.textContent = value === null || value === undefined || value === "" ? "Unavailable" : String(value);
    card.append(labelEl, valueEl);
    grid.appendChild(card);
  }
  return grid;
}

function adminTable(headers: string[], rows: Array<Array<string | HTMLElement>>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "admin-table-wrap";
  const table = document.createElement("table");
  table.className = "admin-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of headers) {
    const th = document.createElement("th");
    th.textContent = header;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      if (typeof value === "string") td.textContent = value;
      else td.appendChild(value);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function linkButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function emptyAdminMessage(message: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "admin-status";
  p.textContent = message;
  return p;
}

function adminScopeLabel(metrics: AdminUsageMetricsResponse): string {
  if (adminScope.userId) {
    const user = (metrics.users ?? []).find((row) => row.user_id === adminScope.userId);
    return `User metrics${user?.display_name ? `: ${user.display_name}` : ""}`;
  }
  if (adminScope.organizationId) {
    const organization = (metrics.organizations ?? []).find((row) => row.organization_id === adminScope.organizationId);
    return `Organization metrics${organization?.name ? `: ${organization.name}` : ""}`;
  }
  return "System-wide metrics";
}

function dateInputStart(value: string): string | null {
  return value ? `${value}T00:00:00.000Z` : null;
}

function dateInputEnd(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function numberValue(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

function percentValue(value: number | null | undefined): string {
  return typeof value === "number" ? `${value}%` : "Unavailable";
}

function percentFromCounts(avoided: number | null | undefined, made: number | null | undefined): string {
  const avoidedCount = avoided ?? 0;
  const madeCount = made ?? 0;
  const total = avoidedCount + madeCount;
  return total > 0 ? `${Math.round((avoidedCount / total) * 1000) / 10}%` : "Unavailable";
}

function durationValue(seconds: number | null | undefined): string {
  if (typeof seconds !== "number") return "Unavailable";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}h`;
}

function dateValue(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : unavailable();
}

function unavailable(): string {
  return "Unavailable";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error_description", "description", "error"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim();
      }
    }
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Something went wrong.";
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  window.addEventListener("pageshow", (event: PageTransitionEvent) => {
    if (event.persisted) window.location.reload();
  });

  const gate = document.querySelector<HTMLElement>(".preview-gate");
  bootstrap(gate).catch((error) => {
    showRecoverableGateError(gate, error);
  });
}
