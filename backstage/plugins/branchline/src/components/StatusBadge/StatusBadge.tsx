import Chip from '@mui/material/Chip';
import type { TaskStatus, WorkflowStatus } from '../../types';

type DisplayStatus = TaskStatus | WorkflowStatus | 'blocked';

const statusConfig: Record<
  DisplayStatus,
  { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error'; variant?: 'outlined' | 'filled' }
> = {
  pending:    { label: 'Pending',    color: 'default' },
  active:     { label: 'Active',     color: 'primary' },
  completed:  { label: 'Completed',  color: 'success' },
  skipped:    { label: 'Skipped',    color: 'warning' },
  'not-taken':{ label: 'Not Taken',  color: 'warning', variant: 'outlined' },
  blocked:         { label: 'Blocked',      color: 'default', variant: 'outlined' },
  cancelled:       { label: 'Cancelled',    color: 'error' },
  failed:          { label: 'Failed',       color: 'error',   variant: 'outlined' },
  'caught-error':  { label: 'Caught Error', color: 'warning', variant: 'outlined' },
};

interface StatusBadgeProps {
  status: DisplayStatus;
  size?: 'small' | 'medium';
}

export function StatusBadge({ status, size = 'small' }: StatusBadgeProps) {
  const cfg = statusConfig[status] ?? { label: status, color: 'default' as const };
  return <Chip label={cfg.label} color={cfg.color} size={size} variant={cfg.variant ?? 'filled'} />;
}
