// Join dialog: opens from the "join" button, validates the form, filters spam,
// and hands the data to submitSignature().

// TODO: set this to the real endpoint once the server exists.
// While it is null NOTHING is sent anywhere: the data is only logged to the console.
const SIGNATURE_ENDPOINT = null;

// Bots that fill the form in under this many milliseconds are ignored.
const MIN_FILL_TIME_MS = 3000;

const dialog = document.getElementById('join-dialog');
const form = document.getElementById('join-form');
const thanks = document.getElementById('join-thanks');
const statusLine = document.getElementById('join-status');
const submitButton = form.querySelector('[type="submit"]');

// When the form was first opened (0 = not yet); closing and re-opening does not restart it.
let openedAt = 0;

// ---- Open / close ------------------------------------------------------------

document.getElementById('join').addEventListener('click', () => {
  form.hidden = false;
  thanks.hidden = true;
  statusLine.textContent = '';
  clearErrors();
  openedAt ||= Date.now();
  dialog.showModal();
});

dialog.addEventListener('click', (event) => {
  // a click on the dark backdrop lands on the <dialog> element itself
  if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
});

// ---- Validation --------------------------------------------------------------

const digitsOnly = (value) => value.replace(/\D/g, '');

const validators = {
  firstName: (v) => (v.trim() ? '' : 'נא למלא שם פרטי'),
  lastName: (v) => (v.trim() ? '' : 'נא למלא שם משפחה'),
  mobile: (v) => (/^05\d{8}$/.test(digitsOnly(v)) ? '' : 'נא להזין מספר נייד תקין, למשל 0501234567'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'נא להזין כתובת דוא"ל תקינה'),
  age: (v) => (Number.isInteger(+v) && +v >= 10 && +v <= 99 ? '' : 'נא להזין גיל תקין'),
  interested: (v, el) => (el.checked ? '' : 'שדה חובה'),
};

function showError(name, message) {
  const field = form.elements[name].closest('.field');
  field.toggleAttribute('data-invalid', Boolean(message));
  form.querySelector(`[data-error-for="${name}"]`).textContent = message;
}

function clearErrors() {
  for (const name of Object.keys(validators)) showError(name, '');
}

function validate() {
  let firstInvalid = null;
  for (const [name, check] of Object.entries(validators)) {
    const message = check(form.elements[name].value, form.elements[name]);
    showError(name, message);
    if (message && !firstInvalid) firstInvalid = form.elements[name];
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

// clear an error as soon as the field becomes valid
form.addEventListener('input', (event) => {
  const name = event.target.name;
  if (validators[name]) showError(name, validators[name](event.target.value, event.target));
});

// ---- Submit ------------------------------------------------------------------

function readForm() {
  const data = new FormData(form);
  return {
    firstName: data.get('firstName').trim(),
    lastName: data.get('lastName').trim(),
    mobile: digitsOnly(data.get('mobile')),
    email: data.get('email').trim(),
    age: Number(data.get('age')),
    ulpana: data.get('ulpana').trim(),
    notes: data.get('notes').trim(),
    interested: data.get('interested') === 'on', // also consent to be notified
    publishName: data.get('publishName') === 'on',
  };
}

async function submitSignature(signature) {
  if (!SIGNATURE_ENDPOINT) {
    console.warn('Signature NOT sent: SIGNATURE_ENDPOINT is not configured yet.', signature);
    return;
  }
  const response = await fetch(SIGNATURE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signature),
  });
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
}

function showThanks() {
  form.hidden = true;
  thanks.hidden = false;
  form.reset();
  openedAt = 0; // the next signature starts a new timer
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusLine.textContent = '';
  if (!validate()) return;

  // Spam filters: a filled hidden field, or a form completed unrealistically fast.
  // Pretend it worked, so a bot learns nothing, but send nothing.
  const looksLikeBot = form.elements.website.value !== '' || Date.now() - openedAt < MIN_FILL_TIME_MS;
  if (looksLikeBot) {
    showThanks();
    return;
  }

  submitButton.disabled = true;
  try {
    await submitSignature(readForm());
    showThanks();
  } catch (error) {
    console.error(error);
    statusLine.textContent = 'אירעה שגיאה בשליחה. נסי שוב בעוד רגע.';
  } finally {
    submitButton.disabled = false;
  }
});
