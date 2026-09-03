import { describe, expect, it } from 'vitest';

import { DEFAULT_PROXY, describeProxy, pickProxy } from '../src/utils/proxy.js';

describe('pickProxy', () => {
    // Every shape that means "the run did not choose". All of them must land on the residential
    // default rather than quietly going out on the container's own IP — that is the whole point.
    it.each([
        ['missing', undefined],
        ['null', null],
        ['empty object (Console proxy editor, untouched)', {}],
        ['empty proxyUrls', { proxyUrls: [] }],
        ['empty groups', { apifyProxyGroups: [] }],
    ])('defaults to residential US when proxyConfiguration is %s', (_label, input) => {
        const { settings, chosen } = pickProxy(input);
        expect(chosen).toBe(false);
        expect(settings).toBe(DEFAULT_PROXY);
        expect(settings.apifyProxyGroups).toEqual(['RESIDENTIAL']);
    });

    it('honours an explicit opt-out', () => {
        const input = { useApifyProxy: false };
        const { settings, chosen } = pickProxy(input);
        expect(chosen).toBe(true);
        expect(settings).toBe(input);
    });

    // A decision expressed by any recognised field, not just `useApifyProxy`.
    it.each([
        ['useApifyProxy', { useApifyProxy: true }],
        ['apifyProxyGroups alone', { apifyProxyGroups: ['DATACENTER'] }],
        ['groups alone', { groups: ['DATACENTER'] }],
        ['countryCode alone', { countryCode: 'DE' }],
        ['custom proxyUrls', { proxyUrls: ['http://user:pass@proxy.example.com:1234'] }],
    ])('keeps a configuration given via %s', (_label, input) => {
        const { settings, chosen } = pickProxy(input);
        expect(chosen).toBe(true);
        expect(settings).toBe(input);
    });
});

describe('describeProxy', () => {
    it('flags the substituted default so the log says where it came from', () => {
        expect(describeProxy(pickProxy(undefined))).toBe('RESIDENTIAL US (default — nothing set in input)');
    });

    it('describes an explicit configuration without the default marker', () => {
        expect(describeProxy(pickProxy({ useApifyProxy: true, apifyProxyGroups: ['DATACENTER'] }))).toBe(
            'DATACENTER (no country)',
        );
    });

    it('names custom proxy URLs without leaking them into the log', () => {
        const description = describeProxy(pickProxy({ proxyUrls: ['http://user:pass@proxy.example.com:1234'] }));
        expect(description).toBe('custom URLs (no country)');
        expect(description).not.toContain('pass');
    });
});
