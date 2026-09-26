# SMART Health Check-in connectathon

<p class="draft"><b>Draft.</b> The event date isn't set yet, so dates below are marked <code>{{TBD: …}}</code>. Everything else linked here is live. Components marked "not yet" in the <a href="directory.html">directory</a> aren't ready for testing.</p>

KTC pre-visit check-in connectathon, {{TBD: event date and time}}, about 3 hours, on Zoom: {{TBD: Zoom link}}.

The connectathon is about experience with a new way of checking in, not a formal conformance test. Software teams connect clinic systems to patients' health apps, and patients, clinic staff, and community members try the result and tell us how it feels. It uses the [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/) draft specification.

## Pick your path

<div class="paths">
<a class="path" href="patients.html"><b>Patients and community members</b><span>Try the demos on any phone or computer, and tell us how it went.</span><em>Start here →</em></a>
<a class="path" href="clinic-staff.html"><b>Clinic and front-desk staff</b><span>See check-in from the practice side: what arrives, and how it fits the front desk.</span><em>Start here →</em></a>
<a class="path" href="verifier-developers.html"><b>EHR, portal, and Verifier developers</b><span>Build the check-in page that asks for data.</span><em>Start here →</em></a>
<a class="path" href="wallet-developers.html"><b>Wallet developers</b><span>Build the health app that answers, on a phone or on the web.</span><em>Start here →</em></a>
<a class="path" href="observers.html"><b>Observers</b><span>Follow along, and read what people found.</span><em>Start here →</em></a>
</div>

## How the event works

- **One Zoom meeting.** Everyone joins the main room for the opening, the hourly check-ins, and the closing report-out, where participants share what they found.
- **One chat.** Questions, pairing, and links go in `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)).
- **Breakout rooms you start yourself.** Two people debugging together: start a Slack huddle in a direct message; it has video and screen sharing. A group, or someone not on the Slack: open `https://meet.jit.si/ktc-checkin-<ehr>-<wallet>` and post the link in the channel.
- **Registration is for software.** Teams bringing an EHR, portal, or wallet [register it](register/) so others can test against it (see the register step for [Verifier developers](verifier-developers.html#register) or [wallet developers](wallet-developers.html#register)). Everyone else just joins.
- **Made-up data only.** Every patient, record, and clinic in the demos and test tools is synthetic. Never use real health information, even your own.

## Schedule

- **{{TBD: date, 3 weeks before}}:** reference implementations, [test tools](scenarios.html#testing-ehr-and-testing-wallet), the [wallet registry](scenarios.html#wallet-registry), [example questionnaires](scenarios.html#example-questionnaires), and [baseline requests](scenarios.html#baseline-requests) are live.
- **{{TBD: date, 1 week before}}:** software teams aim to have their component up for [self-serve testing](scenarios.html#how-to-test) and to have tried a first connection.
- **The event:** ideally spent on the harder problems and live debugging. Some people will still be finishing basic setup, and that's fine.

## For developers: scenarios and tools

- [Test scenarios](scenarios.html): baseline requests, the minimum, larger-data, and optional scenarios, the ground rules, and shared resources.
- [Testing EHR](testing-ehr/) and [SMART Testing Wallet](testing-wallet/): known-good counterparts for self-serve testing.
- [Directory](directory.html) of who is bringing what, and [results](results.html) of formal scenario runs.

## Sharing what you found

Everyone is invited to write a short experience report: what you tried, what worked, what was hard, and what you'd change. The [share page](share.html) has prompts that turn any AI assistant into a guide for writing one, and the form to send it. Reports are public, credited with the name and organization you give, or anonymous.
