/** Extract the first numeric amount from a price string, e.g. "US $14.9" -> 14.9, "US $1,234.5" -> 1234.5 */
export function parseAmount(text: string | null | undefined): number | null {
    if (!text) return null;
    const match = text.replace(/,/g, '').match(/[\d.]+/);
    return match ? Number(match[0]) : null;
}

/** Extract every numeric amount from a string, e.g. "US $14.9 - 20.0" -> [14.9, 20] */
export function parseAmounts(text: string | null | undefined): number[] {
    if (!text) return [];
    return (text.replace(/,/g, '').match(/[\d.]+/g) ?? []).map(Number);
}

/** Extract the currency prefix from a price string, e.g. "US $14.9" -> "US $" */
export function parseCurrencySymbol(text: string | null | undefined): string | null {
    if (!text) return null;
    const match = text.match(/^([^\d]+?)\s*[\d.]/);
    return match ? match[1].trim() : null;
}

/** Normalize a currency symbol/label to an ISO-4217-ish code, e.g. "US $" / "$" -> "USD". */
export function normalizeCurrency(symbol: string | null | undefined): string {
    if (!symbol) return 'USD';
    const s = symbol.toUpperCase();
    if (s.includes('US $') || s.includes('USD') || s === '$') return 'USD';
    if (s.includes('€') || s.includes('EUR')) return 'EUR';
    if (s.includes('£') || s.includes('GBP')) return 'GBP';
    return symbol.trim();
}

/** Parse a compact/abbreviated count, e.g. "5K+ sold" -> 5000, "1.2M" -> 1200000, "3970" -> 3970. */
export function parseCompactNumber(text: string | null | undefined): number | null {
    if (!text) return null;
    const match = text.replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/);
    if (!match) return null;
    let n = parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const suffix = match[2]?.toLowerCase();
    if (suffix === 'k') n *= 1_000;
    else if (suffix === 'm') n *= 1_000_000;
    return Math.round(n);
}

/** Pull the DHGate product id out of a product URL, e.g. ".../1064214730.html?..." -> "1064214730". */
export function extractProductId(url: string): string | null {
    const match = url.match(/\/(\d+)\.html/);
    return match ? match[1] : null;
}

/** Pull the DHGate seller/store id out of a store URL, e.g. ".../store/top-selling/21880856.html?..." -> "21880856". */
export function extractSellerId(url: string | null | undefined): string | null {
    if (!url) return null;
    const match = url.match(/\/(\d+)\.html/);
    return match ? match[1] : null;
}

/**
 * Strip the query string / hash from a URL, returning just `origin + pathname`,
 * e.g. ".../1064214730.html?dspm=...#st1-0" -> ".../1064214730.html".
 * Returns the input unchanged if it cannot be parsed as a URL.
 */
export function stripUrlParams(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch {
        return url;
    }
}

/** Normalize a DHGate image src: prefix protocol-relative `//...` URLs with `https:`. Returns null for empty input. */
export function normalizeImageUrl(src: string | null | undefined): string | null {
    if (!src) return null;
    return src.startsWith('//') ? `https:${src}` : src;
}
