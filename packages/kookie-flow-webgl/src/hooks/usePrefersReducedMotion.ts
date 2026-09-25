import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the platform asks for reduced motion.
 *
 * v2 answers that request with `transition: none` on every control, its rows and its floating
 * panels, and turns the focus ring's landing off. The GL controls take the same answer: every
 * duration they ease over is multiplied by zero while this is true. A state, not a ref, because it
 * changes a material uniform and a tracker's durations — once, when the setting flips, never in a
 * frame.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia(QUERY).matches
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
