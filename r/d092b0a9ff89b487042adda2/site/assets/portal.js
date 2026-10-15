/* PHAROS portal.
 *
 * Everything in this file is presentation. Nothing here is a security
 * control: role gating happens in the serving layer, and the demo's role
 * switch says so on the page beside it.
 *
 * The reasoning behind each block is kept with the site implementation
 * notes, which are not served.
 */

'use strict';

(function () {
  /* Service worker, registered from every portal and demo page so an
   * install has a controller whichever page the user landed on first. */
  /* review copy: no service worker */

  /* Watch-Week countdown. It counts the days remaining, then the recap on
   * day 8. Calendar days in market time throughout — a Watch-Week day is a
   * day the reader lives in, not 86,400,000 milliseconds. The page supplies
   * both dates and this file keeps no clock of its own beyond `now`. */
  var MARKET_TZ = 'America/Chicago';

  /* Days after the recap for which the page may still say the recap is in. */
  var RECAP_READ_WINDOW_DAYS = 7;

  function ctDayIndex(d) {
    /* The calendar day the reader is on, in market time. */
    try {
      var s = new Intl.DateTimeFormat('en-CA', {
        timeZone: MARKET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
    } catch (err) {
      /* An environment without the time-zone database is not a reason to
       * print a wrong day; it is a reason to be off by the reader's offset
       * rather than silent. */
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
  }

  function attrDayIndex(attr) {
    /* getAttribute returns null for an absent attribute, and `new Date(null)`
     * is the epoch rather than an invalid date — which would read as a week
     * that closed in 1970. Type first, then the two parse modes: "2026-08-10"
     * is a calendar date and is taken exactly as written, while anything else
     * is an instant and is resolved to the market day it falls in. Left to
     * `new Date`, the first form parses as UTC and "August 10, 2026" parses as
     * LOCAL, and a day index read off either would silently depend on which
     * spelling the attribute happened to carry. */
    if (typeof attr !== 'string') return null;
    var d = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(attr);
    if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]) / 86400000;
    var t = new Date(attr);
    return isNaN(t.getTime()) ? null : ctDayIndex(t);
  }

  function countdownState(now, closeAttr, recapAttr) {
    var today = ctDayIndex(now);
    var lastDay = attrDayIndex(closeAttr);       /* day 7 */
    var recapDay = attrDayIndex(recapAttr);      /* day 8 */
    if (lastDay === null) return null;

    /* Day 8 follows day 7. That is what the closed loop means, and a pair
     * that does not satisfy it is a stale or hand-edited render rather than a
     * week — so nothing is printed from it. */
    if (recapDay !== null && recapDay !== lastDay + 1) return null;

    var left = lastDay - today + 1;              /* inclusive of today */

    /* A Watch Week is seven days. A larger figure means the attribute is
     * wrong, and the honest response is to leave the markup's own figure
     * alone rather than print a number nobody meant. The count is inclusive
     * of today, so day 1 reads 7 rather than 8. */
    if (left > 7) return null;
    if (left >= 1) {
      return { figure: String(left), unit: left === 1 ? 'day remaining' : 'days remaining' };
    }

    /* The week has closed. From here the countdown points at the recap and
     * at nothing else. Without a recap date there is nothing honest left to
     * count, so the markup stands as authored. */
    if (recapDay === null) return null;
    var toRecap = recapDay - today;
    if (toRecap === 1) return { figure: '1', unit: 'day to your recap' };
    if (toRecap === 0) return { figure: '8', unit: 'day eight — your recap' };

    /* Past the recap: the page may say the recap is in only while the read
     * window is open. Outside it, an old attribute would be asserting that a
     * deliverable had been delivered. */
    if (toRecap >= -RECAP_READ_WINDOW_DAYS) {
      return { figure: '8', unit: 'day eight — your recap is in' };
    }
    return null;
  }

  document.querySelectorAll('[data-countdown-to]').forEach(function (el) {
    var state = countdownState(
      new Date(),
      el.getAttribute('data-countdown-to'),
      el.getAttribute('data-recap-on')
    );
    if (!state) return;
    var figure = el.querySelector('.countdown-figure');
    var unit = el.querySelector('.countdown-unit');
    if (figure) figure.textContent = state.figure;
    if (unit) unit.textContent = state.unit;
  });

  /* Exposed for the countdown's unit tests. Nothing on the page reads it. */
  window.PHAROS = window.PHAROS || {};
  window.PHAROS._countdownState = countdownState;

  /* Demo role switch: a demo control, and the page says so beside it. It
   * shows a visitor what the two roles see. It is not the permission model,
   * which lives in the serving layer where no switch in a page can reach. */
  var switchEl = document.querySelector('[data-role-switch]');
  if (switchEl) {
    var apply = function (role) {
      document.querySelectorAll('[data-owner-only]').forEach(function (node) {
        node.hidden = role !== 'owner';
      });
      document.querySelectorAll('[data-role-label]').forEach(function (node) {
        node.textContent = role === 'owner' ? 'Owner' : 'Operator';
      });
      switchEl.querySelectorAll('button[data-role]').forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-role') === role));
      });
    };

    switchEl.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-role]');
      if (btn) apply(btn.getAttribute('data-role'));
    });

    apply('owner');
  }

  /* Redemption form, under the honest-door rule: while the action is a
   * sentinel the form posts nowhere and says so on the page, rather than
   * swallowing a submission in silence. The guard removes itself once a
   * real endpoint is set. */
  var form = document.querySelector('[data-redeem-form]');
  if (form && /REPLACE_WITH_/.test(form.getAttribute('action') || '')) {
    /* Document-scoped, not form-scoped: the message is a SIBLING of the
     * form. A form-scoped lookup returns null, which cancels the submission
     * and then says nothing — the dead button this guard exists to prevent. */
    var status = document.querySelector('[data-redeem-status]');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!status) {
        /* Never swallow a submission in silence. If the message is missing,
         * let the browser do something visible instead of nothing. */
        window.location.href = 'mailto:hello@neurevo.tech?subject=Trial%20code';
        return;
      }
      status.hidden = false;
      status.focus();
    });
  }

  /* ---------------------------------------------------------------------
   * THE ARCHIVE FILTER
   *
   * The controls ship `hidden` and are revealed HERE, so a visitor without
   * script sees no date box at all rather than one that filters nothing.
   * That is the rule the print affordance follows on the published
   * documents: never draw a control this page cannot honour.
   *
   * Everything it offers is DERIVED from the rows in the list -- the date
   * bounds from the dates present, the kinds from the kinds present. A
   * hard-coded kind list goes stale the first time a new artifact family is
   * issued, and would be wrong on exactly the surface that claims to be a
   * complete manifest.
   *
   * Dates are compared as ISO STRINGS, never parsed into Date objects: the
   * rows carry `YYYY-MM-DD`, which sorts correctly as text, and `new Date()`
   * on a bare date string is UTC midnight -- an operator west of Greenwich
   * would watch a document drop out of its own day.
   *
   * THE COMPACT SHELF: "only show like the last 4 reports by default. THen
   * when they search, it'll expand out to show more. Let's keep these
   * windows small when we first launch them."
   *
   * It is a VISIBILITY change and not a data one. Every row the account owns
   * is server-rendered into the list in both states and is hidden with the
   * same `li.hidden` the filter already uses; the page carries the same bytes
   * compact or expanded. A shelf that fetched the rest on demand would be a
   * second way to read the manifest, free to disagree with the first.
   *
   * A FILTER INTERACTION IS AN EXPANSION. The reader has asked a question and
   * must see every row that answers it, so `apply()` gains one term rather
   * than a second visibility loop -- the ceiling applies only while no filter
   * is set. CLEAR already routes through `apply()`, which is why returning to
   * the compact state costs one assignment.
   * ------------------------------------------------------------------- */

  /* How many rows the shelf opens with. One named number, read by the cap,
   * the copy and the button label alike, so the sentence on the page cannot
   * disagree with the rows under it. */
  var COMPACT_ROWS = 4;

  function kindWord(cell) {
    var first = cell.firstChild;
    var word = first && first.nodeType === 3 ? first.nodeValue : cell.textContent;
    return (word || '').trim();
  }

  var find = document.querySelector('[data-arc-find]');
  var list = document.querySelector('ul.archive');
  if (find && list) {
    var rows = Array.prototype.slice.call(list.querySelectorAll('li'));
    var recs = rows.map(function (li) {
      var d = li.querySelector('.archive-date');
      var k = li.querySelector('.archive-kind');
      return {
        li: li,
        date: d ? (d.textContent || '').trim() : '',
        /* The kind is the tag's own word: the briefs shelf draws the filing
         * clock inside the same cell, after the word, in .archive-filed. */
        kind: k ? kindWord(k) : '',
        /* What the search box matches: every word on the row, as the
         * reader sees it, compared without regard to case. */
        text: (li.textContent || '').replace(/\s+/g, ' ').toLowerCase()
      };
    }).filter(function (r) { return r.date; });

    if (recs.length) {
      var fromEl = find.querySelector('[data-arc-from]');
      var toEl = find.querySelector('[data-arc-to]');
      var kindEl = find.querySelector('[data-arc-kind]');
      var kindField = find.querySelector('[data-arc-kind-field]');
      var clearEl = find.querySelector('[data-arc-clear]');
      /* The search box exists only on a list that offers it, and ships
       * hidden like the rest of the form: a page without one is
       * filtered exactly as before. */
      var qEl = find.querySelector('[data-arc-q]');
      var qField = find.querySelector('[data-arc-q-field]');
      if (qEl && qField) { qField.hidden = false; }
      var statusEl = find.querySelector('[data-arc-status]');

      /* The count affordance sits BELOW the list, so it is a sibling of the
       * form rather than a child of it and is looked up on the document. */
      var moreEl = document.querySelector('[data-arc-more]');
      var moreTextEl = moreEl ? moreEl.querySelector('[data-arc-more-text]') : null;
      var seeAllEl = moreEl ? moreEl.querySelector('[data-arc-see-all]') : null;

      /* Set by the SEE ALL control only. A filter sets nothing: it expands by
       * being a filter, and CLEAR must return the shelf to its opening state
       * whether the reader got there by filtering or by asking for all. */
      var expanded = false;

      var dates = recs.map(function (r) { return r.date; }).sort();
      var lo = dates[0];
      var hi = dates[dates.length - 1];
      /* Bounded by the record: a client cannot page the calendar into a year
       * we have issued nothing for. */
      [fromEl, toEl].forEach(function (el) {
        if (!el) { return; }
        el.min = lo;
        el.max = hi;
      });

      var kinds = [];
      recs.forEach(function (r) {
        if (r.kind && kinds.indexOf(r.kind) === -1) { kinds.push(r.kind); }
      });
      kinds.sort();
      /* R-T11: a filter over a one-kind list is furniture. An operator issued
       * only briefs never sees this control, and nothing had to be configured
       * to make that true. */
      if (kindEl && kindField && kinds.length > 1) {
        var optAll = document.createElement('option');
        optAll.value = '';
        optAll.textContent = 'All kinds';
        kindEl.appendChild(optAll);
        kinds.forEach(function (k) {
          var o = document.createElement('option');
          o.value = k;
          o.textContent = k;
          kindEl.appendChild(o);
        });
        kindField.hidden = false;
      }

      /* THE NEWEST FOUR, DERIVED BY DATE -- not the first four in the markup.
       * Both shelves render newest-first today, so the two definitions pick
       * the same rows and the difference is invisible. That is exactly why it
       * is written this way: the line under the list SAYS "the newest", and
       * taking the first four asserts a property of the render order that
       * nothing here checks. The day a list renders oldest-first, a positional
       * slice prints "the newest four" over the four oldest documents on file.
       *
       * `sort` is stable, so rows sharing a date keep their render order -- a
       * morning brief and its mid-day update land on the same date and must
       * not trade places on the shelf. */
      var newest = recs.slice().sort(function (a, b) {
        if (a.date === b.date) { return 0; }
        return a.date < b.date ? 1 : -1;
      }).slice(0, COMPACT_ROWS);

      var apply = function () {
        var from = fromEl && fromEl.value ? fromEl.value : '';
        var to = toEl && toEl.value ? toEl.value : '';
        var kind = kindEl && kindEl.value ? kindEl.value : '';
        var q = qEl && qEl.value ? qEl.value.replace(/\s+/g, ' ').trim().toLowerCase() : '';
        var filtering = !!(from || to || kind || q);
        /* The ceiling applies only to the unfiltered, unexpanded shelf, and
         * only when there is something behind it to hide. A "showing 1 of 1"
         * is a ceiling nobody is under.
         *
         * THE CONTROL IS A CONDITION OF THE CEILING, not decoration on top of
         * it. A page carrying the filter but not this block -- the demo
         * settings room is one filter away from being exactly that -- would
         * otherwise get its rows hidden with nothing on the page to lift them
         * and nothing saying they were there: a silent ceiling, which is worse
         * than no ceiling at all. Never impose a limit this page has no
         * control to undo.
         *
         * It tests `seeAllEl` and not `moreEl` because the BUTTON is what
         * undoes the limit; the sentence beside it only describes one. And
         * `seeAllEl` is looked up inside `moreEl`, so a control implies a
         * block and one check covers both. */
        var compact = !filtering && !expanded && !!seeAllEl &&
                      recs.length > COMPACT_ROWS;
        var matched = 0;
        var shown = 0;
        recs.forEach(function (r) {
          var ok = (!from || r.date >= from) &&
                   (!to || r.date <= to) &&
                   (!kind || r.kind === kind) &&
                   (!q || r.text.indexOf(q) !== -1);
          if (ok) { matched++; }
          var visible = ok && (!compact || newest.indexOf(r) !== -1);
          r.li.hidden = !visible;
          if (visible) { shown++; }
        });

        /* The form's status line speaks for the FILTER and stays silent when
         * none is set; the line below the list speaks for the CEILING and
         * hides while a filter is set. They are never both talking, which is
         * the only reason two polite live regions on one page are tolerable. */
        if (statusEl) {
          if (!filtering) {
            statusEl.textContent = '';
          } else if (matched === 0) {
            statusEl.textContent = 'No documents match. The archive holds ' +
              recs.length + ', from ' + lo + ' to ' + hi + '.';
          } else {
            statusEl.textContent = 'Showing ' + matched + ' of ' + recs.length + '.';
          }
        }

        if (!moreEl) { return; }
        if (filtering || recs.length <= COMPACT_ROWS) {
          /* Nothing is being withheld, so nothing claims to be -- and the
           * sentence is EMPTIED as well as hidden. Left standing it would say
           * "showing the newest four" from inside the markup while thirteen
           * rows are on the screen: a stale claim nobody can see is still a
           * stale claim, and this tree has paid for one of those. */
          moreEl.hidden = true;
          if (moreTextEl) { moreTextEl.textContent = ''; }
          return;
        }
        moreEl.hidden = false;
        if (moreTextEl) {
          /* Both figures are counted off the rows on the page. Neither is
           * written down anywhere, so neither can go stale.
           *
           * The wording is the filter status line's own -- "Showing N of M."
           * -- rather than a second idiom for the same fact. It also stopped
           * the demo archive reading "46 documents ON FILE, newest first"
           * immediately above "Showing the NEWEST 4 of 46 ON FILE", which is
           * two lines echoing each other's words on the one page that already
           * prints its own total. */
          moreTextEl.textContent = compact
            ? 'Showing the newest ' + shown + ' of ' + recs.length + '.'
            : 'Showing all ' + recs.length + '.';
        }
        if (seeAllEl) {
          seeAllEl.textContent = compact
            ? 'See all ' + recs.length
            : 'Show the newest ' + COMPACT_ROWS;
          seeAllEl.setAttribute('aria-expanded', String(!compact));
        }
      };

      /* Enter inside a date box would otherwise reload the page and throw the
       * filter away. */
      find.addEventListener('submit', function (event) {
        event.preventDefault();
      });
      [fromEl, toEl, kindEl].forEach(function (el) {
        if (el) { el.addEventListener('change', apply); }
      });
      if (qEl) { qEl.addEventListener('input', apply); }
      if (clearEl) {
        clearEl.addEventListener('click', function () {
          if (fromEl) { fromEl.value = ''; }
          if (toEl) { toEl.value = ''; }
          if (kindEl) { kindEl.value = ''; }
          if (qEl) { qEl.value = ''; }
          /* CLEAR returns the shelf to how it opened, whether the reader
           * widened it by filtering or by asking for all of it. */
          expanded = false;
          apply();
        });
      }
      if (seeAllEl) {
        seeAllEl.addEventListener('click', function () {
          expanded = !expanded;
          apply();
        });
      }
      /* Establish the opening state. Until this runs the markup shows every
       * row, which is what a visitor without script keeps: the whole list and
       * no controls, rather than a ceiling they cannot lift. */
      apply();
      find.hidden = false;
    }
  }
})();
