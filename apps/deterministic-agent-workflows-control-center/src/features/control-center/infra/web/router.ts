/** @riviere-role web-tbc */
export type Route =
  | { view: 'dashboard' }
  | {
    view: 'session';
    id: string 
  }
  | { view: 'analytics' }
  | {
    view: 'compare';
    a: string;
    b: string 
  }

/** @riviere-role web-tbc */
export function parseRoute(): Route {
  const hash = window.location.hash.slice(1) || '/'

  if (hash === '/' || hash === '') return { view: 'dashboard' }
  if (hash === '/analytics') return { view: 'analytics' }

  const sessionMatch = /^\/session\/(.+)$/.exec(hash)
  if (sessionMatch?.[1]) return {
    view: 'session',
    id: sessionMatch[1] 
  }

  const compareMatch = /^\/compare\?a=([^&]+)&b=(.+)$/.exec(hash)
  if (compareMatch?.[1] && compareMatch[2]) {
    return {
      view: 'compare',
      a: compareMatch[1],
      b: compareMatch[2] 
    }
  }

  return { view: 'dashboard' }
}

/** @riviere-role web-tbc */
export function onRouteChange(callback: (route: Route) => void): void {
  window.addEventListener('hashchange', () => callback(parseRoute()))
}
