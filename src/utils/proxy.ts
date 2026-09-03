import type { ProxyInput } from '../dto/index.js';

/**
 * Whether this run goes through a proxy is decided here rather than by the input, because on DHGate
 * it is not really a preference. The site is behind Cloudflare, and a run coming from the
 * container's own IP draws the interactive "Verify you are human" variant far more often — and,
 * once a session is burnt, has no second IP to retry from. So a run that says nothing gets a proxy.
 *
 * Opting out stays possible (`useApifyProxy: false`); it just has to be said out loud.
 */

/** What a run gets when it expresses no preference. Mirrors the default in `.actor/input_schema.json`. */
export const DEFAULT_PROXY: ProxyInput = {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'US',
};

/**
 * Did this input actually say anything about proxies?
 *
 * A default parameter would only cover a *missing* field, and the field arrives meaning "I did not
 * choose" in several other shapes: `null`, `{}` (the Console's proxy editor, left untouched),
 * `{ proxyUrls: [] }`. So the question is not whether the key exists but whether it carries a
 * decision — and any one of these fields is one, including a bare `apifyProxyGroups` with no
 * `useApifyProxy` next to it, which `Actor.createProxyConfiguration` honours perfectly well.
 */
export function proxyWasChosen(input?: ProxyInput | null): boolean {
    if (!input) return false;
    // The only field that can express "no proxy", so `false` is as much a decision as `true`.
    if (input.useApifyProxy != null) return true;
    return Boolean(
        input.proxyUrls?.length ||
        input.tieredProxyUrls?.length ||
        input.apifyProxyGroups?.length ||
        input.groups?.length ||
        input.apifyProxyCountry ||
        input.countryCode,
    );
}

/** The settings to hand `Actor.createProxyConfiguration`, plus whether they came from the input. */
export interface ProxyChoice {
    settings: ProxyInput;
    /** `false` when {@link DEFAULT_PROXY} was substituted — worth saying in the log. */
    chosen: boolean;
}

export function pickProxy(input?: ProxyInput | null): ProxyChoice {
    const chosen = proxyWasChosen(input);
    return { settings: chosen ? input! : DEFAULT_PROXY, chosen };
}

/** One line for the startup log: where we are going out from, and whether anyone asked for it. */
export function describeProxy({ settings, chosen }: ProxyChoice): string {
    const groups = settings.apifyProxyGroups?.join('+') ?? settings.groups?.join('+');
    const where = groups ?? (settings.proxyUrls?.length ? 'custom URLs' : 'AUTO');
    const country = settings.apifyProxyCountry ?? settings.countryCode ?? '(no country)';
    return `${where} ${country}${chosen ? '' : ' (default — nothing set in input)'}`;
}
