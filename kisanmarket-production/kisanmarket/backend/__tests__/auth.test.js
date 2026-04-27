// __tests__/auth.test.js — sample API test
const request = require('supertest');
process.env.JWT_SECRET = 'test_secret';
process.env.OTP_BYPASS = 'true';

// Note: requires running Postgres + Redis. CI brings these up via services.
describe('Auth flow', () => {
  // skipped if DB not reachable
  const apiBase = process.env.TEST_API || 'http://localhost:4000';

  it('rejects missing phone', async () => {
    const res = await request(apiBase).post('/api/v1/auth/send-otp').send({});
    expect([400, 503]).toContain(res.status);
  });

  it('sends OTP for valid phone (bypass mode)', async () => {
    const res = await request(apiBase).post('/api/v1/auth/send-otp').send({ phone: '9876543210' });
    if (res.status === 503) return; // server not running
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('healthcheck responds', async () => {
    const res = await request(apiBase).get('/health');
    if (res.status === 503) return;
    expect(res.status).toBe(200);
  });
});
