import {
  ApiBlueprint,
  createApiFactory,
  createExtension,
  createExtensionBlueprint,
  createExtensionBlueprintParams,
  createExtensionDataRef,
  createExtensionInput,
} from '@backstage/frontend-plugin-api';
import { taskFormRegistryApiRef, TaskFormRegistry } from './taskFormRegistryApiRef';
import type { TaskFormComponentType } from './types';

export interface TaskFormEntry {
  formKey: string;
  component: TaskFormComponentType;
}

const taskFormDataRef = createExtensionDataRef<TaskFormEntry>().with({
  id: 'branchline.task-form',
});

/**
 * Lets a consumer of the branchline plugin register a React form component for a
 * given BPMN `branchlineFormKey` task header, to be rendered in the task drawer
 * in place of the default "Mark Complete" action.
 */
export const TaskFormBlueprint = createExtensionBlueprint({
  kind: 'branchline-task-form',
  attachTo: { id: 'api:branchline/task-forms', input: 'forms' },
  output: [taskFormDataRef],
  defineParams: (params: { formKey: string; component: TaskFormComponentType }) =>
    createExtensionBlueprintParams(params),
  *factory(params) {
    yield taskFormDataRef({ formKey: params.formKey, component: params.component });
  },
});

// Collects every TaskFormBlueprint extension attached above into a single
// taskFormRegistryApiRef, resolved via the normal Backstage API/DI system.
export const taskFormsCollectorExtension = createExtension({
  kind: 'api',
  name: 'task-forms',
  attachTo: { id: 'root', input: 'apis' },
  inputs: {
    forms: createExtensionInput([taskFormDataRef]),
  },
  output: [ApiBlueprint.dataRefs.factory],
  factory({ inputs }) {
    const entries = inputs.forms.map(input => input.get(taskFormDataRef));
    const componentsByFormKey = new Map(entries.map(entry => [entry.formKey, entry.component]));
    const registry: TaskFormRegistry = {
      get: formKey => componentsByFormKey.get(formKey),
    };
    return [
      ApiBlueprint.dataRefs.factory(
        createApiFactory({
          api: taskFormRegistryApiRef,
          deps: {},
          factory: () => registry,
        }),
      ),
    ];
  },
});
