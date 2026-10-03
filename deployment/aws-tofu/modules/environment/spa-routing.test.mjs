// Pins down the CloudFront Function that gives the SPA its deep links (spa-routing.js).
//
// It runs in CloudFront's own JavaScript runtime, which has no modules, so it is loaded here the
// way CloudFront loads it -- as a script declaring `handler` -- and called with the event shape
// CloudFront passes. Run with `node --test` (Tofu CI does); there are no dependencies.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./spa-routing.js', import.meta.url), 'utf8')
const context = {}
runInNewContext(source, context)
const route = (uri) => context.handler({ request: { uri, method: 'GET', headers: {} } }).uri

test('the root is the app', () => {
  assert.equal(route('/'), '/index.html')
})

test('a client-side route is the app, however deep', () => {
  assert.equal(route('/tasks'), '/index.html')
  assert.equal(route('/tasks/42/edit'), '/index.html')
})

test('a trailing slash is still a route', () => {
  assert.equal(route('/tasks/'), '/index.html')
})

test('a file is served as itself, so a missing one is still an error and not the app', () => {
  assert.equal(route('/assets/index-3f9a1c.js'), '/assets/index-3f9a1c.js')
  assert.equal(route('/favicon.svg'), '/favicon.svg')
  assert.equal(route('/index.html'), '/index.html')
})

test('a dot earlier in the path does not make a route a file', () => {
  assert.equal(route('/v1.2/tasks'), '/index.html')
})

test('the rest of the request is passed on untouched', () => {
  const request = { uri: '/tasks', method: 'GET', headers: { accept: { value: 'text/html' } } }
  const result = context.handler({ request })
  assert.equal(result.method, 'GET')
  assert.deepEqual(result.headers, { accept: { value: 'text/html' } })
})
