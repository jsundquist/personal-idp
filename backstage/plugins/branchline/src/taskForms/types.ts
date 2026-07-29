import type { ComponentType } from 'react';
import type { Task } from '../types';

export interface TaskFormProps {
  instanceId: string;
  taskId: string;
  formKey: string;
  task: Task;
  /** Call after the form has successfully completed the task, so the drawer/task list can refresh. */
  onSubmitted: () => void;
  /** Call to close the drawer, e.g. if the user cancels. */
  onClose: () => void;
}

export type TaskFormComponentType = ComponentType<TaskFormProps>;
