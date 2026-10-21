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

// Israeli mobile in the local form: dashes, spaces and the country code (+972 / 00972) are accepted
// and removed, e.g. "+972 50-123-4567" becomes "0501234567".
function normalizeMobile(value) {
  const digits = digitsOnly(value).replace(/^(00)?972/, '');
  return digits.startsWith('0') || digits === '' ? digits : `0${digits}`;
}

const validators = {
  firstName: (v) => (v.trim() ? '' : 'נא למלא שם פרטי'),
  lastName: (v) => (v.trim() ? '' : 'נא למלא שם משפחה'),
  mobile: (v) => (/^05\d{8}$/.test(normalizeMobile(v)) ? '' :'נא להזין מספר נייד תקין, למשל 0501234567'),
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

const fieldLabels = {
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  mobile: 'טלפון נייד',
  email: 'דוא"ל',
  age: 'גיל',
  interested: 'אישור ההצטרפות',
};

function validate() {
  const invalid = [];
  for (const [name, check] of Object.entries(validators)) {
    const message = check(form.elements[name].value, form.elements[name]);
    showError(name, message);
    if (message) invalid.push(fieldLabels[name]);
  }
  // the form may be taller than the screen: name the fields next to the button
  if (invalid.length) statusLine.textContent = `יש למלא או לתקן: ${invalid.join(', ')}`;
  return !invalid.length;
}

// clear an error as soon as the field becomes valid
form.addEventListener('input', (event) => {
  const name = event.target.name;
  if (validators[name]) showError(name, validators[name](event.target.value, event.target));
});

// show the cleaned-up number when leaving the field (not while typing, which would move the cursor)
form.elements.mobile.addEventListener('blur', (event) => {
  const field = event.target;
  const cleaned = normalizeMobile(field.value);
  if (cleaned) field.value = cleaned;
});

// ---- Submit ------------------------------------------------------------------

function readForm() {
  const data = new FormData(form);
  return {
    firstName: data.get('firstName').trim(),
    lastName: data.get('lastName').trim(),
    mobile: normalizeMobile(data.get('mobile')),
    email: data.get('email').trim(),
    age: Number(data.get('age')),
    city: data.get('city').trim(),
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
