import type { FastifyRequest } from 'fastify';
import type { ObservabilitySpan } from './logger.js';

/**
 * Ties the HTTP trace started in the Fastify `onRequest` hook to later work
 * (AI chat, canvas mutations) without augmenting the Fastify request type.
 */
const spans = new WeakMap<FastifyRequest, ObservabilitySpan>();

export function setRequestSpan(
  request: FastifyRequest,
  span: ObservabilitySpan,
): void {
  spans.set(request, span);
}

export function getRequestSpan(request: FastifyRequest): ObservabilitySpan | null {
  return spans.get(request) ?? null;
}

export function clearRequestSpan(request: FastifyRequest): void {
  spans.delete(request);
}
