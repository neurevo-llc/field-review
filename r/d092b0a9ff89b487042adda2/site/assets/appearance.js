/* PHAROS appearance controller — design sandbox, 2026-08-16.
 *
 * Three states, one button, top right:
 *
 *   AUTO   follow daylight where the reader actually is  (the default)
 *   DAY    lock to the original SPECTRUM palette
 *   NIGHT  lock to the dark palette
 *
 * WHY AUTO IS NOT `prefers-color-scheme`. The system setting answers "what
 * does this person like", not "is it dark where they are standing". For a
 * product read at 05:30 beside a battery those are different questions: the
 * operator's phone is on the OS default all week and the sun is not. So AUTO
 * computes real sunrise and sunset and flips at those two moments, and the
 * system setting is used only as the fallback when no location can be had.
 *
 * LOCATION WITHOUT A PERMISSION PROMPT. A landing page must not throw a
 * geolocation dialog at a first-time visitor. So:
 *
 *   1. Longitude comes from the browser's own UTC offset, which costs nothing
 *      and is accurate to about a degree -- the Earth turns 15 degrees an
 *      hour, so the zone's standard meridian IS -offsetMinutes/4.
 *   2. Latitude comes from a small table of IANA zone -> representative
 *      latitude, because latitude is what actually moves sunrise: longitude
 *      only shifts the whole day, latitude changes its LENGTH.
 *   3. Precise coordinates are used ONLY if the reader has already granted
 *      this origin location permission -- checked with the Permissions API,
 *      which does not prompt. getCurrentPosition is never called otherwise.
 *
 * The result is good to a few minutes anywhere populated, with no dialog, no
 * network call, and no coordinate ever leaving the page.
 *
 * HIG note, stated plainly rather than buried: Dark Mode > Best practices
 * says "avoid offering an app-specific appearance setting", because a setting
 * that ignores the system reads as broken. This control is a deliberate
 * departure and it earns it in one specific way -- AUTO is the default and it
 * tracks something the system setting cannot express. The lock is an
 * override, not the primary path, and it is remembered so nobody sets it
 * twice.
 */
