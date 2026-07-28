import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { fireEvent, screen } from '@testing-library/react';
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
  it('reports the open count and keeps feedback out of the drawer until opened', async () => {
    const onOpenCountChange = jest.fn();
    await render({ canManage: false, onOpenCountChange });

    // Summary button is shown, but the feedback body is not inline anymore.
    expect(await screen.findByText('View feedback')).toBeTruthy();
    expect(screen.getByText('1 of 1 open')).toBeTruthy();
    expect(screen.queryByText('Add rate limiting')).toBeNull();
    expect(onOpenCountChange).toHaveBeenCalledWith(1);
  });

  it('opens the feedback dialog and drills into an item', async () => {
    await render({ canManage: true });

    fireEvent.click(await screen.findByText('View feedback'));
    // List row shows the feedback body.
    fireEvent.click(await screen.findByText('Add rate limiting'));

    // Detail view exposes the owning-team management actions.
    expect(await screen.findByText('Resolve')).toBeTruthy();
    expect(screen.getByText('Grant Exception')).toBeTruthy();
    expect(screen.getByText('Comments')).toBeTruthy();
  });

  it('shows the add-feedback affordance only to the owning team', async () => {
    await render({ canManage: true });
    expect(await screen.findByText('Add feedback')).toBeTruthy();
  });

  it('hides the add-feedback affordance from non-owning users', async () => {
    await render({ canManage: false });
    expect(await screen.findByText('View feedback')).toBeTruthy();
    expect(screen.queryByText('Add feedback')).toBeNull();
  });
});
