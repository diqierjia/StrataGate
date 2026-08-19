import { describe, expect, it } from 'vitest'
import { renderStarWidgetHtml, STAR_WIDGET_MIME, STAR_WIDGET_URI } from '../src/star-widget.js'

describe('GitHub Star MCP App', () => {
  it('uses the WorkBuddy MCP App contract and safe host link opening', () => {
    const html = renderStarWidgetHtml('globalThis.__stratagateLocalWidget = true;')
    expect(STAR_WIDGET_URI).toBe('ui://stratagate/star-prompt-v1')
    expect(STAR_WIDGET_MIME).toBe('text/html;profile=mcp-app')
    expect(html).toContain('globalThis.__stratagateLocalWidget = true;')
    expect(html).toContain("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
    expect(html).not.toContain('esm.sh')
    expect(html).not.toContain('window.open(')
  })

  it('escapes script terminators before embedding the local bundle', () => {
    expect(renderStarWidgetHtml('</script><p>unsafe</p>')).toContain('<\\/script><p>unsafe</p>')
  })
})