(function () {
  'use strict';

  var KEY = 'pharos-appearance';        /* 'auto' | 'day' | 'night' */
  var ROOT = document.documentElement;
  var ORDER = ['auto', 'day', 'night'];

  /* ---------------------------------------------------------------- solar
   * Sunrise/sunset by the standard low-precision solar position algorithm
   * (Meeus). Accurate to well under a minute for this purpose. Returns null
   * inside a polar day or night, where no sunrise exists at all and the
   * caller must fall back to the system setting.
   */
  var rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;

  function toDays(d) { return d.valueOf() / dayMs - 0.5 + J1970 - J2000; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }

  function solarEvents(date, lat, lon) {
    var e = rad * 23.4397;
    var lw = rad * -lon, phi = rad * lat;
    var d = toDays(date);
    var n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n;
    var M = rad * (357.5291 + 0.98560028 * ds);
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

    /* -0.833 degrees is the standard sunrise altitude: the sun's apparent
     * radius plus mean atmospheric refraction at the horizon. */
    var h = rad * -0.833;
    var cosW = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (isNaN(cosW) || cosW > 1 || cosW < -1) return null;   /* polar day/night */
    var w = Math.acos(cosW);
    var Jset = J2000 + (0.0009 + (w + lw) / (2 * Math.PI) + n)
                     + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var Jrise = Jnoon - (Jset - Jnoon);
    return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
  }

  /* ------------------------------------------------------------- location
   * Representative latitudes only. Longitude is derived from the UTC offset
   * because that is exact enough and needs no table; latitude is the value
   * worth looking up because it sets the day length.
   */
  var ZONE_LAT = {
    'America/Chicago': 31.0, 'America/New_York': 40.7, 'America/Denver': 39.7,
    'America/Los_Angeles': 34.1, 'America/Phoenix': 33.4, 'America/Anchorage': 61.2,
    'America/Toronto': 43.7, 'America/Vancouver': 49.3, 'America/Mexico_City': 19.4,
    'America/Sao_Paulo': -23.6, 'America/Bogota': 4.7,
    'America/Argentina/Buenos_Aires': -34.6,
    'Europe/London': 51.5, 'Europe/Dublin': 53.3, 'Europe/Paris': 48.9,
    'Europe/Berlin': 52.5, 'Europe/Madrid': 40.4, 'Europe/Rome': 41.9,
    'Europe/Amsterdam': 52.4, 'Europe/Stockholm': 59.3, 'Europe/Oslo': 59.9,
    'Europe/Helsinki': 60.2, 'Europe/Moscow': 55.8, 'Europe/Lisbon': 38.7,
    'Europe/Warsaw': 52.2, 'Europe/Zurich': 47.4, 'Europe/Athens': 38.0,
    'Africa/Cairo': 30.0, 'Africa/Lagos': 6.5, 'Africa/Johannesburg': -26.2,
    'Africa/Nairobi': -1.3,
    'Asia/Dubai': 25.2, 'Asia/Karachi': 24.9, 'Asia/Kolkata': 19.1,
    'Asia/Bangkok': 13.8, 'Asia/Singapore': 1.35, 'Asia/Hong_Kong': 22.3,
    'Asia/Shanghai': 31.2, 'Asia/Tokyo': 35.7, 'Asia/Seoul': 37.6,
    'Asia/Jakarta': -6.2, 'Asia/Manila': 14.6, 'Asia/Jerusalem': 31.8,
    'Australia/Sydney': -33.9, 'Australia/Melbourne': -37.8,
    'Australia/Perth': -31.95, 'Australia/Brisbane': -27.5,
    'Pacific/Auckland': -36.9, 'Pacific/Honolulu': 21.3
  };

  function coarseLocation() {
    var zone = null, lat = null;
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    var known = !!(zone && Object.prototype.hasOwnProperty.call(ZONE_LAT, zone));
    if (known) lat = ZONE_LAT[zone];
    /* getTimezoneOffset is minutes WEST of UTC, hence the sign flip.
     *
     * THE STANDARD OFFSET, NOT TODAY'S. A zone's meridian is defined by its
     * STANDARD time; daylight saving moves the clock, not the ground. Reading
     * the current offset placed America/New_York at 60W instead of 75W every
     * summer -- 15 degrees, which is one hour of solar time -- so every
     * sunrise and sunset fired 58 minutes early. Measured 2026-08-17: sunset
     * computed 6:57 PM against an actual 7:52 PM, i.e. the page went dark in
     * broad daylight. In a control whose whole claim is that it follows the
     * sun, an hour is the difference between the claim and a lie.
     *
     * January and July bracket the year and STANDARD time is the LARGER
     * getTimezoneOffset of the two -- more minutes west. That holds in the
     * southern hemisphere too, where the seasons flip but the arithmetic does
     * not, and it is correct for a zone with no DST at all: both readings are
     * equal, so the max is simply the offset. */
    var nowLocal = new Date();
    var janOff = new Date(nowLocal.getFullYear(), 0, 1).getTimezoneOffset();
    var julOff = new Date(nowLocal.getFullYear(), 6, 1).getTimezoneOffset();
    var lon = -Math.max(janOff, julOff) / 4;
    if (lat === null) {
      /* No table entry. 40 degrees is a reasonable mid-latitude default: it
       * puts sunrise within roughly half an hour across most of the populated
       * world, and AUTO is a comfort feature, not a clock. */
      lat = 40;
    }
    return { lat: lat, lon: lon, source: known ? 'your time zone' : 'your UTC offset' };
  }

  var located = coarseLocation();

  /* Upgrade to precise coordinates only if permission is ALREADY granted.
   * This never prompts: we ask the Permissions API for the current state and
   * call getCurrentPosition only when the answer is "granted". */
  function maybeRefineLocation(then) {
    if (!navigator.geolocation || !navigator.permissions || !navigator.permissions.query) return;
    var q;
    try { q = navigator.permissions.query({ name: 'geolocation' }); } catch (e) { return; }
    if (!q || !q.then) return;
    q.then(function (status) {
      if (status.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        located = { lat: pos.coords.latitude, lon: pos.coords.longitude,
                    source: 'your device location' };
        then();
      }, function () { /* a refusal is not an error worth surfacing */ },
         { maximumAge: 36e5, timeout: 8000 });
    })['catch'](function () { /* some browsers reject this query outright */ });
  }

  /* --------------------------------------------------------------- state */
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return ORDER.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolveAuto() {
    var now = new Date();
    var ev = solarEvents(now, located.lat, located.lon);
    if (!ev || isNaN(ev.sunrise.getTime()) || isNaN(ev.sunset.getTime())) {
      return { dark: systemPrefersDark(), until: null,
               why: 'your system setting — no sunrise at your latitude today' };
    }
    var isDay = now >= ev.sunrise && now < ev.sunset;
    var next;
    if (now < ev.sunrise) next = ev.sunrise;
    else if (now < ev.sunset) next = ev.sunset;
    else {
      var t = solarEvents(new Date(now.getTime() + dayMs), located.lat, located.lon);
      next = t ? t.sunrise : null;
    }
    return { dark: !isDay, until: next, why: 'daylight where you are, by ' + located.source };
  }

  function hhmm(d) {
    if (!d) return '';
    try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  }

  /* ---------------------------------------------------------------- icons
   * Distinct SHAPES, not just distinct colours, so the state is readable
   * without colour vision. HIG — Color > Inclusive color: "use text labels or
   * glyph shapes to identify objects or states." The text label carries it
   * too, so the state is stated three ways.
   */
  var ICON = {
    day: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7"/></svg>',
    night: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M2.6 12h2.4M5.4 5.4l1.7 1.7M7.1 16.9l-1.7 1.7"/><path d="M12 7.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor" stroke="none"/></svg>'
  };

  var LABEL = { auto: 'Auto', day: 'Day', night: 'Night' };

  /* --------------------------------------------------------------- apply */
  var timer = null;

  function apply(mode, announce) {
    var dark, detail;
    if (mode === 'day') { dark = false; detail = 'Locked to Day.'; }
    else if (mode === 'night') { dark = true; detail = 'Locked to Night.'; }
    else {
      var r = resolveAuto();
      dark = r.dark;
      detail = 'Following ' + r.why + '.'
             + (r.until ? ' Switches at ' + hhmm(r.until) + '.' : '');
    }

    ROOT.setAttribute('data-appearance', dark ? 'dark' : 'light');
    ROOT.setAttribute('data-appearance-mode', mode);

    /* EVERY control, not the first one. The home page carries two -- one in the
     * masthead and one in the footer -- and `querySelector` would have left the
     * second showing a stale label the moment the first was pressed: two
     * controls for one setting, disagreeing about what the setting is. */
    var btns = document.querySelectorAll('[data-appearance-toggle]');
    var next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      btn.querySelector('.appearance-icon').innerHTML = ICON[mode];
      btn.querySelector('.appearance-label').textContent = LABEL[mode];
      btn.setAttribute('aria-label', 'Appearance: ' + LABEL[mode] + '. ' + detail
                                   + ' Activate for ' + LABEL[next] + '.');
      btn.setAttribute('title', detail);
    }
    /* aria-live sits on a separate status node, not the button, so a screen
     * reader announces the change once instead of re-reading the control.
     * ONE announcement even with two controls: a duplicated live region would
     * read the same sentence twice on every press. */
    var live = document.getElementById('appearance-status');
    if (live && announce && btns.length) {
      live.textContent = 'Appearance: ' + LABEL[mode] + '. ' + detail;
    }

    /* Re-evaluate exactly at the next solar transition, and hourly as a
     * backstop in case the tab slept through it. */
    if (timer) { clearTimeout(timer); timer = null; }
    if (mode === 'auto') {
      var r2 = resolveAuto();
      var ms = r2.until ? (r2.until.getTime() - Date.now()) : 36e5;
      if (!(ms > 0) || ms > 36e5) ms = 36e5;
      timer = setTimeout(function () { apply('auto', false); }, ms + 1000);
    }
  }

  function set(mode, announce) {
    try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode */ }
    apply(mode, announce);
  }

  /* ----------------------------------------------------------- the button */
  function mount() {
    if (document.querySelector('[data-appearance-toggle]')) return;
    /* EXPLICIT SLOTS WIN, AND ALL OF THEM ARE FILLED. The control moved to the
     * footer on 2026-08-17 -- it is a feature, not a masthead item, and the top
     * of every page is the one place there is no room for it. The home page
     * declares two slots and gets two controls; every other page declares one.
     * The old element fallbacks stay for a page that declares none, so a
     * surface that has not been given a slot yet still gets a control rather
     * than silently losing the function. */
    var slots = document.querySelectorAll('[data-appearance-slot]');
    if (!slots.length) {
      var fallback = document.querySelector('.nav')
                  || document.querySelector('.app-bar-inner')
                  || document.querySelector('.doc-chrome');
      if (!fallback) return;
      slots = [fallback];
    }
    for (var s = 0; s < slots.length; s++) mountInto(slots[s], s === 0);
  }

  function mountInto(slot, withLive) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'appearance-toggle';
    btn.setAttribute('data-appearance-toggle', '');
    btn.innerHTML = '<span class="appearance-icon" aria-hidden="true"></span>'
                  + '<span class="appearance-label"></span>';
    btn.addEventListener('click', function () {
      set(ORDER[(ORDER.indexOf(stored()) + 1) % ORDER.length], true);
    });

    slot.appendChild(btn);

    /* ONE live region for the page, on the first control only. `id` must be
     * unique and two `role=status` nodes would announce every change twice. */
    if (withLive) {
      var live = document.createElement('span');
      live.id = 'appearance-status';
      live.className = 'appearance-status';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      slot.appendChild(live);
    }
  }

  function boot() {
    mount();
    apply(stored(), false);
    maybeRefineLocation(function () { if (stored() === 'auto') apply('auto', false); });
    /* If the reader changes their SYSTEM setting we only care in the polar
     * fallback case, but re-resolving is free and cannot be wrong. */
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (stored() === 'auto') apply('auto', false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* THE ATTRIBUTE GOES ON BEFORE THE BODY PAINTS. This file is loaded in
   * <head> WITHOUT defer precisely so this line runs during parse: setting
   * data-appearance on <html> needs no DOM beyond the root element, and doing
   * it here is what prevents a flash of the wrong palette on every load.
   * Mounting the button does need the DOM, so that waits. */
  apply(stored(), false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Exposed for the sandbox's verification pass. Nothing on the page reads it. */
  window.PHAROS = window.PHAROS || {};
  window.PHAROS._appearance = {
    solarEvents: solarEvents,
    resolveAuto: resolveAuto,
    located: function () { return located; },
    set: set
  };
})();
