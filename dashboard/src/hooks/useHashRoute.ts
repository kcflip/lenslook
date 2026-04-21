import { useEffect, useState } from 'react';

export type Route =
  | { type: 'home' }
  | { type: 'lens'; lensId: string }
  | { type: 'brand'; brand: string };

function parseHash(hash: string): Route {
  const lensMatch = hash.match(/^#\/lens\/(.+)$/);
  if (lensMatch) return { type: 'lens', lensId: decodeURIComponent(lensMatch[1]) };
  const brandMatch = hash.match(/^#\/brand\/(.+)$/);
  if (brandMatch) return { type: 'brand', brand: decodeURIComponent(brandMatch[1]) };
  return { type: 'home' };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function lensHref(lensId: string): string {
  return `#/lens/${encodeURIComponent(lensId)}`;
}

export function brandHref(brand: string): string {
  return `#/brand/${encodeURIComponent(brand)}`;
}
