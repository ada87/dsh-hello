import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldHoldInteraction } from '../src/interactions.js'

/**
 * dsh hands a request to one answerer, so the whole feature is this decision.
 * Every mode is asserted against both "a browser is live" and "the app is in
 * the foreground" so a change cannot silently steal requests from the browser.
 */
test('browser-only never holds, whatever is connected', () => {
  for (const browserLive of [true, false]) {
    for (const foregroundPhone of [true, false]) {
      for (const appConnected of [true, false]) {
        assert.equal(
          shouldHoldInteraction({ target: 'browser-only', browserLive, foregroundPhone, appConnected }),
          false,
        )
      }
    }
  }
})

test('browser-first yields to a live browser and otherwise takes a connected app', () => {
  assert.equal(
    shouldHoldInteraction({ target: 'browser-first', browserLive: true, foregroundPhone: true, appConnected: true }),
    false,
    'a live browser always wins',
  )
  assert.equal(
    shouldHoldInteraction({ target: 'browser-first', browserLive: false, foregroundPhone: false, appConnected: true }),
    true,
    'no browser: the app holds even in the background',
  )
  assert.equal(
    shouldHoldInteraction({ target: 'browser-first', browserLive: false, foregroundPhone: false, appConnected: false }),
    false,
    'nothing connected: dsh keeps its fail-closed path',
  )
})

test('phone-first holds only while the app is in the foreground', () => {
  assert.equal(
    shouldHoldInteraction({ target: 'phone-first', browserLive: false, foregroundPhone: true, appConnected: true }),
    true,
  )
  assert.equal(
    shouldHoldInteraction({ target: 'phone-first', browserLive: true, foregroundPhone: true, appConnected: true }),
    true,
    'the foreground app outranks a live browser in this mode',
  )
  assert.equal(
    shouldHoldInteraction({ target: 'phone-first', browserLive: false, foregroundPhone: false, appConnected: true }),
    false,
    'backgrounded app hands the request to dsh',
  )
})
