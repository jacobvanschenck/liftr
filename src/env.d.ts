/// <reference types="astro/client" />
/// <reference types="@clerk/astro/env" />
/// <reference path="../worker-configuration.d.ts" />

import type { Member } from './lib/types';

declare global {
  interface Window {
    // Self-hosted libraries exposed for Astro inline expressions.
    htmx: unknown;
    Alpine: unknown;
  }

  namespace App {
    interface Locals {
      member: Member | null;
    }
  }
}
