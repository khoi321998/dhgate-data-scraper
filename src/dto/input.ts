import type { CaptureMode } from './common.js';

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
}
