// Join dialog: opens from the "join" button, validates the form, filters spam,
// and hands the data to submitSignature().

// The Google Apps Script web app that saves each signature as a row in a private Google Sheet.
// While this is null NOTHING is sent anywhere: the data is only logged to the console.
const SIGNATURE_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbyNS1vK58zWhdhVvyzswaSwU7KNsE95HA-MpbjQpFzmbYYZu5l2E8vL9XBXMtnlnDnFNQ/exec';

// Bots that fill the form in under this many milliseconds are ignored.
const MIN_FILL_TIME_MS = 3000;

// What the person sees when sending fails.  The server answers { ok: false, error: <key> }
// with one of the keys below; anything else (no connection, a crash) uses `general`.
const SEND_ERRORS = {
  busy: 'קיים עומס חריג. בעוד מספר דקות, נסי לשלוח שוב',
  verification: 'האימות נכשל. נסי לשלוח שוב',
  general: 'אירעה שגיאה בשליחה. וודאי שהאינטרנט מחובר ונסי לשלוח שוב',
};

const dialog = document.getElementById('join-dialog');
const form = document.getElementById('join-form');
const thanks = document.getElementById('join-thanks');
const statusLine = document.getElementById('join-status');
const submitButton = form.querySelector('[type="submit"]');

// When the form was first opened (0 = not yet); closing and re-opening does not restart it.
let openedAt = 0;

// ---- Share the petition with friends -----------------------------------------------

const SHARE_MESSAGE = [
  'היי!',
  'ראיתי את זה וחשבתי עלייך 😊',
  'רוצה לתרום לביטחון המדינה ביחידת המודיעין הכי משמעותית, 8200, אבל אין מסגרת תורנית לבנות דתיות שמאפשרת את זה? בדיוק על זה אנחנו מתארגנות!',
  'מוזמנת לקרוא, לחתום ולהעביר הלאה לחברות נוספות 🤩',
  'https://yitshaks.github.io/petition-8200',
].join('\n\n');

// Opens the phone's share sheet (WhatsApp and so on); where there is none, WhatsApp itself.
async function sharePetition() {
  if (navigator.share) {
    try {
      await navigator.share({ text: SHARE_MESSAGE });
    } catch (error) {
      // the person closed the share sheet: nothing to do
    }
    return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(SHARE_MESSAGE)}`, '_blank', 'noopener');
}

document.querySelectorAll('[data-share]').forEach((button) => button.addEventListener('click', sharePetition));

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

const THIS_YEAR = new Date().getFullYear();

const validators = {
  firstName: (v) => (v.trim() ? '' : 'הזיני שם פרטי'),
  lastName: (v) => (v.trim() ? '' : 'הזיני שם משפחה'),
  mobile: (v) => (/^05\d{8}$/.test(normalizeMobile(v)) ? '' : 'הזיני מספר תקין'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'הזיני דוא"ל תקין'),
  birthYear: (v) => (/^\d{4}$/.test(v.trim()) && +v >= 1900 && +v <= THIS_YEAR ? '' : 'הזיני שנה תקינה'),
  interested: (v, el) => (el.checked ? '' : 'סמני תיבה זו. העצומה מיועדת לבנות המעוניינות לשרת במסגרת זו'),
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
  mobile: 'מספר טלפון נייד',
  email: 'דוא"ל',
  birthYear: 'שנת לידה',
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
  if (invalid.length) statusLine.textContent = `הזיני או תקני:\n${invalid.join(', ')}`;
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
    birthYear: Number(data.get('birthYear')),
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
    // text/plain (the body is still JSON): Apps Script does not answer a CORS preflight request
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(signature),
  });
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(`Server refused: ${result.error}`), { key: result.error });
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
    statusLine.textContent = SEND_ERRORS[error.key] ?? SEND_ERRORS.general;
  } finally {
    submitButton.disabled = false;
  }
});
