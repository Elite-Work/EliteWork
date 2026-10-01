declare module 'ioredis' {
  export type RedisStatus = "wait" | "reconnecting" | "connecting" | "connect" | "ready" | "close" | "end";
  export default class Redis {
    constructor(url?: string);
    status: RedisStatus | string;
    get(...args: any[]): Promise<any>;
    set(...args: any[]): Promise<any>;
    del(...args: any[]): Promise<any>;
    exists(...args: any[]): Promise<any>;
    keys(...args: any[]): Promise<any>;
    quit(): Promise<string>;
    ping(message?: string): Promise<string>;
    sadd(key: string, ...members: Array<string | number | Buffer>): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ttl(key: string): Promise<number>;
    smembers(key: string): Promise<string[]>;
    srem(key: string, ...members: string[]): Promise<number>;
    // Command surface is intentionally permissive so the stub does not have to
    // be regenerated whenever a new ioredis command is called.
    on(...args: any[]): any;
    [method: string]: any;
  }
}

declare module 'express-rate-limit' {
  const rateLimit: (options: any) => any;
  export default rateLimit;
}


