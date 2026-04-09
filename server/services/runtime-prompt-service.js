function createRuntimePromptService() {
  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeLocaleList(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }

  function normalizeClientContext(clientContext = {}) {
    const timeZone = normalizeString(clientContext.timeZone);
    const locale = normalizeString(clientContext.locale);
    const languages = normalizeLocaleList(clientContext.languages);
    const timeZoneOffsetMinutes = Number.isFinite(clientContext.timeZoneOffsetMinutes)
      ? Number(clientContext.timeZoneOffsetMinutes)
      : null;

    return {
      timeZone,
      locale,
      languages,
      timeZoneOffsetMinutes,
    };
  }

  function resolveValidTimeZone(timeZone) {
    if (!timeZone) {
      return '';
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch (error) {
      return '';
    }
  }

  function formatUtcOffset(timeZoneOffsetMinutes) {
    if (!Number.isFinite(timeZoneOffsetMinutes)) {
      return '';
    }

    const totalMinutes = -Number(timeZoneOffsetMinutes);
    const sign = totalMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(totalMinutes);
    const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
    const minutes = String(absoluteMinutes % 60).padStart(2, '0');
    return `UTC${sign}${hours}:${minutes}`;
  }

  function formatLocalDateTime({ timeZone, timeZoneOffsetMinutes }) {
    const now = new Date();
    const validTimeZone = resolveValidTimeZone(timeZone);

    if (validTimeZone) {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: validTimeZone,
      }).format(now);
    }

    if (Number.isFinite(timeZoneOffsetMinutes)) {
      const localTimestamp = now.getTime() - (Number(timeZoneOffsetMinutes) * 60 * 1000);
      const isoText = new Date(localTimestamp).toISOString().replace('T', ' ').replace('.000Z', '');
      const utcOffset = formatUtcOffset(timeZoneOffsetMinutes);
      return utcOffset ? `${isoText} ${utcOffset}` : isoText;
    }

    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(now);
  }

  function getLocaleRegion(locale) {
    if (!locale) {
      return '';
    }

    try {
      const intlLocale = new Intl.Locale(locale);
      return intlLocale.region || intlLocale.maximize().region || '';
    } catch (error) {
      return '';
    }
  }

  function getCountryName(region, localeCandidates = []) {
    if (!region) {
      return '';
    }

    const displayLocales = [...localeCandidates, 'en-US'].filter(Boolean);

    try {
      const displayNames = new Intl.DisplayNames(displayLocales, { type: 'region' });
      return displayNames.of(region) || region;
    } catch (error) {
      return region;
    }
  }

  function getTimeZoneCity(timeZone) {
    const validTimeZone = resolveValidTimeZone(timeZone);

    if (!validTimeZone) {
      return '';
    }

    const parts = validTimeZone.split('/').filter(Boolean);
    const city = parts[parts.length - 1] || '';
    return city.replace(/_/gu, ' ');
  }

  function inferLocationLabel(clientContext) {
    const localeCandidates = [clientContext.locale, ...clientContext.languages].filter(Boolean);
    const region = localeCandidates.map(getLocaleRegion).find(Boolean) || '';
    const country = getCountryName(region, localeCandidates);
    const city = getTimeZoneCity(clientContext.timeZone);
    const validTimeZone = resolveValidTimeZone(clientContext.timeZone);
    const utcOffset = formatUtcOffset(clientContext.timeZoneOffsetMinutes);

    if (city && country) {
      return `${city}, ${country} (inferred from browser locale and time zone)`;
    }

    if (city) {
      return `${city} (inferred from browser time zone)`;
    }

    if (country) {
      return `${country} (inferred from browser locale)`;
    }

    if (validTimeZone) {
      return `${validTimeZone} (browser time zone)`;
    }

    if (utcOffset) {
      return `${utcOffset} (browser offset)`;
    }

    return 'Unavailable';
  }

  function buildHiddenSystemPrompt({
    clientContext,
    systemPrompt,
    thinkingMode,
  }) {
    const normalizedClientContext = normalizeClientContext(clientContext);
    const customSystemPrompt = normalizeString(systemPrompt);
    const lines = [];

    if (thinkingMode) {
      lines.push('<|think|>');
      lines.push('');
    }

    lines.push('You are running inside a local chat app.');
    lines.push('The surrounding harness/environment provides request metadata that is not user-authored:');
    lines.push(`- User local date and time: ${formatLocalDateTime(normalizedClientContext)}`);
    lines.push(`- User time zone: ${resolveValidTimeZone(normalizedClientContext.timeZone) || formatUtcOffset(normalizedClientContext.timeZoneOffsetMinutes) || 'Unavailable'}`);
    lines.push(`- User location: ${inferLocationLabel(normalizedClientContext)}`);
    lines.push('- Web search capability is available through the surrounding harness/environment/wrapper when enabled for this request.');
    lines.push('- If harness-provided web research or source snippets appear in the conversation, treat them as current web results.');
    lines.push('- Do not say that you lack web search or browsing ability when the harness has provided that support or supplied current web research.');
    lines.push('- If you use the harness-provided date, time, time zone, or location metadata, state it directly without citation markers such as [Context], [System], or [n].');
    lines.push('- Only use bracketed citations like [1] when referring to numbered web research sources explicitly provided later in the conversation.');

    if (customSystemPrompt) {
      lines.push('');
      lines.push('Apply these additional user-configured instructions for this chat:');
      lines.push(customSystemPrompt);
    }

    return lines.join('\n').trim();
  }

  function buildMessages({
    messages,
    clientContext,
    systemPrompt,
    thinkingMode,
  }) {
    const conversation = Array.isArray(messages)
      ? messages.map((message) => ({ ...message }))
      : [];

    return [
      {
        role: 'system',
        content: buildHiddenSystemPrompt({
          clientContext,
          systemPrompt,
          thinkingMode,
        }),
      },
      ...conversation,
    ];
  }

  return {
    buildMessages,
  };
}

module.exports = {
  createRuntimePromptService,
};
