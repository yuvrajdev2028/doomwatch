import {
  context,
  createContextKey,
  Context,
  ContextManager,
  ROOT_CONTEXT
} from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';
import { TraceContext, Span } from '@doomwatch/core';

export const TRACE_CONTEXT_KEY = createContextKey('doomwatch_trace_context');
export const ACTIVE_SPAN_KEY = createContextKey('doomwatch_active_span');

/**
 * OpenTelemetry ContextManager backed by Node.js native AsyncLocalStorage.
 * Preserves ambient trace context across asynchronous execution chains,
 * promises, timers, and callbacks without requiring manual argument passing.
 */
export class DoomwatchContextManager implements ContextManager {
  private storage = new AsyncLocalStorage<Context>();
  private enabled = false;

  active(): Context {
    return this.storage.getStore() || ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(ctx, () => fn.apply(thisArg, args));
  }

  bind<T>(ctx: Context, target: T): T {
    if (typeof target !== 'function') {
      return target;
    }
    const self = this;
    const bound = function (this: unknown, ...args: unknown[]) {
      return self.with(ctx, () => (target as Function).apply(this, args));
    };
    return bound as unknown as T;
  }

  enable(): this {
    this.enabled = true;
    return this;
  }

  disable(): this {
    this.enabled = false;
    this.storage.disable();
    return this;
  }
}

// Global initialization flag
let initialized = false;

export function initGlobalContextManager(): void {
  if (initialized) return;
  const manager = new DoomwatchContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  initialized = true;
}

/**
 * Runs a callback with a specific TraceContext and Span bound to ambient async storage.
 */
export function runInTraceContext<T>(
  traceCtx: TraceContext,
  span: Span,
  fn: () => T
): T {
  initGlobalContextManager();
  const current = context.active();
  const updated = current
    .setValue(TRACE_CONTEXT_KEY, traceCtx)
    .setValue(ACTIVE_SPAN_KEY, span);

  return context.with(updated, fn);
}

/**
 * Retrieves the currently active TraceContext from ambient storage, if any.
 */
export function getActiveTraceContext(): TraceContext | null {
  initGlobalContextManager();
  const ctx = context.active();
  const val = ctx.getValue(TRACE_CONTEXT_KEY);
  return (val as TraceContext) || null;
}

/**
 * Retrieves the currently active Span from ambient storage, if any.
 */
export function getActiveSpan(): Span | null {
  initGlobalContextManager();
  const ctx = context.active();
  const val = ctx.getValue(ACTIVE_SPAN_KEY);
  return (val as Span) || null;
}
