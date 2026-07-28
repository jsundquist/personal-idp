import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import type { FeedbackItem } from '../../types';
import { FeedbackDialog, type FeedbackView } from './FeedbackDialog';

const ITEMS: FeedbackItem[] = [
  {
    id: 'fb-1',
    instanceId: 'wf-1',
    taskId: 'gate-arch',
    authorGroup: 'group:default/arb',
    author: 'user:default/reviewer',
    body: 'Add rate limiting',
    status: 'open',
    comments: [
      {
        id: 'c-1',
        feedbackId: 'fb-1',
        author: 'user:default/dev',
        body: 'Working on it',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function mockApi() {
  return {
    listTaskFeedback: jest.fn(),
    addFeedback: jest.fn().mockResolvedValue({}),
    addFeedbackComment: jest.fn().mockResolvedValue({}),
    closeFeedback: jest.fn().mockResolvedValue({}),
  };
}

async function render(props: {
  canManage: boolean;
  initialView?: FeedbackView;
  api?: ReturnType<typeof mockApi>;
  onMutated?: jest.Mock;
  onClose?: jest.Mock;
}) {
  const api = props.api ?? mockApi();
  await renderInTestApp(
    <TestApiProvider apis={[[branchlineApiRef, api]]}>
      <FeedbackDialog
        open
        onClose={props.onClose ?? jest.fn()}
        instanceId="wf-1"
        taskId="gate-arch"
        items={ITEMS}
        loading={false}
        canManage={props.canManage}
        initialView={props.initialView ?? 'list'}
        onMutated={props.onMutated ?? jest.fn()}
      />
    </TestApiProvider>,
  );
  return api;
}

describe('FeedbackDialog', () => {
  it('drills from the list into a feedback detail and back again', async () => {
    await render({ canManage: true });

    fireEvent.click(await screen.findByText('Add rate limiting'));

    // Detail view: management actions above the comments, and the comment shows.
    expect(await screen.findByText('Resolve')).toBeTruthy();
    expect(screen.getByText('Working on it')).toBeTruthy();

    // Back returns to the list, where the management actions are gone.
    fireEvent.click(screen.getByLabelText('Back to feedback list'));
    expect(screen.queryByText('Resolve')).toBeNull();
    expect(await screen.findByText('Add rate limiting')).toBeTruthy();
  });

  it('renders a comment on a timeline with author, initials avatar and timestamp', async () => {
    await render({ canManage: true });

    fireEvent.click(await screen.findByText('Add rate limiting'));

    // Author name and body render inside the timeline content.
    expect(await screen.findByText('dev')).toBeTruthy();
    expect(screen.getByText('Working on it')).toBeTruthy();

    // Initials avatar for user:default/dev.
    expect(screen.getByText('DE')).toBeTruthy();

    // Date and time of the comment are shown, formatted the same way the component does
    // so the assertion stays timezone-agnostic.
    const created = '2026-01-02T00:00:00Z';
    const date = new Date(created).toLocaleDateString();
    const time = new Date(created).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(date)).toBeTruthy();
    expect(screen.getByText(time)).toBeTruthy();
  });

  it('lets any participant comment but only the owning team resolve', async () => {
    const api = await render({ canManage: false });

    fireEvent.click(await screen.findByText('Add rate limiting'));

    // No management actions for a non-owning user.
    expect(screen.queryByText('Resolve')).toBeNull();
    expect(screen.queryByText('Grant Exception')).toBeNull();

    // ...but the comment box still works.
    fireEvent.change(screen.getByPlaceholderText('Add a comment…'), {
      target: { value: 'Looks good' },
    });
    fireEvent.click(screen.getByText('Comment'));
    expect(api.addFeedbackComment).toHaveBeenCalledWith('wf-1', 'fb-1', 'Looks good');
  });

  it('resolves feedback from the detail view after confirming', async () => {
    const onMutated = jest.fn();
    const api = await render({ canManage: true, onMutated });

    fireEvent.click(await screen.findByText('Add rate limiting'));

    // First click only arms the confirmation — nothing is closed yet.
    fireEvent.click(await screen.findByText('Resolve'));
    expect(api.closeFeedback).not.toHaveBeenCalled();

    // Confirming performs the resolve.
    fireEvent.click(await screen.findByText('Confirm Resolve'));
    expect(api.closeFeedback).toHaveBeenCalledWith('wf-1', 'fb-1', 'resolved');
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });

  it('cancels a resolve confirmation without closing the finding', async () => {
    const api = await render({ canManage: true });

    fireEvent.click(await screen.findByText('Add rate limiting'));
    fireEvent.click(await screen.findByText('Resolve'));
    fireEvent.click(await screen.findByText('Cancel'));

    // Back to the initial actions, nothing mutated.
    expect(await screen.findByText('Grant Exception')).toBeTruthy();
    expect(api.closeFeedback).not.toHaveBeenCalled();
  });

  it('logs new feedback from the add view', async () => {
    const onMutated = jest.fn();
    const api = await render({ canManage: true, initialView: 'add', onMutated });

    fireEvent.change(await screen.findByLabelText('What needs to be done?'), {
      target: { value: 'Needs a runbook' },
    });
    fireEvent.click(screen.getByText('Log feedback'));

    expect(api.addFeedback).toHaveBeenCalledWith('wf-1', 'gate-arch', 'Needs a runbook');
  });
});
