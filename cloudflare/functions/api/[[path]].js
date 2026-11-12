import { proxy } from "../_proxy.js";
export const onRequest = (ctx) => proxy(ctx);
