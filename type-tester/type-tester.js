const { h, render } = preact;
const { useEffect, useMemo, useState } = preactHooks;
const html = htm.bind(h);
const FOCUS_LETTERS = ['T', 'G', 'B', 'Y', 'H', 'N'];
const FOCUS_SET = new Set(FOCUS_LETTERS.map((letter) => letter.toLowerCase()));

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(values) {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const normalizeDashes = (text) => text.replace(/[\u2012\u2013\u2014\u2015]/g, '-');
  const q = typeof entry.q === 'string' ? normalizeDashes(entry.q).trim() : '';
  const a = typeof entry.a === 'string' ? normalizeDashes(entry.a).trim() : '';
  if (!q || !a) {
    return null;
  }
  return { q, a };
}

function focusDensity(text) {
  const letters = (text || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!letters.length) {
    return 0;
  }

  let hitCount = 0;
  for (const letter of letters) {
    if (FOCUS_SET.has(letter)) {
      hitCount += 1;
    }
  }
  return hitCount / letters.length;
}

function pickFromPool(pool, used, count) {
  const available = pool.filter((item) => !used.has(item.key));
  const picked = [];
  const shuffled = shuffle(available);
  for (let i = 0; i < shuffled.length && picked.length < count; i += 1) {
    const item = shuffled[i];
    used.add(item.key);
    picked.push(item);
  }
  return picked;
}

function formatQuote(entry) {
  return `${entry.q} - ${entry.a}.`;
}

function trimPassage(text, maxChars = 520) {
  if (text.length <= maxChars) {
    return text;
  }
  const slice = text.slice(0, maxChars);
  const punctuationCut = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (punctuationCut > 260) {
    return slice.slice(0, punctuationCut + 1);
  }
  return slice;
}

