import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';

import { HomePage } from './routes/home.tsx';
import { ViewPage } from './routes/view.tsx';

/**
 * Path-based routing, deliberately. Hash routing is off the table for this app
 * — the fragment is load-bearing, it carries the shared availability payload,
 * and a router that also owns the hash would fight it.
 */
const rootRoute = createRootRoute({ component: () => <Outlet /> });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

const viewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/v', component: ViewPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, viewRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
