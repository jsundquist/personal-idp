import { createApiRef } from '@backstage/core-plugin-api';
import type { TaskFormComponentType } from './types';

export interface TaskFormRegistry {
  get(formKey: string): TaskFormComponentType | undefined;
}

export const taskFormRegistryApiRef = createApiRef<TaskFormRegistry>({
  id: 'plugin.branchline.task-form-registry',
});
