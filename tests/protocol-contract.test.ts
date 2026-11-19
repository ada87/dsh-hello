import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { PROTOCOL_VERSION } from '../src/protocol.js'

/**
 * The App lives in another repository, so the handshake shape is pinned on
 * both sides by `protocol-contract.json`. app-dsh has the mirror-image test
 * over its `src/api/dshHelloProtocol.ts`; keep the two JSON files identical.
 *
 * Additive fields keep protocol vN; removing or renaming one must bump it.
 */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./protocol-contract.json', import.meta.url)), 'utf8'),
) as {
  version: number
  interfaces: Record<string, string[]>
}

const source = readFileSync(fileURLToPath(new URL('../src/protocol.ts', import.meta.url)), 'utf8')

function interfaceBody(name: string): string {
  const header = new RegExp(`export interface ${name}(?:\\s+extends\\s+[^{]+)?\\s*\\{`)
  const match = header.exec(source)
  assert.ok(match !== null, `missing interface ${name}`)
  let depth = 0
  for (let index = match.index; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(match.index, index + 1)
    }
  }
  assert.fail(`unterminated interface ${name}`)
}

function fieldNames(body: string, indent: number): string[] {
  const pattern = new RegExp(`^${' '.repeat(indent)}(\\w+)\\??\\s*:`, 'gm')
  const names: string[] = []
  for (const match of body.matchAll(pattern)) names.push(match[1]!)
  return names.sort()
}

const serverFacts = interfaceBody('ServerFacts')
const health = interfaceBody('HealthResponse')
const features = /features\s*:\s*\{/.exec(health)
assert.ok(features !== null, 'HealthResponse must declare features')

const actual: Record<string, string[]> = {
  ServerFacts: fieldNames(serverFacts, 2),
  HealthResponse: fieldNames(health, 2),
  'HealthResponse.features': fieldNames(health.slice(features.index), 4),
}

test('the handshake fields match the contract shared with app-dsh', () => {
  for (const [name, expected] of Object.entries(fixture.interfaces)) {
    assert.deepEqual(
      actual[name],
      [...expected].sort(),
      `${name} drifted from the contract; update both repos and bump PROTOCOL_VERSION if fields were removed`,
    )
  }
  assert.equal(PROTOCOL_VERSION, fixture.version, 'PROTOCOL_VERSION must match the contract')
})
