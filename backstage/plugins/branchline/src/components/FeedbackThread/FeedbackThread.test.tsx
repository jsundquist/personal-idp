import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { screen } from '@testing-library/react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { FeedbackThread } from './FeedbackThread';

function mockApi(overrides?: Partial<Record<string, jest.Mock>>) {
  return {
    listTaskFeedback: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'fb-1',
          instanceId: 'wf-1',
          taskId: 'gate-arch',
          authorGroup: 'group:default/arb',
          author: 'user:default/reviewer',
          body: 'Add rate limiting',
          status: 'open',
          comments: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      counts: { open: 1, total: 1 },
    }),
    addFeedback: jest.fn(),
    addFeedbackComment: jest.fn(),
    closeFeedback: jest.fn(),
    ...overrides,
  };
}

async function render(props: {
  canManage: boolean;
  onOpenCountChange?: jest.Mock;
  api?: ReturnType<typeof mockApi>;
}) {
  const api = props.api ?? mockApi();
  await renderInTestApp(
    <TestApiProvider apis={[[branchlineApiRef, api]]}>
      <FeedbackThread
        instanceId="wf-1"
        taskId="gate-arch"
        canManage={props.canManage}
        onOpenCountChange={props.onOpenCountChange}
      />
    </TestApiProvider>,
  );
  return api;
}

describe('FeedbackThread', () => {
  it('renders feedback items with their status and reports the open count', async () => {
    const onOpenCountChange = jest.fn();
    await render({ canManage: false, onOpenCountChange });

    expect(await screen.findByText('Add rate limiting')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(onOpenCountChange).toHaveBeenCalledWith(1);
  });

  it('shows management actions only to the owning team', async () => {
    await render({ canManage: true });
    expect(await screen.findByText('Add rate limiting')).toBeTruthy();
    expect(screen.getByText('Add feedback')).toBeTruthy();
    expect(screen.getByText('Resolve')).toBeTruthy();
    expect(screen.getByText('Grant Exception')).toBeTruthy();
  });

  it('hides management actions from non-owning users', async () => {
    await render({ canManage: false });
    expect(await screen.findByText('Add rate limiting')).toBeTruthy();
    expect(screen.queryByText('Add feedback')).toBeNull();
    expect(screen.queryByText('Resolve')).toBeNull();
    // Any participant can still comment
    expect(screen.getByText('Comment')).toBeTruthy();
  });
});
