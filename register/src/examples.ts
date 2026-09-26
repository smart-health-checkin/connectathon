// Example participant files shown on the registration form. tests/participants.test.ts checks they validate.
import type { Participant } from "./participant.ts";

export const EXAMPLES: { id: string; title: string; summary: string; file: string; participant: Participant }[] = [
  {
    id: "native-wallet-example",
    title: "A native wallet only, with no public build",
    summary: "An Android and iPhone app. Android testers ask for a test-track invite; the iPhone build waits on Apple, so the team runs it for testers.",
    file: "example-health.json",
    participant: {
      organization: "Example Health",
      homepage: "https://example.org",
      contacts: [{ name: "Pat Developer", github: "pat-developer", slack: "Pat Developer" }],
      components: [
        {
          id: "example-health-wallet",
          role: "native-wallet",
          name: "Example Health",
          description: "A patient app that answers check-in requests from records the patient has connected. Renders questionnaires.",
          status: "up",
          platforms: ["android", "ios"],
          access: "invite",
          requirements: "Android 10 or later with Chrome 141 or later; iPhone with iOS 26 and Safari",
          largeResponses: true,
          testPatient: "Jane Test, born 1970, with problems, medications, allergies, and an insurance card",
          notes: "Android: message Pat in Slack with the Google account to add to our test track. iPhone: awaiting Apple's approval, so find us in the event's main room and we'll run it with you on our phone.",
        },
      ],
    },
  },
  {
    id: "web-wallet-example",
    title: "A web wallet",
    summary: "A wallet that runs as a website. It goes into wallets.json, so Verifier pages list it in their wallet menus.",
    file: "example-records.json",
    participant: {
      organization: "Example Records",
      homepage: "https://records.example.org",
      contacts: [{ name: "Sam Builder", github: "sam-builder", email: "sam@records.example.org" }],
      components: [
        {
          id: "example-records-web",
          role: "web-wallet",
          name: "Example Records",
          description: "A web wallet holding US Core records and an insurance card.",
          status: "up",
          walletUrl: "https://records.example.org/checkin",
          iconUrl: "https://records.example.org/icon.svg",
          target: "tab",
          testPatient: "Lee Test, born 1992, with immunizations and an insurance card",
          notes: "Sign in with any email; no password is checked.",
        },
      ],
    },
  },
  {
    id: "verifier-examples",
    title: "Verifiers: a check-in page and a phone app",
    summary: "A clinic's web check-in page, which anyone can open, and its Android app, which wallet teams install from a link.",
    file: "example-clinic.json",
    participant: {
      organization: "Example Clinic",
      contacts: [{ name: "Alex Clinic", github: "alex-clinic" }],
      components: [
        {
          id: "example-clinic-checkin",
          role: "ehr",
          name: "Example Clinic check-in",
          description: "Pre-visit check-in page. Asks for insurance, allergies, and a PHQ-2.",
          status: "up",
          url: "https://clinic.example.org/checkin",
        },
        {
          id: "example-clinic-app",
          role: "ehr",
          name: "Example Clinic app",
          description: "The patient app's pre-visit check-in, calling the phone's wallets directly.",
          status: "not-yet",
          platforms: ["android"],
          access: "install",
          installUrl: "https://clinic.example.org/downloads/example-clinic.apk",
          requirements: "Android 10 or later",
        },
      ],
    },
  },
];
