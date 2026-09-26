// Lightweight ambient typings for dependencies whose shipped types are either
// unavailable at build time or too strict for the wrapper utilities the
// backend builds on top of. These intentionally shadow the package types, so
// they must stay in sync with the surface the backend actually uses.
declare module 'ioredis' {
  export default class Redis {
    // Kept to a single optional argument on purpose: call sites that pass an
    // options object are annotated with `@ts-expect-error` (see lib/redis.ts
    // and jobs/queue.ts), which becomes a compile error itself if this
    // constructor starts accepting the options argument.
    constructor(url?: string);
    // Command surface is intentionally permissive so the stub does not have to
    // be regenerated whenever a new ioredis command is called.
    [method: string]: any;
  }
}

declare module 'express-rate-limit' {
  const rateLimit: (options: any) => any;
  export default rateLimit;
}
