/** Links used in several places on the connectathon site. Change them here only. */

/** The experience-report form (Google Forms; no account needed). */
export const FORM_URL = "https://forms.gle/fXJf1H3zfZcyTNum7";

/** Where people pick a prompt and find the form. */
export const SHARE_URL = "https://smart-health-checkin.org/connectathon/share.html";

/** Prompts people paste into an AI assistant; `{{FORM_URL}}` is filled in at build time. */
export const PROMPTS = [
  {
    file: "try-it-as-a-patient.md",
    title: "Try it as a patient",
    who: "Patient and community representatives, and anyone who wants the patient's view.",
    what: "Walks you through three short demos that work on any phone or computer, asks how each one went, and helps you write a short report. About 15 minutes.",
  },
  {
    file: "debrief.md",
    title: "Debrief your testing",
    who: "Developers and implementers: EHR and portal teams, wallet builders.",
    what: "Paste in your notes, logs, or Testing EHR runs. It asks a few questions and drafts a short report on what worked, what was hard, and where the spec or tools fell short.",
  },
];
