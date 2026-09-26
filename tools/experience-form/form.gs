/**
 * Builds the "Share your experience" form for the SMART Health Check-in
 * connectathon. Bind this script to a blank Google Form (form menu > Apps
 * Script), paste it in, and run buildForm. It rebuilds the form in place, so
 * running it again resets the questions (responses are kept by Forms).
 *
 * Needs only the forms.currentonly scope: in Project Settings, show the
 * manifest and set "oauthScopes": ["https://www.googleapis.com/auth/forms.currentonly"].
 *
 * The share page and both prompts link to this form:
 * https://smart-health-checkin.org/connectathon/share.html
 */
function buildForm() {
  const form = FormApp.getActiveForm();
  form.getItems().forEach((item) => form.deleteItem(item));

  form.setTitle('SMART Health Check-in: share your experience');
  form.setDescription(
    'Tell us how trying SMART Health Check-in went for you: what worked, what was confusing, ' +
    'and what would make you trust it. Everything in the demos is made up, so please do not ' +
    'include real health information.\n\n' +
    'If an AI assistant helped you write a report (see smart-health-checkin.org/connectathon/share.html), ' +
    'paste it below. Or just write in your own words.\n\n' +
    'Reports are public by default: we may publish them on the connectathon site and in summaries, credited ' +
    'with the name and organization you give below, or anonymously if you leave those blank. Your email ' +
    'address is never published. Tick the box at the end to keep your report private.'
  );

  form.addParagraphTextItem()
    .setTitle('Your report')
    .setHelpText('Paste the report your assistant drafted, or write what happened in your own words.')
    .setRequired(true);

  const role = form.addCheckboxItem().setTitle('Which describe you? (choose all that apply)');
  role.setChoices([
    role.createChoice('Patient or caregiver'),
    role.createChoice('Clinic or practice staff'),
    role.createChoice('Developer of an EHR, portal, or other Verifier (the side that asks for data)'),
    role.createChoice('Developer of a wallet (the side that shares data)'),
  ]).showOtherOption(true);

  form.addTextItem().setTitle('Your name and organization, as you would like to be credited (optional; leave blank to be anonymous)');

  form.addTextItem()
    .setTitle('Email, if we may follow up (optional)')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());

  const privacy = form.addCheckboxItem()
    .setTitle('Keep my report private')
    .setHelpText('Leave this unticked to let us publish your report.');
  privacy.setChoices([privacy.createChoice('Keep my report private (organizers only)')]);

  form.addParagraphTextItem().setTitle('Anything else?');

  form.setConfirmationMessage('Thank you. Your report helps shape SMART Health Check-in.');
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);
  // Forms must be published before they can accept responses.
  try {
    form.setPublished(true);
    form.setAcceptingResponses(true);
  } catch (e) {
    Logger.log('Publish from the form editor: ' + e);
  }

  Logger.log('Respond at: ' + form.getPublishedUrl());
  try {
    Logger.log('Short link: ' + form.shortenFormUrl(form.getPublishedUrl()));
  } catch (e) {
    Logger.log('No short link: ' + e);
  }
}