function buildPassage(quotes) {
  const scored = quotes
    .map((quote) => ({
      ...quote,
      key: `${quote.q}|${quote.a}`,
      score: focusDensity(`${quote.q} ${quote.a}`),
    }))
    .sort((left, right) => right.score - left.score);

  const topQuarterCount = Math.max(1, Math.floor(scored.length * 0.25));
  const topHalfCount = Math.max(1, Math.floor(scored.length * 0.5));
  const topQuarter = scored.slice(0, topQuarterCount);
  const topHalf = scored.slice(0, topHalfCount);

  const used = new Set();
  const intro = pickFromPool(topQuarter, used, 2);
  const middle = pickFromPool(topHalf, used, 2);
  const ending = pickFromPool(scored, used, 2);

  const selected = [...intro, ...middle, ...ending];

  while (selected.length < 6 && selected.length < scored.length) {
    const [extra] = pickFromPool(scored, used, 1);
    if (!extra) {
      break;
    }
    selected.push(extra);
  }

  const passage = trimPassage(selected.map(formatQuote).join(' '));
  return passage;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function computeMetrics(correctChars, typoCount, fingerMistakes, elapsedMs) {
  const minutes = Math.max(elapsedMs / 60000, 1 / 60000);
  const wpm = Math.round(correctChars / 5 / minutes);
  const totalKeystrokes = Math.max(1, correctChars + typoCount);
  const accuracy = Math.round((correctChars / totalKeystrokes) * 100);
  return { wpm, accuracy, fingerMistakes };
}

function App() {
  const [quotes, setQuotes] = useState([]);
  const [dataStatus, setDataStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [phase, setPhase] = useState('idle');
  const [passage, setPassage] = useState('');
  const [index, setIndex] = useState(0);
  const [typoCount, setTypoCount] = useState(0);
  const [fingerMistakes, setFingerMistakes] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [history, setHistory] = useState([]);

  const elapsedMs = useMemo(() => {
    if (!startedAt) {
      return 0;
    }
    const end = phase === 'finished' ? endedAt : nowTick;
    return Math.max(0, end - startedAt);
  }, [startedAt, endedAt, nowTick, phase]);

  const metrics = useMemo(
    () => computeMetrics(index, typoCount, fingerMistakes, elapsedMs),
    [index, typoCount, fingerMistakes, elapsedMs],
  );

  async function loadQuotes() {
    setDataStatus('loading');
    setErrorMessage('');
    try {
      const globalQuotes = Array.isArray(window.TYPE_TESTER_QUOTES)
        ? window.TYPE_TESTER_QUOTES
        : null;

      let payload = globalQuotes;
      if (!payload) {
        const response = await fetch('./quotes.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load quotes.json (${response.status})`);
        }
        payload = await response.json();
      }

      if (!Array.isArray(payload)) {
        throw new Error('Quote source must be a JSON array');
      }
      const cleaned = payload.map(sanitizeEntry).filter(Boolean);
      if (!cleaned.length) {
        throw new Error('Quote source does not contain usable quote entries');
      }
      setQuotes(cleaned);
      setDataStatus('ready');
      startRound(cleaned);
    } catch (error) {
      setDataStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not load quotes');
    }
  }

  function startRound(sourceQuotes = quotes) {
    if (!sourceQuotes.length) {
      return;
    }

    setPassage(buildPassage(sourceQuotes));
    setPhase('racing');
    setIndex(0);
    setTypoCount(0);
    setFingerMistakes(0);
    setStartedAt(0);
    setEndedAt(0);
    setNowTick(Date.now());
  }

  function noteFingerMistake() {
    if (phase !== 'racing') {
      return;
    }
    setFingerMistakes((value) => value + 1);
  }

  useEffect(() => {
    loadQuotes();
  }, []);

  useEffect(() => {
    if (phase !== 'racing') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'F2') {
        event.preventDefault();
        noteFingerMistake();
        return;
      }

      if (phase === 'finished' && event.key === 'Enter') {
        event.preventDefault();
        startRound();
        return;
      }

      if (phase !== 'racing') {
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      event.preventDefault();
      const now = Date.now();
      const expected = passage[index] || '';

      if (!startedAt) {
        setStartedAt(now);
      }

      if (event.key === expected) {
        const nextIndex = index + 1;
        if (nextIndex >= passage.length) {
          const finishedAt = now;
          const elapsed = Math.max(1, finishedAt - (startedAt || finishedAt));
          const finalMetrics = computeMetrics(nextIndex, typoCount, fingerMistakes, elapsed);
          setIndex(nextIndex);
          setEndedAt(finishedAt);
          setPhase('finished');
          setHistory((records) =>
            [
              {
                at: new Date(finishedAt).toISOString(),
                elapsed,
                wpm: finalMetrics.wpm,
                accuracy: finalMetrics.accuracy,
                typoCount,
                fingerMistakes,
              },
              ...records,
            ].slice(0, 8),
          );
          return;
        }
        setIndex(nextIndex);
        return;
      }

      setTypoCount((value) => value + 1);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, passage, index, startedAt, typoCount, fingerMistakes, quotes]);

  const chars = useMemo(
    () =>
      [...passage].map((char, position) => {
        const className =
          position < index ? 'char correct' : position === index ? 'char current' : 'char pending';
        return html`<span key=${position} class=${className}>${char}</span>`;
      }),
    [passage, index],
  );

  return html`
    <section>
      <header class="top">
        <h1 class="title">Center-Key Type Tester</h1>
        <div class="subtitle">
          Type-racer flow with extra tracking for finger-form mistakes. Source: local quote dataset.
        </div>
        <div class="focus-letters">
          ${FOCUS_LETTERS.map(
            (letter) => html`<span class="focus-pill" key=${letter}>${letter}</span>`,
          )}
        </div>
      </header>

      <div class="body">
        <section class="panel stats">
          <div class="stat">
            <div class="label">Status</div>
            <div class="value">${phase}</div>
          </div>
          <div class="stat">
            <div class="label">Time</div>
            <div class="value">${formatDuration(elapsedMs)}</div>
          </div>
          <div class="stat">
            <div class="label">WPM</div>
            <div class="value">${metrics.wpm}</div>
          </div>
          <div class="stat">
            <div class="label">Accuracy</div>
            <div class="value">${metrics.accuracy}%</div>
          </div>
          <div class="stat">
            <div class="label">Typos</div>
            <div class="value">${typoCount}</div>
          </div>
          <div class="stat">
            <div class="label">Finger Mistakes</div>
            <div class="value">${fingerMistakes}</div>
          </div>
        </section>

        <section class="panel typing-area">
          <div class="passage">
            ${dataStatus === 'error'
              ? html`<span class="error">${errorMessage}</span>`
              : passage
                ? chars
                : 'Loading practice passage...'}
          </div>

          <div class="controls">
            <button type="button" onClick=${() => startRound()} disabled=${dataStatus !== 'ready'}>
              ${phase === 'finished' ? 'Next Passage' : 'New Passage'}
            </button>
            <button
              type="button"
              class="warn"
              onClick=${noteFingerMistake}
              disabled=${phase !== 'racing'}
              title="Shortcut: F2"
            >
              I made a mistake (F2)
            </button>
            <button type="button" class="secondary" onClick=${loadQuotes}>Reload quote data</button>
          </div>

          <div class="hint">
            Strict mode: only the exact next character advances progress. Wrong keys increase Typos.
            Manual form mistakes are tracked separately.
          </div>
        </section>

        <section class="status">
          ${dataStatus === 'loading'
            ? 'Loading quote data...'
            : dataStatus === 'error'
              ? html`<span class="error">Error: ${errorMessage}</span>`
              : `Loaded ${quotes.length} quotes. Passage starts with high T/G/B/Y/H/N density, then gradually blends toward normal quote text.`}
        </section>

        <section class="panel history">
          <h2>Recent Rounds</h2>
          ${history.length === 0
            ? html`<div class="status">No completed rounds yet.</div>`
            : html`<ol class="history-list">
                ${history.map(
                  (row) => html`<li key=${row.at}>
                    ${new Date(row.at).toLocaleTimeString()} | ${Math.round(row.elapsed / 1000)}s |
                    ${row.wpm} WPM | ${row.accuracy}% | typos ${row.typoCount} | finger
                    ${row.fingerMistakes}
                  </li>`,
                )}
              </ol>`}
        </section>
      </div>
    </section>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
