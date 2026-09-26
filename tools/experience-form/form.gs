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
    'paste it below. Or just write in your own words.'
  );

  form.addParagraphTextItem()
    .setTitle('Your report')
    .setHelpText('Paste the report your assistant drafted, or write what happened in your own words.')
    .setRequired(true);

  const role = form.addMultipleChoiceItem().setTitle('Which best describes you?');
  role.setChoices([
    role.createChoice('Patient or caregiver'),
    role.createChoice('Clinic or practice staff'),
    role.createChoice('Developer or implementer'),
  ]).showOtherOption(true);

  form.addTextItem().setTitle('Your name (optional)');

  form.addTextItem()
    .setTitle('Email, if we may follow up (optional)')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());

  const quote = form.addMultipleChoiceItem()
    .setTitle('May we quote from your report, without your name?');
  quote.setChoices([quote.createChoice('Yes'), quote.createChoice('No')]);

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
