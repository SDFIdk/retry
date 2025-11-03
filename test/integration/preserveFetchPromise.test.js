import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { preserveFetchPromise } from '../../src/retry.js'

const url = 'http://example.com'

const mockCall = (delay = 0, responseCode = 200, count = 1) => {
  return nock(url)
    .get('/')
    .delay(delay)
    .times(count)
    .reply(responseCode, {})
}

describe('preserveFetchTests', async () => {
  beforeEach(() => nock.cleanAll())
  
  it('Check that the attempt returns unresolved promise when soft timeout expires', async () => {
    mockCall(100, 200)
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 50 },
        { attemptArray: [], attemptNumber: 0, remainingTime: 400 }
      )
      // Soft timeout (50ms) expires before fetch completes (100ms)
      assert.equal(response.success, false, 'Should be unsuccessful due to soft timeout')
      assert.ok(response.promise, 'Should include promise for future racing')
      assert.equal(response.attemptNumber, 0, 'Should have correct attempt number')
      assert.equal(response.response, undefined, 'Should not have response yet')
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  })
  
  it('Check that the attempt returns resolved promise when fetch completes before timeout', async () => {
    mockCall(100, 200)
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 200 },
        { attemptArray: [], attemptNumber: 0, remainingTime: 400 }
      )
      // Fetch completes (100ms) before soft timeout (200ms)
      assert.equal(response.success, true, 'Should be successful')
      assert.equal(response.response.status, 200, 'Should have correct status')
      assert.equal(response.attemptNumber, 0, 'Should have correct attempt number')
      assert.ok(response.promise, 'Should include promise wrapper')
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  })
  
  it('Race multiple attempts and retrieve the first one to resolve', async () => {
    mockCall(250, 200)
    mockCall(100, 200)
    try {
      // First attempt: soft timeout at 200ms, fetch takes 250ms
      const weakTimedOutResponse = await preserveFetchPromise(
        url,
        { timeout: 200 },
        { attemptArray: [], attemptNumber: 0, remainingTime: 400 }
      )

      assert.equal(weakTimedOutResponse.success, false, 'First attempt should timeout')
      assert.ok(weakTimedOutResponse.promise, 'Should preserve promise')
      assert.equal(weakTimedOutResponse.attemptNumber, 0)

      // Second attempt: races against first attempt's preserved promise
      const resolvedResponse = await preserveFetchPromise(
        url,
        { timeout: 200 },
        { attemptArray: [weakTimedOutResponse.promise], attemptNumber: 1, remainingTime: 200 }
      )
      
      // Second attempt completes faster (100ms) and wins the race
      assert.equal(resolvedResponse.success, true, 'Second attempt should succeed')
      assert.equal(resolvedResponse.response.status, 200, 'Should have correct status')
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  })
  
  it('preserveFetchPromise should fail on bad response status code', async () => {
    mockCall(50, 500)
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 200, statusCodes: [500, 502, 503, 504] },
        { attemptArray: [], attemptNumber: 0, remainingTime: 400 }
      )
      
      // Fetch completes quickly but with bad status code
      assert.equal(response.success, false, 'Should fail due to bad status code')
      assert.equal(response.attemptNumber, 0)
      assert.equal(response.promise, undefined, 'Should not preserve promise for non-retriable error')
    } catch (error) {
      assert.fail(`Unexpected error was thrown: ${error.message}`)
    }
  })
  
  it('When hard timeout is hit, should return AbortError as successful response', async () => {
    mockCall(500, 200)
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 200 },
        { attemptArray: [], attemptNumber: 0, remainingTime: 100 }
      )
      
      // Hard timeout (100ms) is hit before fetch completes (500ms)
      assert.equal(response.success, true, 'Should be "successful" to stop retrying')
      assert.equal(response.response.name, 'AbortError', 'Should contain AbortError')
      assert.equal(response.attemptNumber, 0)
      assert.ok(response.promise, 'Should include promise wrapper')
    } catch (error) {
      assert.fail(`Unexpected error was thrown: ${error.message}`)
    }
  })
  
  it('Earlier attempt wins race even after soft timeout', async () => {
    mockCall(150, 200)
    mockCall(200, 200)
    try {
      // First attempt: soft timeout at 100ms, but fetch completes at 150ms
      const firstAttempt = await preserveFetchPromise(
        url,
        { timeout: 100 },
        { attemptArray: [], attemptNumber: 0, remainingTime: 500 }
      )
      
      assert.equal(firstAttempt.success, false, 'Should soft timeout')
      assert.ok(firstAttempt.promise, 'Should preserve first attempt promise')
      
      // Second attempt: starts with soft timeout at 200ms
      // But first attempt completes at 150ms total and wins the race
      const secondAttempt = await preserveFetchPromise(
        url,
        { timeout: 200 },
        { attemptArray: [firstAttempt.promise], attemptNumber: 1, remainingTime: 400 }
      )
      
      // First attempt should win because it completes at 150ms
      // while second attempt won't complete until 200ms+
      assert.equal(secondAttempt.success, true, 'First attempt should win')
      assert.equal(secondAttempt.attemptNumber, 0, 'Should be from first attempt')
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  })
})