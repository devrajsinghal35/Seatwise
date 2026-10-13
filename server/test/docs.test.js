import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

describe('OpenAPI 3 Documentation (/api/docs)', () => {
  test('serves OpenAPI 3 specification JSON at /api/docs.json', async (t) => {
    const srv = await startTestServer();
    t.after(() => srv.close());

    const res = await srv.get('/api/docs.json');
    assert.equal(res.status, 200);

    const spec = res.body;
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'SeatWise API');
    assert.ok(spec.paths['/shows/{id}/hold']);
    assert.ok(spec.paths['/bookings']);
    assert.ok(spec.paths['/health']);
  });

  test('serves Swagger UI at /api/docs/', async (t) => {
    const srv = await startTestServer();
    t.after(() => srv.close());

    const res = await srv.get('/api/docs/');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === 'string');
    assert.ok(res.body.includes('Swagger UI') || res.body.includes('swagger-ui'));
  });
});
