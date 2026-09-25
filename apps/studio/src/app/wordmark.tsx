import { Heading } from '@kushagradhawan/kookie-ui-react';

/**
 * The studio's mark, set in PP Acma at the step the docs site's sidebar uses; globals.css
 * declares the face.
 *
 * `weight="medium"` because the one file loaded is the Semibold cut, declared at weight 500, and a heading asking for more
 * makes the browser stroke a bolder one. `aria-hidden` because it is a picture of the name: the
 * link around it carries the name, and a span puts nothing in the document outline.
 */
export function Wordmark() {
  return (
    <Heading size="7" weight="medium" className="kd-wordmark" render={<span aria-hidden="true" />}>
      Studio
    </Heading>
  );
}
