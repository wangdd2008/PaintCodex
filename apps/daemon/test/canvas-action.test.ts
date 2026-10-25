import { describe, expect, it } from 'vitest';
import {
  CANVAS_ACTION_MARKER,
  isSafeSvg,
  parseCanvasAction,
} from '../src/paint/agent/canvas-action.js';

function actionText(svg: string): string {
  return `Sure.\n${CANVAS_ACTION_MARKER}\n${JSON.stringify({
    name: 'AI — Test',
    svg,
  })}`;
}

describe('canvas action parsing', () => {
  it('extracts a safe SVG action', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="10"/></svg>';

    expect(parseCanvasAction(actionText(svg))).toEqual({
      name: 'AI — Test',
      svg,
    });
  });

  it('ignores ordinary conversation', () => {
    expect(parseCanvasAction('Paris is the capital of France.')).toBeNull();
  });
});

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
  });

  it('accepts a plain shape', () => {
    expect(
      isSafeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      ),
    ).toBe(true);
  });
});
