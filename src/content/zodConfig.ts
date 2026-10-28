import { config } from 'zod';

// Zod compiles its object parsers with `new Function`, after probing whether the page allows it.
// Under our CSP (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`) the probe is caught but
// the browser still reports it as a `securitypolicyviolation`, which the dist e2e (story 1.24)
// treats as a failure. `jitless` skips the probe and the compilation: the content is a few small
// files parsed once at boot, so the plain parsers cost nothing noticeable.
config({ jitless: true });
