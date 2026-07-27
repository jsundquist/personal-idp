import { BranchlineClient } from './BranchlineClient';

function setup(responseBody: unknown = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => responseBody,
    text: async () => '',
  });
  const discoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue('http://localhost/api/branchline'),
  };
  const fetchApi = { fetch: fetchMock };
  const client = new BranchlineClient(discoveryApi as any, fetchApi as any);
  return { client, fetchMock };
}

describe('BranchlineClient feedback methods', () => {
  it('listTaskFeedback GETs the task feedback endpoint', async () => {
    const { client, fetchMock } = setup({ items: [], counts: { open: 0, total: 0 } });
    await client.listTaskFeedback('wf-1', 'gate-arch');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/branchline/workflows/wf-1/tasks/gate-arch/feedback',
      undefined,
    );
  });

  it('addFeedback POSTs the body', async () => {
    const { client, fetchMock } = setup({ id: 'fb-1' });
    await client.addFeedback('wf-1', 'gate-arch', 'Add rate limiting');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://localhost/api/branchline/workflows/wf-1/tasks/gate-arch/feedback',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ body: 'Add rate limiting' });
  });

  it('addFeedbackComment POSTs to the comments endpoint', async () => {
    const { client, fetchMock } = setup({ id: 'c-1' });
    await client.addFeedbackComment('wf-1', 'fb-1', 'Done');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://localhost/api/branchline/workflows/wf-1/feedback/fb-1/comments',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ body: 'Done' });
  });

  it('closeFeedback PATCHes status and exception reason', async () => {
    const { client, fetchMock } = setup({ id: 'fb-1', status: 'exception' });
    await client.closeFeedback('wf-1', 'fb-1', 'exception', 'accepted risk');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost/api/branchline/workflows/wf-1/feedback/fb-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      status: 'exception',
      exceptionReason: 'accepted risk',
    });
  });

  it('getAuditTrail GETs the audit endpoint', async () => {
    const { client, fetchMock } = setup([]);
    await client.getAuditTrail('wf-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/branchline/workflows/wf-1/audit',
      undefined,
    );
  });
});
