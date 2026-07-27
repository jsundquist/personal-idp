import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { screen } from '@testing-library/react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { AuditTrailDialog } from './AuditTrailDialog';

const WORKFLOW = {
  id: 'wf-1',
  title: 'New Orders API',
  parallelBlocks: [
    {
      id: 'p1',
      label: 'Phase 1',
      steps: [
        {
          id: 's1',
          label: '',
          parallelTasks: false,
          tasks: [{ id: 't1', label: 'Architecture Review', status: 'active' }],
        },
      ],
    },
  ],
};

function mockApi(events: unknown[]) {
  return { getAuditTrail: jest.fn().mockResolvedValue(events) };
}

async function render(events: unknown[]) {
  const api = mockApi(events);
  await renderInTestApp(
    <TestApiProvider apis={[[branchlineApiRef, api]]}>
      <AuditTrailDialog open onClose={() => {}} workflow={WORKFLOW as any} />
    </TestApiProvider>,
  );
  return api;
}

describe('AuditTrailDialog', () => {
  it('renders milestone events and maps taskId to the task label', async () => {
    const api = await render([
      { type: 'workflow-started', timestamp: '2026-01-01T00:00:00.000Z', actor: 'user:default/starter' },
      { type: 'feedback-created', timestamp: '2026-01-01T01:00:00.000Z', actor: 'user:default/rev', taskId: 't1', detail: 'Add rate limiting' },
      { type: 'feedback-resolved', timestamp: '2026-01-01T01:30:00.000Z', actor: 'user:default/rev', taskId: 't1' },
    ]);

    expect(await screen.findByText('Workflow started')).toBeTruthy();
    // taskId t1 resolves to its label from parallelBlocks
    expect(screen.getByText('Feedback resolved · Architecture Review')).toBeTruthy();
    expect(screen.getByText('Feedback logged · Architecture Review')).toBeTruthy();
    // starter name rendered
    expect(screen.getByText(/starter/)).toBeTruthy();
    expect(api.getAuditTrail).toHaveBeenCalledWith('wf-1');
  });

  it('shows an empty state when there is no activity', async () => {
    await render([]);
    expect(await screen.findByText('No activity recorded yet.')).toBeTruthy();
  });
});
