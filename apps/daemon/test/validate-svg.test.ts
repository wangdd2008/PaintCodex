import { describe, expect, it } from 'vitest';
import { isSafeSvg, unsafeSvgReason } from '../src/paint/agent/runtime/validate-svg.js';

describe('SVG safety', () => {
  const unsafe = [
    ['script tags', '<svg><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ['embedded images', '<svg><image href="x.png"/></svg>'],
    ['event handlers', '<svg onload="alert(1)"></svg>'],
    ['javascript URLs', '<svg><a href="javascript:alert(1)">x</a></svg>'],
    ['style imports', '<svg><style>@import url(https://evil.test/x.css);</style></svg>'],
    [
      'remote paint servers',
      '<svg><rect style="fill:url(https://evil.test/x.svg#p)"/></svg>',
    ],
    [
      'data paint servers',
      '<svg><rect fill="url(data:image/svg+xml;base64,AAAA)"/></svg>',
    ],
    ['protocol-relative links', '<svg><a href="//evil.test">x</a></svg>'],
    ['markup that is not an svg root', '<div>not svg</div>'],
  ] as const;

  it.each(unsafe)('rejects %s', (_label, svg) => {
    expect(isSafeSvg(svg)).toBe(false);
    expect(unsafeSvgReason(svg)).not.toBeNull();
  });

  it('accepts a plain shape', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

    expect(isSafeSvg(svg)).toBe(true);
    expect(unsafeSvgReason(svg)).toBeNull();
  });

  it('rejects an empty or overlong document', () => {
    expect(isSafeSvg('')).toBe(false);
    expect(isSafeSvg(`<svg>${'x'.repeat(200_001)}</svg>`)).toBe(false);
  });
});
