function createWebSearchService({
  searchEndpoint = 'https://duckduckgo.com/html/',
  maxSearchResults = 6,
  maxFetchedPages = 4,
  maxContextChars = 14_000,
  maxSnippetChars = 3000,
  maxSearchSnippetChars = 180,
  maxHtmlChars = 300_000,
  requestTimeoutMs = 10_000,
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
} = {}) {
  const GENERIC_SNIPPET_PATTERNS = [
    /\bfind the latest\b/i,
    /\bview real-time stock prices\b/i,
    /\breal-time quote\b/i,
    /\bfull financial overview\b/i,
    /\bhistorical performance\b/i,
    /\bcharts? and other financial information\b/i,
    /\bstock news\b/i,
    /\bother vital information\b/i,
  ];

  function normalizeWhitespace(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function trimToLength(value = '', maxLength = 0) {
    const source = normalizeWhitespace(value);

    if (!maxLength || source.length <= maxLength) {
      return source;
    }

    return `${source.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function decodeHtmlEntities(value = '') {
    return String(value || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  function stripHtml(value = '') {
    return decodeHtmlEntities(
      String(value || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    );
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function isSupportedSourceUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function resolveSearchResultUrl(url) {
    try {
      const parsed = new URL(url, 'https://duckduckgo.com');
      const encodedTarget = parsed.searchParams.get('uddg');

      if (encodedTarget) {
        return decodeURIComponent(encodedTarget);
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  function tokenizeQuery(query) {
    return [...new Set(
      normalizeWhitespace(query)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    )];
  }

  function countQueryTermMatches(text, queryTerms) {
    const lowerText = normalizeWhitespace(text).toLowerCase();

    return queryTerms.reduce((count, term) => (
      lowerText.includes(term) ? count + 1 : count
    ), 0);
  }

  function scorePassage(passage, queryTerms) {
    const lowerPassage = passage.toLowerCase();
    let score = 0;

    queryTerms.forEach((term) => {
      const matches = lowerPassage.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
      score += matches ? matches.length : 0;
    });

    if (/\d/.test(passage)) {
      score += 0.5;
    }

    score += Math.min(1.5, passage.length / 220);
    return score;
  }

  function scoreSnippetCandidate(snippet, queryTerms, title = '') {
    const source = normalizeWhitespace(snippet);

    if (!source) {
      return Number.NEGATIVE_INFINITY;
    }

    let score = Math.min(2, source.length / 180);
    const termMatches = countQueryTermMatches(source, queryTerms);

    score += termMatches * 1.25;

    if (/\$\s?\d|usd\b|\b\d+(?:\.\d+)?%|\b\d+(?:,\d{3})*(?:\.\d+)?\b/i.test(source)) {
      score += 2;
    } else if (/\d/.test(source)) {
      score += 0.75;
    }

    if (title) {
      const normalizedTitle = normalizeWhitespace(title).toLowerCase();
      const normalizedSource = source.toLowerCase();

      if (normalizedSource === normalizedTitle) {
        score -= 2;
      } else if (normalizedTitle && normalizedSource.includes(normalizedTitle)) {
        score -= 0.5;
      }
    }

    GENERIC_SNIPPET_PATTERNS.forEach((pattern) => {
      if (pattern.test(source)) {
        score -= 1.5;
      }
    });

    return score;
  }

  function splitIntoPassages(text) {
    return String(text || '')
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length >= 80 && line.length <= 700);
  }

  function areNearDuplicateSnippets(left = '', right = '') {
    const normalizedLeft = normalizeWhitespace(left).toLowerCase();
    const normalizedRight = normalizeWhitespace(right).toLowerCase();

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    if (normalizedLeft === normalizedRight) {
      return true;
    }

    const minLength = Math.min(normalizedLeft.length, normalizedRight.length);

    if (minLength < 80) {
      return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
    }

    const leftPrefix = normalizedLeft.slice(0, 120);
    const rightPrefix = normalizedRight.slice(0, 120);

    return normalizedLeft.includes(rightPrefix) || normalizedRight.includes(leftPrefix);
  }

  function extractTitle(html = '') {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return normalizeWhitespace(stripHtml(titleMatch?.[1] || ''));
  }

  function extractMetaDescriptionCandidates(html = '') {
    const matches = [
      ...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([\s\S]*?)["'][^>]*>/gi),
      ...html.matchAll(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/gi),
    ];

    return [...new Set(matches
      .map((match) => normalizeWhitespace(stripHtml(match[1] || '')))
      .filter(Boolean))];
  }

  function createFetchSignal(parentSignal) {
    const timeoutSignal = typeof AbortSignal?.timeout === 'function'
      ? AbortSignal.timeout(requestTimeoutMs)
      : null;

    if (parentSignal && timeoutSignal && typeof AbortSignal?.any === 'function') {
      return AbortSignal.any([parentSignal, timeoutSignal]);
    }

    return parentSignal || timeoutSignal || undefined;
  }

  async function fetchText(url, signal) {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'User-Agent': userAgent,
      },
      redirect: 'follow',
      signal: createFetchSignal(signal),
    });

    if (!response.ok) {
      throw new Error(`Request returned ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}.`);
    }

    return (await response.text()).slice(0, maxHtmlChars);
  }

  function parseSearchResults(html) {
    const titleMatches = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetMatches = [...html.matchAll(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi)];

    return titleMatches
      .map((match, index) => ({
        url: resolveSearchResultUrl(decodeHtmlEntities(match[1] || '')),
        title: normalizeWhitespace(stripHtml(match[2] || '')),
        searchSnippet: trimToLength(stripHtml(snippetMatches[index]?.[1] || ''), maxSearchSnippetChars),
      }))
      .filter((result) => result.title && isSupportedSourceUrl(result.url))
      .filter((result) => !/duckduckgo\.com$/i.test(getDomain(result.url)))
      .slice(0, maxSearchResults);
  }

  function selectPassages(html, queryTerms) {
    const text = stripHtml(html);
    const passages = splitIntoPassages(text);
    const scoredPassages = passages
      .map((passage) => ({
        passage,
        score: scorePassage(passage, queryTerms),
      }))
      .sort((left, right) => right.score - left.score);

    const picked = [];
    let totalChars = 0;

    scoredPassages.forEach(({ passage }) => {
      if (picked.length >= 8) {
        return;
      }

      const duplicate = picked.some((candidate) => areNearDuplicateSnippets(candidate, passage));

      if (!duplicate) {
        const nextLength = totalChars + passage.length + (picked.length ? 1 : 0);

        if (nextLength > maxSnippetChars) {
          return;
        }

        picked.push(passage);
        totalChars = nextLength;
      }
    });

    if (!picked.length) {
      return passages.slice(0, 4)
        .reduce((highlights, passage) => {
          const duplicate = highlights.some((candidate) => areNearDuplicateSnippets(candidate, passage));

          if (duplicate) {
            return highlights;
          }

          const combined = highlights.join('\n');
          const nextLength = combined.length + passage.length + (highlights.length ? 1 : 0);

          if (nextLength > maxSnippetChars) {
            return highlights;
          }

          return [...highlights, passage];
        }, []);
    }

    return picked;
  }

  function pickNotableHighlights(candidates, queryTerms, title = '') {
    const normalizedCandidates = candidates
      .map((candidate) => normalizeWhitespace(candidate))
      .filter(Boolean);

    if (!normalizedCandidates.length) {
      return [];
    }

    const rankedCandidates = normalizedCandidates
      .map((candidate) => ({
        candidate,
        score: scoreSnippetCandidate(candidate, queryTerms, title),
      }))
      .sort((left, right) => right.score - left.score);

    const picked = [];
    let totalChars = 0;

    rankedCandidates.forEach(({ candidate, score }) => {
      if (score <= 0 && picked.length >= 2) {
        return;
      }

      if (picked.length >= 8) {
        return;
      }

      const duplicate = picked.some((existing) => areNearDuplicateSnippets(existing, candidate));

      if (duplicate) {
        return;
      }

      const nextLength = totalChars + candidate.length + (picked.length ? 1 : 0);

      if (nextLength > maxSnippetChars) {
        return;
      }

      picked.push(candidate);
      totalChars = nextLength;
    });

    return picked;
  }

  async function fetchSource(result, queryTerms, signal) {
    const html = await fetchText(result.url, signal);
    const title = trimToLength(extractTitle(html) || result.title, 120);
    const highlights = pickNotableHighlights([
      ...extractMetaDescriptionCandidates(html),
      ...selectPassages(html, queryTerms),
      result.searchSnippet,
    ], queryTerms, title);

    return {
      title: title || result.title,
      url: result.url,
      domain: getDomain(result.url),
      highlights,
      snippet: highlights.join('\n'),
    };
  }

  function buildResearchContext(query, sources) {
    const sections = sources.map((source) => {
      const lines = [
        `[${source.index}] ${trimToLength(source.title, 120)} (${source.domain})`,
        `URL: ${source.url}`,
      ];

      const highlights = Array.isArray(source.highlights)
        ? source.highlights.map((highlight) => trimToLength(highlight, maxSnippetChars)).filter(Boolean)
        : [];

      if (highlights.length) {
        highlights.forEach((highlight, highlightIndex) => {
          lines.push(`Highlight ${highlightIndex + 1}: ${highlight}`);
        });
      } else if (source.snippet) {
        lines.push(`Highlight 1: ${trimToLength(source.snippet, maxSnippetChars)}`);
      }

      return lines.join('\n');
    });

    const prefix = [
      `Web research for: "${trimToLength(query, 220)}"`,
      'Use the numbered sources below for factual grounding. Cite claims inline with [n].',
    ].join('\n');

    let context = prefix;

    sections.forEach((section) => {
      if (context.length + section.length + 2 > maxContextChars) {
        return;
      }

      context += `\n\n${section}`;
    });

    return context;
  }

  async function research(query, { signal, onEvent = () => {} } = {}) {
    const normalizedQuery = trimToLength(query, 300);

    if (!normalizedQuery) {
      throw new Error('Web search requires a non-empty query.');
    }

    onEvent({
      type: 'web',
      phase: 'searching',
      query: normalizedQuery,
      label: `Searching the web for "${normalizedQuery}"`,
    });

    const searchUrl = new URL(searchEndpoint);
    searchUrl.searchParams.set('q', normalizedQuery);
    searchUrl.searchParams.set('kl', 'us-en');

    const searchHtml = await fetchText(searchUrl.toString(), signal);
    const queryTerms = tokenizeQuery(normalizedQuery);
    const results = parseSearchResults(searchHtml);

    if (!results.length) {
      throw new Error('Web search returned no results.');
    }

    const seenUrls = new Set();
    const selectedResults = results
      .filter((result) => {
        const normalizedUrl = result.url;

        if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
          return false;
        }

        seenUrls.add(normalizedUrl);
        return true;
      })
      .slice(0, maxFetchedPages);

    const sources = [];

    for (const [index, result] of selectedResults.entries()) {
      const visitIndex = index + 1;
      const domain = getDomain(result.url);

      onEvent({
        type: 'web',
        phase: 'visiting',
        status: 'loading',
        index: visitIndex,
        url: result.url,
        domain,
        label: `Visiting ${domain}`,
      });

      try {
        const source = await fetchSource(result, queryTerms, signal);
        const indexedSource = {
          index: sources.length + 1,
          title: trimToLength(source.title || result.title, 120),
          url: source.url,
          domain: source.domain || domain,
          highlights: Array.isArray(source.highlights)
            ? source.highlights.map((highlight) => trimToLength(highlight, maxSnippetChars)).filter(Boolean)
            : [],
          snippet: trimToLength(source.snippet || result.searchSnippet, maxSnippetChars),
        };

        if (!indexedSource.highlights.length && indexedSource.snippet) {
          indexedSource.highlights = [indexedSource.snippet];
        }

        sources.push(indexedSource);

        onEvent({
          type: 'web',
          phase: 'visiting',
          status: 'ready',
          index: visitIndex,
          url: indexedSource.url,
          domain: indexedSource.domain,
          title: indexedSource.title,
          label: `Loaded ${indexedSource.domain}`,
        });
      } catch (error) {
        if (result.searchSnippet) {
          const fallbackSource = {
            index: sources.length + 1,
            title: trimToLength(result.title, 120),
            url: result.url,
            domain,
            highlights: [trimToLength(result.searchSnippet, maxSnippetChars)],
            snippet: trimToLength(result.searchSnippet, maxSnippetChars),
          };

          sources.push(fallbackSource);

          onEvent({
            type: 'web',
            phase: 'visiting',
            status: 'fallback',
            index: visitIndex,
            url: fallbackSource.url,
            domain: fallbackSource.domain,
            title: fallbackSource.title,
            label: `Using search snippet from ${fallbackSource.domain}`,
          });
          continue;
        }

        onEvent({
          type: 'web',
          phase: 'visiting',
          status: 'error',
          index: visitIndex,
          url: result.url,
          domain,
          error: error.message,
          label: `Could not read ${domain}`,
        });
      }
    }

    if (!sources.length) {
      throw new Error('No usable sources were extracted from search results.');
    }

    const contextText = buildResearchContext(normalizedQuery, sources);

    onEvent({
      type: 'web',
      phase: 'ready',
      query: normalizedQuery,
      compactedChars: contextText.length,
      sourceCount: sources.length,
      sources,
      label: `Compacted ${sources.length} web sources`,
    });

    return {
      query: normalizedQuery,
      sources,
      contextText,
      compactedChars: contextText.length,
    };
  }

  return {
    research,
  };
}

module.exports = {
  createWebSearchService,
};
