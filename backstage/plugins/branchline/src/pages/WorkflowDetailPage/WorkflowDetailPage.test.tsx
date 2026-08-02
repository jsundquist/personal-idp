import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { taskFormRegistryApiRef } from '../../taskForms/taskFormRegistryApiRef';
import { WorkflowDetailPage } from './WorkflowDetailPage';

function workflowWith(task: Record<string, unknown>) {
  return {
    id: 'wf-1',
    title: 'Basic Demo',
    owningGroup: 'group:default/developers',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    parallelBlocks: [
      {
        id: 'p1',
        label: 'Phase 1',
        steps: [{ id: 's1', label: '', parallelTasks: false, tasks: [task] }],
      },
    ],
  };
}

async function render(task: Record<string, unknown>) {
  const api = {
    getWorkflowInstance: jest.fn().mockResolvedValue(workflowWith(task)),
    listWorkflowInstances: jest.fn().mockResolvedValue([]),
  };
  const permissionApi = {
    authorize: jest.fn().mockResolvedValue({ result: AuthorizeResult.ALLOW }),
  };
  const formRegistry = { get: jest.fn().mockReturnValue(undefined) };
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [branchlineApiRef, api],
        [permissionApiRef, permissionApi],
        [taskFormRegistryApiRef, formRegistry],
      ]}
    >
      <Routes>
        <Route path="/branchline/:workflowId" element={<WorkflowDetailPage />} />
      </Routes>
    </TestApiProvider>,
    { initialRouteEntries: ['/branchline/wf-1'] },
  );
  return api;
}

describe('WorkflowDetailPage per-task groups', () => {
  it('shows a "Requires: <team>" chip for a task the user cannot act on', async () => {
    await render({
      id: 'arch-review',
      label: 'Architecture Review',
      status: 'active',
      candidateGroups: ['arb'],
      canAct: false,
    });
    expect(await screen.findByText('Requires: arb')).toBeTruthy();
  });

  it('does not show a Requires chip when the user can act', async () => {
    await render({
      id: 'submit',
      label: 'Submit Service Request',
      status: 'active',
      candidateGroups: ['developers'],
      canAct: true,
    });
    expect(await screen.findByText('Submit Service Request')).toBeTruthy();
    expect(screen.queryByText('Requires: developers')).toBeNull();
  });
});
