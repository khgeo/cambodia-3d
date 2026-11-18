// Google Earth Engine in the browser: sign in with Google (OAuth token, Google Identity Services), then the
// Earth Engine JavaScript client runs the computations in the user's own Cloud project.
// The OAuth client ID is public by design; no secret is kept here.
export const CLIENT_ID = '425364258325-ecgc6g87k8gplnklqfm1vj35b349m6jp.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/earthengine.readonly', 'https://www.googleapis.com/auth/earthengine'];
const EE_JS = 'https://cdn.jsdelivr.net/npm/@google/earthengine@1.7.53/build/ee_api_js.js', GSI = 'https://accounts.google.com/gsi/client';
let tokenClient = null, token = null, ready = null, scopeLevel = 0;
export const state = { signedIn: false, project: '', email: '', error: '' };
const listeners = new Set(); export const onChange = f => { listeners.add(f); return () => listeners.delete(f); }; const emit = () => listeners.forEach(f => { try { f(state); } catch (e) { } });
const script = src => new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s); });
export const getProject = () => { try { return localStorage.getItem('cambodia3d.geeProject') || 'gee-geotech'; } catch (e) { return 'gee-geotech'; } };
export const setProject = p => { try { localStorage.setItem('cambodia3d.geeProject', p); } catch (e) { } };

function askToken(prompt) {
  return new Promise((ok, bad) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES[scopeLevel], prompt,
      callback: r => r.error ? bad(new Error(r.error_description || r.error)) : ok(r),
      error_callback: e => bad(new Error(e.message || e.type || 'Sign-in was closed')),
    });
    tokenClient.requestAccessToken();
  });
}
const setToken = r => { token = { access: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 }; ee.data.setAuthToken(CLIENT_ID, 'Bearer', r.access_token, r.expires_in, [], null, false); };
const initEE = project => new Promise((ok, bad) => ee.initialize(null, null, ok, e => bad(new Error(String(e))), null, project));
export const evaluate = o => new Promise((ok, bad) => o.evaluate((r, e) => e ? bad(new Error(e)) : ok(r)));
export const thumbURL = (img, params) => new Promise((ok, bad) => img.getThumbURL(params, (u, e) => e ? bad(new Error(e)) : ok(u)));
export const downloadURL = (img, params) => new Promise((ok, bad) => img.getDownloadURL(params, (u, e) => e ? bad(new Error(e)) : ok(u)));

// sign in (shows the Google window the first time) and initialise Earth Engine; returns the ee object
export async function connect(project = getProject(), interactive = true) {
  if (ready && state.signedIn && state.project === project && token && Date.now() < token.exp) return ee;
  state.error = ''; emit();
  try {
    await Promise.all([script(GSI), script(EE_JS)]);
    const r = await askToken(token ? '' : interactive ? 'consent' : ''); setToken(r);
    ee.data.setAuthTokenRefresher((authArgs, cb) => { askToken('').then(x => { token = { access: x.access_token, exp: Date.now() + (x.expires_in - 60) * 1000 }; cb({ access_token: x.access_token, token_type: 'Bearer', expires_in: x.expires_in }); }).catch(e => cb({ error: e.message })); });
    await initEE(project);
    try { await evaluate(ee.Number(1)); } // a cheap round trip so scope / project problems show now
    catch (e) { if (/scope|insufficient|403/i.test(e.message) && scopeLevel === 0) { scopeLevel = 1; token = null; return connect(project, true); } throw e; }
    try { const u = await (await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token.access)).json(); state.email = u.email || ''; } catch (e) { }
    state.signedIn = true; state.project = project; setProject(project); ready = true; emit(); return ee;
  } catch (e) { state.signedIn = false; state.error = explain(e.message); emit(); throw new Error(state.error); }
}
export function signOut() { if (token && window.google) google.accounts.oauth2.revoke(token.access, () => { }); token = null; ready = null; Object.assign(state, { signedIn: false, email: '', error: '' }); emit(); }
function explain(m) {
  if (/not registered|not been used|disabled|SERVICE_DISABLED/i.test(m)) return 'Earth Engine is not enabled for this Cloud project, or the project is not registered for Earth Engine. ' + m;
  if (/permission|PERMISSION_DENIED|caller does not have/i.test(m)) return 'Your Google account has no Earth Engine access to this project. Check the project ID, or ask its owner to add you. ' + m;
  if (/popup|closed|access_denied/i.test(m)) return 'Sign-in was cancelled or the pop-up was blocked. ' + m;
  return m;
}

// small UI block reused by every Earth Engine app: [project] [Sign in] status
export function mountConnect(el, onReady) {
  el.innerHTML = `<div class="row geeRow"><span class="geeDot"></span><input class="geeProj" title="Google Cloud project with Earth Engine" style="flex:1"><button class="geeBtn">🔑 Sign in with Google</button></div><div class="geeMsg svhelp"></div>`;
  const dot = el.querySelector('.geeDot'), proj = el.querySelector('.geeProj'), btn = el.querySelector('.geeBtn'), msg = el.querySelector('.geeMsg');
  proj.value = getProject();
  const show = () => { dot.className = 'geeDot' + (state.signedIn ? ' on' : state.error ? ' bad' : '');
    btn.textContent = state.signedIn ? '↩ Sign out' : '🔑 Sign in with Google';
    msg.textContent = state.signedIn ? `Earth Engine ✓ ${state.email ? state.email + ' · ' : ''}project ${state.project}` : state.error || 'Earth Engine runs in your Google Cloud project (sign in once per session).'; };
  onChange(show); show();
  btn.onclick = async () => { if (state.signedIn) { signOut(); return; } btn.disabled = true; btn.textContent = '⏳'; try { await connect(proj.value.trim() || 'gee-geotech'); onReady && onReady(); } catch (e) { } btn.disabled = false; show(); };
  proj.onchange = () => { setProject(proj.value.trim()); if (state.signedIn && state.project !== proj.value.trim()) { signOut(); } };
}
// load the Google sign-in and Earth Engine scripts early, so the sign-in window can open straight from a click
export const preload = () => Promise.all([script(GSI), script(EE_JS)]).catch(e => console.warn(e));
