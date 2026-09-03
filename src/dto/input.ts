import type { ProxyConfigurationOptions } from 'apify';

import type { CaptureMode } from './common.js';

/**
 * What `Actor.createProxyConfiguration` accepts. `useApifyProxy` is not part of
 * `ProxyConfigurationOptions` — it only exists to carry the Console's proxy editor's on/off
 * toggle — but it is exactly the field that arrives from the input schema, so it has to be here.
 */
export type ProxyInput = ProxyConfigurationOptions & { useApifyProxy?: boolean };

/** Raw shape of the Actor input (see `.actor/input_schema.json`). */
export interface ActorInput {
    startUrls: {
        url: string;
        method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'OPTIONS' | 'CONNECT' | 'PATCH';
        headers?: Record<string, string>;
        userData?: Record<string, unknown>;
    }[];
    maxRequestsPerCrawl: number;
    mode: CaptureMode;
    /**
     * Proxy to route the browser through. Omitting it does *not* mean "no proxy" — `main.ts`
     * falls back to an Apify datacenter US exit. `useApifyProxy: false` is how you opt out.
     */
    proxyConfiguration?: ProxyInput;
}
